'use strict';
// Cấu trúc và chốt chặn cấu hình: workflow JSON, wiring tool, trường bảo mật cố định, skill, secret, compose, CI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ADMIN_AGENT_DIR, REPO_ROOT, SKILLS_DIR, listWorkflowFiles, loadWorkflow, loadJson, findNode, mustFindNode, triggerInputs } = require('./helpers/load-workflow');
const { TOOLS, FIXED_FIELDS } = require('./helpers/announcement-tools');
const { assertNoSecretLike } = require('./helpers/secret-scan');

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const FILES = listWorkflowFiles();
const WORKFLOWS = Object.fromEntries(FILES.map((f) => [f, loadWorkflow(f)]));
const main = WORKFLOWS['main-workflow.json'];
const TRIGGER_TYPES = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.executeWorkflowTrigger', 'n8n-nodes-base.scheduleTrigger']);
const toolNodes = main.nodes.filter((n) => n.type === '@n8n/n8n-nodes-langchain.toolWorkflow');
const allToolNodes = main.nodes.filter((n) => /@n8n\/n8n-nodes-langchain\.tool(Workflow|Code)$/.test(n.type));
const idToFile = Object.fromEntries(FILES.map((f) => [WORKFLOWS[f].id, f]));
// publish_* nhận thêm job_id chỉ từ scheduled-publisher; model và workflow chính không truyền.
const TRIGGER_ONLY_INPUTS = { publish_website_post: ['job_id'], publish_threads_post: ['job_id'] };

test('mọi workflow: JSON hợp lệ, id/tên node không trùng, connection đúng, không node mồ côi, mã Code biên dịch được', () => {
  for (const f of FILES) {
    const wf = WORKFLOWS[f];
    const names = wf.nodes.map((n) => n.name);
    assert.equal(new Set(names).size, names.length, `${f}: tên node trùng`);
    const ids = wf.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, `${f}: id node trùng`);
    const touched = new Set();
    for (const [src, byType] of Object.entries(wf.connections)) {
      assert.ok(names.includes(src), `${f}: connection từ node không tồn tại ${src}`);
      touched.add(src);
      for (const outputs of Object.values(byType)) for (const out of outputs) for (const link of out || []) {
        assert.ok(names.includes(link.node), `${f}: connection trỏ node không tồn tại ${link.node}`);
        touched.add(link.node);
      }
    }
    for (const n of wf.nodes) if (!TRIGGER_TYPES.has(n.type)) assert.ok(touched.has(n.name), `${f}: node mồ côi ${n.name}`);
    assert.equal(wf.settings.executionOrder, 'v1', f);
    assert.equal(wf.active, false, f);
    for (const n of wf.nodes.filter((x) => typeof (x.parameters || {}).jsCode === 'string')) {
      assert.doesNotThrow(() => new Function(`return (async () => {\n${n.parameters.jsCode}\n})`), `${f}/${n.name}`);
    }
  }
  const ids = FILES.map((f) => WORKFLOWS[f].id);
  assert.equal(new Set(ids).size, ids.length, 'id workflow trùng');
  for (const f of fs.readdirSync(ADMIN_AGENT_DIR).filter((x) => x.endsWith('.json'))) JSON.parse(fs.readFileSync(path.join(ADMIN_AGENT_DIR, f), 'utf8'));
});

test('có đủ workflow: chính, lịch đăng, 8 tool bài đăng và 7 tool thông báo với id cố định', () => {
  assert.equal(FILES.length, 17, FILES.join(', '));
  for (const t of TOOLS) {
    assert.ok(FILES.includes(t.file), `thiếu ${t.file}`);
    assert.equal(WORKFLOWS[t.file].id, t.id);
    assert.equal(triggerInputs(WORKFLOWS[t.file]).join(','), t.inputs.join(','));
  }
});

