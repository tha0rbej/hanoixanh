'use strict';
// Node `Sanitize Draft` của save_announcement_draft: làm sạch tiêu đề/nội dung TRƯỚC khi gọi RPC.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow, getCode } = require('./helpers/load-workflow');
const { runCodeNode } = require('./helpers/run-node');
const { UUID } = require('./helpers/announcement-tools');

const codeOf = () => getCode(loadWorkflow('save-announcement-draft.json'), 'Sanitize Draft');

async function sanitize(over = {}) {
  const req = {
    thread_id: UUID.thread,
    admin_user_id: UUID.admin,
    campaign_id: UUID.campaign,
    subject: 'Thông báo dời giờ chiến dịch La Phù',
    body: 'Chiến dịch dời sang 8h sáng Chủ nhật.',
    ...over,
  };
  const out = await runCodeNode(codeOf(), { input: [req] });
  assert.equal(out.length, 1);
  return out[0].json;
}

const noTags = (s) => assert.doesNotMatch(s, /<\/?[a-zA-Z!?]/, `còn thẻ HTML trong: ${s}`);

test('Sanitize Draft: nội dung sạch đi nguyên, thread/admin/campaign lấy từ trường cố định', async () => {
  const r = await sanitize();
  assert.equal(r.allowed, true);
  assert.deepEqual(r.request, {
    p_thread_id: UUID.thread,
    p_admin_id: UUID.admin,
    p_campaign_id: UUID.campaign,
    p_subject: 'Thông báo dời giờ chiến dịch La Phù',
    p_body: 'Chiến dịch dời sang 8h sáng Chủ nhật.',
  });
});

test('Sanitize Draft: tước script, img onerror, thẻ có thuộc tính và thẻ lồng <<b>script> trước khi gửi RPC', async () => {
  const dirty = [
    'Xin chào <script>alert(1)</script> mọi người',
    'Ảnh <img src=x onerror=alert(1)> và <a href="javascript:alert(1)">bấm</a>',
    'Lồng <<b>script>alert(1)<</b>/script> nhau',
    'Chú thích <!-- ẩn --> hết',
  ];
  for (const body of dirty) {
    const r = await sanitize({ body, subject: '<<b>i>Tiêu đề</<b>i>' });
    assert.equal(r.allowed, true, body);
    noTags(r.request.p_body);
    noTags(r.request.p_subject);
    assert.doesNotMatch(r.request.p_body, /script|onerror|alert|javascript/, body);
    assert.equal(r.request.p_subject, 'Tiêu đề');
  }
});

test('Sanitize Draft: chữ "a < b and c > d" được giữ nguyên', async () => {
  const body = 'Điều kiện: a < b and c > d, và 3 <5 hoặc 7> 2.';
  const r = await sanitize({ body });
  assert.equal(r.request.p_body, body);
});

test('Sanitize Draft: gỡ ký tự điều khiển, chuẩn hóa xuống dòng, tiêu đề một dòng', async () => {
  const [rlo, zwsp] = [0x202e, 0x200b].map((c) => String.fromCharCode(c));
  const r = await sanitize({ body: `a\u0000b\u0007c${rlo}d${zwsp}e\r\nf\rg\n\n\n\nh`, subject: 'Dời giờ\nchiến dịch\r\nLa Phù' });
  assert.equal(r.request.p_body, 'abcde\nf\ng\n\nh');
  assert.equal(r.request.p_subject, 'Dời giờ chiến dịch La Phù');
});

test('Sanitize Draft: quá dài bị từ chối too_long (không cắt âm thầm), đúng giới hạn thì nhận', async () => {
  assert.equal((await sanitize({ subject: 'a'.repeat(150), body: 'b'.repeat(5000) })).allowed, true);
  const s = await sanitize({ subject: 'a'.repeat(151) });
  assert.deepEqual([s.allowed, s.result.status, s.result.field, s.result.reason, s.result.max], [false, 'invalid_input', 'subject', 'too_long', 150]);
  const b = await sanitize({ body: 'b'.repeat(5001) });
  assert.deepEqual([b.allowed, b.result.status, b.result.field, b.result.reason, b.result.max], [false, 'invalid_input', 'body', 'too_long', 5000]);
});

test('Sanitize Draft: rỗng sau khi làm sạch trả needs_content', async () => {
  for (const [field, value] of [['subject', '   '], ['subject', '<b></b>'], ['body', '<script>alert(1)</script>'], ['body', null], ['body', '\u0000\u0007']]) {
    const r = await sanitize({ [field]: value });
    assert.equal(r.allowed, false, `${field}=${JSON.stringify(value)}`);
    assert.equal(r.result.status, 'needs_content');
    assert.equal(r.result.field, field);
  }
});

test('Sanitize Draft: id sai trả invalid_input, chuỗi tấn công regex chạy xong nhanh', async () => {
  const bad = await sanitize({ campaign_id: 'khong-phai-uuid' });
  assert.deepEqual([bad.allowed, bad.result.status, bad.result.field], [false, 'invalid_input', 'campaign_id']);
  const started = Date.now();
  await sanitize({ body: '<script>'.repeat(2400), subject: '<a'.repeat(400) });
  assert.ok(Date.now() - started < 3000, 'xử lý quá chậm');
});
