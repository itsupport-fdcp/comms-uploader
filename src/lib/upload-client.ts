type UploadResponse = {
  success: boolean;
  error?: string;
  jobId?: string;
  status?: 'queued' | 'processing' | 'completed' | 'failed';
  url?: string;
  filename?: string;
  uploadId?: number | null;
  result?: UploadResponse;
};

export async function parseUploadResponse(res: Response): Promise<UploadResponse> {
  let data: UploadResponse | undefined;
  if (res.headers.get('content-type')?.includes('application/json')) {
    data = await res.json().catch(() => undefined);
  }
  if (!res.ok || !data || typeof data.success !== 'boolean') {
    const messages: Record<number, string> = {
      413: 'The file exceeds the server upload limit (100 MB).',
      502: 'The upload server is unavailable. Check Upload History before retrying.',
      503: 'The upload server is busy. Please try again shortly.',
      504: 'The gateway timed out. Check Upload History before retrying to avoid a duplicate upload.',
    };
    throw new Error(data?.error || messages[res.status] || `The upload server returned an invalid response (HTTP ${res.status}).`);
  }
  return data;
}

export async function uploadFile(formData: FormData, onStatus?: (message: string) => void) {
  const file = formData.get('file');
  if (file instanceof File && file.size > 100 * 1024 * 1024) {
    throw new Error('Files must be 100 MB or smaller.');
  }
  let response: Response;
  try {
    response = await fetch('/api/upload', { method: 'POST', body: formData });
  } catch {
    throw new Error('The connection to the upload server was lost. Check Upload History before retrying.');
  }
  let data = await parseUploadResponse(response);
  if (!data.success) throw new Error(data.error || 'Upload failed.');
  // Allow a rolling deployment where the server still returns a completed upload.
  if (!data.jobId) {
    if (!data.url) throw new Error('The upload server did not return a file URL.');
    return data;
  }

  const jobId = data.jobId;
  const deadline = Date.now() + 3 * 60 * 60 * 1000;
  let failures = 0;
  while (Date.now() < deadline) {
    onStatus?.(data.status === 'queued' ? 'Upload received. Waiting to process...' : 'Processing and saving your upload...');
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
      if (error instanceof Error && error.message.includes('server may have restarted')) throw error;
      if (++failures >= 5) {
        throw new Error('Unable to check upload progress. Processing may still finish. Check Upload History before retrying.');
      }
      continue;
    }
    if (!data.success || data.status === 'failed') throw new Error(data.error || 'Upload processing failed.');
    if (data.status === 'completed') {
      if (!data.result?.url) throw new Error('The completed upload did not include a file URL.');
      return data.result;
    }
  }
  throw new Error('Processing is taking longer than expected. Check Upload History before retrying.');
}
