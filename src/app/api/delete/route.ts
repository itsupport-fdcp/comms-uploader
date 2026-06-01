import { NextResponse } from 'next/server';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

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
    // e.g. https://fdcp-images.s3.ap-southeast-1.amazonaws.com/uploads/2026-06/1717200000-file.mp4
    let s3Key = '';
    try {
      const urlObj = new URL(url);
      // Pathname starts with '/' e.g., '/uploads/2026-06/1717200000-file.mp4'
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

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    });

    await s3Client.send(command);
    console.log(`Successfully deleted S3 object: ${s3Key} from bucket ${bucket}`);

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
