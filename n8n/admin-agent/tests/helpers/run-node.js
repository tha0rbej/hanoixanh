'use strict';
// Chạy jsCode của node Code / toolCode trong `vm` với các biến giả của n8n:
// $input, $json, $('Tên node'), $env, $node, $now, $items, require (giới hạn), console.
// Không gọi mạng, không đọc biến môi trường thật.
const vm = require('node:vm');

class NodeCodeError extends Error {
  constructor(message, name) {
    super(message);
    this.name = name || 'NodeCodeError';
  }
}

function makeNowStub(iso) {
  const ms = Date.parse(iso || '2026-11-24T10:00:00.000Z');
  return {
    toISO: () => new Date(ms).toISOString(),
    toMillis: () => ms,
    toString: () => new Date(ms).toISOString(),
  };
}

// opts:
//   input: mảng json của item vào node (mặc định [{}])
//   nodes: { 'Tên node': [json, ...] } cho $('Tên node')
//   env: giá trị $env
//   fs: module fs (thật, hoặc đã bọc tới thư mục tạm)
//   now: chuỗi ISO cho $now
//   timeout: ms cho phần chạy đồng bộ (mặc định 5000)
async function runCodeNode(jsCode, opts = {}) {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} } });
  const inRealm = (value) => vm.runInContext(`(${JSON.stringify(value === undefined ? null : value)})`, ctx);
  const toItems = (arr) => (arr || []).map((json, i) => ({ json: inRealm(json), pairedItem: { item: i } }));

  const inputItems = toItems(opts.input || [{}]);
  const registry = {};
  for (const [name, arr] of Object.entries(opts.nodes || {})) registry[name] = toItems(arr);

  const ref = (name) => {
    if (!Object.prototype.hasOwnProperty.call(registry, name)) {
      throw new NodeCodeError(`Node '${name}' hasn't been executed`);
    }
    const items = registry[name];
    return {
      first: () => items[0],
      last: () => items[items.length - 1],
      all: () => items,
      get item() {
        return items[0];
      },
      isExecuted: true,
    };
  };

  const allowed = { fs: opts.fs };
  const requireStub = (id) => {
    if (Object.prototype.hasOwnProperty.call(allowed, id) && allowed[id]) return allowed[id];
    throw new NodeCodeError(`Cannot find module '${id}' [Module '${id}' is disallowed]`);
  };

  const sandbox = {
    $input: { first: () => inputItems[0], last: () => inputItems[inputItems.length - 1], all: () => inputItems, item: inputItems[0] },
    $json: inputItems[0] ? inputItems[0].json : {},
    $items: () => inputItems,
    $: ref,
    $node: new Proxy({}, { get: (_t, name) => ({ json: registry[name] ? registry[name][0].json : undefined }) }),
    $env: inRealm(opts.env || {}),
    $now: makeNowStub(opts.now),
    $execution: { id: 'test-execution', mode: 'test' },
    $workflow: { id: 'test-workflow', name: 'test' },
    require: requireStub,
    Buffer,
    URL,
    URLSearchParams,
  };
  Object.assign(ctx, sandbox);

  const wrapped = `(async () => {\n${jsCode}\n})()`;
  let result;
  try {
    const script = new vm.Script(wrapped, { filename: 'n8n-code-node.js' });
    result = await script.runInContext(ctx, { timeout: opts.timeout || 5000 });
  } catch (err) {
    throw new NodeCodeError(err && err.message ? String(err.message) : String(err), err && err.name);
  }
  return JSON.parse(JSON.stringify(result === undefined ? null : result));
}

// toolCode (@n8n/n8n-nodes-langchain.toolCode): biến `query` là đầu vào của model; trả về chuỗi.
async function runToolCode(jsCode, opts = {}) {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} } });
  const inRealm = (value) => vm.runInContext(`(${JSON.stringify(value === undefined ? null : value)})`, ctx);
  const allowed = { fs: opts.fs };
  Object.assign(ctx, {
    query: opts.query === undefined ? '' : typeof opts.query === 'string' ? opts.query : inRealm(opts.query),
    $env: inRealm(opts.env || {}),
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(allowed, id) && allowed[id]) return allowed[id];
      throw new NodeCodeError(`Cannot find module '${id}' [Module '${id}' is disallowed]`);
    },
    Buffer,
  });
  let result;
  try {
    const script = new vm.Script(`(async () => {\n${jsCode}\n})()`, { filename: 'n8n-tool-code.js' });
    result = await script.runInContext(ctx, { timeout: opts.timeout || 5000 });
  } catch (err) {
    throw new NodeCodeError(err && err.message ? String(err.message) : String(err), err && err.name);
  }
  return result;
}

module.exports = { runCodeNode, runToolCode, NodeCodeError };
