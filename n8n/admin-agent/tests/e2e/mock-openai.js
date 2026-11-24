'use strict';
// OpenAI Responses API giả + Tavily giả + Threads giả cho kiểm thử e2e. Model "nói" theo kịch bản trong scenarios.js,
// chọn kịch bản bằng nhãn [S:<tên>] ở đầu tin nhắn của admin. Không có khóa thật.
// Chạy: HNX_E2E_MOCK=1 HNX_MOCK_BIND=172.17.0.1 HNX_MOCK_OPENAI_PORT=19998 HNX_MOCK_SUPABASE_URL=http://127.0.0.1:19999 node mock-openai.js
// Quan sát: GET /__requests (mọi lượt gọi model: system prompt, tên tool, đầu ra tool), GET /__calls (Tavily/Threads).
const http = require('node:http');
const { MODEL } = require('./scenarios');

const REQUESTS = [];
const CALLS = [];
let counter = 0;
const J = JSON.stringify;
const SUPA = () => process.env.HNX_MOCK_SUPABASE_URL || 'http://127.0.0.1:19999';
const supa = async (p) => (await fetch(SUPA() + p)).json();
const textOf = (item) => (typeof item.content === 'string' ? item.content : (item.content || []).map((p) => p.text || '').join('\n'));
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

function respond(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(J(body));
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    const url = new URL(req.url, 'http://x');
    const body = tryJson(raw) || {};
    if (url.pathname === '/__requests') return respond(res, 200, REQUESTS);
    if (url.pathname === '/__calls') return respond(res, 200, CALLS);
    if (url.pathname.startsWith('/tavily')) {
      CALLS.push({ service: 'tavily', auth: req.headers.authorization ? 'present' : 'none', body });
      return respond(res, 200, { query: body.query, images: ['https://example.com/a.jpg', { url: 'https://example.com/b.jpg', description: 'ảnh b' }], results: [{ title: 'Bãi rác Tô Lịch', url: 'https://example.com/n1', content: 'Rác chất đống ven sông.', score: 0.8, published_date: '2026-11-20' }, { title: 'Điểm rác Hồ Tây', url: 'https://example.com/n2', content: 'Rác sinh hoạt.', score: 0.5, published_date: '2026-11-19' }] });
    }
    if (url.pathname.startsWith('/threads')) {
      CALLS.push({ service: 'threads', method: req.method, path: url.pathname, body });
      return respond(res, 200, { id: url.pathname.includes('threads_publish') ? 'THREADS_POST_1' : 'CONTAINER_1', permalink: 'https://www.threads.com/@e2e/post/THREADS_POST_1', status: 'FINISHED' });
    }
    if (url.pathname === '/v1/models') return respond(res, 200, { object: 'list', data: [{ id: 'gpt-e2e', object: 'model' }] });
    if (!url.pathname.startsWith('/v1/responses')) return respond(res, 404, { error: { message: 'mock: chỉ hỗ trợ /v1/responses', type: 'invalid_request_error' } });

    const input = Array.isArray(body.input) ? body.input : [{ role: 'user', content: String(body.input) }];
    let lastUser = -1;
    input.forEach((it, i) => { if (it.role === 'user' && (it.type === undefined || it.type === 'message')) lastUser = i; });
    const message = lastUser >= 0 ? textOf(input[lastUser]) : '';
    const names = {};
    for (const it of input) if (it.type === 'function_call') names[it.call_id] = it.name;
    // n8n trả kết quả tool dưới dạng mảng một phần tử ([{...}] hoặc [{ response: "<chuỗi JSON>" }]); bóc ra để kịch bản đọc thẳng JSON.
    const unwrap = (v) => {
      if (!Array.isArray(v) || v.length !== 1 || !v[0]) return v;
      return typeof v[0].response === 'string' ? (tryJson(v[0].response) || v[0].response) : v[0];
    };
    const outputs = input.slice(lastUser + 1).filter((it) => it.type === 'function_call_output').map((it) => ({ name: names[it.call_id], raw: it.output, json: unwrap(tryJson(typeof it.output === 'string' ? it.output : J(it.output))) }));
    const scenario = (/\[S:([A-Za-z0-9_-]+)\]/.exec(message) || [])[1];
    const system = [body.instructions || '', ...input.filter((it) => it.role === 'system' || it.role === 'developer').map(textOf)].join('\n');
    const toolDefs = (body.tools || []).map((t) => ({ name: t.name || (t.function && t.function.name), parameters: t.parameters || (t.function && t.function.parameters), description: t.description }));
    REQUESTS.push({ scenario, step: outputs.length, system, tools: toolDefs.map((t) => t.name), toolDefs, outputs, message, endpoint: url.pathname, reasoning: body.reasoning, model: body.model });

    const steps = MODEL[scenario];
    let parts = [{ text: 'Không có kịch bản cho tin nhắn này.' }];
    if (steps) {
      const ctx = tryJson((message.split('CONTEXT JSON:\n')[1] || '').trim()) || {};
      try {
        parts = await steps[Math.min(outputs.length, steps.length - 1)]({ ctx, outputs, message, supa });
      } catch (err) {
        REQUESTS[REQUESTS.length - 1].error = String(err && err.message);
        parts = [{ text: 'MOCK-ERROR: ' + String(err && err.message) }];
      }
    }
    if (parts && parts.status) return respond(res, parts.status, parts.body);
    counter += 1;
    const items = parts.map((p, i) => (p.functionCall
      ? { type: 'function_call', id: `fc_${counter}_${i}`, call_id: `call_${counter}_${i}`, name: p.functionCall.name, arguments: J(p.functionCall.args), status: 'completed' }
      : { type: 'message', id: `msg_${counter}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: p.text, annotations: [] }] }));
    return respond(res, 200, { id: `resp_${counter}`, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: body.model || 'gpt-e2e', output: items, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
  });
});

if (require.main === module) {
  if (!process.env.HNX_E2E_MOCK) {
    console.log('mock-openai: đặt HNX_E2E_MOCK=1 để chạy (dùng bởi run-e2e.sh).');
    process.exit(0);
  }
  server.listen(Number(process.env.HNX_MOCK_OPENAI_PORT || 19998), process.env.HNX_MOCK_BIND || '127.0.0.1', () => console.log('mock openai sẵn sàng'));
}
