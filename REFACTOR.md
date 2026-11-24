# REFACTOR: những gì đã thay đổi và cách chạy web + Agent trên local

Tài liệu này dành cho người mới nhận repo. Đọc mục 1 để biết đã đổi gì, mục 3 và 4 để chạy được web và Agent, mục 6 để biết cái gì chưa được kiểm chứng.

Không có key hay secret nào nằm trong repo hoặc tài liệu này. Mọi giá trị ghi bên dưới là tên biến và nơi lấy.

## 1. Tóm tắt thay đổi

### 1.1 Vá bảo mật (web + Supabase)

| Vấn đề cũ | Cách xử lý |
| --- | --- |
| Người dùng thường tự đổi `role` thành admin hoặc tự sửa `points_balance` được (RLS cho sửa mọi cột của hàng mình) | Trigger `protect_profile_privileged_columns` chặn đổi `role`, `points_balance`, `email`, `created_at` nếu không phải admin |
| Người dùng tự cộng điểm bằng cách tạo bản ghi đăng ký giả (`status='attended'`, `awarded_points` tùy ý) | Policy `registrations_create` chỉ cho tạo đăng ký ở trạng thái `registered`, điểm 0, chiến dịch phải có thật. Báo cáo ô nhiễm cũng bị siết tương tự |
| Kho ảnh `hnx-media` cho mọi người dùng đăng nhập tải file bất kỳ | Chỉ nhận JPG/PNG/WEBP/GIF tối đa 10 MB, mỗi người chỉ tải vào thư mục của mình (`<user id>/...`) |
| XSS: dữ liệu DB nối thẳng vào `innerHTML` | Escape ở admin dashboard và 4 trang HTML tĩnh; URL chỉ nhận `http(s)` |
| Trang HTML trong iframe nhận `postMessage` từ bất kỳ nguồn nào | Mọi listener kiểm `origin` và `source`; 35 chỗ gửi tin không còn dùng `'*'` |
| Webhook n8n gửi email xác nhận gọi thẳng từ trình duyệt, không xác thực | Bỏ hẳn lời gọi này; email xác nhận do `mailer/` đảm nhiệm |

Chi tiết SQL và cách kiểm trên staging: `supabase/README.md`.

### 1.2 Email xác nhận đăng ký: thay n8n + LLM bằng chương trình Python

- Thư mục mới `mailer/`: worker Python chỉ dùng thư viện chuẩn, **không dùng LLM, không dùng n8n**.
- Mỗi 30 giây hỏi Supabase xem có đăng ký mới chưa gửi thư, rồi điền tên, chiến dịch, giờ, địa điểm vào mẫu cố định và gửi qua SMTP.
- Chỉ gọi ra ngoài, không cần địa chỉ công khai. Máy tắt rồi bật lại thì tự gửi bù, không mất thư.
- Đã xóa `n8n-luong-chien-dich.json` và skill `skills/hnx-campaign-email/`.
- Chi tiết: `mailer/README.md`.

### 1.3 Thông báo hàng loạt cho người đăng ký một sự kiện (mới)

- Admin nhắn Agent một câu ngắn; Agent viết nội dung, gửi thử cho riêng admin, chờ admin xác nhận ở tin nhắn riêng rồi mailer gửi cho tất cả người đã đăng ký (mỗi người một thư cá nhân hóa).
- Bảng và hàm SQL: `supabase/migrations/20261124000000_campaign_announcements.sql`.
- Gửi do `mailer/` đảm nhiệm: tối đa 20 thư mỗi phút và 400 thư mỗi ngày (chỉnh bằng biến môi trường), chống gửi trùng, dừng được khi hủy.
- Người không có tài khoản không nhận được; tối đa 1000 người mỗi thông báo.

### 1.4 Admin Agent (n8n tự host, dùng OpenAI)

- Đổi từ Gemini sang **OpenAI `gpt-6-luna`** qua Responses API (đổi model bằng biến `OPENAI_MODEL`).
- n8n bản Community không có Variables, nên workflow đọc cấu hình qua `$env.HNX_*`.
- Hai skill: `pollution-campaign-post` (tìm điểm ô nhiễm, viết và đăng bài lên website và Threads) và `campaign-announcement` (thông báo hàng loạt). Tổng 16 tool.
- `load_skill`: system prompt chỉ chứa tên và mô tả ngắn của từng skill; model gọi `load_skill` để lấy toàn bộ nội dung khi cần. Chỉ nhận tên skill hợp lệ, chặn đường dẫn lạ.
- Chốt chặn an toàn (nằm ở từng tool, không phụ thuộc model):
  - `thread_id`, `admin_user_id`, `confirmation_text`, `turn_started_at` gắn cố định từ phía server, model không tự điền.
  - Duyệt, đăng, gửi hàng loạt cần tin nhắn xác nhận riêng của admin, sau khi admin đã đọc bản nháp. Không gộp được trong một lượt.
  - Đăng bài hẹn giờ có bước giành job nguyên tử (`claim_publication_job`) để không đăng trùng.
  - Nội dung bài và thư bị tước thẻ HTML; URL chỉ nhận `http(s)`.
