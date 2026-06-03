import { NextResponse } from 'next/server';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getDb, saveDb } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { url, upload_id, performed_by } = await request.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'No URL provided' },
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
          error: 'AWS Server Configuration Error: AWS credentials are missing.',
        },
        { status: 500 }
      );
    }

    // Extract S3 Key from public URL
    let s3Key = '';
    try {
      const urlObj = new URL(url);
      s3Key = decodeURIComponent(urlObj.pathname.substring(1));
    } catch (e) {
      console.error('Failed to parse URL for S3 key extraction:', e);
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    if (!s3Key) {
      return NextResponse.json(
        { success: false, error: 'Could not extract S3 key' },
        { status: 400 }
      );
    }

    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const isHls = s3Key.endsWith('playlist.m3u8');

    if (isHls) {
      // Find the folder prefix (up to the last slash)
      const lastSlashIdx = s3Key.lastIndexOf('/');
      const prefix = s3Key.substring(0, lastSlashIdx + 1);

      console.log(`HLS bulk deletion triggered for prefix: ${prefix}`);
      
      // List all segment files inside the folder
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      });
      const listedObjects = await s3Client.send(listCommand);

      if (listedObjects.Contents && listedObjects.Contents.length > 0) {
        const deleteParams = {
          Bucket: bucket,
          Delete: {
            Objects: listedObjects.Contents.map((obj) => ({ Key: obj.Key! })),
          },
        };
        const deleteCommand = new DeleteObjectsCommand(deleteParams);
        await s3Client.send(deleteCommand);
        console.log(`Successfully deleted ${listedObjects.Contents.length} files under prefix "${prefix}" from bucket ${bucket}`);
      } else {
        console.log(`No objects found to delete under prefix "${prefix}"`);
      }
    } else {
      // Non-HLS single object deletion
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      });
      await s3Client.send(command);
      console.log(`Successfully deleted single S3 object: ${s3Key} from bucket ${bucket}`);
    }

    // --- SQLite: log DELETE and remove record ---
    try {
      const db = await getDb();
      const actor = performed_by || 'anonymous';

      if (upload_id) {
        db.run(
          `INSERT INTO upload_actions (upload_id, action, performed_by) VALUES (?, 'DELETE', ?)`,
          [upload_id, actor]
        );
        db.run(`DELETE FROM uploads WHERE id = ?`, [upload_id]);
      }

      saveDb(db);
    } catch (dbErr) {
      console.error('SQLite delete error (non-fatal):', dbErr);
    }

    return NextResponse.json({
      success: true,
      message: 'File deleted from S3 successfully',
    });
  } catch (error: any) {
    console.error('Delete S3 Object Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'An error occurred during S3 deletion.' },
      { status: 500 }
    );
  }
}
