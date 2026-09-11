import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { processUpload, type UploadInput } from './process-upload';

type UploadResult = Awaited<ReturnType<typeof processUpload>>;
type Job = {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  updatedAt: number;
  result?: UploadResult;
  error?: string;
  message?: string;
  percent?: number;
};

// One worker per Node process; shared by all route bundles.
const globalJobs = globalThis as typeof globalThis & {
  uploadWorker?: { jobs: Map<string, Job>; tail: Promise<void>; pending: number };
};
const worker = globalJobs.uploadWorker ??= {
  jobs: new Map<string, Job>(), tail: Promise.resolve(), pending: 0,
};

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export function reserveUpload(): string | null {
  for (const [id, job] of worker.jobs) {
    if ((job.status === 'completed' || job.status === 'failed') &&
        (Date.now() - job.updatedAt > 24 * 60 * 60 * 1000 || worker.jobs.size >= 1000)) {
      worker.jobs.delete(id);
    }
  }
  if (worker.pending >= 4) return null;
  const id = randomUUID();
  worker.pending++;
  worker.jobs.set(id, { status: 'queued', updatedAt: Date.now() });
  return id;
}

export function releaseUpload(id: string) {
  if (worker.jobs.delete(id)) worker.pending--;
}

export function getUploadJob(id: string) {
  return worker.jobs.get(id);
}

export function runUpload(id: string, input: UploadInput): Promise<void> {
  const work = worker.tail.then(async () => {
    worker.jobs.set(id, { status: 'processing', updatedAt: Date.now() });
    try {
      const result = await processUpload(input, (message, percent) => {
        worker.jobs.set(id, { status: 'processing', updatedAt: Date.now(), message, percent });
      });
      worker.jobs.set(id, { status: 'completed', updatedAt: Date.now(), result });
    } catch (error) {
      console.error('Upload job failed:', id, error);
      worker.jobs.set(id, {
        status: 'failed', updatedAt: Date.now(),
        error: "We couldn't finish saving your file. Please try again. If this keeps happening, contact your IT team.",
      });
    } finally {
      await fs.rm(path.dirname(input.inputPath), { recursive: true, force: true }).catch(console.error);
      worker.pending--;
    }
  });
  worker.tail = work.catch(console.error);
  return work;
}