- Chi tiết: `n8n/README.md`, `n8n/admin-agent/README.md`.

### 1.5 Khác

- `REFACTOR.md` (file này), `AGENTS.md` viết lại theo dự án thật.
- CI (`.github/workflows/deploy-inet.yml`): thêm bước typecheck, test web, test n8n, test mailer; truyền biến `VITE_N8N_ADMIN_AGENT_WEBHOOK_URL`; thêm header chống bị nhúng trang vào `.htaccess`.
- Gỡ `noindex` (site sẽ công khai); gỡ `.tools/ngrok/ngrok.exe` (33 MB) khỏi git.
- Sửa 5 lỗi TypeScript, test `Dialog` hay đỏ ngẫu nhiên (focus bị giật), gộp đoạn code lặp ở `App.tsx`, giảm tần suất tải lại dữ liệu từ 10 giây lên 60 giây.

## 2. Cấu trúc thư mục quan trọng

```text
src/                         Shell React (đăng nhập, admin dashboard, Trợ lý AI)
public/source/               Các trang HTML tĩnh, nhúng bằng iframe, nói chuyện với shell qua postMessage
supabase/migrations/         SQL (chạy theo thứ tự tên file)
mailer/                      Worker Python gửi email xác nhận và thông báo hàng loạt
n8n/                         docker-compose, env.example, README để chạy n8n
n8n/admin-agent/             Workflow của Agent + bộ test + e2e
skills/                      pollution-campaign-post, campaign-announcement
```

## 3. Chạy web trên local

Cần: Node 22 và pnpm 10 (xem `.mise.toml`).

```bash
pnpm install
cp env.example .env.local     # rồi điền 2 giá trị đầu bên dưới
pnpm dev                      # mặc định http://localhost:8443
```

| Biến (`.env.local`) | Bắt buộc | Lấy ở đâu |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Có | Supabase → Project Settings → API → Project URL (xin chủ dự án) |
| `VITE_SUPABASE_ANON_KEY` | Có | Cùng chỗ, key dạng `sb_publishable_...` (anon). Chỉ dùng key này ở frontend |
| `VITE_N8N_ADMIN_AGENT_WEBHOOK_URL` | Chỉ khi dùng tab Trợ lý AI | Production URL của webhook `hnx-admin-agent` (mục 4) |

Đăng nhập Google cần bật provider Google trong Supabase (Authentication → Providers) và thêm `http://localhost:8443` vào danh sách redirect URL.

Tuyệt đối không đặt Secret key hay `service_role` của Supabase vào `.env.local` hay bất kỳ file frontend nào.

## 4. Chạy Admin Agent trên local

Agent chạy bằng n8n trong Docker. Máy phải đang bật thì Agent mới trả lời được. Hướng dẫn từng bước đầy đủ: `n8n/README.md`. Tóm tắt:

### 4.1 Chuẩn bị Supabase (một lần)

Chạy các migration trong SQL Editor, theo thứ tự tên file. Các migration của đợt này:

| Thứ tự | File | Khi nào chạy |
| --- | --- | --- |
| 1 | `20261119000000_admin_agent.sql` | Trước khi dùng Agent |
| 2 | `20261122000000_protect_profile_columns.sql` | Ngay, không phụ thuộc deploy |
| 3 | `20261122020000_restrict_registration_insert.sql` | Ngay, không phụ thuộc deploy |
| 4 | `20261123000000_registration_confirmation_email.sql` | **Trước** khi deploy frontend mới và bật mailer |
| 5 | `20261123010000_claim_publication_job.sql` | Sau (1); cần cho đăng bài hẹn giờ |
| 6 | `20261124000000_campaign_announcements.sql` | Sau (4); cần cho thông báo hàng loạt |
| 7 | `20261122010000_harden_media_storage.sql` | **Sau** khi deploy frontend mới (nếu chạy trước, upload ảnh sẽ lỗi) |

Cần ít nhất một tài khoản có `profiles.role = 'admin'` để đăng nhập thử Trợ lý AI.

### 4.2 Biến môi trường (`n8n/.env`, tạo từ `n8n/env.example`)

| Biến | Bắt buộc | Lấy ở đâu |
| --- | --- | --- |
| `N8N_ENCRYPTION_KEY` | Có | Tự tạo: `openssl rand -hex 32`. Sao lưu, mất là mất hết credential đã lưu |
| `HNX_SUPABASE_URL` | Có | Project URL của Supabase |
| `HNX_SUPABASE_SECRET_KEY` | Có | Supabase → Project Settings → API Keys → Secret key (`sb_secret_...`). Key quyền cao, chỉ để ở n8n |
| `HNX_PUBLIC_SITE_URL` | Có | Địa chỉ website (không có dấu `/` ở cuối) |
| `OPENAI_MODEL` | Không | Mặc định `gpt-6-luna` |
| `THREADS_USER_ID` | Chỉ khi đăng Threads | Gọi `GET graph.threads.com/v1.0/me` bằng token Threads |

