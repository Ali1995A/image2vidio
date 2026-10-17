require('./route-loader.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { POST } = require('../app/api/generate/route.ts');
const boundary = require('../server/provider-boundary.cjs');
let calls;
beforeEach(() => {
  globalThis[Symbol.for('family-ai.guard.v1')].clear();
  delete process.env.AI_CALLS_ENABLED; delete process.env.AIHUBMIX_BASE_URL; delete process.env.AIHUBMIX_MEDIA_HOSTS;
  process.env.AIHUBMIX_API_KEY = 'not-a-real-key-test-only'; calls = [];
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); throw new Error('Unexpected mocked request'); };
});
function req(body) { return new Request('https://family.test/api/generate', { method: 'POST', body: JSON.stringify(body) }); }
const image = 'data:image/png;base64,aGVsbG8=';
test('all actions reject hostile base URLs before any network request', async () => {
  for (const action of ['', 'status', 'content']) for (const baseUrl of ['https://untrusted.example/v1', 'http://aihubmix.com/v1', 'https://aihubmix.com.evil.test/v1', 'https://aihubmix.com@evil.test/v1', 'https://aihubmix.com:444/v1', 'https://aihubmix.com/v1?x=1']) {
    const r = await POST(req({ action, tid: '123456789012', imageDataUrl: image, baseUrl })); assert.equal(r.status, 400);
  }
  assert.equal(calls.length, 0);
});
test('client keys and invalid server provider config cannot change credential destination', async () => {
  assert.equal((await POST(req({ action: 'status', tid: '123', apiKey: 'client-test-only' }))).status, 400);
  process.env.AIHUBMIX_BASE_URL = 'https://untrusted.example/v1';
  assert.equal((await POST(req({ action: 'content', tid: '123' }))).status, 503); assert.equal(calls.length, 0);
});
test('status works without generating a paid job and blocks authenticated redirects', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ id: '123', status: 'completed' }); };
  assert.equal((await POST(req({ action: 'status', tid: '123' }))).status, 200);
  assert.equal(calls[0].url, 'https://aihubmix.com/v1/videos/123'); assert.equal(calls[0].init.redirect, 'manual');
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(null, { status: 307, headers: { location: 'https://untrusted.example/' } }); };
  assert.equal((await POST(req({ action: 'status', tid: '123' }))).status, 502); assert.equal(calls.length, 2);
});
test('content follows a trusted signed redirect without any Authorization header', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://bucket.oss-cn-test.aliyuncs.com/clip.mp4?signature=test' } }) : new Response('mock-video', { headers: { 'content-type': 'video/mp4' } }); };
  assert.equal((await POST(req({ action: 'content', tid: '123' }))).status, 200);
  assert.ok(new Headers(calls[0].init.headers).has('authorization'));
  assert.equal(new Headers(calls[1].init.headers).has('authorization'), false);
  assert.equal(calls[1].init.body, undefined);
});
test('content rejects hostile redirects and cannot leak credentials to a hostname suffix trick', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(null, { status: 302, headers: { location: 'https://bucket.aliyuncs.com.evil.test/clip.mp4' } }); };
  assert.equal((await POST(req({ action: 'content', tid: '123' }))).status, 502); assert.equal(calls.length, 1);
});
test('status fallback signed URL is returned to browser without server credential forwarding', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return calls.length === 1 ? Response.json({ error: 'not available here' }, { status: 404 }) : Response.json({ status: 'completed', url: 'https://bucket.oss-cn-test.aliyuncs.com/clip.mp4' }); };
  const r = await POST(req({ action: 'content', tid: '123' })); assert.equal(r.status, 200); assert.match((await r.json()).url, /aliyuncs/); assert.equal(calls.length, 2);
});
test('media download sends no account key to external media even before redirects', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response('video'); };
  await boundary.downloadFetch('https://bucket.oss-cn-test.aliyuncs.com/video.mp4', 'test-only');
  assert.equal(new Headers(calls[0].init.headers).has('authorization'), false);
});
test('generation keeps model, resolution and duration server-owned', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return String(url).endsWith('/chat/completions') ? Response.json({ choices: [{ message: { content: 'SUBJECT=cat' } }] }) : Response.json({ id: '123', status: 'queued' }); };
  const r = await POST(req({ imageDataUrl: image, mode: 'smart', seconds: 1000, model: 'expensive-unknown', size: '8k' })); assert.equal(r.status, 202);
  const payload = JSON.parse(calls[1].init.body); assert.equal(payload.seconds, 5); assert.equal(payload.size, '832x480'); assert.equal(payload.model, 'wan2.2-t2v-plus');
});
test('polling does not consume create quota or get disabled by paid-call pause', async () => {
  process.env.AI_CALLS_ENABLED = 'false';
  global.fetch = async () => Response.json({ id: '123', status: 'queued' });
  assert.equal((await POST(req({ action: 'status', tid: '123' }))).status, 202);
  assert.equal((await POST(req({ imageDataUrl: image }))).status, 503);
});
