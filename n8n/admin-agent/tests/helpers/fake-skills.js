'use strict';
// Dựng thư mục skills giả trong thư mục tạm và một `fs` bọc lại để đường dẫn /skills trỏ vào đó.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// spec: { 'ten-skill': { 'SKILL.md': 'nội dung', 'references/x.md': '...', 'link': { symlink: '/đường/dẫn' } } }
// Một giá trị { symlink: target } tạo symlink. Một giá trị { dir: true } tạo thư mục rỗng.
// Khóa cấp 1 cũng có thể là { symlink: target } (thư mục skill là symlink).
function makeSkillsRoot(spec) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hnx-skills-'));
  const root = path.join(base, 'skills');
  fs.mkdirSync(root);
  for (const [skillDir, entries] of Object.entries(spec || {})) {
    const dirPath = path.join(root, skillDir);
    if (entries && entries.symlink) {
      fs.symlinkSync(entries.symlink, dirPath);
      continue;
    }
    fs.mkdirSync(dirPath, { recursive: true });
    for (const [rel, value] of Object.entries(entries || {})) {
      const full = path.join(dirPath, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (value && value.symlink) fs.symlinkSync(value.symlink, full);
      else if (value && value.dir) fs.mkdirSync(full, { recursive: true });
      else if (Buffer.isBuffer(value)) fs.writeFileSync(full, value);
      else fs.writeFileSync(full, String(value));
    }
  }
  return {
    base,
    root,
    fs: wrapFs(root),
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

// fs thật nhưng mọi đường dẫn bắt đầu bằng /skills được dịch sang thư mục tạm,
// kết quả realpathSync dịch ngược lại (để mã kiểm tra "nằm trong /skills" chạy đúng).
function wrapFs(root) {
  const toReal = (p) => {
    if (typeof p !== 'string') return p;
    if (p === '/skills') return root;
    if (p.startsWith('/skills/')) return path.join(root, p.slice('/skills/'.length));
    return p;
  };
  const toFake = (p) => {
    if (typeof p !== 'string') return p;
    if (p === root) return '/skills';
    if (p.startsWith(root + path.sep)) return '/skills/' + p.slice(root.length + 1).split(path.sep).join('/');
    return p;
  };
  return new Proxy(fs, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      if (prop === 'realpathSync') {
        const fn = (p, ...rest) => toFake(target.realpathSync(toReal(p), ...rest));
        fn.native = (p, ...rest) => toFake(target.realpathSync.native(toReal(p), ...rest));
        return fn;
      }
      return (p, ...rest) => value.call(target, toReal(p), ...rest);
    },
  });
}

const VALID_SKILL = (name, description, body = '# Nội dung\n\nChi tiết.') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

module.exports = { makeSkillsRoot, wrapFs, VALID_SKILL };
