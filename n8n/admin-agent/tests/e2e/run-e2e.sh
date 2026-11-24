#!/usr/bin/env bash
# Kiểm thử đầu-cuối trên n8n 2.48.8 THẬT trong Docker, dùng mock OpenAI/Supabase/Tavily/Threads (không khóa thật).
# Chạy: bash n8n/admin-agent/tests/e2e/run-e2e.sh   (hoặc RUN_E2E=1 pnpm test:n8n)
# Cần: Docker, image docker.n8n.io/n8nio/n8n:2.48.8 đã có sẵn, Node 18+, cổng 127.0.0.1:5678 trống.
# Chỉ tạo container/volume/network có tên bắt đầu bằng hnx-n8n và dọn sạch khi xong (image được giữ lại).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
IMAGE="docker.n8n.io/n8nio/n8n:2.48.8"
SUPA_PORT=19999
OPENAI_PORT=19998
WEBHOOK="http://127.0.0.1:5678/webhook/hnx-admin-agent"

command -v docker >/dev/null 2>&1 || { echo "e2e: không có docker"; exit 2; }
command -v node >/dev/null 2>&1 || { echo "e2e: không có node"; exit 2; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "e2e: thiếu image $IMAGE (docker pull $IMAGE)"; exit 2; }
if docker ps -a --format '{{.Names}}' | grep -q '^hnx-n8n'; then
  echo "e2e: đã có container hnx-n8n* (có thể là n8n đang dùng thật); dừng để không đụng vào nó."
  exit 2
fi
if (exec 3<>/dev/tcp/127.0.0.1/5678) 2>/dev/null; then
  echo "e2e: cổng 5678 đang bị chiếm"
  exit 2
fi

WORK="$(mktemp -d /tmp/hnx-e2e.XXXXXX)"
GATEWAY="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
GATEWAY="${GATEWAY:-172.17.0.1}"
MOCK_PIDS=()
COMPOSE=(docker compose -f "$WORK/n8n/docker-compose.yml" -f "$WORK/n8n/override.yml")

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [ "${HNX_E2E_KEEP:-}" = "1" ]; then
    echo "e2e: HNX_E2E_KEEP=1 nên KHÔNG dọn. Thư mục tạm: $WORK. Dọn tay: docker compose -f $WORK/n8n/docker-compose.yml -f $WORK/n8n/override.yml down -v; kill ${MOCK_PIDS[*]:-}; rm -rf $WORK"
    exit $code
  fi
  for pid in "${MOCK_PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
  if [ -f "$WORK/n8n/docker-compose.yml" ]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1
  fi
  docker rm -f hnx-n8n >/dev/null 2>&1
  docker volume rm hnx-n8n-data >/dev/null 2>&1
  docker network rm hnx-n8n_default >/dev/null 2>&1
  rm -rf "$WORK"
  echo "e2e: đã dọn container/volume/network hnx-n8n* (image giữ lại)"
  exit $code
}
trap cleanup EXIT INT TERM

# --- 1. dựng thư mục tạm: compose thật của repo + .env giả + skills + workflow đã đổi URL ngoài sang mock ---
mkdir -p "$WORK/n8n" "$WORK/wf"
cp "$REPO/n8n/docker-compose.yml" "$WORK/n8n/docker-compose.yml"
cp -r "$REPO/skills" "$WORK/skills"
cat > "$WORK/n8n/.env" <<EOF
N8N_ENCRYPTION_KEY=e2e-fake-encryption-key-0123456789abcdef
HNX_SUPABASE_URL=http://host.docker.internal:$SUPA_PORT
HNX_SUPABASE_SECRET_KEY=e2e-fake-supabase-secret
HNX_PUBLIC_SITE_URL=https://example.test
OPENAI_MODEL=gpt-e2e
THREADS_USER_ID=1234567890
EOF
cat > "$WORK/n8n/override.yml" <<EOF
services:
  n8n:
    extra_hosts:
      - "host.docker.internal:host-gateway"
