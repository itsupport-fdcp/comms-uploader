import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { lookup as mimeLookup } from 'mime-types';

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

    const arrayBuffer = await file.arrayBuffer();
    const fileContent = Buffer.from(arrayBuffer);
    const sanitizedName = sanitizeFilename(file.name);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const folder = `uploads/${year}-${month}/`;
    const key = `${folder}${Date.now()}-${sanitizedName}`;

    // Lookup mime type using file type or file name
    const contentType = file.type || mimeLookup(file.name) || 'application/octet-stream';

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
      ContentDisposition: 'inline',
    });

    await s3Client.send(command);

    const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    return NextResponse.json({
      success: true,
      url: publicUrl,
      filename: sanitizedName,
    });
  } catch (error: any) {
    console.error('Upload Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'An error occurred during file upload.' },
      { status: 500 }
    );
  }
}
