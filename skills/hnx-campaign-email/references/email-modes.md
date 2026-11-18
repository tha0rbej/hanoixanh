# Các loại email

## `registration_confirmation`

Mục tiêu: xác nhận hệ thống đã ghi nhận đăng ký.

Phải có:

- lời xác nhận rõ ràng;
- tên chiến dịch;
- thời gian bắt đầu/kết thúc nếu có;
- địa điểm nếu payload có;
- câu nhắc theo dõi email khi thông tin còn thiếu.

Không được nói người nhận đã được duyệt, đã có chỗ chắc chắn hoặc đã vào nhóm nếu payload không xác nhận điều đó.

## `reminder`

Mục tiêu: nhắc trước hoạt động. Chỉ `send` khi có tên chiến dịch và thời gian hợp lệ. Nêu địa điểm, vật dụng hoặc hướng dẫn check-in chỉ khi chúng có trong payload.

## `change_notice`

Mục tiêu: thông báo thay đổi. Đặt nội dung thay đổi ngay sau lời chào, phân biệt rõ `trước đây` và `cập nhật`. Thiếu `changed_fields` hoặc giá trị mới thì `review`.

## `cancellation_notice`

Mục tiêu: thông báo hủy một cách thẳng thắn và tôn trọng. Không tự hứa hoàn tiền, chiến dịch thay thế hoặc lịch mới. Nếu có bước tiếp theo đã xác nhận, trình bày một lần.

## `post_event_followup`

Mục tiêu: cảm ơn sau hoạt động và cung cấp bước tiếp theo. Không nói người nhận đã tham dự nếu `attendance_status` không xác nhận. Không tự tạo số giờ, điểm, khối lượng rác hoặc thành tích.

## Subject gợi ý

- Xác nhận: `Hà Nội Xanh xác nhận đăng ký: {chien_dich}`
- Nhắc lịch: `Nhắc lịch tham gia {chien_dich}`
- Thay đổi: `Cập nhật quan trọng về {chien_dich}`
- Hủy: `Thông báo về lịch {chien_dich}`
- Follow-up: `Cảm ơn bạn đã đồng hành cùng Hà Nội Xanh`

Điều chỉnh để subject không quá dài nhưng không thay đổi ý nghĩa vận hành.
