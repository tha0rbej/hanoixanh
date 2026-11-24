'use strict';
// Hồi quy cho chốt chặn của luồng bài đăng (có sẵn từ trước) chạy qua bộ chạy `vm`;
// đồng thời kiểm tra bộ chạy mô phỏng đủ $input, $('Node'), $env và chặn require ngoài fs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow, getCode } = require('./helpers/load-workflow');
const { runCodeNode } = require('./helpers/run-node');

const code = getCode(loadWorkflow('approve-post-draft.json'), 'Validate Approval');
const TRIGGER = 'When Executed by Another Workflow';

function run({ message, createdAt = '2026-11-24T09:00:00.000Z', currentVersion = 2, version = 2 }) {
  const req = {
    thread_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    admin_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    draft_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    version,
    confirmation_text: message,
    turn_started_at: '2026-11-24T10:00:00.000Z',
  };
  return runCodeNode(code, {
    input: [{ id: 'v1', created_at: createdAt }],
    nodes: { [TRIGGER]: [req], 'Get Draft': [{ id: req.draft_id, current_version: currentVersion, status: 'draft' }] },
  });
}

test('duyệt bài đăng: xác nhận rõ ở lượt sau thì cho duyệt; tin nhắn tìm kiếm hoặc phủ định thì từ chối', async () => {
  assert.equal((await run({ message: 'chốt bản này' }))[0].json.allowed, true);
  assert.equal((await run({ message: 'tìm điểm ô nhiễm sông Tô Lịch' }))[0].json.result.status, 'needs_admin_confirmation');
  assert.equal((await run({ message: 'đừng duyệt vội' }))[0].json.result.status, 'needs_admin_confirmation');
});

test('duyệt bài đăng: bản nháp tạo trong cùng lượt thì needs_admin_review; version cũ thì ném stale_version', async () => {
  assert.equal((await run({ message: 'duyệt', createdAt: '2026-11-24T10:00:01.000Z' }))[0].json.result.status, 'needs_admin_review');
  await assert.rejects(run({ message: 'duyệt', currentVersion: 3, version: 2 }), /stale_version/);
});

test('bộ chạy node Code: chặn require ngoài fs và báo lỗi khi tham chiếu node chưa chạy', async () => {
  await assert.rejects(runCodeNode("const p = require('path'); return [{ json: {} }];"), /disallowed/);
  await assert.rejects(runCodeNode("return [{ json: $('Không có').first().json }];"), /hasn't been executed/);
});
