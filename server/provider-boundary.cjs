'use strict';
const { GuardError, readBytes } = require('./ai-guard.cjs');

function canonicalBase(value) {
  let u;
  try { u = new URL(value || 'https://aihubmix.com/v1'); } catch { throw new GuardError(400, 'UNTRUSTED_PROVIDER', 'Invalid provider address'); }
  if (u.origin !== 'https://aihubmix.com' || u.username || u.password || u.search || u.hash || !/^\/v1\/?$/.test(u.pathname)) {
    throw new GuardError(400, 'UNTRUSTED_PROVIDER', 'Invalid provider address');
  }
  return 'https://aihubmix.com/v1';
}
function providerConfig(body) {
  let baseUrl;
  try { baseUrl = canonicalBase(process.env.AIHUBMIX_BASE_URL); }
  catch { throw new GuardError(503, 'PROVIDER_CONFIG', '生成服务地址需要家长检查。'); }
  if (body.baseUrl !== undefined && canonicalBase(body.baseUrl) !== baseUrl) throw new GuardError(400, 'UNTRUSTED_PROVIDER', 'Invalid provider address');
  if (body.apiKey !== undefined) throw new GuardError(400, 'CLIENT_KEY_DISABLED', '请使用服务器配置。');
  return { baseUrl, apiKey: String(process.env.AIHUBMIX_API_KEY || '').trim() };
}
function trustedApi(url) {
  const u = new URL(url);
  if (u.origin !== 'https://aihubmix.com' || u.username || u.password || u.hash || u.search || !/^\/v1\/(?:chat\/completions|videos(?:\/[^/]+(?:\/content)?)?)$/.test(u.pathname)) {
    throw new GuardError(502, 'UNTRUSTED_PROVIDER', '生成服务返回了不支持的地址。');
  }
  return u;
}
function mediaUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new GuardError(502, 'UNTRUSTED_MEDIA', '生成服务返回了不支持的视频地址。'); }
  const extra = String(process.env.AIHUBMIX_MEDIA_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const hostAllowed = u.hostname === 'aihubmix.com' || u.hostname.endsWith('.aliyuncs.com') || extra.includes(u.hostname);
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password || u.hash || !hostAllowed || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname)) {
    throw new GuardError(502, 'UNTRUSTED_MEDIA', '生成服务返回了不支持的视频地址。');
  }
  return u;
}
function isSignedMedia(url) {
  const u = mediaUrl(url);
  return u.hostname.endsWith('.aliyuncs.com');
}
async function request(url, init, allowContentRedirect) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  let current = url;
  let options = { ...init, redirect: 'manual', signal: controller.signal };
  try {
    for (let hops = 0; hops <= 3; hops++) {
      const response = await fetch(String(current), options);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!allowContentRedirect || !location || hops === 3) throw new GuardError(502, 'UPSTREAM_REDIRECT', '生成服务暂时不可用，请稍后再试。');
        current = mediaUrl(new URL(location, current).href);
        // Never replay the provider credential, cookies or POST body on any redirect.
        options = { method: 'GET', redirect: 'manual', signal: controller.signal };
        continue;
      }
      const bytes = await readBytes(response.body, 64 * 1024 * 1024, 55000);
      return new Response(bytes.length ? bytes : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    throw new GuardError(502, 'UPSTREAM_REDIRECT', 'Too many redirects');
  } catch (e) { if (controller.signal.aborted) throw new GuardError(504, 'UPSTREAM_TIMEOUT', '准备时间有点长，请稍后再试。'); throw e; }
  finally { clearTimeout(timer); }
}
function providerFetch(url, init = {}) {
  const u = trustedApi(url);
  return request(u, init, (!init.method || init.method === 'GET') && u.pathname.endsWith('/content'));
}
function downloadFetch(url, apiKey) {
  const u = mediaUrl(url);
  if (u.origin === 'https://aihubmix.com' && u.pathname.startsWith('/v1/')) {
    return providerFetch(u.href, { headers: { Authorization: `Bearer ${apiKey}` } });
  }
  return request(u, { method: 'GET' }, true);
}
module.exports = { providerConfig, canonicalBase, trustedApi, mediaUrl, isSignedMedia, providerFetch, downloadFetch };
