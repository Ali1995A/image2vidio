// Transpile only for isolated request tests. No application server, .env loading or network.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
const root = path.resolve(__dirname, '..');
class NextResponse extends Response {
  static json(value, init) { return new NextResponse(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
}
Module._load = function (name, parent, isMain) {
  if (name === 'next/server') return { NextResponse };
  if (name === '@/lib/memories') return { appendMemory: async () => undefined };
  if (name.startsWith('@/')) name = path.join(root, 'src', name.slice(2));
  return originalLoad.call(this, name, parent, isMain);
};
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
module.exports = { NextResponse };
