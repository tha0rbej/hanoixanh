# Chạy n8n trên máy này cho Admin Agent

n8n ở đây chỉ phục vụ Trợ lý AI của Admin Dashboard (soạn và đăng bài về điểm ô nhiễm). Email xác nhận đăng ký không dùng n8n (xem `mailer/`). Chi tiết workflow: `n8n/admin-agent/README.md`.

Phiên bản đã thử: **n8n 2.48.8** (bản Community, ghim trong `docker-compose.yml`). Bản này không có n8n Variables, nên workflow đọc cấu hình qua biến môi trường (`$env.HNX_*`).

## 1. Yêu cầu

- Docker và Docker Compose; cổng `127.0.0.1:5678` còn trống.
- Máy phải đang bật thì Agent trả lời được và bài hẹn giờ mới được đăng.

## 2. Cấu hình

```bash
cd n8n
cp env.example .env     # rồi sửa .env: key thật của Supabase, khóa mã hóa n8n, URL website...
openssl rand -hex 32    # dán kết quả vào N8N_ENCRYPTION_KEY, sao lưu giá trị này
```

`.env` đã nằm trong `.gitignore`. Mẫu có chú thích nơi lấy từng giá trị. Mẫu đặt tên `env.example` (không có dấu chấm) vì `.gitignore` đang chặn mọi tên `.env*`.

## 3. Chạy

```bash
docker compose up -d
curl http://127.0.0.1:5678/healthz     # {"status":"ok"} là sẵn sàng (khoảng 30 giây lần đầu)
```

Mở http://localhost:5678, tạo tài khoản owner (email và mật khẩu tự chọn, chỉ lưu trong máy này).

## 4. Tạo 4 credential (làm TRƯỚC khi import)

Tên phải đúng từng ký tự, vì workflow tham chiếu credential theo tên. Credential tạo sau khi import sẽ không được nối (publish báo "Credential ... no longer exists"); khi đó chạy lại lệnh import ở bước 5.

| Loại credential | Tên | Giá trị |
| --- | --- | --- |
| OpenAI API | `HNX OpenAI` | API key từ platform.openai.com (API keys); để nguyên Base URL mặc định |
| Supabase API | `HNX Supabase Server` | Host = Project URL; Service Role Secret = Secret key (hoặc `service_role` legacy) |
| Header Auth | `HNX Tavily Search` | Name `Authorization`, Value `Bearer <TAVILY_API_KEY>` |
| Header Auth | `HNX Threads Publisher` | Name `Authorization`, Value `Bearer <access token Threads>` |

## 5. Import và bật 17 workflow

Chạy ở thư mục gốc repo. File tool đã có `id` cố định nên main workflow tự trỏ đúng tool, không phải chọn lại bằng tay. Gồm 15 tool (8 tool bài đăng + 7 tool thông báo), `scheduled-publisher` và `main-workflow`.

```bash
WF="search-pollution-locations get-pollution-finding create-cleanup-post-draft get-post-draft revise-post-draft approve-post-draft publish-website-post publish-threads-post find-announcement-events get-event-registrants save-announcement-draft get-announcement-status send-test-announcement approve-and-send-announcement cancel-announcement scheduled-publisher main-workflow"
docker cp n8n/admin-agent hnx-n8n:/tmp/hnx-workflows
for f in $WF; do docker exec hnx-n8n n8n import:workflow --input=/tmp/hnx-workflows/$f.json; done
for id in hnxToolSearchPollution hnxToolGetFinding hnxToolCreateDraft hnxToolGetDraft hnxToolReviseDraft hnxToolApproveDraft hnxToolPublishWebsite hnxToolPublishThreads hnxToolFindAnnouncementEvents hnxToolGetEventRegistrants hnxToolSaveAnnouncementDraft hnxToolGetAnnouncementStatus hnxToolSendTestAnnouncement hnxToolApproveAndSendAnnouncement hnxToolCancelAnnouncement hnxScheduledPublisher hnxAdminAgent; do docker exec hnx-n8n n8n publish:workflow --id=$id; done
docker compose -f n8n/docker-compose.yml restart n8n
```

Tool thông báo (`find_announcement_events`, ..., `cancel_announcement`) cần các migration Supabase chạy theo thứ tự `20261119000000` -> `20261123010000` -> `20261124000000`, và `mailer/` phải chạy thì thư mới được gửi (xem `n8n/admin-agent/README.md`). Thiếu migration thì các tool này trả `service_unavailable`, các tool bài đăng vẫn chạy.

