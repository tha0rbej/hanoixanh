---
name: pollution-campaign-post
description: Tìm và xác minh địa điểm ô nhiễm tại Hà Nội, tạo và chỉnh sửa bài kêu gọi vệ sinh, rồi đăng hoặc lên lịch đăng lên website Hà Nội Xanh và Threads. Dùng khi admin yêu cầu bất kỳ phần nào của quy trình nghiên cứu, viết, duyệt hoặc xuất bản bài về địa điểm ô nhiễm.
---

# Pollution campaign post

Hỗ trợ admin đi từ một nhu cầu nghiên cứu đến bài đăng đa kênh đã được kiểm soát. Chỉ thực hiện đúng phần admin yêu cầu và dừng tại điểm cần lựa chọn hoặc xác nhận.

## Nguyên tắc

- Tool description là hợp đồng kỹ thuật chính xác cho từng công cụ.
- Không bịa địa điểm, mức độ ô nhiễm, thời gian, nguồn, hình ảnh hoặc kết quả xuất bản.
- Phân biệt rõ thông tin đang diễn ra với nguồn lịch sử. Mỗi finding phải có ngày nguồn và mức tin cậy.
- Không dùng ảnh không rõ nguồn để xuất bản. Có thể cho admin xem ảnh tham khảo nếu ghi rõ trạng thái quyền sử dụng.
- Không coi im lặng là phê duyệt. Việc duyệt và xuất bản cần câu xác nhận rõ ràng của admin.
- Không coi một kênh đăng thành công là bằng chứng kênh còn lại đã thành công.

## Quy trình

### 1. Nghiên cứu địa điểm

Khi admin yêu cầu tìm kiếm, gọi `search_pollution_locations`. Trình bày mỗi kết quả với tên địa điểm, quận/huyện, loại ô nhiễm, tóm tắt bằng chứng, ngày nguồn, mức tin cậy, nguồn và ảnh.

Nếu admin chỉ yêu cầu tìm kiếm, trả kết quả rồi dừng. Không tự tạo bài.

### 2. Chọn địa điểm

Trước khi tạo bài, phải có một `finding_id` đã được admin chọn. Dùng `get_pollution_finding` nếu cần tải lại dữ liệu đã lưu.

### 3. Thu thập thông tin bắt buộc

Phải có thời gian bắt đầu buổi vệ sinh. Nếu thiếu, hỏi admin. Có thể hỏi thêm giờ kết thúc, điểm tập trung, vật dụng cần mang và số liên hệ, nhưng không chặn tạo draft nếu các trường đó không bắt buộc theo tool contract.

### 4. Tạo và chỉnh sửa draft

Gọi `create_cleanup_post_draft` sau khi đủ dữ liệu. Draft phải có phiên bản website, phiên bản Threads, ảnh, nguồn và preview/file URL.

Đưa draft cho admin đọc. Với mỗi feedback, gọi `revise_post_draft`, giữ nguyên `draft_id` và tạo version mới. Dùng `get_post_draft` để lấy version mới nhất khi tiếp tục một phiên cũ.

### 5. Duyệt

Chỉ gọi `approve_post_draft` khi admin nói rõ như “chốt bản này”, “duyệt” hoặc “nội dung ổn rồi”. Phải duyệt đúng version admin vừa xem.

### 6. Hỏi thời gian đăng

Sau khi draft được duyệt, hỏi admin muốn đăng lúc nào.

- Có thời gian: truyền ISO 8601 có múi giờ `Asia/Ho_Chi_Minh` vào `publish_at`.
- Admin nói “đăng luôn” hoặc “không cần hẹn giờ”: truyền `publish_at = null` và xác nhận đăng ngay.
- Admin chưa trả lời: không gọi tool xuất bản.

### 7. Xuất bản

Gọi riêng `publish_website_post` và `publish_threads_post`. Báo trạng thái, URL và lỗi của từng kênh. Nếu một kênh lỗi, chỉ đề xuất retry kênh đó.

## Điều kiện hoàn thành

Hoàn thành phần việc khi đạt đúng điểm dừng admin yêu cầu: có kết quả research, có draft chờ duyệt, hoặc có kết quả đăng/lên lịch của từng kênh.
