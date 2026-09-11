import { after, NextResponse } from 'next/server';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  getUploadJob, MAX_UPLOAD_BYTES, releaseUpload, reserveUpload, runUpload,
} from '@/lib/upload-jobs';

export const runtime = 'nodejs';
// Processing runs after the response on the self-hosted Node server.

export async function POST(request: Request) {
  const jobId = reserveUpload();
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'The upload queue is full. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': '15' } });
  }

  let stagingDir: string | undefined;
  try {
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES + 1024 * 1024) {
      releaseUpload(jobId);
      return NextResponse.json({ success: false, error: 'Files must be 500 MB or smaller.' }, { status: 413 });
    }
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      releaseUpload(jobId);
      return NextResponse.json({ success: false, error: 'Choose a non-empty file to upload.' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      releaseUpload(jobId);
      return NextResponse.json({ success: false, error: 'Files must be 500 MB or smaller.' }, { status: 413 });
    }

    const tempRoot = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempRoot, { recursive: true });
    stagingDir = await fs.mkdtemp(path.join(tempRoot, 'upload-'));
    const inputPath = path.join(stagingDir, 'source');
    await pipeline(Readable.fromWeb(file.stream() as import('node:stream/web').ReadableStream), createWriteStream(inputPath));
    const input = {
      name: file.name, type: file.type, size: file.size, inputPath,
      eventId: Number(formData.get('event_id')) || null,
      uploadedBy: String(formData.get('uploaded_by') || 'anonymous'),
    };
    after(() => runUpload(jobId, input));
    return NextResponse.json({ success: true, jobId, status: 'queued' },
      { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    releaseUpload(jobId);
    if (stagingDir) await fs.rm(stagingDir, { recursive: true, force: true }).catch(console.error);
    console.error('Upload intake failed:', error);
    return NextResponse.json({ success: false, error: 'Could not receive the file. Please try again.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId');
  const job = jobId ? getUploadJob(jobId) : undefined;
  if (!job) {
    return NextResponse.json({ success: false, error: 'Upload status is unavailable. The server may have restarted. Check Upload History before retrying.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ success: job.status !== 'failed', ...job },
    { headers: { 'Cache-Control': 'no-store' } });
}