Phải bật (publish) cả 15 tool lẫn `hnxScheduledPublisher`: n8n 2.x không chạy sub-workflow chưa bật. Sau mỗi lần import lại một workflow đang bật, chạy lại `publish:workflow` và restart container (trigger lịch dừng cho tới khi restart).

Production URL của webhook: `http://localhost:5678/webhook/hnx-admin-agent` (cũng hiện trong node `Admin Chat Webhook`).

## 6. Nối vào website

Trong `.env.local` ở thư mục gốc repo:

```text
VITE_N8N_ADMIN_AGENT_WEBHOOK_URL=http://localhost:5678/webhook/hnx-admin-agent
```

Rồi chạy lại `pnpm dev` (hoặc build lại). Lưu ý:

- Tab Trợ lý AI gọi webhook từ trình duyệt, nên `http://localhost:5678` chỉ dùng được khi mở web từ chính máy này.
- CORS: đã kiểm tra bằng `curl`, n8n trả preflight `OPTIONS` có `Access-Control-Allow-Origin` đúng origin gọi tới (ví dụ `http://localhost:8443`) và cho phép header `authorization`, `content-type`; mọi phản hồi 200/400/401/403/502 đều kèm header này. Muốn giới hạn chỉ origin của web, đặt tuỳ chọn `allowedOrigins` ở node `Admin Chat Webhook`.
- Web production chạy HTTPS gọi tới `http://localhost` có thể bị trình duyệt chặn hoặc hỏi quyền truy cập mạng cục bộ (chưa thử trên trình duyệt thật). Dùng cách này để thử trên máy dev; khi chạy thật hãy đặt n8n sau tunnel hoặc domain HTTPS.
- Khi có tunnel/domain: trong `.env` đặt `N8N_PUBLIC_URL=https://n8n.example.com/` và `N8N_SECURE_COOKIE=true`, chạy lại `docker compose up -d`, rồi lấy Production URL mới đặt vào `VITE_N8N_ADMIN_AGENT_WEBHOOK_URL` và build lại web.

## 7. Thử khi chưa có key

Không cần key để thấy các nhánh từ chối của webhook:

```bash
U=http://127.0.0.1:5678/webhook/hnx-admin-agent
curl -s -X POST $U -H 'Content-Type: application/json' -d '{"message":"hi"}'
curl -s -X OPTIONS $U -H 'Origin: http://localhost:8443' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type' -i
```

Kết quả mong đợi của webhook: thiếu hoặc sai token trả 401; token của tài khoản không phải admin trả 403; thiếu `message` trả 400; token admin hợp lệ mà OpenAI lỗi (key sai, hết số dư) trả 502 `agent_error` kèm lý do. Mọi lỗi chi tiết xem ở tab Executions của n8n.

Muốn thử cả chuỗi tool bằng mock (OpenAI, Supabase, Tavily, Threads giả; không khóa thật, không cơ sở dữ liệu thật): `RUN_E2E=1 pnpm test:n8n` hoặc `bash n8n/admin-agent/tests/e2e/run-e2e.sh`. Script dựng n8n 2.48.8 tạm trong thư mục tạm và dọn sạch khi xong; từ chối chạy nếu đã có container `hnx-n8n*` hoặc cổng 5678 đang bận (xem `n8n/admin-agent/tests/e2e/README.md`).

## 8. Dừng, xóa

```bash
docker compose down        # dừng và xóa container, giữ dữ liệu (volume hnx-n8n-data)
docker compose down -v     # xóa luôn dữ liệu n8n (tài khoản owner, credential, workflow, lịch sử)
docker compose stop        # chỉ dừng
```

## Cảnh báo bảo mật vận hành

