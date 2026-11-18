# Hợp đồng dữ liệu n8n

## Payload hiện tại từ website

```json
{
  "ten": "Nguyễn An",
  "email": "an@example.com",
  "chien_dich": "Làm sạch sông Tô Lịch",
  "thoi_gian_bat_dau": "22/11/2026 07:30 SA",
  "thoi_gian_ket_thuc": "22/11/2026 11:30 SA"
}
```

Website hiện gửi năm trường trên sau khi ghi đăng ký thành công. Không coi việc webhook được gọi là bằng chứng rằng email đã được gửi.

## Trường mở rộng được hỗ trợ

| Trường | Ý nghĩa |
|---|---|
| `event_type` | `registration_confirmation`, `reminder`, `change_notice`, `cancellation_notice`, `post_event_followup` |
| `registration_id` | Khóa idempotency ưu tiên để chống gửi lặp |
| `campaign_id` | ID chiến dịch ổn định |
| `dia_diem` | Địa điểm đã xác nhận |
| `campaign_url` | Link HTTPS đến chi tiết chiến dịch |
| `contact_name`, `contact_phone` | Đầu mối đã được phê duyệt |
| `changed_fields` | Danh sách thay đổi cho email thông báo |
| `attendance_status` | Trạng thái tham gia cho follow-up |

## Chuẩn hóa

- Trim khoảng trắng; giới hạn tên người và tên chiến dịch ở độ dài hợp lý trước khi đưa vào prompt.
- Email phải có cấu trúc cơ bản hợp lệ. Nếu không hợp lệ: `decision = "skip"`.
- `ten` rỗng: vẫn có thể gửi, dùng lời chào `Chào bạn,`.
- `chien_dich` rỗng: `decision = "review"`.
- Thời gian rỗng hoặc không parse được: không bịa; email nói Hà Nội Xanh sẽ cập nhật thời gian, đồng thời thêm cảnh báo.
- Với `reminder`, `change_notice` và `cancellation_notice`, thiếu dữ kiện thay đổi cốt lõi thì `review`.
- Chỉ nhận URL `https://`. URL khác bị loại khỏi nội dung và ghi vào `warnings`.

## Idempotency và trạng thái gửi

AI không tự quyết định email đã gửi trước đó. Workflow phải kiểm tra khóa theo thứ tự:

1. `registration_id + event_type`;
2. nếu thiếu ID: hash chuẩn hóa của `email + chien_dich + thoi_gian_bat_dau + event_type`.

Ghi trạng thái gửi ngoài model: `queued`, `sent`, `failed`, số lần thử và provider message ID. Chỉ retry lỗi tạm thời; không retry địa chỉ sai hoặc bị từ chối vĩnh viễn.

## Xử lý nội dung không tin cậy

Các giá trị như `ten`, `chien_dich`, `changed_fields` có thể chứa HTML hoặc prompt injection. Workflow nên:

- truyền chúng dưới một object dữ liệu riêng, không nối thẳng vào system prompt;
- giới hạn độ dài;
- escape HTML sau khi model trả về hoặc trước khi render template;
- chuyển `decision` sang `review` nếu dữ liệu chứa yêu cầu thay đổi vai trò, tiết lộ bí mật hoặc gửi đến người nhận khác.
