'use strict';
// Kiểm thử luồng đầu-cuối trên n8n THẬT trong Docker (mock OpenAI/Supabase/Tavily/Threads, không khóa thật).
// Mặc định bị bỏ qua; chạy bằng: RUN_E2E=1 pnpm test:n8n   (cần Docker, image n8n 2.48.8 đã kéo sẵn).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');

const RUN = process.env.RUN_E2E === '1';
let hasDocker = false;
if (RUN) hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

const skip = !RUN ? 'bỏ qua: đặt RUN_E2E=1 để chạy (cần Docker)' : !hasDocker ? 'bỏ qua: không có Docker' : false;

test('e2e: toàn bộ kịch bản trên n8n 2.48.8 (tests/e2e/run-e2e.sh)', { skip, timeout: 20 * 60 * 1000 }, async () => {
  const script = path.join(__dirname, 'e2e', 'run-e2e.sh');
  const code = await new Promise((resolve) => {
    const child = spawn('bash', [script], { stdio: 'inherit', env: process.env });
    child.on('close', resolve);
  });
  assert.equal(code, 0, 'run-e2e.sh thất bại');
});