test('workflow chính: 15 tool workflow + load_skill, đều nối ai_tool vào Admin Agent, workflowId trỏ đúng file', () => {
  assert.equal(toolNodes.length, 15);
  for (const n of allToolNodes) assert.deepEqual(((main.connections[n.name] || {}).ai_tool || []).flat().map((l) => l.node), ['Admin Agent'], n.name);
  const targets = toolNodes.map((n) => n.parameters.workflowId.value);
  assert.equal(new Set(targets).size, targets.length, 'hai tool trỏ cùng một workflow');
  for (const n of toolNodes) {
    const id = n.parameters.workflowId.value;
    assert.ok(idToFile[id], `${n.name}: workflowId ${id} không có file`);
    assert.equal(n.parameters.workflowId.cachedResultName, WORKFLOWS[idToFile[id]].name, n.name);
  }
});

test('workflowInputs.value, schema và input của executeWorkflowTrigger khớp nhau hai chiều', () => {
  for (const n of toolNodes) {
    const trig = triggerInputs(WORKFLOWS[idToFile[n.parameters.workflowId.value]]).sort();
    const exempt = TRIGGER_ONLY_INPUTS[n.name] || [];
    const values = Object.keys(n.parameters.workflowInputs.value).sort();
    const schema = n.parameters.workflowInputs.schema.map((s) => s.id).sort();
    assert.deepEqual(schema, values, `${n.name}: schema khác value`);
    assert.deepEqual(values, trig.filter((x) => !exempt.includes(x)), `${n.name}: khác input của sub-workflow`);
    for (const e of exempt) assert.ok(trig.includes(e), `${n.name}: ngoại lệ ${e} không còn trong trigger`);
  }
});

test('trường nhạy cảm gắn cố định từ node phía server, không dùng $fromAI (tool cũ và mới)', () => {
  const SOURCES = {
    thread_id: "={{ $('Prepare Agent Turn').first().json.thread_id }}",
    admin_user_id: "={{ $('Verify Supabase User').first().json.id }}",
    confirmation_text: "={{ $('Admin Chat Webhook').first().json.body.message }}",
    turn_started_at: "={{ $('Mark Turn Start').first().json.turn_started_at }}",
  };
  let checked = 0;
  for (const n of toolNodes) {
    for (const [key, value] of Object.entries(n.parameters.workflowInputs.value)) {
      if (!FIXED_FIELDS.includes(key)) continue;
      checked += 1;
      assert.doesNotMatch(value, /\$fromAI/, `${n.name}.${key} do model điền`);
      if (SOURCES[key]) assert.equal(value, SOURCES[key], `${n.name}.${key}`);
    }
  }
  assert.ok(checked >= 25, `chỉ kiểm được ${checked} trường`);
});

