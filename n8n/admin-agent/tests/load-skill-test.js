'use strict';
// Node toolCode `load_skill`: allowlist động, chặn path traversal/symlink, giới hạn kích thước.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWorkflow, getToolCode, mustFindNode, SKILLS_DIR } = require('./helpers/load-workflow');
const { runToolCode } = require('./helpers/run-node');
const { makeSkillsRoot, wrapFs, VALID_SKILL } = require('./helpers/fake-skills');

const main = loadWorkflow('main-workflow.json');
const codeOf = () => getToolCode(main, 'load_skill');

async function call(spec, query, fsOverride) {
  const fake = makeSkillsRoot(spec);
  try {
    const raw = await runToolCode(codeOf(), { query, fs: fsOverride ? fsOverride(fake.fs) : fake.fs });
    assert.equal(typeof raw, 'string', 'toolCode phải trả chuỗi');
    return JSON.parse(raw);
  } finally {
    fake.cleanup();
  }
}

const SPEC = {
  'alpha-skill': { 'SKILL.md': VALID_SKILL('alpha-skill', 'Alpha.', '# Alpha\n\nNỘI-DUNG-ALPHA'), 'references/x.md': 'THAM-KHẢO' },
  'beta-skill': { 'SKILL.md': VALID_SKILL('beta-skill', 'Beta.') },
};

test('load_skill: tên hợp lệ trả toàn bộ nội dung SKILL.md (không kèm references); nhận object, chuỗi trơn hoặc JSON', async () => {
  const expected = VALID_SKILL('alpha-skill', 'Alpha.', '# Alpha\n\nNỘI-DUNG-ALPHA');
  for (const query of [{ skill_name: 'alpha-skill' }, 'alpha-skill', '{"skill_name":"alpha-skill"}']) {
    const r = await call(SPEC, query);
    assert.deepEqual(r, { name: 'alpha-skill', content: expected });
  }
});

test('load_skill: tên lạ, path traversal, byte null, rỗng, quá dài, sai kiểu đều bị từ chối unknown_skill kèm danh sách available', async () => {
  const bad = ['khong-co', '../x', '../../etc/passwd', '..', '.', 'a/b', '/etc/passwd', 'alpha-skill\\..\\x', 'alpha-skill\u0000', '', '   ', ' alpha-skill', 'ALPHA-SKILL', 'a'.repeat(65), 'alpha-skill\n', 'alpha-skill/references/x.md'];
  for (const name of bad) {
    const r = await call(SPEC, { skill_name: name });
    assert.deepEqual(r, { error: 'unknown_skill', available: ['alpha-skill', 'beta-skill'] }, JSON.stringify(name));
  }
  for (const query of [{}, null, undefined, 42, ['alpha-skill'], { skill_name: { a: 1 } }, '{skill_name:']) {
    const r = await call(SPEC, query);
    assert.equal(r.error, 'unknown_skill', JSON.stringify(query));
  }
});

test('load_skill: allowlist là động — thêm thư mục skill mới thì tải được ngay; skill thiếu frontmatter hợp lệ thì không', async () => {
  const spec = { ...SPEC, 'gamma-skill': { 'SKILL.md': VALID_SKILL('gamma-skill', 'Gamma.') }, 'no-front': { 'SKILL.md': '# chỉ tiêu đề\n' } };
  assert.equal((await call(spec, { skill_name: 'gamma-skill' })).name, 'gamma-skill');
  assert.equal((await call(spec, { skill_name: 'no-front' })).error, 'unknown_skill');
  assert.equal((await call(SPEC, { skill_name: 'gamma-skill' })).error, 'unknown_skill');
});

test('load_skill: SKILL.md lớn hơn 64 KB bị từ chối skill_too_large; đúng 64 KB vẫn tải được', async () => {
  const big = await call({ ...SPEC, 'big-skill': { 'SKILL.md': VALID_SKILL('big-skill', 'Lớn.', 'x'.repeat(65 * 1024)) } }, { skill_name: 'big-skill' });
  assert.deepEqual(big, { error: 'skill_too_large', max_bytes: 65536 });
  const head = '---\nname: edge-skill\ndescription: Biên.\n---\n';
  const edge = await call({ 'edge-skill': { 'SKILL.md': head + 'y'.repeat(65536 - Buffer.byteLength(head)) } }, { skill_name: 'edge-skill' });
  assert.equal(Buffer.byteLength(edge.content), 65536);
});

test('load_skill: symlink (thư mục hoặc SKILL.md, ra ngoài hay trong /skills) bị từ chối và không lộ nội dung', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hnx-outside-'));
  try {
    fs.mkdirSync(path.join(outside, 'evil'));
    fs.writeFileSync(path.join(outside, 'evil', 'SKILL.md'), VALID_SKILL('evil', 'Ngoài.', 'BÍ-MẬT-NGOÀI'));
    fs.writeFileSync(path.join(outside, 'secret.md'), VALID_SKILL('linked', 'Ngoài.', 'BÍ-MẬT-NGOÀI'));
    const spec = {
      ...SPEC,
      evil: { symlink: path.join(outside, 'evil') },
      linked: { 'SKILL.md': { symlink: path.join(outside, 'secret.md') } },
      inner: { 'SKILL.md': { symlink: '../alpha-skill/SKILL.md' } },
    };
    for (const name of ['evil', 'linked', 'inner']) {
      const r = await call(spec, { skill_name: name });
      assert.equal(r.error, 'unknown_skill', name);
      assert.doesNotMatch(JSON.stringify(r), /BÍ-MẬT/);
      assert.deepEqual(r.available, ['alpha-skill', 'beta-skill']);
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('load_skill: thiếu /skills hoặc đọc file lỗi thì trả error có cấu trúc, không ném ngoại lệ và không lộ đường dẫn', async () => {
  const fake = makeSkillsRoot({});
  fs.rmSync(fake.root, { recursive: true, force: true });
  try {
    assert.deepEqual(JSON.parse(await runToolCode(codeOf(), { query: { skill_name: 'x' }, fs: fake.fs })), { error: 'unknown_skill', available: [] });
  } finally {
    fake.cleanup();
  }
  const broken = (real) => new Proxy(real, { get: (t, p) => (p === 'readFileSync' ? () => { throw new Error('EACCES: /skills/secret/path'); } : t[p]) });
  const r = await call(SPEC, { skill_name: 'alpha-skill' }, broken);
  assert.equal(r.error, 'skill_unreadable');
  assert.doesNotMatch(JSON.stringify(r), /EACCES|\/skills\/secret/);
});

test('load_skill: tải được cả hai skill thật của repo, nội dung giống file', async () => {
  for (const name of ['pollution-campaign-post', 'campaign-announcement']) {
    const r = JSON.parse(await runToolCode(codeOf(), { query: { skill_name: name }, fs: wrapFs(SKILLS_DIR) }));
    assert.equal(r.name, name);
    assert.equal(r.content, fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8'));
  }
});

test('load_skill: node khai báo lược đồ đầu vào skill_name (string, bắt buộc)', () => {
  const node = mustFindNode(main, 'load_skill');
  assert.equal(node.parameters.specifyInputSchema, true);
  assert.equal(node.parameters.schemaType, 'manual');
  const schema = JSON.parse(node.parameters.inputSchema);
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['skill_name']);
  assert.equal(schema.properties.skill_name.type, 'string');
});
