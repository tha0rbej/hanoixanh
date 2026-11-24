# Kiểm thử đầu-cuối (tùy chọn)

Chạy toàn bộ luồng Admin Agent trên **n8n 2.48.8 thật** trong Docker, với mock thay cho OpenAI, Supabase, Tavily và Threads. Không dùng khóa thật, không kết nối cơ sở dữ liệu thật.

```bash
RUN_E2E=1 pnpm test:n8n          # chạy cùng các test mặc định
bash n8n/admin-agent/tests/e2e/run-e2e.sh   # chỉ chạy e2e
```

Mặc định `pnpm test:n8n` bỏ qua e2e. Cần Docker, image `docker.n8n.io/n8nio/n8n:2.48.8` đã kéo sẵn, Node 18+ và cổng `127.0.0.1:5678` trống. Script từ chối chạy nếu đã có container tên `hnx-n8n*` (tránh đụng vào n8n đang dùng).

## Script làm gì

1. Tạo thư mục tạm, dùng đúng `n8n/docker-compose.yml` của repo với `.env` giả, bản sao `skills/` và bản sao workflow (chỉ đổi URL Tavily/Threads sang mock).
2. Bật hai mock trên địa chỉ cổng nối Docker: `mock-supabase.js` (REST + RPC theo hợp đồng giai đoạn 1, trả đúng mã status) và `mock-openai.js` (Responses API giả theo kịch bản, kèm Tavily/Threads giả).
3. Dựng n8n, nhập credential giả và 17 workflow, bật rồi restart.
4. `scenarios.js` gọi webhook thật rồi kiểm tra nhật ký của mock.
5. Dọn container/volume/network `hnx-n8n*` và thư mục tạm; image được giữ lại.

## Kịch bản

- Thông báo: `load_skill` -> tìm sự kiện -> đếm người đăng ký -> lưu bản nháp (HTML bị tước trước RPC) -> gửi thử -> cố gửi trong cùng lượt bị chặn (`confirmation_text` của model bị bỏ qua) -> lượt sau admin xác nhận thì `approved` -> xem tiến độ -> hủy (bị từ chối nếu tin nhắn không có ý hủy).
- Bảo mật: `load_skill` với path traversal/tên lạ bị từ chối, `admin_user_id`/`thread_id` giả của model bị bỏ qua, system prompt chỉ có tên + mô tả skill và model thấy đủ 16 tool.
- Hồi quy `pollution-campaign-post`: tìm kiếm, tạo/sửa draft, duyệt, đăng website và Threads.

Thêm kịch bản mới: thêm các bước "model" vào `MODEL` và kiểm tra tương ứng ở `run()` trong `scenarios.js`; chọn kịch bản bằng nhãn `[S:<tên>]` ở đầu tin nhắn.