test('7 tool thông báo: model chỉ điền đúng các trường id/nội dung, phần còn lại cố định', () => {
  for (const t of TOOLS) {
    const node = mustFindNode(main, t.tool);
    assert.equal(node.parameters.workflowId.value, t.id);
    const values = node.parameters.workflowInputs.value;
    assert.deepEqual(Object.keys(values).sort(), [...t.inputs].sort(), t.tool);
    const fromAI = Object.entries(values).filter(([, v]) => /\$fromAI\(/.test(v)).map(([k]) => k);
    assert.deepEqual(fromAI.sort(), [...t.modelFields].sort(), t.tool);
  }
});

test('7 tool thông báo: luồng trigger -> kiểm tra -> if -> (Call RPC -> Return Result | Return Validation Result), RPC đúng hàm, khóa lấy từ $env', () => {
  const sql = read('supabase', 'migrations', '20261124000000_campaign_announcements.sql');
  for (const t of TOOLS) {
    const wf = WORKFLOWS[t.file];
    assert.equal(mustFindNode(wf, t.validate).type, 'n8n-nodes-base.code', t.tool);
    const http = mustFindNode(wf, 'Call RPC');
    assert.equal(http.parameters.url, `={{ $env.HNX_SUPABASE_URL + '/rest/v1/rpc/${t.rpc}' }}`);
    assert.match(sql, new RegExp(`${t.rpc}\\(`), `migration không có ${t.rpc}`);
    assert.equal(http.parameters.method, 'POST');
    assert.equal(http.parameters.body, '={{ JSON.stringify($json.request) }}');
    assert.equal(http.onError, 'continueRegularOutput');
    assert.deepEqual(http.parameters.options.response.response, { fullResponse: true, neverError: true });
    const headers = Object.fromEntries(http.parameters.headerParameters.parameters.map((h) => [h.name, h.value]));
    assert.match(headers.apikey, /\$env\.HNX_SUPABASE_SECRET_KEY/);
    assert.match(headers.Authorization, /^=\{\{ 'Bearer ' \+ \(\$env\.HNX_SUPABASE_SECRET_KEY/);
    const next = (name, idx = 0) => ((wf.connections[name] || {}).main || [])[idx].map((l) => l.node);
    assert.deepEqual(next('When Executed by Another Workflow'), [t.validate]);
    assert.deepEqual(next(t.validate), ['Validation Passed']);
    assert.deepEqual(next('Validation Passed', 0), ['Call RPC']);
    assert.deepEqual(next('Validation Passed', 1), ['Return Validation Result']);
    assert.deepEqual(next('Call RPC'), ['Return Result']);
  }
});

test('mọi request tới Supabase dùng $env cho khóa; không còn $vars, Gemini, googlePalm trong workflow, tài liệu và skill', () => {
  for (const f of FILES) {
    for (const n of WORKFLOWS[f].nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest' && String(x.parameters.url || '').includes('HNX_SUPABASE_URL'))) {
      const headers = Object.fromEntries(((n.parameters.headerParameters || {}).parameters || []).map((h) => [h.name, h.value]));
      assert.match(headers.apikey || '', /\$env\.HNX_SUPABASE_SECRET_KEY/, `${f}/${n.name}: apikey`);
      if (n.name === 'Verify Supabase User') assert.equal(headers.Authorization, '={{ $json.headers.authorization }}');
      else assert.match(headers.Authorization || '', /^=\{\{ 'Bearer ' \+ \(\$env\.HNX_SUPABASE_SECRET_KEY/, `${f}/${n.name}: Authorization`);
    }
  }
  const targets = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'tests') walk(full); }
      else if (!e.name.startsWith('.env') && /\.(json|md|yml|yaml|example)$/.test(e.name)) targets.push(full);
    }
  };
  walk(path.join(REPO_ROOT, 'n8n'));
  walk(SKILLS_DIR);
  assert.ok(targets.length > 10);
  for (const file of targets) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\$vars\b/, `${path.relative(REPO_ROOT, file)}: còn $vars`);
    assert.doesNotMatch(text, /gemini|googlePalm|generativelanguage/i, `${path.relative(REPO_ROOT, file)}: còn Gemini/googlePalm`);
  }
});

test('không có chuỗi giống khóa thật (sk-, tvly-, sb_secret_, JWT) trong repo', () => {
  assertNoSecretLike(REPO_ROOT, assert);
});

test('docker-compose: cổng chỉ mở 127.0.0.1, bắt buộc N8N_ENCRYPTION_KEY, /skills chỉ đọc, cho phép module fs', () => {
  const yml = read('n8n', 'docker-compose.yml');
  const portLines = yml.split('\n').filter((l) => /^\s*-\s*"?[\d.]*:?\d+:5678"?/.test(l));
  assert.ok(portLines.length >= 1);
  for (const l of portLines) assert.match(l, /"127\.0\.0\.1:5678:5678"/, l);
  assert.doesNotMatch(yml, /["' -]0\.0\.0\.0:/);
  assert.match(yml, /N8N_ENCRYPTION_KEY:\s*\$\{N8N_ENCRYPTION_KEY:\?[^}]+\}/);
  assert.match(yml, /\.\.\/skills:\/skills:ro/);
  assert.match(yml, /NODE_FUNCTION_ALLOW_BUILTIN:\s*fs\b/);
});

test('luồng chính: Has Thread -> Load Skills Metadata -> Admin Agent; system prompt là biểu thức chèn metadata skill, tên tool load_skill có thật', () => {
  const next = (name, idx = 0) => (((main.connections[name] || {}).main || [])[idx] || []).map((l) => l.node);
  assert.deepEqual(next('Admin Chat Webhook'), ['Mark Turn Start']);
  assert.deepEqual(next('Has Thread', 0), ['Load Skills Metadata']);
  assert.deepEqual(next('Load Skills Metadata'), ['Admin Agent']);
  const agent = mustFindNode(main, 'Admin Agent').parameters;
  assert.ok(agent.options.systemMessage.startsWith('='), 'systemMessage phải là biểu thức');
  assert.ok(agent.options.systemMessage.includes("$('Load Skills Metadata').first().json.skills_metadata"));
  assert.ok(agent.options.systemMessage.includes('load_skill'));
  assert.ok(agent.text.includes("$('Prepare Agent Turn').first().json"), 'ngữ cảnh lượt chat không được lẫn metadata skill');
  assert.ok(findNode(main, 'load_skill'));
});

test('tool-contracts.json khớp tên tool, trường required và danh sách skill', () => {
  const contracts = loadJson('tool-contracts.json');
  const names = contracts.tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual([...names].sort(), allToolNodes.map((n) => n.name).sort());
  for (const c of contracts.tools) {
    const node = mustFindNode(main, c.name);
    if (node.type.endsWith('toolCode')) { assert.deepEqual(c.required, ['skill_name']); continue; }
    const values = node.parameters.workflowInputs.value;
    const modelFields = Object.entries(values).filter(([, v]) => /\$fromAI\(/.test(v));
    const noDefault = modelFields.filter(([, v]) => !/\$fromAI\('[^']+',\s*`[^`]*`,\s*'[^']+',/.test(v)).map(([k]) => k);
    for (const k of c.required) assert.ok(modelFields.some(([f]) => f === k), `${c.name}: required ${k} không phải trường model điền`);
    for (const k of noDefault) assert.ok(c.required.includes(k), `${c.name}: trường bắt buộc ${k} thiếu trong required`);
  }
  const skillNames = fs.readdirSync(SKILLS_DIR).filter((d) => fs.existsSync(path.join(SKILLS_DIR, d, 'SKILL.md'))).sort();
  assert.deepEqual(contracts.skills.map((s) => s.name).sort(), skillNames);
  for (const s of contracts.skills) assert.ok(fs.existsSync(path.join(REPO_ROOT, s.source)), s.source);
});

// --- skill ---------------------------------------------------------------------------------
const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) { const kv = /^([a-z][a-z0-9_-]*):\s*(.*)$/.exec(line); if (kv) out[kv[1]] = kv[2].trim(); }
  return out;
}

test('hai skill có frontmatter name (= tên thư mục) và description một dòng; SKILL.md đủ nhỏ để load_skill tải', () => {
  assert.deepEqual([...skillDirs].sort(), ['campaign-announcement', 'pollution-campaign-post']);
  for (const dir of skillDirs) {
    const text = read('skills', dir, 'SKILL.md');
    const fm = parseFrontmatter(text);
    assert.ok(fm, `${dir}: thiếu frontmatter`);
    assert.equal(fm.name, dir);
    assert.match(fm.name, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.ok(fm.description && !/^[>|]/.test(fm.description), `${dir}: description phải nằm trên một dòng`);
    assert.ok(Buffer.byteLength(text) < 64 * 1024);
  }
  const d = skillDirs.map((n) => parseFrontmatter(read('skills', n, 'SKILL.md')).description);
  assert.notEqual(d[0], d[1]);
});

test('tên tool trong backtick của SKILL.md đều có thật, mọi tool có thật được một skill nhắc tới, references chỉ mô tả tool có thật', () => {
  const realTools = new Set(allToolNodes.map((n) => n.name));
  const knownFields = new Set(FILES.flatMap((f) => (WORKFLOWS[f].nodes.some((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger') ? triggerInputs(WORKFLOWS[f]) : [])));
  const verbs = new Set(['find', 'get', 'save', 'send', 'approve', 'cancel', 'create', 'revise', 'publish', 'search', 'load', 'upsert', 'request', 'update', 'delete', 'list']);
  const mentioned = new Set();
  for (const dir of skillDirs) {
    const text = read('skills', dir, 'SKILL.md');
    const inSkill = new Set();
    for (const m of text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) {
      if (realTools.has(m[1])) { mentioned.add(m[1]); inSkill.add(m[1]); }
      else if (verbs.has(m[1].split('_')[0]) && !knownFields.has(m[1])) assert.fail(`skills/${dir}/SKILL.md nhắc tool không tồn tại: ${m[1]}`);
    }
    const ref = path.join(SKILLS_DIR, dir, 'references', 'tool-contracts.md');
    assert.ok(fs.existsSync(ref), `${dir}: thiếu references/tool-contracts.md`);
    const headings = [...fs.readFileSync(ref, 'utf8').matchAll(/^##\s+`([a-z_]+)`/gm)].map((m) => m[1]);
    for (const h of headings) assert.ok(realTools.has(h), `${dir}: heading ${h} không phải tool`);
    for (const t of inSkill) assert.ok(headings.includes(t), `${dir}: references thiếu ${t}`);
  }
  for (const t of realTools) if (t !== 'load_skill') assert.ok(mentioned.has(t), `tool ${t} không được skill nào nhắc tới`);
});

test('README liệt kê đúng bốn credential mà workflow dùng', () => {
  const used = new Set();
  for (const f of FILES) for (const n of WORKFLOWS[f].nodes) for (const c of Object.values(n.credentials || {})) used.add(c.name);
  assert.deepEqual([...used].sort(), ['HNX OpenAI', 'HNX Supabase Server', 'HNX Tavily Search', 'HNX Threads Publisher']);
  for (const doc of [read('n8n', 'admin-agent', 'README.md'), read('n8n', 'README.md')]) for (const name of used) assert.ok(doc.includes('`' + name + '`'), `README thiếu ${name}`);
});

test('package.json và CI: có test:n8n / test:mailer / test:all, giữ nguyên test vitest, deploy chạy test n8n + mailer sau bước Test', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.test, 'vitest run');
  assert.match(pkg.scripts['test:n8n'], /node --test .*n8n\/admin-agent\/tests/);
  assert.match(pkg.scripts['test:mailer'], /python3 -m unittest discover -s mailer -p 'test_\*\.py'/);
  assert.match(pkg.scripts['test:all'], /test:n8n.*test:mailer|test.*test:n8n.*test:mailer/);
  const yml = read('.github', 'workflows', 'deploy-inet.yml');
  const steps = [...yml.matchAll(/^\s+- name:\s*(.+)$/gm)].map((m) => m[1].trim());
  const i = steps.indexOf('Test');
  assert.ok(i >= 0);
  assert.deepEqual(steps.slice(i + 1, i + 3), ['Test n8n workflows', 'Test mailer']);
  assert.match(yml, /run:\s*pnpm test:n8n/);
  assert.match(yml, /run:\s*python3 -m unittest discover -s mailer -p 'test_\*\.py'/);
});

test('hạ tầng e2e: README, run-e2e.sh (có quyền chạy), mock OpenAI/Supabase và kịch bản đều có trong repo', () => {
  const e2e = path.join(ADMIN_AGENT_DIR, 'tests', 'e2e');
  for (const f of ['README.md', 'run-e2e.sh', 'mock-openai.js', 'mock-supabase.js', 'scenarios.js']) assert.ok(fs.existsSync(path.join(e2e, f)), `thiếu tests/e2e/${f}`);
  assert.ok((fs.statSync(path.join(e2e, 'run-e2e.sh')).mode & 0o111) !== 0, 'run-e2e.sh phải có quyền thực thi');
});
