'use strict';
// Quét repo tìm chuỗi giống khóa thật (OpenAI, Tavily, Supabase secret, JWT).
// Chỉ đọc file mà git theo dõi hoặc chưa theo dõi nhưng KHÔNG bị .gitignore chặn, nên không bao giờ mở n8n/.env*.
// Dòng nào chứa "fake-secret-ok" được bỏ qua (dùng cho chuỗi giả trong test).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PATTERNS = [
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'tavily-key', re: /\btvly-[A-Za-z0-9_-]{10,}/ },
  { name: 'supabase-secret', re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
];
const PLACEHOLDER_RE = /^[xX*._-]{8,}$/;
const SKIP_EXT =new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.zip', '.exe', '.pdf', '.mp4']);
const MAX_BYTES = 2 * 1024 * 1024;

function listFiles(repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((rel) => !path.basename(rel).startsWith('.env'))
    .filter((rel) => !rel.split('/').includes('node_modules'))
    .filter((rel) => !SKIP_EXT.has(path.extname(rel).toLowerCase()));
}

// Trả về mảng { file, line, pattern } (không kèm nội dung khớp để không in lại khóa).
function findSecretLike(repoRoot) {
  const hits = [];
  for (const rel of listFiles(repoRoot)) {
    const full = path.join(repoRoot, rel);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // file đã xóa nhưng còn trong index
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (text.includes('fake-secret-ok')) return;
      for (const p of PATTERNS) {
        const m = p.re.exec(text);
        // Chuỗi mẫu rõ ràng (sb_secret_xxxxxxxx) không phải khóa thật.
        if (m && !PLACEHOLDER_RE.test(m[0].replace(/^(?:sk-|tvly-|sb_secret_)/, ''))) hits.push({ file: rel, line: i + 1, pattern: p.name });
      }
    });
  }
  return hits;
}

function assertNoSecretLike(repoRoot, assert) {
  const hits = findSecretLike(repoRoot);
  assert.deepEqual(hits, [], 'Có chuỗi giống khóa thật trong repo (file:dòng): ' + hits.map((h) => `${h.file}:${h.line}(${h.pattern})`).join(', '));
}

module.exports = { findSecretLike, assertNoSecretLike, listFiles, PATTERNS };
