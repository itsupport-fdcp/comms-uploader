const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the actual TS modules with external boundaries replaced; no AWS or live DB writes.
function load(file, mocks = {}) {
  const source = fs.readFileSync(path.resolve(file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports,
  );
  return module.exports;
}

const client = load('src/lib/upload-client.ts');
const json = (data, options = 200) => Response.json(data, typeof options === 'number' ? { status: options } : options);

test('HTML gateway errors and malformed JSON produce readable errors', async () => {
  await assert.rejects(client.parseUploadResponse(new Response('<html>Gateway timeout</html>', { status: 504 })), /took too long.*Upload History/i);
  await assert.rejects(client.parseUploadResponse(new Response('<html>too large</html>', { status: 413 })), /500 MB/);
  await assert.rejects(client.parseUploadResponse(new Response('{broken', { headers: { 'content-type': 'application/json' } })), /couldn't confirm/);
});

test('client waits for completion, retries status only, and submits the file once', async t => {
  const methods = [];
  const statuses = [];
  const replies = [
    json({ success: true, jobId: 'abc', status: 'queued' }, 202),
    new Response('<html>bad gateway</html>', { status: 502 }),
    json({ success: true, status: 'processing', message: 'Preparing video quality 2 of 4', percent: 43 }),
    json({ success: true, status: 'completed', result: { success: true, url: 'https://cdn/test.m3u8' } }),
  ];
  t.mock.method(global, 'fetch', async (_url, options) => {
    methods.push(options.method || 'GET');
    return replies.shift();
  });
  t.mock.method(global, 'setTimeout', callback => { callback(); return 0; });
  const percentages = [];
  const result = await client.uploadFile(new FormData(), (status, percent) => { statuses.push(status); percentages.push(percent); });
  assert.equal(result.url, 'https://cdn/test.m3u8');
  assert.deepEqual(methods, ['POST', 'GET', 'GET', 'GET']);
  assert.ok(statuses.some(status => status.includes('Waiting')));
  assert.ok(statuses.includes('Preparing video quality 2 of 4'));
  assert.ok(percentages.includes(43));
});

test('connection reset does not resend the file', async t => {
  const mock = t.mock.method(global, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(client.uploadFile(new FormData()), /lost contact.*internet connection/i);
  assert.equal(mock.mock.callCount(), 1);
});

test('processing failure is surfaced without reporting completion', async t => {
  const replies = [json({ success: true, jobId: 'abc' }, 202), json({ success: false, status: 'failed', error: 'S3 denied' })];
  t.mock.method(global, 'fetch', async () => replies.shift());
  t.mock.method(global, 'setTimeout', callback => { callback(); return 0; });
  await assert.rejects(client.uploadFile(new FormData()), /couldn't finish saving.*IT team/);
});

test('technical server errors and unexpected browser errors stay out of user messages', async () => {
  await assert.rejects(client.parseUploadResponse(json({ success: false, error: 'AccessDenied: secret bucket ARN' }, 500)), error => {
    assert.match(error.message, /upload service.*IT team/);
    assert.doesNotMatch(error.message, /AccessDenied|ARN|secret/);
    return true;
  });
  assert.doesNotMatch(client.getUploadErrorMessage(new Error('Unexpected token <html>')), /Unexpected token|html/);
});

test('missing upload status shows a next step without repeated polling', async t => {
  const replies = [json({ success: true, jobId: 'abc' }, 202), json({ success: false }, 404)];
  const mock = t.mock.method(global, 'fetch', async () => replies.shift());
  t.mock.method(global, 'setTimeout', callback => { callback(); return 0; });
  await assert.rejects(client.uploadFile(new FormData()), /no longer check.*Upload History/);
  assert.equal(mock.mock.callCount(), 2);
});

test('queue serializes processing, bounds admission, and releases failed jobs', async t => {
  delete global.uploadWorker;
  const finishes = [];
  const calls = [];
  const jobs = load('src/lib/upload-jobs.ts', {
    './process-upload': { processUpload: (input, onProgress) => { calls.push(input.name); onProgress('Preparing video quality 1 of 4', 25); return new Promise((resolve, reject) => finishes.push({ resolve, reject })); } },
    'node:fs': { promises: { rm: async () => {} } },
  });
  t.mock.method(console, 'error', () => {});
  const ids = Array.from({ length: 4 }, () => jobs.reserveUpload());
  assert.ok(ids.every(Boolean));
  assert.equal(jobs.reserveUpload(), null);
  const first = jobs.runUpload(ids[0], { name: 'one', inputPath: '/mock/one/source' });
  const second = jobs.runUpload(ids[1], { name: 'two', inputPath: '/mock/two/source' });
  await Promise.resolve();
  assert.deepEqual(calls, ['one']);
  assert.equal(jobs.getUploadJob(ids[0]).percent, 25);
  assert.ok(jobs.getUploadJob(ids[0]).activity.includes('Preparing video quality 1 of 4'));
  assert.equal(jobs.getUploadJob(ids[0]).status, 'processing');
  assert.equal(jobs.getUploadJob(ids[1]).status, 'queued');
  finishes[0].reject(new Error('S3 denied'));
  await first;
  await Promise.resolve();
  assert.equal(jobs.getUploadJob(ids[0]).status, 'failed');
  assert.deepEqual(calls, ['one', 'two']);
  finishes[1].resolve({ success: true, url: 'https://cdn/two' });
  await second;
  assert.equal(jobs.getUploadJob(ids[1]).result.url, 'https://cdn/two');
  assert.equal(jobs.getUploadJob(ids[1]).activity.at(-1), 'Upload completed. Your file is ready.');
  assert.ok(jobs.reserveUpload());
  delete global.uploadWorker;
});

test('intake returns 202 before processing and status is never cached', async () => {
  let afterCallback;
  let input;
  const route = load('src/app/api/upload/route.ts', {
    'next/server': { after: callback => { afterCallback = callback; }, NextResponse: { json } },
    '@/lib/upload-jobs': {
      MAX_UPLOAD_BYTES: 500 * 1024 * 1024, reserveUpload: () => 'test-job', releaseUpload: () => {},
      runUpload: async (_id, staged) => { input = staged; },
      getUploadJob: () => ({ status: 'processing' }),
    },
  });
  const form = new FormData();
  form.append('file', new File(['example'], 'photo.webp', { type: 'image/webp' }));
  const response = await route.POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
  // Mock NextResponse.json must preserve the response options.
  assert.equal(response.status, 202);
  assert.equal(input, undefined);
  await afterCallback();
  assert.equal(fs.readFileSync(input.inputPath, 'utf8'), 'example');
  const stagingDir = path.resolve(path.dirname(input.inputPath));
  const tempRoot = path.resolve('temp') + path.sep;
  assert.ok(stagingDir.startsWith(tempRoot));
  fs.rmSync(stagingDir, { recursive: true, force: true });
  const status = await route.GET(new Request('http://localhost/api/upload?jobId=test-job'));
  assert.equal(status.headers.get('cache-control'), 'no-store');
});

test('video processing encodes with bounded threads, uploads HLS, records history, and cleans temp output', async t => {
  const uploads = [];
  const commands = [];
  const statements = [];
  let outputDir;
  t.mock.method(console, 'log', () => {});
  const processor = load('src/lib/process-upload.ts', {
    '@aws-sdk/client-s3': {
      S3Client: class { async send(command) { uploads.push(command.input); } },
      PutObjectCommand: class { constructor(input) { this.input = input; } },
    },
    '@/lib/db': {
      getDb: async () => ({
        exec: sql => sql.includes('last_insert') ? [{ values: [[42]] }] : [{ values: [['Test Event', 2026]] }],
        run: (...args) => statements.push(args),
      }),
      saveDb: () => {},
    },
    util: { promisify: fn => fn },
    child_process: { execFile: (command, args) => {
      commands.push({ command, args });
      if (command === 'ffprobe') return Promise.resolve({ stdout: JSON.stringify({ format: { duration: '1', size: '5' }, streams: [{ codec_type: 'video', width: 426, height: 240 }] }) });
      const playlist = args.at(-1);
      outputDir = path.resolve(path.dirname(playlist), '..');
      fs.writeFileSync(playlist, '#EXTM3U\nseg_000.ts');
      fs.writeFileSync(path.join(path.dirname(playlist), 'seg_000.ts'), 'segment');
      const stdout = new (require('node:events').EventEmitter)();
      const encoding = new Promise(resolve => setImmediate(() => {
        stdout.emit('data', 'out_time_');
        stdout.emit('data', 'us=500000\n');
        resolve({ stdout: '' });
      }));
      encoding.child = { stdout };
      return encoding;
    } },
  });
  const progress = [];
  const result = await processor.processUpload({ name: 'movie.mp4', type: 'video/mp4', size: 5, inputPath: 'mock-source', eventId: 1, uploadedBy: 'tester' }, (message, percent) => progress.push({ message, percent }));
  assert.ok(progress.some(step => step.message === '[HLS] Encoding 240p (1 of 1)' && step.percent === 100));
  assert.ok(progress.some(step => step.message === '[HLS] Encoding 240p (1 of 1)' && step.percent === 50));
  assert.ok(progress.some(step => step.message === 'Saving your video...' && step.percent === 100));
  assert.equal(progress.at(-1).message, 'Finishing up...');
  assert.ok(progress.some(step => /Completed encoding 240p in [0-9.]+s/.test(step.message)));
  assert.equal(result.uploadId, 42);
  assert.ok(result.url.endsWith('/playlist.m3u8'));
  assert.equal(uploads.length, 3);
  assert.ok(uploads.some(upload => upload.ContentType === 'video/MP2T'));
  assert.equal(commands[1].args[commands[1].args.indexOf('-threads') + 1], '1');
  assert.equal(statements.length, 3);
  assert.equal(fs.existsSync(outputDir), false);
});
