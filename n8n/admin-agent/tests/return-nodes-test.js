'use strict';
// Node `Return Result` của 7 tool thông báo: MỌI mã status của hợp đồng RPC giai đoạn 1
// (comment đầu supabase/migrations/20261124000000_campaign_announcements.sql) phải đi qua đúng status;
// RPC chưa có hoặc lỗi thì trả service_unavailable. Không kiểm nội dung câu thông báo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow, getCode } = require('./helpers/load-workflow');
const { runCodeNode } = require('./helpers/run-node');
const { UUID, TOOLS, BY_TOOL } = require('./helpers/announcement-tools');

async function ret(tool, response) {
  const out = await runCodeNode(getCode(loadWorkflow(BY_TOOL[tool].file), 'Return Result'), { input: [response] });
  assert.equal(out.length, 1);
  return out[0].json;
}
const ok = (body) => ({ statusCode: 200, body });
const CAMPAIGN = { id: UUID.campaign, title: 'Dọn rác La Phù', start_at: '2026-12-06T00:00:00+00:00', end_at: null, location: 'La Phù' };
const ANN = (status = 'draft') => ({ id: UUID.announcement, status, version: 2, subject: 's', body_text: 'b', campaign: CAMPAIGN, registrant_count: 12, test: { state: 'none' }, recipient_count: 12, progress: { pending: 1, sent: 2, failed: 3, skipped: 4 } });

// Mọi status của hợp đồng, mỗi tool một danh sách [body RPC].
const CONTRACT = {
  find_announcement_events: [{ status: 'ok', campaigns: [] }, { status: 'ok', campaigns: [{ ...CAMPAIGN, campaign_status: 'upcoming', registrant_count: 3 }] }, { status: 'invalid_input' }],
  get_event_registrants: [{ status: 'ok', campaign: CAMPAIGN, registrant_count: 12, max_recipients: 1000, sample_names: [] }, { status: 'campaign_not_found' }, { status: 'invalid_input' }],
  save_announcement_draft: [
    { status: 'ok', created: true, unchanged: false, announcement: ANN() },
    { status: 'ok', created: false, unchanged: true, announcement: ANN() },
    { status: 'forbidden' },
    { status: 'campaign_not_found' },
    { status: 'invalid_input', field: 'subject', reason: 'too_long', max: 150 },
    { status: 'version_limit' },
  ],
  get_announcement_status: [...['draft', 'approved', 'sending', 'sent', 'cancelled'].map((s) => ({ status: 'ok', announcement: ANN(s) })), { status: 'not_found' }, { status: 'invalid_input' }],
  send_test_announcement: [
    { status: 'queued', version: 2, tests_left_this_hour: 4 },
    { status: 'not_found' },
    { status: 'forbidden' },
    { status: 'not_draft', announcement_status: 'approved' },
    { status: 'version_mismatch', current_version: 4 },
    { status: 'rate_limited', retry_after_seconds: 1200 },
    { status: 'invalid_input' },
  ],
  approve_and_send_announcement: [
    { status: 'approved', announcement_id: UUID.announcement, version: 2, recipient_count: 12 },
    { status: 'already_approved', announcement_status: 'sending', version: 2, recipient_count: 12 },
    { status: 'version_mismatch', current_version: 3 },
    { status: 'cancelled' },
    { status: 'confirmation_required' },
    { status: 'needs_admin_review' },
    { status: 'no_recipients' },
    { status: 'too_many_recipients', count: 1500, max: 1000 },
    { status: 'not_found' },
    { status: 'forbidden' },
    { status: 'invalid_input' },
  ],
  cancel_announcement: [{ status: 'cancelled', skipped: 8, sent_count: 4 }, { status: 'already_sent' }, { status: 'already_cancelled' }, { status: 'not_found' }, { status: 'forbidden' }, { status: 'invalid_input' }],
};

for (const def of TOOLS) {
  test(`${def.tool}: mọi status của hợp đồng RPC đi qua đúng status và có message cho model`, async () => {
    assert.ok(CONTRACT[def.tool].length >= 3);
    for (const body of CONTRACT[def.tool]) {
      const r = await ret(def.tool, ok(body));
      assert.equal(r.status, body.status, JSON.stringify(body));
      assert.equal(typeof r.message, 'string');
      assert.ok(r.message.length > 0);
    }
  });

  test(`${def.tool}: RPC chưa có (PGRST202/404) hoặc lỗi HTTP/mạng trả service_unavailable thay vì lỗi trần`, async () => {
    for (const response of [
      { statusCode: 404, body: { code: 'PGRST202', message: 'Could not find the function' } },
      { statusCode: 404, body: {} },
      { statusCode: 500, body: { message: 'boom' } },
      { statusCode: 401, body: { message: 'Invalid API key' } },
      { error: { message: 'ECONNREFUSED' } },
      {},
      { statusCode: 200, body: { foo: 1 } },
    ]) {
      const r = await ret(def.tool, response);
      assert.equal(r.status, 'service_unavailable', JSON.stringify(response));
      assert.doesNotMatch(JSON.stringify(r), /ECONNREFUSED|Invalid API key|boom|Could not find/, 'không đưa lỗi thô cho model');
    }
  });
}

test('Return Result: dữ liệu quyết định luồng được giữ (can_send, số người nhận, giới hạn)', async () => {
  const reg = (n) => ret('get_event_registrants', ok({ status: 'ok', campaign: CAMPAIGN, registrant_count: n, max_recipients: 1000, sample_names: [] }));
  assert.equal((await reg(0)).can_send, false);
  assert.equal((await reg(12)).can_send, true);
  assert.equal((await reg(1000)).can_send, true);
  assert.equal((await reg(1001)).can_send, false);
  const approved = await ret('approve_and_send_announcement', ok({ status: 'approved', announcement_id: UUID.announcement, version: 2, recipient_count: 12 }));
  assert.equal(approved.recipient_count, 12);
  const many = await ret('approve_and_send_announcement', ok({ status: 'too_many_recipients', count: 1500, max: 1000 }));
  assert.deepEqual([many.count, many.max], [1500, 1000]);
});

test('Return Result: không bao giờ đưa trường email/danh sách người nhận về cho model', async () => {
  const r = await ret('get_event_registrants', ok({ status: 'ok', campaign: CAMPAIGN, registrant_count: 2, max_recipients: 1000, sample_names: ['A. B.'], email: 'a@b.vn', recipients: [{ email: 'x@y.vn' }], emails: ['z@w.vn'] }));
  assert.doesNotMatch(JSON.stringify(r), /@/);
});

test('Return Validation Result trả đúng result của node kiểm tra', async () => {
  for (const def of TOOLS) {
    const out = await runCodeNode(getCode(loadWorkflow(def.file), 'Return Validation Result'), { input: [{ allowed: false, result: { status: 'needs_admin_confirmation', message: 'x' } }] });
    assert.deepEqual(out, [{ json: { status: 'needs_admin_confirmation', message: 'x' } }], def.tool);
  }
});
