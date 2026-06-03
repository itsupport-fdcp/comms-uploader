import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { lookup as mimeLookup } from 'mime-types';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getDb, saveDb } from '@/lib/db';

const execPromise = promisify(exec);

interface VideoInfo {
  duration: number;
  size: number;
  bitrate: number;
  width?: number;
  height?: number;
  format?: string;
  hasAudio?: boolean;
}

async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  try {
    const { stdout } = await execPromise(
      `ffprobe -v error -print_format json -show_format -show_streams "${filePath}"`
    );
    const data = JSON.parse(stdout);
    
    const format = data.format || {};
    const duration = parseFloat(format.duration) || 0;
    const size = parseInt(format.size) || 0;
    const bitrate = parseInt(format.bit_rate) || 0;

    // Find the video stream
    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
    const width = videoStream?.width;
    const height = videoStream?.height;

    // Check if an audio stream exists
    const hasAudio = data.streams?.some((s: any) => s.codec_type === 'audio') ?? false;

    return {
      duration,
      size,
      bitrate,
      width,
      height,
      format: format.format_name,
      hasAudio,
    };
  } catch (error) {
    console.error('Error running ffprobe:', error);
    throw error;
  }
}

async function getFilesRecursively(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? getFilesRecursively(res) : res;
    })
  );
  return Array.prototype.concat(...files);
}

