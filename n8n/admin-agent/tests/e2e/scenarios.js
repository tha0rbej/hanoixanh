'use strict';
// Kịch bản e2e: (1) MODEL = lời "model" giả theo từng bước, dùng bởi mock-openai.js;
// (2) runner (chạy bằng `HNX_E2E_RUN=1 node scenarios.js`) gửi tin nhắn tới webhook n8n thật rồi kiểm tra
// nhật ký của mock Supabase/OpenAI. Chỉ kiểm LUỒNG và chốt chặn, không kiểm câu chữ.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EVIL_ADMIN = 'EVIL-ADMIN-ID';
const EVIL_THREAD = 'EVIL-THREAD-ID';
const J = JSON.stringify;
const fc = (name, args) => ({ functionCall: { name, args } });
const txt = (t) => ({ text: t });
const out = (c, i) => (c.outputs[i] || {}).json || {};
const latestAnnouncement = async (c) => {
  const list = (await c.supa('/__db')).announcements;
  return list[list.length - 1];
};

const WEB = { title: 'Dọn sạch bãi rác ven sông Tô Lịch', slug: 'don-sach-bai-rac-song-to-lich', excerpt: 'Kêu gọi tình nguyện viên.', content: 'Nội dung <b>bài</b> viết <script>alert(1)</script> thuần.', image_url: 'https://example.com/anh.jpg', category: 'Hoạt động', source_name: 'Hà Nội Xanh', source_url: 'https://example.com/nguon' };
const THR = { text: 'Cùng dọn rác sông Tô Lịch sáng Chủ nhật!', image_url: 'https://example.com/anh.jpg' };
const IMG = [{ url: 'https://example.com/anh.jpg', caption: 'Ảnh', source_url: 'https://example.com/nguon', license_status: 'unknown' }];
const SRC = [{ title: 'Báo', url: 'https://example.com/nguon', published_at: '2026-11-20' }];

