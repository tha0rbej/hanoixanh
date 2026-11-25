---
name: registration-email-mailer
description: Vận hành và xử lý sự cố luồng email xác nhận đăng ký chiến dịch của Hà Nội Xanh bằng Python Mailer, Supabase và Gmail SMTP. Dùng khi cần cấu hình, kiểm tra hàng đợi, chạy thử, bật/dừng hoặc chẩn đoán email xác nhận; không dùng cho việc soạn nội dung thông báo hàng loạt.
---

# Registration email mailer

Luồng xác nhận đăng ký là một worker Python polling. Mặc định worker dựng thư từ template cố định rồi gửi qua Gmail SMTP. Khi đặt `AI_EMAIL_WEBHOOK_URL`, worker gọi workflow n8n có AI Agent để sinh `subject`, `text`, `html`; Python Mailer vẫn là thành phần gửi SMTP và ghi trạng thái Supabase.

## Nguyên tắc an toàn

- Không in, commit, gửi lại hoặc đưa vào câu trả lời các giá trị `SUPABASE_SERVICE_KEY`, `SMTP_PASSWORD` hay file `mailer/.env`.
- Không gửi thử thật chỉ để kiểm tra cấu hình. Dùng `--dry-run` trước; chỉ dùng `--once` hoặc chạy liên tục khi admin yêu cầu rõ.
- Không chạy hai worker cho cùng một Supabase project. Trên một máy, tôn trọng `mailer/.mailer.lock`; trước khi chạy tay hãy kiểm tra worker/service đang hoạt động.
- Không chạy lại câu backfill `set confirmation_email_sent_at = now()` trong migration. Câu đó chỉ chạy một lần khi triển khai migration.
- Không khôi phục webhook n8n cũ cho frontend mới nếu không có yêu cầu rõ; frontend mới ghi đăng ký vào Supabase và để Mailer xử lý.
- Nếu bật AI webhook, khi n8n/LLM lỗi phải giữ lượt đăng ký chờ thử lại và không gửi thư fallback trong cùng lần xử lý.

## Khi cần kiểm tra

Đọc `mailer/README.md` trước khi thay đổi vận hành. Xác minh lần lượt:

1. `mailer/.env` tồn tại cục bộ và có `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SITE_URL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.
2. Migration `supabase/migrations/20261123000000_registration_confirmation_email.sql` đã được chạy trên project Supabase. Có thể kiểm tra schema bằng truy vấn chỉ đọc các cột `confirmation_email_sent_at`, `confirmation_email_attempts`, `confirmation_email_error`.
3. Chỉ có một worker đang chạy; không suy luận worker đang hoạt động chỉ từ việc file cấu hình tồn tại.
4. Hàng đợi còn dòng chờ và lỗi từng dòng, nếu cần:

```sql
select id, user_id, campaign_key, confirmation_email_attempts,
       confirmation_email_error, created_at
from public.campaign_registrations
where status = 'registered'
  and confirmation_email_sent_at is null
order by created_at desc;
```

## Chạy và chẩn đoán

Từ thư mục `mailer/`:

- `python registration_mailer.py --dry-run`: đọc dữ liệu và dựng thư, không gửi SMTP, không ghi DB.
- `python registration_mailer.py --once`: xử lý một vòng gửi thật; chỉ chạy khi admin đã yêu cầu.
- `python registration_mailer.py`: chạy liên tục theo `POLL_SECONDS`.
- `python registration_mailer.py --demo`: kiểm tra template không cần Supabase hay SMTP.

Nếu `--dry-run` báo `supabase_unreachable`, `supabase_unauthorized`, `supabase_rate_limited` hoặc lỗi server thì dừng và sửa kết nối/secret trước; không reset số lần thử của các dòng. Nếu báo `smtp_auth_failed` hoặc `smtp_connect_failed`, kiểm tra Gmail App Password, cổng 587, `SMTP_SECURITY=starttls` và giới hạn gửi. Nếu chỉ một dòng lỗi, giữ mã lỗi trong DB và chỉ reset dòng đó sau khi nguyên nhân đã được sửa.

## Phạm vi của skill

- Mail xác nhận: Mailer tự gửi bằng template; tùy chọn có thể dùng AI Agent n8n để soạn nội dung qua `n8n/registration-email-ai-agent.json`.
- Thông báo hàng loạt: Admin Agent có thể dùng n8n/LLM để soạn và duyệt; Mailer vẫn là thành phần gửi thư thật. Với quy trình đó, dùng skill `campaign-announcement`.
- Không biến skill này thành nơi lưu credential, không thêm secret vào workflow JSON, frontend, GitHub Actions log hoặc commit.
