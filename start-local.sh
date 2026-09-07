#!/usr/bin/env bash
# Run with: bash start-local.sh (Git Bash, WSL, macOS, or Linux).
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; then
  if [[ -f "$PWD/.runtime/node/node.exe" ]]; then
    export PATH="$PWD/.runtime/node:$PATH"
  fi
fi
export npm_config_cache="$PWD/.runtime/npm-cache"

if ! command -v node >/dev/null 2>&1; then
  echo "Chua co Node.js. Hay cai Node.js 22 (ban 22.12 tro len), mo lai terminal va chay lai file nay."
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 22 && minor >= 12) || major > 22 ? 0 : 1)'; then
  echo "Can Node.js 22.12 tro len. Phien ban hien tai: $(node --version)"
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "Khong tim thay npx. Hay cai lai Node.js kem npm, sau do mo lai terminal."
  exit 1
fi

export PORT="${PORT:-8443}"
if ! node -e 'const p = process.env.PORT; process.exit(/^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= 65535 ? 0 : 1)'; then
  echo "PORT phai la so nguyen tu 1 den 65535."
  exit 1
fi

echo "Dang cai/kiem tra dependencies voi pnpm 10.34.3 (can Internet lan dau)..."
npx --yes pnpm@10.34.3 install --frozen-lockfile --store-dir .runtime/pnpm-store

echo "Khoi dong web tai http://localhost:${PORT}"
echo "Nhan Ctrl+C de dung."
exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$PORT" --strictPort
