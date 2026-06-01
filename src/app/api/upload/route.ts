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

    return {
      duration,
      size,
      bitrate,
      width,
      height,
      format: format.format_name,
    };
  } catch (error) {
    console.error('Error running ffprobe:', error);
    throw error;
  }
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

    let fileContent: Buffer;
    let sanitizedName = sanitizeFilename(file.name);
    let finalContentType = contentType;

    if (isVideo) {
      console.log(`Received video for processing: ${file.name} (${file.size} bytes)`);
      
      const arrayBuffer = await file.arrayBuffer();
      const inputBuffer = Buffer.from(arrayBuffer);
      
      const tempDir = path.join(process.cwd(), 'temp');
      await fs.mkdir(tempDir, { recursive: true });
      
      const ext = path.extname(file.name).replace('.', '') || 'mp4';
      const tempInputPath = path.join(tempDir, `input_${Date.now()}_${crypto.randomUUID()}.${ext}`);
      const tempOutputPath = path.join(tempDir, `output_${Date.now()}_${crypto.randomUUID()}.mp4`);
      
      try {
        // Write file buffer to temp file
        await fs.writeFile(tempInputPath, inputBuffer);
        
        // Inspect video via ffprobe
        const info = await getVideoInfo(tempInputPath);
        const duration = info.duration;
        
        console.log(`Video duration: ${duration}s, size: ${info.size} bytes, format: ${info.format}`);
        
        // Calculate target size (2 MB to 8 MB based on duration)
        // D <= 10s: 2MB. D >= 60s: 8MB. 10s < D < 60s: linear scale.
        let targetSizeMb = 2;
        if (duration > 10) {
          if (duration >= 60) {
            targetSizeMb = 8;
          } else {
            targetSizeMb = 2 + ((duration - 10) / 50) * 6;
          }
        }
        
        const targetSizeBytes = targetSizeMb * 1024 * 1024;
        const isStandardWebFormat = ext.toLowerCase() === 'mp4' || ext.toLowerCase() === 'm4v';
        
        if (info.size <= targetSizeBytes && isStandardWebFormat) {
          console.log(`Skipping compression: original file (${info.size} bytes) is already under target (${targetSizeBytes} bytes) and in MP4 format.`);
          fileContent = inputBuffer;
        } else if (duration <= 0) {
          console.log('Skipping compression: invalid duration.');
          fileContent = inputBuffer;
        } else {
          // Calculate bitrate (bps)
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
          
          const videoBitrateKbps = Math.round(targetVideoBitrate / 1000);
          console.log(`Targeting video bitrate: ${videoBitrateKbps} kbps`);
          
          // Adaptive resolution scaling to maintain pixel density at lower bitrates
          let targetWidth = 1920;
          if (videoBitrateKbps < 800) {
            targetWidth = 854; // 480p
            console.log('Low bitrate: scaling to 480p');
          } else if (videoBitrateKbps < 1500) {
            targetWidth = 1280; // 720p
            console.log('Medium bitrate: scaling to 720p');
          } else {
            console.log('High bitrate: keeping resolution at 1080p');
          }
          
          const videoFilter = `scale='min(${targetWidth},iw)':-2,format=yuv420p`;
          const ffmpegCommand = `ffmpeg -y -i "${tempInputPath}" -c:v libx264 -preset fast -b:v ${videoBitrateKbps}k -maxrate ${Math.round(videoBitrateKbps * 1.5)}k -bufsize ${videoBitrateKbps * 2}k -vf "${videoFilter}" -c:a aac -b:a 128k -movflags +faststart "${tempOutputPath}"`;
          
          console.log(`Compressing video... command: ${ffmpegCommand}`);
          const startTime = Date.now();
          await execPromise(ffmpegCommand);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          
          fileContent = await fs.readFile(tempOutputPath);
          console.log(`Video compressed successfully in ${elapsed}s. Size reduced from ${info.size} to ${fileContent.length} bytes.`);
          
          const originalNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          sanitizedName = sanitizeFilename(`${originalNameWithoutExt}.mp4`);
          finalContentType = 'video/mp4';
        }
      } catch (err) {
        console.error('Error during video compression, falling back to original video upload:', err);
        fileContent = inputBuffer;
      } finally {
        // Clean up temp files
        try {
          await fs.unlink(tempInputPath).catch(() => {});
          await fs.unlink(tempOutputPath).catch(() => {});
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
    const key = `${folder}${Date.now()}-${sanitizedName}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: finalContentType,
      ContentDisposition: 'inline',
    });

    // Directly upload the file to S3 from the server
    await s3Client.send(command);
    console.log(`Uploaded to S3: ${key} (${fileContent.length} bytes)`);

    const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    // --- SQLite: record upload ---
    let uploadId: number | null = null;
    try {
      const db = await getDb();
      const originalSize = file.size;
      const compressedSize = fileContent.length;
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
      compressedSize: fileContent.length,
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
