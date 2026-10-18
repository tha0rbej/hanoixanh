# Cấu hình Supabase

1. Tạo project Supabase, mở SQL Editor và chạy các file trong `migrations/` theo thứ tự tên file. Các migration `20261017000000_rewards_and_badges.sql`, `20261017010000_points_leaderboard.sql` và `20261017020000_cumulative_campaign_points.sql` bổ sung điểm, mức thưởng, huy hiệu, bảng xếp hạng và cho phép mỗi tài khoản tích điểm qua nhiều chiến dịch.
2. Trong Auth → Users, mời email admin đầu tiên. Sau khi người đó đăng nhập lần đầu, chạy:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

3. Tạo `.env.local` ở thư mục gốc từ `env.example` và điền Project URL cùng anon key. Không dùng service-role key ở frontend.
4. Storage bucket `hnx-media` được migration tạo tự động; tài khoản đã đăng nhập có thể upload ảnh báo cáo, còn ảnh quản trị bài viết/điểm dọn dẹp được kiểm soát bởi RLS.

Các bảng dùng `campaign_key` để tương thích với chiến dịch HTML hiện tại. Khi admin tạo chiến dịch mới, frontend dùng UUID `campaign_id`; các chiến dịch cũ có thể được nhập dần sau.
## Email xác nhận tài khoản

Supabase gửi email xác nhận theo cài đặt của project. Để hiển thị người gửi là **Hà Nội Xanh** và nội dung “Xác nhận tài khoản”, vào Supabase Dashboard → Authentication → Email Templates → Confirm signup:

- Đặt `Sender name` trong Authentication → SMTP Settings là `Hà Nội Xanh` (cần SMTP riêng để đổi tên người gửi).
- Đổi Subject thành `Hà Nội Xanh – Xác nhận tài khoản`.
- Sửa nội dung template, giữ nguyên biến `{{ .ConfirmationURL }}` trong nút/liên kết xác nhận.

Đây là cài đặt phía Supabase, không thể đổi tên người gửi bằng mã frontend.