EOF
for f in "$REPO"/n8n/admin-agent/*.json; do
  [ "$(basename "$f")" = "tool-contracts.json" ] && continue
  sed -e "s#https://api.tavily.com/search#http://host.docker.internal:$OPENAI_PORT/tavily#g" \
      -e "s#https://graph.threads.com/v1.0/#http://host.docker.internal:$OPENAI_PORT/threads/#g" \
      "$f" > "$WORK/wf/$(basename "$f")"
done
cat > "$WORK/creds.json" <<EOF
[
  {"id":"e2eOpenAi","name":"HNX OpenAI","type":"openAiApi","data":{"apiKey":"e2e-fake-openai-key","url":"http://host.docker.internal:$OPENAI_PORT/v1"}},
  {"id":"e2eSupabase","name":"HNX Supabase Server","type":"supabaseApi","data":{"host":"http://host.docker.internal:$SUPA_PORT","serviceRole":"e2e-fake-supabase-secret"}},
  {"id":"e2eTavily","name":"HNX Tavily Search","type":"httpHeaderAuth","data":{"name":"Authorization","value":"Bearer e2e-fake-tavily"}},
  {"id":"e2eThreads","name":"HNX Threads Publisher","type":"httpHeaderAuth","data":{"name":"Authorization","value":"Bearer e2e-fake-threads"}}
]
EOF

# --- 2. mock ---
export HNX_E2E_MOCK=1 HNX_MOCK_BIND="$GATEWAY" HNX_MOCK_SUPABASE_PORT=$SUPA_PORT HNX_MOCK_OPENAI_PORT=$OPENAI_PORT
export HNX_MOCK_SUPABASE_URL="http://$GATEWAY:$SUPA_PORT" HNX_MOCK_OPENAI_URL="http://$GATEWAY:$OPENAI_PORT"
node "$HERE/mock-supabase.js" >"$WORK/mock-supabase.log" 2>&1 & MOCK_PIDS+=($!)
node "$HERE/mock-openai.js" >"$WORK/mock-openai.log" 2>&1 & MOCK_PIDS+=($!)
for i in $(seq 1 20); do
  curl -fs "http://$GATEWAY:$SUPA_PORT/__db" >/dev/null 2>&1 && curl -fs "http://$GATEWAY:$OPENAI_PORT/__calls" >/dev/null 2>&1 && break
  sleep 0.5
done

# --- 3. n8n ---
wait_health() {
  for i in $(seq 1 60); do curl -fs http://127.0.0.1:5678/healthz >/dev/null 2>&1 && return 0; sleep 2; done
  return 1
}
"${COMPOSE[@]}" up -d >/dev/null 2>&1 || { echo "e2e: docker compose up thất bại"; exit 1; }
wait_health || { echo "e2e: n8n không khởi động được"; docker logs --tail 40 hnx-n8n; exit 1; }

docker cp "$WORK/creds.json" hnx-n8n:/tmp/creds.json >/dev/null
docker cp "$WORK/wf" hnx-n8n:/tmp/wf >/dev/null
# Ngay sau healthz n8n có thể chưa khởi tạo xong owner/project; nhập credential tới khi export thấy đủ 4 credential.
ok=0
for attempt in 1 2 3 4 5 6; do
  docker exec hnx-n8n n8n import:credentials --input=/tmp/creds.json >/dev/null 2>&1
  n="$(docker exec hnx-n8n n8n export:credentials --all 2>/dev/null | grep -o '"name":"HNX [A-Za-z ]*"' | wc -l)"
  [ "$n" -ge 4 ] && { ok=1; break; }
  sleep 5
done
[ $ok -eq 1 ] || { echo "e2e: không nhập được credential vào n8n"; exit 1; }
IDS=""
for f in "$WORK"/wf/*.json; do
  docker exec hnx-n8n n8n import:workflow --input="/tmp/wf/$(basename "$f")" >/dev/null 2>&1 || { echo "e2e: import $(basename "$f") thất bại"; exit 1; }
  IDS="$IDS $(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).id)" "$f")"
done
for id in $IDS; do
  docker exec hnx-n8n n8n publish:workflow --id="$id" 2>&1 | grep -q "Cannot publish" && { echo "e2e: không bật được workflow $id"; exit 1; }
done
docker restart hnx-n8n >/dev/null
wait_health || { echo "e2e: n8n không chạy lại được"; docker logs --tail 40 hnx-n8n; exit 1; }
# Đợi webhook đăng ký xong (không token thì trả 401).
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WEBHOOK" -H 'Content-Type: application/json' -d '{"message":"hi"}')" = "401" ] && break
  sleep 2
done

# --- 4. kịch bản ---
export HNX_E2E_RUN=1 HNX_E2E_WEBHOOK="$WEBHOOK"
node "$HERE/scenarios.js"
code=$?
if [ $code -ne 0 ]; then
  echo "--- n8n log (cuối) ---"
  docker logs --tail 40 hnx-n8n 2>&1
fi
exit $code