### 4.3 Credential tạo trong giao diện n8n (tên phải đúng từng ký tự)

| Credential | Loại | Giá trị | Bắt buộc |
| --- | --- | --- | --- |
| `HNX OpenAI` | OpenAI API | API key từ platform.openai.com. Cần số dư credit | Có |
| `HNX Supabase Server` | Supabase API | Host = Project URL; Service Role Secret = Secret key | Có |
| `HNX Tavily Search` | Header Auth | Name `Authorization`, Value `Bearer <TAVILY_API_KEY>` (tavily.com) | Có, để tìm điểm ô nhiễm |
| `HNX Threads Publisher` | Header Auth | Name `Authorization`, Value `Bearer <token Threads>` | Chỉ khi đăng Threads |

Chỉ dùng kênh website thì không cần Threads. Tối thiểu để thử luồng tìm kiếm và viết bản nháp: Supabase Secret key, OpenAI key (có credit) và Tavily key.

### 4.4 Chạy

```bash
cd n8n && cp env.example .env     # điền .env
docker compose up -d
# mở http://localhost:5678, tạo tài khoản owner, tạo 4 credential ở trên
# rồi import và publish 17 workflow theo lệnh trong n8n/README.md (mục 5)
```

Sau đó đặt `VITE_N8N_ADMIN_AGENT_WEBHOOK_URL=http://localhost:5678/webhook/hnx-admin-agent` trong `.env.local` của web và chạy lại `pnpm dev`.

Lưu ý: tab Trợ lý AI gọi webhook từ trình duyệt, nên địa chỉ `localhost` chỉ dùng được khi mở web từ chính máy chạy n8n. Chạy thật nên đặt n8n sau tunnel hoặc domain HTTPS, và chỉ mở đường dẫn `/webhook/` ra internet, không mở giao diện editor.

## 5. Chạy mailer (email xác nhận và thông báo hàng loạt)

Không bắt buộc để chạy web hay Agent, nhưng cần để thư được gửi. Hướng dẫn: `mailer/README.md`.

```bash
cd mailer && cp env.example .env       # điền .env
python3 registration_mailer.py --demo  # xem thư mẫu, không cần cấu hình
python3 registration_mailer.py --dry-run
python3 registration_mailer.py --once
python3 registration_mailer.py         # chạy liên tục
```

| Biến (`mailer/.env`) | Lấy ở đâu |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Project URL và Secret key của Supabase |
| `SITE_URL` | Địa chỉ website |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Tài khoản gửi thư. Gmail: bật xác minh 2 bước rồi tạo "Mật khẩu ứng dụng", không dùng mật khẩu thật |

Thứ tự triển khai chuẩn (tránh mất thư): chạy migration `20261123000000` → bật mailer → mới deploy frontend mới. Đồng thời tắt workflow n8n cũ và bật "Confirm email" trong Supabase Auth (chi tiết ở `mailer/README.md`).

## 6. Kiểm thử

```bash
pnpm test         # web (vitest)
pnpm test:n8n     # workflow n8n: node Code, cấu trúc, chốt chặn bảo mật
pnpm test:mailer  # mailer Python
pnpm test:all     # cả ba
RUN_E2E=1 pnpm test:n8n   # (tùy chọn) chạy trọn quy trình trên n8n thật trong Docker, dùng mock, cần Docker
```

## 7. Chưa kiểm chứng và việc còn lại

Toàn bộ kiểm thử mới dừng ở môi trường giả lập. Chưa thử với dịch vụ thật:

- **SQL trên Supabase thật:** các migration chưa chạy trên project thật. Chạy trên staging trước theo các ca thử trong `supabase/README.md`.
- **OpenAI thật:** model có chọn đúng tool và viết thư tốt không (mới thử một câu ngắn). Từ khóa xác nhận "gửi", "duyệt", "đăng" là phần sẽ tinh chỉnh bằng prompt sau.
- **SMTP thật:** chưa gửi thư nào ra ngoài.
- **Threads, đăng nhập Google, luồng đăng ký chiến dịch trên web thật.**
- **Node 22 cho test n8n** (CI dùng Node 22; máy phát triển đã thử với Node 20).

Hạn chế đã biết:

- Tìm sự kiện phân biệt dấu: gõ "la phu" không ra "La Phù", Agent sẽ hỏi lại.
- Thân thư thông báo biến mọi URL `http(s)` thành liên kết; admin cần nhìn lại liên kết khi đọc bản nháp.
- Khối thông tin sự kiện trong thư lấy giờ và địa điểm từ bảng chiến dịch. Thông báo kiểu "dời giờ" thì phải cập nhật chiến dịch trước khi gửi.
- Nếu thread có nhiều bản nháp, Agent có thể chọn nhầm bản khi admin chỉ nói "gửi đi".
- Gmail giới hạn khoảng 500 thư mỗi ngày; mặc định 400.
