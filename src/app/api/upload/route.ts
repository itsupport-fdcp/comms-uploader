import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { lookup as mimeLookup } from 'mime-types';

function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '');
}

export async function POST(request: Request) {
  try {
    const { filename, contentType: providedContentType, title } = await request.json();

    if (!filename) {
      return NextResponse.json(
        { success: false, error: 'No filename provided' },
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

    const sanitizedName = sanitizeFilename(filename);
    const titleSlug = title ? sanitizeFilename(title) : '';

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const folder = titleSlug 
      ? `uploads/${year}-${month}/${titleSlug}/`
      : `uploads/${year}-${month}/`;
    const key = `${folder}${Date.now()}-${sanitizedName}`;

    // Lookup mime type using file type or file name
    const contentType = providedContentType || mimeLookup(filename) || 'application/octet-stream';

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ContentDisposition: 'inline',
    });

    // Generate the presigned URL valid for 1 hour
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    return NextResponse.json({
      success: true,
      presignedUrl,
      url: publicUrl,
      filename: sanitizedName,
    });
  } catch (error: any) {
    console.error('Presign Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'An error occurred generating the upload URL.' },
      { status: 500 }
    );
  }
}