- `docker-compose.yml` đặt `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` và nạp `.env` bằng `env_file`. Hệ quả: mọi node Code và mọi biểu thức `{{ ... }}` trong workflow đọc được toàn bộ biến môi trường của container, gồm `N8N_ENCRYPTION_KEY` (giải mã được mọi credential đã lưu) và `HNX_SUPABASE_SECRET_KEY` (quyền service-role trên Supabase).
- `NODE_FUNCTION_ALLOW_BUILTIN=fs` cho node Code đọc/ghi file bất kỳ trong container (kể cả `/home/node/.n8n`, nơi lưu cơ sở dữ liệu và khóa). Biến này chỉ để hai node đọc skill (`Load Skills Metadata` lấy tên + mô tả đưa vào system prompt, `load_skill` trả nội dung `SKILL.md`); cả hai chỉ nhận thư mục `/skills/<tên>/SKILL.md` là file thật (không symlink), `/skills` được mount chỉ đọc.
- Chỉ người có quyền tạo hoặc sửa workflow mới khai thác được hai điểm trên, nên coi tài khoản n8n (owner và mọi user sau này) ngang quyền với service-role của Supabase: đặt mật khẩu mạnh, không tạo user thừa, không chia sẻ tài khoản.
- Khi đưa n8n ra internet qua tunnel/reverse proxy, CHỈ chuyển tiếp đường dẫn `/webhook/` (Production URL của Admin Agent là `/webhook/hnx-admin-agent`). KHÔNG mở giao diện editor, `/rest/`, `/healthz` hay đường dẫn gốc ra ngoài. Ví dụ Caddy:

  ```caddy
  n8n.example.com {
      @webhook path /webhook/*
      reverse_proxy @webhook 127.0.0.1:5678
      respond 404
  }
  ```

  Cloudflare Tunnel (`config.yml`), chỉ một ingress cho `/webhook/*`, còn lại trả 404:

  ```yaml
  ingress:
    - hostname: n8n.example.com
      path: ^/webhook/
      service: http://127.0.0.1:5678
    - service: http_status:404
  ```

  Truy cập editor chỉ qua `http://127.0.0.1:5678` trên máy chạy n8n (hoặc SSH tunnel). Đừng dùng URL `/webhook-test/` ở production.
- Khóa mã hóa: n8n hỗ trợ hậu tố `_FILE` cho biến cấu hình, nên có thể đặt `N8N_ENCRYPTION_KEY_FILE=/run/secrets/n8n_key` và mount file khóa chỉ đọc thay vì để khóa trong `.env`. Lưu ý: compose hiện đang bắt buộc `N8N_ENCRYPTION_KEY` trong `.env`, và khóa đã nạp vào tiến trình n8n vẫn đọc được bằng `$env` khi `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, nên chỉ nên coi đây là bước giảm lộ khóa trong file `.env`, không phải ngăn chặn node Code. Chưa áp dụng trong `docker-compose.yml`.

## Ghi chú vận hành

- Migration `supabase/migrations/20261123010000_claim_publication_job.sql` (RPC `claim_publication_job`, chạy sau `20261119000000_admin_agent.sql`) phải có trên Supabase trước khi bật tool đăng bài; thiếu nó thì mọi lần đăng báo lỗi và không có bài nào được đăng.

- Model của Agent: node `OpenAI Chat Model` (`@n8n/n8n-nodes-langchain.lmChatOpenAi`, typeVersion 1.3), credential `HNX OpenAI`, model lấy từ `OPENAI_MODEL` (mặc định `gpt-6-luna`; đổi trong `.env` rồi `docker compose up -d`, hoặc sửa trực tiếp ở node).
- Function calling: node 1.3 bật sẵn "Use Responses API", nên Agent gọi `POST /v1/responses` (đã xác nhận bằng server giả: đúng endpoint này, không dùng Chat Completions). Lý do chọn: theo trang model, Chat Completions chỉ cho function calling khi `reasoning_effort = none`, còn Responses API hỗ trợ đầy đủ công cụ. Cả 16 tool (15 tool workflow + `load_skill`) được gửi dạng function tool với `strict: false` (n8n tắt strict), nên các trường tùy chọn và `default` trong schema được chấp nhận; không cần ép mọi trường thành bắt buộc.
- Suy luận và chi phí: workflow gửi `reasoning.effort = low` (đã xác nhận trong request). Token suy luận tính tiền như token đầu ra (gpt-6-luna: $0.10 vào / $0.50 ra mỗi 1 triệu token). Đổi mức bằng `OPENAI_REASONING_EFFORT` trong `.env` (`none`, `low`, `medium`, `high`...); để rỗng thì không gửi tham số, dùng cho model không có suy luận như gpt-4.1. Mặc định của OpenAI là `medium`, đắt và chậm hơn.
- Đã thử bằng server giả nói giao thức Responses API (đúng định dạng `function_call` và `function_call_output`), chưa thử với OpenAI thật: tài khoản đang có số dư âm nên mọi lượt gọi model thật sẽ bị từ chối cho tới khi nạp tiền. Chưa kiểm chứng được `gpt-6-luna` chấp nhận đúng các tham số trên.
- Nếu node Supabase báo 401 hoặc "Invalid API key" với Secret key mới (`sb_secret_...`), dùng key `service_role` legacy cho credential `HNX Supabase Server` và cho `HNX_SUPABASE_SECRET_KEY`.
- n8n log vài cảnh báo "deprecation" và "Python 3 is missing" khi khởi động; chúng không ảnh hưởng workflow này.
