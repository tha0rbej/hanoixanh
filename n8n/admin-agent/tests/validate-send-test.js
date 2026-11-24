'use strict';
// Chốt chặn của approve_and_send_announcement: node `Validate Send` chỉ cho gọi RPC khi tin nhắn thật của admin
// là xác nhận gửi rõ ràng. Chỉ kiểm LUỒNG (cho qua / từ chối), không kiểm câu chữ thông điệp.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow, getCode } = require('./helpers/load-workflow');
const { runCodeNode } = require('./helpers/run-node');
const { UUID } = require('./helpers/announcement-tools');

// Nạp lười để mỗi test thất bại riêng khi workflow chưa có.
const codeOf = () => getCode(loadWorkflow('approve-and-send-announcement.json'), 'Validate Send');

async function validate(over = {}) {
  const req = {
    thread_id: UUID.thread,
    admin_user_id: UUID.admin,
    announcement_id: UUID.announcement,
    version: 2,
    confirmation_text: 'gửi đi',
    turn_started_at: '2026-11-24T10:00:00.000Z',
    ...over,
  };
  const out = await runCodeNode(codeOf(), { input: [req] });
  assert.equal(out.length, 1);
  return out[0].json;
}

test('Validate Send: xác nhận gửi rõ ràng (kể cả chữ NFD) được cho qua', async () => {
  for (const msg of ['gửi đi', 'duyệt gửi cho tất cả', 'chốt bản này, gửi luôn', 'gửi đi'.normalize('NFD')]) {
    const r = await validate({ confirmation_text: msg });
    assert.equal(r.allowed, true, msg);
  }
});

test('Validate Send: lệnh tạo thông báo, tin nhắn tìm kiếm, ok trống, rỗng đều bị từ chối needs_admin_confirmation', async () => {
  for (const msg of ['báo mọi người chiến dịch La Phù dời giờ', 'tìm sự kiện La Phù', 'ok', '', '   ', null, 123]) {
    const r = await validate({ confirmation_text: msg });
    assert.equal(r.allowed, false, String(msg));
    assert.equal(r.result.status, 'needs_admin_confirmation', String(msg));
    assert.equal(r.request, undefined);
  }
});

test('Validate Send: phủ định, gửi thử, câu hỏi bị từ chối', async () => {
  for (const msg of ['đừng gửi vội', 'chưa gửi nhé', 'hủy gửi', "don't send yet", 'gửi thử cho tôi', 'gửi được chưa?']) {
    const r = await validate({ confirmation_text: msg });
    assert.equal(r.result.status, 'needs_admin_confirmation', msg);
  }
});

test('Validate Send: request RPC có đúng tên tham số và nguyên văn tin nhắn thật của admin', async () => {
  const r = await validate({ confirmation_text: '  Duyệt gửi cho tất cả  ', turn_started_at: '2026-11-24T17:00:00+07:00', version: '3' });
  assert.equal(r.allowed, true);
  assert.deepEqual(r.request, {
    p_thread_id: UUID.thread,
    p_admin_id: UUID.admin,
    p_announcement_id: UUID.announcement,
    p_version: 3,
    p_confirmation_text: 'Duyệt gửi cho tất cả',
    p_turn_started_at: '2026-11-24T10:00:00.000Z',
  });
});

test('Validate Send: turn_started_at hỏng trả invalid_input', async () => {
  for (const bad of ['', null, 'hôm qua', '2026-13-45T00:00:00Z']) {
    const r = await validate({ turn_started_at: bad });
    assert.equal(r.allowed, false);
    assert.equal(r.result.status, 'invalid_input');
    assert.equal(r.result.field, 'turn_started_at');
  }
});

test('Validate Send: id hoặc version sai trả invalid_input, không gọi RPC', async () => {
  for (const [field, bad] of [['announcement_id', 'khong-phai-uuid'], ['thread_id', 'abc'], ['admin_user_id', null], ['version', 0], ['version', 1.5]]) {
    const r = await validate({ [field]: bad });
    assert.equal(r.allowed, false, field);
    assert.equal(r.result.status, 'invalid_input');
    assert.equal(r.result.field, field);
  }
});