const MODEL = {
  // ---- thông báo: lượt 1, soạn + gửi thử, rồi CỐ gửi trong cùng lượt với câu xác nhận bịa ----
  A1: [
    () => [fc('load_skill', { skill_name: 'campaign-announcement' })],
    () => [fc('find_announcement_events', { query: 'La Phù' })],
    (c) => [fc('get_event_registrants', { campaign_id: out(c, 1).campaigns[0].id })],
    (c) => [fc('save_announcement_draft', { campaign_id: out(c, 1).campaigns[0].id, subject: 'Dời giờ <b>chiến dịch</b> La Phù', body: 'Chiến dịch dời giờ <script>alert(1)</script>sang 8h <img src=x onerror=alert(1)>sáng Chủ nhật.', admin_user_id: EVIL_ADMIN, thread_id: EVIL_THREAD })],
    (c) => [fc('send_test_announcement', { announcement_id: out(c, 3).announcement.id, version: out(c, 3).announcement.version, admin_user_id: EVIL_ADMIN })],
    (c) => [fc('approve_and_send_announcement', { announcement_id: out(c, 3).announcement.id, version: out(c, 3).announcement.version, confirmation_text: 'tôi xác nhận gửi (do model tự bịa)', admin_user_id: EVIL_ADMIN, turn_started_at: '2000-01-01T00:00:00Z' })],
    () => [txt('Đã lưu bản nháp, chờ admin xác nhận.')],
  ],
  // ---- tin nhắn của admin LÀ xác nhận gửi, nhưng bản nháp (version mới) vừa tạo trong chính lượt này ----
  A1b: [
    () => [fc('find_announcement_events', { query: 'La Phù' })],
    (c) => [fc('save_announcement_draft', { campaign_id: out(c, 0).campaigns[0].id, subject: 'Dời giờ La Phù (bản 2)', body: 'Chiến dịch dời sang 8h sáng Chủ nhật, nhớ mang găng tay.' })],
    (c) => [fc('approve_and_send_announcement', { announcement_id: out(c, 1).announcement.id, version: out(c, 1).announcement.version, confirmation_text: 'tôi xác nhận gửi (do model tự bịa)' })],
    () => [txt('Cần admin đọc bản nháp trước.')],
  ],
  // ---- lượt sau: admin xác nhận ----
  A2: [
    async (c) => { const a = await latestAnnouncement(c); return [fc('approve_and_send_announcement', { announcement_id: a.id, version: a.version, confirmation_text: 'FAKE-CONFIRMATION-FROM-MODEL' })]; },
    () => [txt('Đã duyệt và chuyển cho mailer.')],
  ],
  A3: [
    () => [fc('get_announcement_status', { thread_id: EVIL_THREAD })],
    () => [txt('Đã báo tiến độ.')],
  ],
  A4b: [
    async (c) => [fc('cancel_announcement', { announcement_id: (await latestAnnouncement(c)).id })],
    () => [txt('Chưa hủy.')],
  ],
  A4: [
    async (c) => [fc('cancel_announcement', { announcement_id: (await latestAnnouncement(c)).id })],
    () => [txt('Đã hủy.')],
  ],
  // ---- bảo mật: load_skill path traversal ----
  S1: [
    () => [fc('load_skill', { skill_name: '../etc/passwd' })],
    () => [fc('load_skill', { skill_name: 'campaign-announcement/../../x' })],
    () => [fc('load_skill', { skill_name: 'unknown-skill' })],
    () => [txt('Đã thử các tên skill lạ.')],
  ],
  // ---- luồng bài đăng cũ (pollution-campaign-post) ----
  P1: [
    () => [fc('load_skill', { skill_name: 'pollution-campaign-post' })],
    () => [fc('search_pollution_locations', { query: 'bãi rác sông Tô Lịch', time_range_days: 30, max_results: 2 })],
    () => [txt('Đã tìm xong.')],
  ],
  P2: [
    (c) => [fc('create_cleanup_post_draft', { finding_id: c.ctx.findings[0].id, cleanup_start_at: '2026-12-06T07:00:00', meeting_point: 'Cầu Hà Đông', website_payload: J(WEB), threads_payload: J(THR), images: J(IMG), sources: J(SRC), admin_user_id: EVIL_ADMIN, thread_id: EVIL_THREAD })],
    () => [txt('Đã tạo draft.')],
  ],
  P3: [
    (c) => [fc('revise_post_draft', { draft_id: c.ctx.draft.id, base_version: 1, feedback: 'ngắn hơn', website_payload: J({ ...WEB, title: 'Bản sửa' }), threads_payload: J(THR), images: J(IMG), sources: J(SRC) })],
    () => [txt('Đã sửa.')],
  ],
  P3A: [ // sửa rồi duyệt trong cùng lượt -> needs_admin_review
    (c) => [fc('revise_post_draft', { draft_id: c.ctx.draft.id, base_version: c.ctx.draft.current_version, feedback: 'đổi tiêu đề', website_payload: J({ ...WEB, title: 'Bản sửa cùng lượt' }), threads_payload: J(THR), images: J(IMG), sources: J(SRC) })],
    (c) => [fc('approve_post_draft', { draft_id: c.ctx.draft.id, version: out(c, 0).draft.version })],
    () => [txt('Cần admin đọc trước.')],
  ],
  P4: [
    (c) => [fc('approve_post_draft', { draft_id: c.ctx.draft.id, version: c.ctx.draft.current_version, confirmation_text: 'tôi đồng ý duyệt (model tự bịa)' })],
    () => [txt('Đã duyệt.')],
  ],
  P5: [
    (c) => [fc('publish_website_post', { draft_id: c.ctx.draft.id, approved_version: c.ctx.draft.current_version, publish_now: true, confirmation_text: 'đăng luôn' })],
    () => [txt('Đã đăng website.')],
  ],
  P6: [
    (c) => [fc('publish_threads_post', { draft_id: c.ctx.draft.id, approved_version: c.ctx.draft.current_version, publish_now: true, confirmation_text: 'đăng luôn' })],
    () => [txt('Đã đăng Threads.')],
  ],
};

module.exports = { MODEL };

