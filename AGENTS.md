# Hà Nội Xanh

Website của dự án cộng đồng Hà Nội Xanh: giới thiệu và đăng ký chiến dịch dọn rác, đăng ký tình nguyện viên/đối tác, tích điểm đổi quà xanh (huy hiệu, bảng xếp hạng), báo cáo điểm ô nhiễm, tin tức, trang quản trị (Admin Dashboard) và Trợ lý AI cho admin soạn/đăng bài.

## Kiến trúc lai

- **Shell React** (`src/App.tsx`, react-router, `AuthContext`) lo định tuyến, đăng nhập, quản trị và mọi lệnh gọi Supabase.
- **Trang HTML tĩnh** trong `public/source/{home,about,remaining,profile}` được nhúng bằng `<iframe>` (component `SourceFrame` trong `src/App.tsx`). Iframe và shell nói chuyện qua `window.postMessage` với kiểu tin nhắn có tiền tố `hnx:` (ví dụ `hnx:auth-state`, `hnx:campaign-register`, `hnx:posts-data`). Thêm tính năng cho trang tĩnh nghĩa là thêm một cặp tin nhắn yêu cầu/kết quả ở cả hai phía.
- **Client Supabase tự viết gọn** bằng `fetch` trong `src/lib/supabase.ts` (đăng nhập, hồ sơ, `tableSelect/Insert/Update/Delete`, `rpc`, upload). `@supabase/supabase-js` chỉ dùng cho luồng OAuth/PKCE.
- **Trợ lý AI**: `src/app/AdminAgentConsole.tsx` gọi webhook n8n kèm JWT của admin; workflow nằm trong `n8n/admin-agent/`.

## Thư mục

- `src/app` — Auth, dashboard admin, điểm thưởng (`rewards.ts`), kiểu dữ liệu, tiện ích.
- `src/lib` — client Supabase, analytics.
- `src/pages`, `src/components` — trang và thành phần React.
- `public/source` — các trang HTML tĩnh, CSS/JS dùng chung và ảnh.
- `supabase/migrations` — SQL schema, RLS, RPC; chạy theo thứ tự tên file (xem `supabase/README.md`).
- `n8n/admin-agent` — workflow Agent và các tool sub-workflow (xem README trong thư mục). n8n chỉ còn dùng cho Admin Agent.
- `mailer/` — worker Python (chỉ dùng thư viện chuẩn) gửi email xác nhận đăng ký chiến dịch bằng mẫu thư có sẵn, không dùng n8n/LLM. Nó đọc các lượt đăng ký chưa gửi từ Supabase bằng Secret key, gửi qua SMTP rồi đánh dấu vào `campaign_registrations.confirmation_email_*` (xem `mailer/README.md`).
- `skills/` — kỹ năng cho Agent: `pollution-campaign-post` (nghiên cứu và đăng bài về điểm ô nhiễm) và `campaign-announcement` (soạn, gửi thử, duyệt, theo dõi thông báo email tới người đăng ký sự kiện). Mỗi skill là `skills/<tên>/SKILL.md` có frontmatter `name` + `description`. System prompt của Agent chỉ chứa tên + mô tả (node `Load Skills Metadata`); model gọi tool `load_skill` để lấy nội dung đầy đủ. Thêm thư mục skill mới là Agent thấy ngay, không cần sửa workflow (nhớ thêm tool tương ứng nếu skill cần).

## Lệnh (Node 22, pnpm 10; xem `.mise.toml`)

```bash
pnpm install
pnpm dev         # dev server
pnpm build       # build ra dist/
pnpm test        # vitest run (giao diện)
pnpm test:n8n    # node:test cho workflow/skill của Admin Agent (n8n/admin-agent/tests, Node 20+, không cần cài thêm)
pnpm test:mailer # unittest của mailer (Python 3.10+)
pnpm test:all    # chạy cả ba bộ trên
pnpm typecheck   # tsc --noEmit
pnpm format      # oxfmt
```

`pnpm test:n8n` chỉ chạy các test dùng mock, không gọi OpenAI/Supabase/SMTP thật. Kiểm thử đầu-cuối tùy chọn trên n8n thật trong Docker (mock OpenAI/Supabase/Tavily/Threads, cần Docker và image n8n 2.48.8): `RUN_E2E=1 pnpm test:n8n` hoặc `bash n8n/admin-agent/tests/e2e/run-e2e.sh` (xem `n8n/admin-agent/tests/e2e/README.md`); mặc định bị bỏ qua.

Mailer (Python ≥ 3.10, cấu hình trong `mailer/.env` tạo từ `mailer/env.example`):

```bash
cd mailer
python3 -m unittest -v                         # test
python3 registration_mailer.py --demo          # xem thử mẫu thư
python3 registration_mailer.py --dry-run       # in thư thật, không gửi, không ghi DB
python3 registration_mailer.py --once          # một vòng rồi thoát
python3 registration_mailer.py                 # chạy liên tục
```

## Biến môi trường (frontend)

Tạo `.env.local` từ `env.example`:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — chỉ dùng anon/publishable key.
- `VITE_N8N_ADMIN_AGENT_WEBHOOK_URL` — Production URL của webhook Admin Agent.

**Không bao giờ** đưa service-role key hay Secret key của Supabase (hoặc key OpenAI, Tavily, Threads) vào frontend, `public/`, workflow export hay commit. Các khóa đó chỉ nằm trong credential/biến của n8n hoặc trong `mailer/.env` (Secret key và mật khẩu SMTP của mailer).

## Quy ước code

- Tailwind CSS v4 qua `@tailwindcss/vite`; CSS toàn cục trong `src/index.css`, không cần file cấu hình Tailwind.
- Định dạng bằng oxfmt (`pnpm format`).
- Chuỗi có dấu nháy đơn thì dùng nháy kép (`"We're here"`) hoặc escape; JSX phải đóng thẻ đầy đủ.
- Dữ liệu từ DB hoặc người dùng đưa vào `innerHTML` (kể cả trong `public/source`) phải được escape.
- RLS phải chặn người dùng thường sửa cột đặc quyền như `role`, `points_balance` (kiểm tra khi viết migration mới).
- Migration mới đặt tên `YYYYMMDDHHMMSS_mo_ta.sql`, không sửa migration đã chạy.

## Deploy

GitHub Actions `.github/workflows/deploy-inet.yml` chạy khi push lên `main`: cài phụ thuộc, typecheck, test, build với biến `VITE_*`, thêm `.htaccess`/`robots.txt`, rồi FTP thư mục `dist/` lên hosting iNET. User/mật khẩu FTP nằm trong GitHub Secrets (không ghi vào repo); thư mục đích nằm trong Variables (`FTP_SERVER_DIR`); địa chỉ máy chủ ghi trong workflow.