function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '');
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const eventId = formData.get('event_id') ? Number(formData.get('event_id')) : null;
    const uploadedBy = (formData.get('uploaded_by') as string) || 'anonymous';

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file uploaded' },
        { status: 400 }
      );
    }

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || 'ap-southeast-1';
    const bucket = process.env.AWS_S3_BUCKET || 'fdcp-images';

    if (!accessKeyId || !secretAccessKey) {
      console.error('AWS credentials are not configured on the server.');
      return NextResponse.json(
        {
          success: false,
          error: 'AWS Server Configuration Error: AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is missing.',
        },
        { status: 500 }
      );
    }

    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Lookup mime type using file type or file name
    const contentType = file.type || mimeLookup(file.name) || 'application/octet-stream';
    const isVideo = contentType.startsWith('video/');

    let fileContent: Buffer | null = null;
    let sanitizedName = sanitizeFilename(file.name);
    let finalContentType = contentType;

    let isHls = false;
    let hlsTotalSize = 0;
    let hlsTempDir = '';

    if (isVideo) {
      console.log(`Received video for HLS processing: ${file.name} (${file.size} bytes)`);
      
      const arrayBuffer = await file.arrayBuffer();
      const inputBuffer = Buffer.from(arrayBuffer);
      
      const tempDir = path.join(process.cwd(), 'temp');
      await fs.mkdir(tempDir, { recursive: true });
      
      const ext = path.extname(file.name).replace('.', '') || 'mp4';
      const tempInputPath = path.join(tempDir, `input_${Date.now()}_${crypto.randomUUID()}.${ext}`);
      
      // Dedicated directory for HLS segments
      const hlsFolderName = `hls_${Date.now()}_${crypto.randomUUID()}`;
      hlsTempDir = path.join(tempDir, hlsFolderName);
      await fs.mkdir(hlsTempDir, { recursive: true });
      
      try {
        // Write file buffer to temp file
        await fs.writeFile(tempInputPath, inputBuffer);
        
        // Inspect video via ffprobe
        const info = await getVideoInfo(tempInputPath);
        const duration = info.duration;
        
        console.log(`Video duration: ${duration}s, size: ${info.size} bytes, format: ${info.format}`);
        
        // Ensure input height and width are rounded to even numbers for libx264 compliance
        let inputHeight = info.height ? Math.floor(info.height / 2) * 2 : 720;
        let inputWidth = info.width ? Math.floor(info.width / 2) * 2 : 1280;

        // Cap the maximum resolution to 1080p to prevent EC2 instances (like t2.micro/t3.micro with 1GB RAM)
        // from running out of memory (OOM) and getting the FFmpeg process killed (Exit Code 137).
        const MAX_HEIGHT_CAP = 1080;
        if (inputHeight > MAX_HEIGHT_CAP) {
          const scaleRatio = MAX_HEIGHT_CAP / inputHeight;
          inputWidth = Math.floor((inputWidth * scaleRatio) / 2) * 2;
          inputHeight = MAX_HEIGHT_CAP;
        }

        const hasAudio = info.hasAudio ?? false;

        if (duration <= 0) {
          console.log('Skipping compression: invalid duration.');
          fileContent = inputBuffer;
        } else {
          // Standard resolution profiles
          interface ResolutionProfile {
            name: string;
            width: number;
            height: number;
            bitrateKbps: number;
          }

          const PROFILES: ResolutionProfile[] = [
            { name: '1080p', width: 1920, height: 1080, bitrateKbps: 3000 },
            { name: '720p', width: 1280, height: 720, bitrateKbps: 1500 },
            { name: '480p', width: 854, height: 480, bitrateKbps: 800 },
            { name: '360p', width: 640, height: 360, bitrateKbps: 400 },
            { name: '240p', width: 426, height: 240, bitrateKbps: 200 },
          ];

          // 1. Get all standard profiles strictly lower than the input height
          const lowerProfiles = PROFILES.filter(p => p.height < inputHeight);

          // 2. Determine bitrate for the original video based on duration / target size
          let targetSizeMb = 2;
          if (duration > 10) {
            if (duration >= 60) {
              targetSizeMb = 8;
            } else {
              targetSizeMb = 2 + ((duration - 10) / 50) * 6;
            }
          }
          const targetSizeBytes = targetSizeMb * 1024 * 1024;
          const targetTotalBitrate = (targetSizeBytes * 8) / duration;
          const audioBitrate = 128 * 1000;
          let targetVideoBitrate = targetTotalBitrate - audioBitrate;

          // Apply bounds (400 kbps to 4000 kbps)
          const videoBitrateFloor = 400 * 1000;
          const videoBitrateCeiling = 4000 * 1000;

          if (targetVideoBitrate < videoBitrateFloor) {
            targetVideoBitrate = videoBitrateFloor;
          } else if (targetVideoBitrate > videoBitrateCeiling) {
            targetVideoBitrate = videoBitrateCeiling;
          }

          const originalBitrateKbps = Math.round(targetVideoBitrate / 1000);

          // 3. Create the original profile
          const originalProfile: ResolutionProfile = {
            name: `${inputHeight}p`,
            width: inputWidth,
            height: inputHeight,
            bitrateKbps: originalBitrateKbps
          };

          // 4. Combine them: original profile + all lower profiles
          const activeProfiles = [originalProfile, ...lowerProfiles];
          console.log(`Active resolution profiles to encode: ${activeProfiles.map(p => p.name).join(', ')}`);

          // 5. Transcode each profile sequentially
          for (const profile of activeProfiles) {
            const profileDir = path.join(hlsTempDir, profile.name);
            await fs.mkdir(profileDir, { recursive: true });

            const ffmpegTempInputPath = tempInputPath.replace(/\\/g, '/');
            const ffmpegSegmentPath = path.join(profileDir, 'seg_%03d.ts').replace(/\\/g, '/');
            const ffmpegPlaylistPath = path.join(profileDir, 'playlist.m3u8').replace(/\\/g, '/');

            const videoFilter = `scale=-2:${profile.height},format=yuv420p`;
            const audioParams = hasAudio ? `-c:a aac -b:a 128k` : `-an`;

            const ffmpegCommand = `ffmpeg -y -i "${ffmpegTempInputPath}" -c:v libx264 -preset fast -b:v ${profile.bitrateKbps}k -maxrate ${Math.round(profile.bitrateKbps * 1.5)}k -bufsize ${profile.bitrateKbps * 2}k -vf "${videoFilter}" ${audioParams} -hls_time 6 -hls_playlist_type vod -hls_segment_filename "${ffmpegSegmentPath}" "${ffmpegPlaylistPath}"`;

            console.log(`[HLS] Encoding ${profile.name} (bitrate: ${profile.bitrateKbps}k)...`);
            const startTime = Date.now();
            await execPromise(ffmpegCommand);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[HLS] Completed encoding ${profile.name} in ${elapsed}s.`);
          }

          // 6. Generate the master playlist (playlist.m3u8) in the root hlsTempDir
          let masterPlaylistContent = '#EXTM3U\n#EXT-X-VERSION:3\n';
          for (const profile of activeProfiles) {
            const aspectWidth = Math.round((inputWidth * profile.height) / inputHeight);
            const profileWidth = Math.round(aspectWidth / 2) * 2;
            const bandwidth = (profile.bitrateKbps * 1000) + (hasAudio ? 128000 : 0);

            masterPlaylistContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${profileWidth}x${profile.height},NAME="${profile.name}"\n`;
            masterPlaylistContent += `${profile.name}/playlist.m3u8\n`;
          }

          await fs.writeFile(path.join(hlsTempDir, 'playlist.m3u8'), masterPlaylistContent, 'utf-8');
          console.log('[HLS] Generated master playlist.');

          isHls = true;
          const originalNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          sanitizedName = sanitizeFilename(`${originalNameWithoutExt}.mp4`);
          finalContentType = 'application/x-mpegURL';
        }
      } catch (err) {
        console.error('Error during video HLS compression, falling back to original video upload:', err);
        fileContent = inputBuffer;
        isHls = false;
      } finally {
        // Clean up temp input file
        try {
          await fs.unlink(tempInputPath).catch(() => {});
        } catch (cleanupErr) {
          console.error('Cleanup failed:', cleanupErr);
        }
      }
    } else {
      const arrayBuffer = await file.arrayBuffer();
      fileContent = Buffer.from(arrayBuffer);
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Resolve event name for the S3 folder path
    let eventFolder = 'general';
    try {
      const dbInstance = await getDb();
      const resolvedEventId = eventId || 1;
      const eventResult = dbInstance.exec(
        'SELECT name, year FROM events WHERE id = ?',
        [resolvedEventId]
      );
      if (eventResult.length && eventResult[0].values.length) {
        const [evName, evYear] = eventResult[0].values[0] as [string, number];
        // Sanitize for use in S3 path: lowercase, spaces to hyphens
        eventFolder = `${evName}-${evYear}`.toLowerCase().replace(/\s+/g, '-');
      }
    } catch (evErr) {
      console.warn('Could not resolve event name for path:', evErr);
    }

    const folder = `uploads/${year}-${month}/${eventFolder}/`;
    
    let key = '';
    let publicUrl = '';
    let compressedSize = 0;

    if (isHls && hlsTempDir) {
      // HLS Directory upload: multiple segments and playlist
      const uniqueFolder = `${Date.now()}-${sanitizedName.replace(/\.[^/.]+$/, '')}`;
      const hlsS3Prefix = `${folder}${uniqueFolder}/`;
      
      const allFiles = await getFilesRecursively(hlsTempDir);
      key = `${hlsS3Prefix}playlist.m3u8`;
      publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

      console.log(`Uploading HLS files to prefix: ${hlsS3Prefix}`);
      for (const absolutePath of allFiles) {
        const relativePath = path.relative(hlsTempDir, absolutePath);
        const s3RelativePath = relativePath.replace(/\\/g, '/');

        const fileBuf = await fs.readFile(absolutePath);
        hlsTotalSize += fileBuf.length;

        const fileS3Key = `${hlsS3Prefix}${s3RelativePath}`;
        const fileContentType = s3RelativePath.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';

        await s3Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: fileS3Key,
          Body: fileBuf,
          ContentType: fileContentType,
          ContentDisposition: 'inline',
        }));
      }

      console.log(`HLS upload completed. Total size: ${hlsTotalSize} bytes.`);
      compressedSize = hlsTotalSize;

      // Clean up local HLS temp files
      try {
        await fs.rm(hlsTempDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error('Failed to remove local HLS temp folder:', cleanupErr);
      }
    } else {
      // Standard single file upload (photos or fallback video)
      key = `${folder}${Date.now()}-${sanitizedName}`;
      publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
      compressedSize = fileContent!.length;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileContent!,
        ContentType: finalContentType,
        ContentDisposition: 'inline',
      });

      await s3Client.send(command);
      console.log(`Uploaded single file to S3: ${key} (${fileContent!.length} bytes)`);
    }

    // --- SQLite: record upload ---
    let uploadId: number | null = null;
    try {
      const db = await getDb();
      const originalSize = file.size;
      const fileType = isVideo ? 'video' : 'image';
      const resolvedEventId = eventId || 1; // fallback to first event

      db.run(
        `INSERT INTO uploads (event_id, filename, s3_key, url, file_type, original_size, compressed_size, uploaded_by, current_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [resolvedEventId, sanitizedName, key, publicUrl, fileType, originalSize, compressedSize, uploadedBy]
      );

      const idResult = db.exec('SELECT last_insert_rowid() AS id');
      uploadId = idResult[0]?.values[0]?.[0] as number;

      if (uploadId) {
        db.run(
          `INSERT INTO upload_versions (upload_id, version_number, filename, s3_key, url, uploaded_by)
           VALUES (?, 1, ?, ?, ?, ?)`,
          [uploadId, sanitizedName, key, publicUrl, uploadedBy]
        );

        db.run(
          `INSERT INTO upload_actions (upload_id, action, performed_by) VALUES (?, 'UPLOAD', ?)`,
          [uploadId, uploadedBy]
        );
      }

      saveDb(db);
    } catch (dbErr) {
      console.error('SQLite write error (non-fatal):', dbErr);
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      filename: sanitizedName,
      compressedSize,
      uploadId,
    });
  } catch (error: any) {
    console.error('Presign Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'An error occurred generating the upload URL.' },
      { status: 500 }
    );
  }
}
