const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual component handlers with a minimal hook host, no browser or paid API.
function mount(fetchImpl) {
  const slots = []; let cursor = 0; let tree;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect() { cursor++; },
  };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('components/VideoGenerator.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'fragment' } : { py: value => value },
    Blob, File, Uint8Array, AbortController, URL, Date, JSON, console,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: fetchImpl,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 1800 ? 0 : ms),
    window: { setTimeout, clearTimeout },
  });
  const props = { doodleRef: { current: { exportReferenceImageBlob: async () => new Blob(['drawing']) } } };
  function render() { cursor = 0; tree = module.exports.default(props); }
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children)];
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    return node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  }
  render();
  return { render, button: label => nodes(tree).find(n => n.type === 'button' && text(n).includes(label)), video: () => nodes(tree).find(n => n.type === 'video'), text: () => text(tree) };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('direct video URL enables download and native playback controls', async () => {
  const app = mount(async () => json({ url: 'https://example.com/video.mp4' }));
  await app.button('开始').props.onClick(); app.render();
  assert.equal(app.video().props.src, 'https://example.com/video.mp4');
  assert.equal(app.video().props.controls, true);
  assert.equal(app.button('下载').props.disabled, false);
  assert.equal(app.button('开始').props.disabled, false);
});

test('pending task polls content and displays the completed result', async () => {
  const actions = [];
  const app = mount(async (_, options) => { const body = JSON.parse(options.body); actions.push(body.action || 'create'); return body.action ? json({ url: 'https://example.com/done.mp4' }) : json({ pending: true, tid: 'task1' }, 202); });
  await app.button('开始').props.onClick(); app.render();
  assert.deepEqual(actions, ['create', 'content']);
  assert.equal(app.video().props.src, 'https://example.com/done.mp4');
});

test('stopped late response cannot overwrite a newer task or clear its busy state', async () => {
  const requests = [];
  const app = mount((_, options) => new Promise(resolve => requests.push({ resolve, signal: options.signal })));
  const oldRun = app.button('开始').props.onClick();
  while (requests.length < 1) await new Promise(resolve => setImmediate(resolve));
  app.render(); app.button('停止').props.onClick(); app.render();
  assert.equal(requests[0].signal.aborted, true);
  const newRun = app.button('开始').props.onClick();
  while (requests.length < 2) await new Promise(resolve => setImmediate(resolve));
  requests[0].resolve(json({ url: 'https://example.com/old.mp4' }));
  await oldRun; app.render();
  assert.equal(app.button('开始').props.disabled, true);
  assert.equal(app.video(), undefined);
  requests[1].resolve(json({ url: 'https://example.com/new.mp4' }));
  await newRun; app.render();
  assert.equal(app.video().props.src, 'https://example.com/new.mp4');
  assert.equal(app.button('开始').props.disabled, false);
});

test('network failure restores retry controls and exposes the error', async () => {
  const app = mount(async () => { throw new Error('Network unavailable'); });
  await app.button('开始').props.onClick(); app.render();
  assert.match(app.text(), /Network unavailable/);
  assert.equal(app.button('开始').props.disabled, false);
  assert.equal(app.button('下载').props.disabled, true);
});
