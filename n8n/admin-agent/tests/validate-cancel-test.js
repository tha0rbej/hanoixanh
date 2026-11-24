'use strict';
// Chốt chặn của cancel_announcement: node `Validate Cancel` chỉ cho hủy khi tin nhắn thật của admin có ý hủy rõ ràng.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow, getCode } = require('./helpers/load-workflow');
const { runCodeNode } = require('./helpers/run-node');
const { UUID } = require('./helpers/announcement-tools');

const codeOf = () => getCode(loadWorkflow('cancel-announcement.json'), 'Validate Cancel');

async function validate(over = {}) {
  const req = { thread_id: UUID.thread, admin_user_id: UUID.admin, announcement_id: UUID.announcement, confirmation_text: 'hủy', ...over };
  const out = await runCodeNode(codeOf(), { input: [req] });
  assert.equal(out.length, 1);
  return out[0].json;
}

test('Validate Cancel: ý hủy rõ ràng được cho qua và request chỉ có thread/admin/announcement', async () => {
  for (const msg of ['hủy thông báo đi', 'dừng gửi', 'cancel']) {
    const r = await validate({ confirmation_text: msg });
    assert.equal(r.allowed, true, msg);
    assert.deepEqual(r.request, { p_thread_id: UUID.thread, p_admin_id: UUID.admin, p_announcement_id: UUID.announcement });
  }
});

test('Validate Cancel: xác nhận gửi, lệnh tạo thông báo, phủ định và rỗng bị từ chối', async () => {
  for (const msg of ['gửi đi', 'báo mọi người là chiến dịch bị hủy', 'đừng hủy', 'chưa muốn hủy', '', null]) {
    const r = await validate({ confirmation_text: msg });
    assert.equal(r.allowed, false, String(msg));
    assert.equal(r.result.status, 'needs_admin_confirmation', String(msg));
  }
});

test('Validate Cancel: announcement_id sai trả invalid_input', async () => {
  const r = await validate({ announcement_id: 'abc' });
  assert.equal(r.allowed, false);
  assert.equal(r.result.status, 'invalid_input');
  assert.equal(r.result.field, 'announcement_id');
});
