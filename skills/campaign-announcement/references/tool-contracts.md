# Tool contracts (campaign-announcement)

Tài liệu tham khảo cho người phát triển; quy trình đầy đủ nằm trong `SKILL.md`. Mọi tool trả JSON có `status` và `message` tiếng Việt cho model. Dữ liệu do RPC `security definer` của Supabase trả về (chỉ service_role gọi được), không bao giờ có email. Hợp đồng RPC: comment đầu `supabase/migrations/20261124000000_campaign_announcements.sql`.

`thread_id`, `admin_user_id`, `confirmation_text` (nguyên văn tin nhắn thật của admin ở lượt hiện tại) và `turn_started_at` do workflow chính gắn cố định, model không truyền. Tool từ chối trước khi gọi RPC nếu id sai định dạng (`invalid_input`). Lỗi RPC (HTTP lỗi, RPC chưa có do chưa chạy migration `PGRST202`) trả `service_unavailable` thay vì lỗi trần.

## `find_announcement_events`

Tìm sự kiện theo tên (`ilike`, không bỏ dấu), sự kiện sắp diễn ra trước, sau đó sự kiện đã qua. Input: `query?` (bỏ trống để liệt kê, tối đa 100 ký tự), `limit?` (1–10, mặc định 5). Trả `status: ok` và `campaigns[]` (`id`, `title`, `start_at`, `end_at`, `location`, `campaign_status`, `registrant_count`) hoặc `invalid_input`.

## `get_event_registrants`

Số người sẽ nhận thông báo. Input: `campaign_id`. Trả `registrant_count`, `max_recipients` (1000), `sample_names` (tối đa 3 tên viết tắt), `can_send` (do workflow tính: có người và không vượt giới hạn); `campaign_not_found`, `invalid_input`. Người đăng ký = user duy nhất có đăng ký chưa hủy.

## `save_announcement_draft`

Lưu bản nháp văn bản thuần. Input: `campaign_id`, `subject`, `body`. Trước khi gọi RPC, workflow tước thẻ HTML (lặp đến ổn định), gỡ ký tự điều khiển, chuẩn hóa xuống dòng và NFC, cắt khoảng trắng, tiêu đề một dòng. Tiêu đề tối đa 150 ký tự, nội dung tối đa 5000; quá dài trả `invalid_input` (`field`, `reason: too_long`, `max`) và không cắt; rỗng sau làm sạch trả `needs_content`. Một bản nháp mở cho mỗi (cuộc trò chuyện, sự kiện): nội dung khác tạo version mới và hủy yêu cầu thư thử, nội dung giống hệt trả `unchanged`. Trả `announcement` (`id`, `version`, `subject`, `body_text`, `registrant_count`, …). Mã khác: `forbidden`, `campaign_not_found`, `version_limit` (50 version).

## `get_announcement_status`

Trạng thái và tiến độ. Input: `announcement_id?` (bỏ trống = thông báo mới nhất của cuộc trò chuyện). Trả `announcement` với `status` (`draft`, `approved`, `sending`, `sent`, `cancelled`), `version`, `registrant_count`, `test` (`state`: none, pending, sent, failed), `recipient_count`, `progress` (`pending`, `sent`, `failed`, `skipped`); `not_found`, `invalid_input`.

## `send_test_announcement`

Xếp hàng gửi thư thử tới email của chính admin. Input: `announcement_id`, `version`. Trả `queued` (`version`, `tests_left_this_hour`), `not_found`, `forbidden`, `not_draft` (`announcement_status`), `version_mismatch` (`current_version`), `rate_limited` (`retry_after_seconds`; 5 lần mỗi giờ mỗi thông báo), `invalid_input`. Mailer gửi trong một chu kỳ quét.

## `approve_and_send_announcement`

Duyệt, đóng băng nội dung và chốt danh sách người nhận; mailer gửi dần. Input: `announcement_id`, `version`. Cổng xác nhận chạy TRƯỚC khi gọi RPC: tin nhắn thật của admin phải là xác nhận gửi rõ ràng (không phải lệnh tạo thông báo, không bị phủ định, không phải câu hỏi hay yêu cầu gửi thử) và `turn_started_at` phải hợp lệ; không đạt trả `needs_admin_confirmation`. RPC còn chặn `needs_admin_review` nếu version được tạo cùng lượt chat. Trả `approved` (`announcement_id`, `version`, `recipient_count`), `already_approved`, `version_mismatch`, `cancelled`, `confirmation_required`, `needs_admin_review`, `no_recipients`, `too_many_recipients` (`count`, `max`), `not_found`, `forbidden`, `invalid_input`.

## `cancel_announcement`

Hủy thông báo đã duyệt đang chờ hoặc đang gửi. Input: `announcement_id`. Cổng xác nhận chạy trước RPC: tin nhắn thật của admin phải có ý hủy/dừng rõ ràng, không bị phủ định; không đạt trả `needs_admin_confirmation`. Trả `cancelled` (`skipped`, `sent_count`), `already_sent`, `already_cancelled`, `not_found`, `forbidden`, `invalid_input`. Người chưa nhận chuyển sang `skipped`; thư đã gửi không thu hồi được.
