# Tool contracts

Các description dưới đây được gửi đầy đủ cho model trong MVP. Tool implementation phải xác thực lại mọi điều kiện; không tin model chỉ vì arguments đúng schema.

## `load_skill`

Tải toàn bộ nội dung một skill đã được quản trị viên hệ thống cho phép. Dùng khi metadata cho thấy skill phù hợp và cần hướng dẫn nghiệp vụ chi tiết. Không dùng để cấp quyền; quyền thực thi do từng tool kiểm tra.

Input: `skill_name` (string, bắt buộc).

## `search_pollution_locations`

Tìm và lưu các địa điểm có bằng chứng ô nhiễm gần đây trong phạm vi Hà Nội, kèm ảnh và nguồn. Ưu tiên nguồn chính thống hoặc báo chí có ngày xuất bản; không coi một nguồn cũ là trạng thái hiện tại. Trả `finding_id` ổn định cho mỗi kết quả. Ảnh phải có URL trang nguồn, chú thích và trạng thái quyền sử dụng. Đây là tool chỉ đọc web nhưng có tác dụng ghi findings vào Supabase.

Input: `thread_id`, `query`, `pollution_types`, `time_range_days` (mặc định 30), `max_results` (1–10).

## `get_pollution_finding`

Đọc một finding đã lưu theo `finding_id`. Chỉ trả finding thuộc thread của admin hiện tại.

Input: `thread_id`, `finding_id`.

## `create_cleanup_post_draft`

Tạo draft mới từ finding đã chọn và dữ liệu sự kiện. Bắt buộc có `cleanup_start_at`; nếu thiếu phải trả `missing_information` thay vì tự suy đoán. Sinh nội dung website, caption Threads, nguồn, ảnh và file HTML/preview. Không xuất bản.

Input: `thread_id`, `finding_id`, `cleanup_start_at`, `cleanup_end_at?`, `meeting_point?`, `contact?`, `website_payload`, `threads_payload`, `images`, `sources`. `admin_user_id` do workflow chính map từ user đã xác thực, không cho model tự đặt.

## `get_post_draft`

Đọc draft và version mới nhất. Chỉ trả draft thuộc thread của admin hiện tại.

Input: `thread_id`, `draft_id`.

## `revise_post_draft`

Áp dụng feedback vào draft hiện tại, giữ `draft_id`, tạo version tăng tuần tự và render lại preview/file. Không thay đổi version đã duyệt và không xuất bản.

Input: `thread_id`, `draft_id`, `base_version`, `feedback`, nội dung `website_payload`, `threads_payload`, `images` và `sources` sau chỉnh sửa.

## `approve_post_draft`

Đánh dấu chính xác một version là đã duyệt. Chỉ gọi sau xác nhận rõ của admin. Từ chối nếu version không còn là version mới nhất hoặc admin chưa có quyền.

Input: `thread_id`, `draft_id`, `version`, `confirmation_text`.

## `publish_website_post`

Đăng hoặc lên lịch version đã duyệt vào bảng `posts` của website. Kiểm tra quyền admin, `approved_version`, idempotency và confirmation. `publish_at = null` chỉ hợp lệ khi `publish_now = true` và có xác nhận rõ. Trả `publication_job_id`, trạng thái và URL bài viết.

Input: `thread_id`, `draft_id`, `approved_version`, `publish_at?`, `publish_now`, `confirmation_text`.

## `publish_threads_post`

Đăng hoặc lên lịch version đã duyệt lên Threads bằng credential server-side. Kiểm tra quyền, version, giới hạn nội dung, media, idempotency và confirmation độc lập với website. Trả `publication_job_id`, trạng thái, provider post ID và URL nếu có.

Input giống `publish_website_post`.
