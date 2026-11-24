'use strict';
// Node kiểm tra đầu vào của bốn tool đơn giản: find_announcement_events, get_event_registrants,
// get_announcement_status, send_test_announcement. Chỉ kiểm dữ liệu đi tới RPC.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow, getCode } = require('./helpers/load-workflow');
const { runCodeNode } = require('./helpers/run-node');
const { UUID, BY_TOOL } = require('./helpers/announcement-tools');

async function validate(tool, req) {
  const def = BY_TOOL[tool];
  const out = await runCodeNode(getCode(loadWorkflow(def.file), def.validate), { input: [req] });
  assert.equal(out.length, 1);
  return out[0].json;
}

test('find_announcement_events: query được làm sạch, limit ép vào 1..10', async () => {
  const ok = await validate('find_announcement_events', { query: '  La\nPhù\u0000 <b>x</b> ' + 'a'.repeat(300), limit: 50 });
  assert.equal(ok.allowed, true);
  assert.doesNotMatch(ok.request.p_query, /[\r\n\u0000<>]/);
  assert.ok(ok.request.p_query.length <= 100);
  assert.equal(ok.request.p_limit, 10);
  const empty = await validate('find_announcement_events', { query: null, limit: 'abc' });
  assert.deepEqual(empty.request, { p_query: '', p_limit: 5 });
});

test('get_event_registrants: campaign_id hợp lệ đi tiếp, sai thì invalid_input', async () => {
  const ok = await validate('get_event_registrants', { campaign_id: UUID.campaign });
  assert.deepEqual(ok.request, { p_campaign_id: UUID.campaign });
  for (const bad of ['', null, 'La Phù', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc']) {
    const r = await validate('get_event_registrants', { campaign_id: bad });
    assert.equal(r.allowed, false);
    assert.deepEqual([r.result.status, r.result.field], ['invalid_input', 'campaign_id']);
  }
});

test('get_announcement_status: bỏ trống announcement_id thì p_announcement_id = null; id sai thì invalid_input', async () => {
  const none = await validate('get_announcement_status', { thread_id: UUID.thread, announcement_id: '' });
  assert.deepEqual(none.request, { p_thread_id: UUID.thread, p_announcement_id: null });
  const some = await validate('get_announcement_status', { thread_id: UUID.thread, announcement_id: UUID.announcement });
  assert.equal(some.request.p_announcement_id, UUID.announcement);
  const bad = await validate('get_announcement_status', { thread_id: UUID.thread, announcement_id: 'abc' });
  assert.deepEqual([bad.allowed, bad.result.status, bad.result.field], [false, 'invalid_input', 'announcement_id']);
});

test('send_test_announcement: request có đúng tên tham số; id/version sai thì invalid_input', async () => {
  const base = { thread_id: UUID.thread, admin_user_id: UUID.admin, announcement_id: UUID.announcement, version: 3 };
  const ok = await validate('send_test_announcement', base);
  assert.deepEqual(ok.request, { p_thread_id: UUID.thread, p_admin_id: UUID.admin, p_announcement_id: UUID.announcement, p_version: 3 });
  for (const [field, bad] of [['announcement_id', ''], ['admin_user_id', null], ['version', 0], ['version', 'x']]) {
    const r = await validate('send_test_announcement', { ...base, [field]: bad });
    assert.deepEqual([r.allowed, r.result.status, r.result.field], [false, 'invalid_input', field], field);
  }
});
