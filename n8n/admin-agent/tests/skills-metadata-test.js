'use strict';
// Node Code `Load Skills Metadata` của workflow chính: đọc /skills/*/SKILL.md, lấy name + description
// để đưa vào system prompt (không đưa nội dung đầy đủ), bỏ qua skill hỏng mà không sập.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWorkflow, getCode, SKILLS_DIR } = require('./helpers/load-workflow');
const { runCodeNode } = require('./helpers/run-node');
const { makeSkillsRoot, wrapFs, VALID_SKILL } = require('./helpers/fake-skills');

const codeOf = () => getCode(loadWorkflow('main-workflow.json'), 'Load Skills Metadata');

async function load(spec) {
  const fake = makeSkillsRoot(spec);
  try {
    const out = await runCodeNode(codeOf(), { input: [{ thread_id: 'x' }], fs: fake.fs });
    assert.equal(out.length, 1);
    return out[0].json;
  } finally {
    fake.cleanup();
  }
}

test('Load Skills Metadata: đọc name + description (một dòng, > và |), sắp xếp theo tên, không kèm thân SKILL.md', async () => {
  const folded = '---\nname: folded\ndescription: >\n  Dòng một\n  dòng hai\nother: 1\n---\n# x\n';
  const literal = '---\r\nname: literal\r\ndescription: |\r\n  Một\r\n  hai\r\n---\r\n# x\r\n';
  const r = await load({
    'b-skill': { 'SKILL.md': VALID_SKILL('b-skill', 'Mô tả B.', '# Thân\n\nCHUỖI-ĐẶC-TRƯNG-CỦA-THÂN') },
    'a-skill': { 'SKILL.md': VALID_SKILL('a-skill', 'Mô tả A.') },
    folded: { 'SKILL.md': folded },
    literal: { 'SKILL.md': literal },
  });
  assert.deepEqual(r.skills, [
    { name: 'a-skill', description: 'Mô tả A.' },
    { name: 'b-skill', description: 'Mô tả B.' },
    { name: 'folded', description: 'Dòng một dòng hai' },
    { name: 'literal', description: 'Một hai' },
  ]);
  assert.equal(r.skills_metadata.split('\n').length, 4);
  assert.match(r.skills_metadata, /^- a-skill: Mô tả A\.$/m);
  assert.doesNotMatch(r.skills_metadata, /CHUỖI-ĐẶC-TRƯNG/);
});

test('Load Skills Metadata: bỏ qua skill hỏng (thiếu name/description/frontmatter, rỗng, sai tên, quá 64KB, tên thư mục xấu) mà không sập', async () => {
  const r = await load({
    good: { 'SKILL.md': VALID_SKILL('good', 'Tốt.') },
    'no-name': { 'SKILL.md': '---\ndescription: Thiếu tên\n---\n' },
    'no-desc': { 'SKILL.md': '---\nname: no-desc\n---\n' },
    'no-front': { 'SKILL.md': '# Chỉ có tiêu đề\n' },
    empty: { 'SKILL.md': '' },
    mismatch: { 'SKILL.md': VALID_SKILL('other-name', 'Sai tên.') },
    big: { 'SKILL.md': VALID_SKILL('big', 'Quá lớn.', 'x'.repeat(70 * 1024)) },
    broken: { 'SKILL.md': Buffer.from([0xff, 0xfe, 0x00, 0x2d, 0x2d]) },
    Bad_Name: { 'SKILL.md': VALID_SKILL('Bad_Name', 'Tên xấu.') },
    ['a'.repeat(65)]: { 'SKILL.md': VALID_SKILL('a'.repeat(65), 'Dài quá.') },
    'dir-skill': { 'SKILL.md': { dir: true } },
  });
  assert.deepEqual(r.skills.map((s) => s.name), ['good']);
});

test('Load Skills Metadata: bỏ qua symlink trỏ ra ngoài /skills (thư mục skill và SKILL.md)', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hnx-outside-'));
  try {
    fs.mkdirSync(path.join(outside, 'evil'));
    fs.writeFileSync(path.join(outside, 'evil', 'SKILL.md'), VALID_SKILL('evil', 'Nằm ngoài.'));
    fs.writeFileSync(path.join(outside, 'file.md'), VALID_SKILL('link-file', 'File ngoài.'));
    const r = await load({
      evil: { symlink: path.join(outside, 'evil') },
      'link-file': { 'SKILL.md': { symlink: path.join(outside, 'file.md') } },
      good: { 'SKILL.md': VALID_SKILL('good', 'Tốt.') },
    });
    assert.deepEqual(r.skills.map((s) => s.name), ['good']);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('Load Skills Metadata: thư mục /skills không tồn tại thì không sập và trả danh sách rỗng', async () => {
  const fake = makeSkillsRoot({});
  fs.rmSync(fake.root, { recursive: true, force: true });
  try {
    const out = await runCodeNode(codeOf(), { fs: fake.fs });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].json.skills, []);
    assert.equal(typeof out[0].json.skills_metadata, 'string');
  } finally {
    fake.cleanup();
  }
});

test('Load Skills Metadata: skill thật của repo đọc được', async () => {
  const out = await runCodeNode(codeOf(), { fs: wrapFs(SKILLS_DIR) });
  const names = out[0].json.skills.map((s) => s.name);
  assert.deepEqual(names, ['campaign-announcement', 'pollution-campaign-post']);
  for (const s of out[0].json.skills) assert.ok(s.description.length > 0 && s.description.length <= 400);
});
