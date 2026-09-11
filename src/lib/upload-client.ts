type UploadResponse = {
  success: boolean;
  error?: string;
  message?: string;
  percent?: number;
  jobId?: string;
  status?: 'queued' | 'processing' | 'completed' | 'failed';
  url?: string;
  filename?: string;
  uploadId?: number | null;
  result?: UploadResponse;
};

const CHECK_HISTORY = 'Open Upload History to check whether your file was saved before trying again.';
const UNCONFIRMED = `We couldn't confirm that your upload finished. ${CHECK_HISTORY}`;
const PROCESSING_FAILED = "We couldn't finish saving your file. Please try again. If this keeps happening, contact your IT team.";

export class UploadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'UploadError';
  }
}

export function getUploadErrorMessage(error: unknown): string {
  return error instanceof UploadError
    ? error.message
    : "We couldn't prepare or upload this file. Please try again. If this keeps happening, contact your IT team.";
}

export async function parseUploadResponse(res: Response): Promise<UploadResponse> {
  let data: UploadResponse | undefined;
  if (res.headers.get('content-type')?.includes('application/json')) {
    data = await res.json().catch(() => undefined);
  }
  if (!res.ok || !data || typeof data.success !== 'boolean') {
    const messages: Record<number, string> = {
      400: 'This file could not be accepted. Choose a non-empty file and try again.',
      401: 'Your session may have expired. Sign in again, then try uploading your file.',
      403: "You don't have permission to upload right now. Contact your IT team for help.",
      404: `We can no longer check this upload's progress. ${CHECK_HISTORY}`,
      413: 'This file is too large. Choose a file 500 MB or smaller and try again.',
      429: 'Other files are being uploaded right now. Please wait a moment, then try again.',
      500: "We couldn't save your file because of a problem with the upload service. Please try again later. If this continues, contact your IT team.",
      502: `The upload service is temporarily unavailable. ${CHECK_HISTORY}`,
      503: 'The upload service is busy. Please wait a moment, then try again.',
      504: `The upload service took too long to respond. Your file may still be processing. ${CHECK_HISTORY}`,
    };
    // Server responses can contain provider errors or HTML. Keep those out of the UI.
    throw new UploadError(messages[res.status] || UNCONFIRMED, res.status);
  }
  return data;
}

export async function uploadFile(formData: FormData, onStatus?: (message: string, percent?: number) => void) {
  const file = formData.get('file');
  if (file instanceof File && file.size > 500 * 1024 * 1024) {
    throw new UploadError('This file is too large. Choose a file 500 MB or smaller and try again.');
  }
  let response: Response;
  onStatus?.('Sending your file...');
  try {
    response = await fetch('/api/upload', { method: 'POST', body: formData });
  } catch {
    throw new UploadError(`We lost contact with the upload service. Check your internet connection. ${CHECK_HISTORY}`);
  }
  let data = await parseUploadResponse(response);
  if (!data.success) throw new UploadError(PROCESSING_FAILED);
  // Allow a rolling deployment where the server still returns a completed upload.
  if (!data.jobId) {
    if (!data.url) throw new UploadError(UNCONFIRMED);
    return data;
  }

  const jobId = data.jobId;
  const deadline = Date.now() + 3 * 60 * 60 * 1000;
  let failures = 0;
  while (Date.now() < deadline) {
    onStatus?.(failures > 0 ? 'Reconnecting to check progress...' :
      data.status === 'queued' ? 'Upload received. Waiting to process...' :
      data.message || 'Processing and saving your upload...', failures > 0 ? undefined : data.percent);
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      const statusResponse = await fetch(`/api/upload?jobId=${encodeURIComponent(jobId)}`, {
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      // Retry status reads only. Never automatically resend a file.
      if (statusResponse.status >= 500) throw new Error('Upload status temporarily unavailable.');
      data = await parseUploadResponse(statusResponse);
      failures = 0;
    } catch (error) {
      if (error instanceof UploadError && error.status && error.status >= 400 && error.status < 500) throw error;
      if (++failures >= 5) {
        throw new UploadError(`We can't check your upload's progress right now. Your file may still be processing. ${CHECK_HISTORY}`);
      }
      continue;
    }
    if (!data.success || data.status === 'failed') throw new UploadError(PROCESSING_FAILED);
    if (data.status === 'completed') {
      if (!data.result?.url) throw new UploadError(UNCONFIRMED);
      return data.result;
    }
  }
  throw new UploadError(`Your file is taking longer than expected to process. ${CHECK_HISTORY}`);
}