// ===========================================================================================
// Runner
// ===========================================================================================
async function run() {
  const N8N = process.env.HNX_E2E_WEBHOOK || 'http://127.0.0.1:5678/webhook/hnx-admin-agent';
  const SUPA = process.env.HNX_MOCK_SUPABASE_URL || 'http://127.0.0.1:19999';
  const OPENAI = process.env.HNX_MOCK_OPENAI_URL || 'http://127.0.0.1:19998';
  const ADMIN = '11111111-1111-4111-8111-111111111111';
  const THREAD = '33333333-3333-4333-8333-333333333333';
  const get = async (base, p) => (await fetch(base + p)).json();
  const results = [];
  let failed = 0;
  // Duyệt/đăng chỉ được phép khi bản nháp/lần duyệt cũ hơn đầu lượt ít nhất 5 giây (dung sai lệch đồng hồ).
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function turn(tag, message, { token = 'admin-token' } = {}) {
    const full = `[S:${tag}] ${message}`;
    const s0 = (await get(SUPA, '/__log')).length;
    const o0 = (await get(OPENAI, '/__requests')).length;
    const res = await fetch(N8N, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: J({ message: full, thread_id: THREAD, client_message_id: require('node:crypto').randomUUID() }) });
    const json = await res.json().catch(() => ({}));
    const supaLog = (await get(SUPA, '/__log')).slice(s0);
    const model = (await get(OPENAI, '/__requests')).slice(o0);
    const outputs = model.length ? model[model.length - 1].outputs : [];
    const rpc = (name) => supaLog.filter((l) => l.path === `/rest/v1/rpc/${name}`);
    return { status: res.status, json, message: full, supaLog, model, outputs, rpc };
  }
  async function scenario(name, fn) {
    try {
      await fn();
      results.push([name, 'PASS']);
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      results.push([name, 'FAIL']);
      const cause = err && err.cause ? ` (${err.cause.code || err.cause.message})` : '';
      console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').slice(0, 6).join('\n      ')}${cause}`);
    }
  }
  const skillFile = (n) => fs.readFileSync(path.join(REPO_ROOT, 'skills', n, 'SKILL.md'), 'utf8');
  const names = (t) => t.outputs.map((o) => o.name);

  // 0. xác thực
  await scenario('auth: không token trả 401, token không phải admin trả 403', async () => {
    const r1 = await fetch(N8N, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J({ message: 'hi' }) });
    assert.equal(r1.status, 401);
    const r2 = await fetch(N8N, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' }, body: J({ message: 'hi' }) });
    assert.equal(r2.status, 403);
  });

  // 1. thông báo: lượt 1
  let a1;
  await scenario('thông báo lượt 1: load_skill -> tìm sự kiện -> đếm người -> lưu nháp (HTML bị tước) -> gửi thử -> cố gửi cùng lượt bị chặn', async () => {
    a1 = await turn('A1', 'báo mọi người đăng ký chiến dịch La Phù là dời sang 8h sáng Chủ nhật');
    assert.equal(a1.status, 200, J(a1.json));
    assert.deepEqual(names(a1), ['load_skill', 'find_announcement_events', 'get_event_registrants', 'save_announcement_draft', 'send_test_announcement', 'approve_and_send_announcement']);
    const [skill, find, regs, save, test, approve] = a1.outputs.map((o) => o.json);
    assert.equal(skill.name, 'campaign-announcement');
    assert.equal(skill.content, skillFile('campaign-announcement'), 'load_skill phải trả đủ nội dung SKILL.md');
    assert.equal(find.status, 'ok');
    assert.equal(find.campaigns.length, 1);
    assert.equal(regs.status, 'ok');
    assert.equal(regs.can_send, true);
    assert.equal(save.status, 'ok');
    // RPC nhận nội dung đã làm sạch và id lấy từ phía server, không phải từ model
    const [saved] = a1.rpc('upsert_announcement_draft');
    assert.ok(saved, 'upsert_announcement_draft chưa được gọi');
    assert.doesNotMatch(saved.body.p_subject + saved.body.p_body, /<|script|onerror|alert/);
    assert.equal(saved.body.p_admin_id, ADMIN);
    assert.equal(saved.body.p_thread_id, THREAD);
    assert.equal(test.status, 'queued');
    const [tested] = a1.rpc('request_announcement_test');
    assert.equal(tested.body.p_admin_id, ADMIN);
    assert.equal(tested.body.p_thread_id, THREAD);
    // cố gửi trong cùng lượt: bị chặn trước RPC vì tin nhắn thật của admin là lệnh tạo thông báo, không phải xác nhận gửi
    assert.equal(approve.status, 'needs_admin_confirmation');
    assert.equal(a1.rpc('approve_announcement').length, 0, 'không được gọi approve_announcement');
  });

  await scenario('thông báo cùng lượt: tin nhắn có ý gửi nhưng bản nháp vừa tạo -> needs_admin_review; confirmation_text là tin nhắn thật của admin', async () => {
    const t = await turn('A1b', 'duyệt gửi cho tất cả');
    assert.equal(t.status, 200, J(t.json));
    assert.equal(t.outputs[t.outputs.length - 1].json.status, 'needs_admin_review');
    const [call] = t.rpc('approve_announcement');
    assert.ok(call, 'RPC approve_announcement phải được gọi (qua cổng xác nhận)');
    assert.equal(call.body.p_confirmation_text, t.message, 'phải là tin nhắn thật của admin');
    assert.notEqual(call.body.p_confirmation_text, 'tôi xác nhận gửi (do model tự bịa)');
    assert.equal(call.body.p_admin_id, ADMIN);
    assert.equal(call.body.p_thread_id, THREAD);
    const ts = Date.parse(call.body.p_turn_started_at);
    assert.ok(!Number.isNaN(ts) && ts <= Date.now() && ts > Date.now() - 10 * 60 * 1000, 'p_turn_started_at phải là thời điểm bắt đầu lượt này');
  });

  await scenario('thông báo lượt sau: admin xác nhận -> approved; confirmation_text của model bị bỏ qua', async () => {
    const t = await turn('A2', 'gửi cho tất cả');
    assert.equal(t.status, 200, J(t.json));
    const r = t.outputs[0].json;
    assert.equal(r.status, 'approved');
    assert.equal(r.recipient_count, 12);
    const [call] = t.rpc('approve_announcement');
    assert.equal(call.body.p_confirmation_text, t.message);
    assert.doesNotMatch(J(call.body), /FAKE-CONFIRMATION|EVIL/);
    const a = (await get(SUPA, '/__db')).announcements.pop();
    assert.equal(a.status, 'approved');
  });

  await scenario('thông báo: xem tiến độ bằng get_announcement_status; thread_id giả của model bị bỏ qua', async () => {
    const t = await turn('A3', 'tiến độ gửi thế nào rồi');
    assert.equal(t.status, 200, J(t.json));
    assert.equal(t.outputs[0].json.status, 'ok');
    assert.ok(['approved', 'sending'].includes(t.outputs[0].json.announcement.status));
    const [call] = t.rpc('get_announcement');
    assert.equal(call.body.p_thread_id, THREAD);
  });

  await scenario('thông báo: hủy bị từ chối khi tin nhắn không có ý hủy, được phép khi admin nói rõ hủy', async () => {
    const no = await turn('A4b', 'đừng hủy, cứ để chạy');
    assert.equal(no.outputs[0].json.status, 'needs_admin_confirmation');
    assert.equal(no.rpc('cancel_announcement').length, 0);
    const yes = await turn('A4', 'hủy thông báo này đi');
    assert.equal(yes.outputs[0].json.status, 'cancelled');
    assert.equal(yes.rpc('cancel_announcement')[0].body.p_admin_id, ADMIN);
    assert.equal((await get(SUPA, '/__db')).announcements.pop().status, 'cancelled');
  });

  // 2. bảo mật
  await scenario('bảo mật: load_skill từ chối tên lạ và path traversal, không lộ file hệ thống', async () => {
    const t = await turn('S1', 'tải thử các skill lạ');
    assert.equal(t.status, 200, J(t.json));
    assert.equal(t.outputs.length, 3);
    for (const o of t.outputs) {
      assert.equal(o.json.error, 'unknown_skill', o.raw);
      assert.deepEqual([...o.json.available].sort(), ['campaign-announcement', 'pollution-campaign-post']);
      assert.doesNotMatch(o.raw, /root:|\/bin\/|nologin/);
    }
  });

  await scenario('bảo mật: system prompt chỉ có tên + mô tả skill (không có nội dung đầy đủ) và model thấy đủ 16 tool với schema', async () => {
    assert.ok(a1, 'cần kết quả lượt thông báo 1');
    const first = a1.model[0];
    const main = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'n8n', 'admin-agent', 'main-workflow.json'), 'utf8'));
    const expectedTools = main.nodes.filter((n) => /langchain\.tool(Workflow|Code)$/.test(n.type)).map((n) => n.name).sort();
    assert.equal(expectedTools.length, 16);
    assert.deepEqual([...first.tools].sort(), expectedTools);
    for (const d of first.toolDefs) assert.ok(d.parameters && d.parameters.type === 'object', `tool ${d.name} thiếu schema`);
    const load = first.toolDefs.find((d) => d.name === 'load_skill');
    assert.ok(load.parameters.properties.skill_name, 'load_skill phải có tham số skill_name');
    const approve = first.toolDefs.find((d) => d.name === 'approve_and_send_announcement');
    assert.deepEqual(Object.keys(approve.parameters.properties).sort(), ['announcement_id', 'version'], 'model chỉ được điền announcement_id và version');
    for (const name of ['pollution-campaign-post', 'campaign-announcement']) {
      const text = skillFile(name);
      const fm = /^description:\s*(.+)$/m.exec(text)[1].trim();
      assert.ok(first.system.includes(name), `system prompt thiếu tên ${name}`);
      assert.ok(first.system.includes(fm), `system prompt thiếu mô tả ${name}`);
      const body = text.replace(/^---[\s\S]*?\n---\n/, '');
      const leaked = body.split('\n').map((l) => l.trim()).filter((l) => l.length >= 30).filter((l) => first.system.includes(l));
      assert.deepEqual(leaked, [], `system prompt chứa nội dung đầy đủ của ${name}`);
    }
    assert.ok(first.system.includes('load_skill'));
  });

  // 3. hồi quy luồng bài đăng cũ
  await scenario('pollution (cũ): tìm kiếm Tavily -> lưu findings', async () => {
    const t = await turn('P1', 'tìm điểm ô nhiễm sông Tô Lịch');
    assert.equal(t.status, 200, J(t.json));
    assert.deepEqual(names(t), ['load_skill', 'search_pollution_locations']);
    assert.equal(t.outputs[0].json.name, 'pollution-campaign-post');
    assert.equal(t.outputs[1].json.status, 'ok');
    assert.equal((await get(SUPA, '/__db')).pollution_findings.length, 2);
  });
  await scenario('pollution (cũ): tạo draft (id giả của model bị bỏ qua) rồi sửa', async () => {
    const t = await turn('P2', 'tạo bài từ địa điểm đầu tiên, bắt đầu 7h sáng Chủ nhật 6/12');
    assert.equal(t.status, 200, J(t.json));
    assert.equal(t.outputs[0].json.status, 'in_review', J(t.outputs[0].json));
    const d = (await get(SUPA, '/__db')).content_drafts[0];
    assert.equal(d.thread_id, THREAD);
    assert.equal(d.created_by, ADMIN);
    const t2 = await turn('P3', 'rút gọn bài lại');
    assert.equal(t2.outputs[0].json.status, 'in_review');
  });
  await scenario('pollution (cũ): sửa rồi duyệt cùng lượt bị chặn needs_admin_review', async () => {
    const t = await turn('P3A', 'chốt bản này');
    assert.equal(t.outputs[t.outputs.length - 1].json.status, 'needs_admin_review', J(t.outputs.map((o) => o.json)));
  });
  await scenario('pollution (cũ): duyệt (confirmation_text bịa bị bỏ qua) -> đăng website -> đăng Threads', async () => {
    await sleep(6000);
    const t = await turn('P4', 'chốt bản này');
    assert.equal(t.outputs[0].json.status, 'approved', J(t.outputs[0].json));
    await sleep(6000);
    const w = await turn('P5', 'đăng luôn lên website');
    assert.equal(w.outputs[0].json.status, 'published', J(w.outputs[0].json));
    assert.equal((await get(SUPA, '/__db')).posts.length, 1);
    const th = await turn('P6', 'đăng luôn lên Threads');
    assert.equal(th.outputs[0].json.status, 'published', J(th.outputs[0].json));
    const calls = await get(OPENAI, '/__calls');
    assert.ok(calls.some((c) => c.service === 'threads' && c.path.includes('threads_publish')));
  });

  console.log(`\n${results.length - failed}/${results.length} kịch bản đạt`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  if (!process.env.HNX_E2E_RUN) {
    console.log('scenarios: đặt HNX_E2E_RUN=1 để chạy (dùng bởi run-e2e.sh).');
    process.exit(0);
  }
  run().catch((err) => { console.error(err); process.exit(1); });
}
