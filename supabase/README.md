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
5. Migration `20261119000000_admin_agent.sql` tạo state, draft/version, publication jobs và audit log cho Admin Agent. Hai RPC `prepare_admin_agent_turn` và `finalize_admin_agent_turn` chỉ cấp quyền cho `service_role`; chỉ gọi chúng từ n8n bằng Supabase Secret key, không gọi từ trình duyệt.

6. Migration `20261123000000_registration_confirmation_email.sql` thêm cột `confirmation_email_sent_at`, `confirmation_email_attempts` (có ràng buộc `>= 0`), `confirmation_email_error` (chỉ chứa mã lỗi ngắn) vào `campaign_registrations` cho worker `mailer/` (email xác nhận đăng ký chiến dịch). Migration cũng tạo lại policy INSERT `registrations_create` (giữ nguyên điều kiện của `20261122020000`, thêm: ba cột `confirmation_email_*` phải ở giá trị mặc định và `created_at` chỉ được lệch từ -1 ngày tới +1 phút so với `now()`), nên phải chạy SAU `20261122020000`. Chạy migration TRƯỚC khi bật mailer. Migration đánh dấu mọi đăng ký đã tồn tại là "đã gửi" (chạy một lần lúc migrate, đừng chạy lại câu `update` đó) để mailer không gửi thư hàng loạt cho dữ liệu cũ; chỉ đăng ký mới sau đó mới được gửi. Thứ tự triển khai: chạy migration và bật mailer TRƯỚC, deploy frontend mới (bản không còn gọi webhook n8n) SAU; đăng ký phát sinh giữa lúc deploy frontend và lúc chạy migration sẽ bị backfill bỏ qua. Cách gửi bù và các bước tắt workflow n8n cũ, bật "Confirm email" nằm trong `mailer/README.md`, mục "Thứ tự triển khai".
7. Mailer cần Secret key của Supabase (Project Settings → API Keys) để đọc email người dùng từ Auth và ghi cột trạng thái; key chỉ đặt trong `mailer/.env` ở máy chạy mailer, không đưa vào frontend. Xem `mailer/README.md`.
8. Migration `20261124000000_campaign_announcements.sql` thêm tính năng thông báo tùy biến gửi tất cả người đăng ký một chiến dịch. PHẢI chạy SAU `20261119000000_admin_agent.sql` (bảng `agent_threads`) và `20261123000000_registration_confirmation_email.sql`; chạy lại nhiều lần vẫn an toàn.
   - Bảng: `campaign_announcements` (nội dung, phiên bản, trạng thái `draft/approved/sending/sent/cancelled`, tiến độ), `campaign_announcement_versions` (lịch sử nội dung) và `campaign_announcement_recipients` (mỗi người một dòng, `UNIQUE (announcement_id, user_id)` chống gửi trùng). RLS bật cả ba bảng, chỉ admin được đọc; không có policy ghi, mọi thay đổi đi qua RPC.
   - RPC cho Admin Agent (n8n, chỉ `service_role`): `find_announcement_campaigns`, `announcement_campaign_registrants`, `upsert_announcement_draft`, `get_announcement`, `request_announcement_test`, `approve_announcement`, `cancel_announcement`. RPC cho mailer: `claim_announcement_tests`, `mark_announcement_test_sent`, `mark_announcement_test_failed`, `claim_announcement_recipients`, `preview_announcement_recipients`, `begin_announcement_send` (kiểm lần cuối trước mỗi thư thật: đã hủy thì `skip`), `mark_announcement_recipient`, `release_announcement_recipients`, `mail_sent_count_between`. Hợp đồng đầy đủ (tham số và mã `status` trả về) nằm trong phần chú thích đầu file migration. Mọi RPC kiểm `p_admin_id` là admin thật và thread thuộc về admin đó; không RPC nào trả địa chỉ email (mailer tự tra qua Auth Admin API).
   - Xem tiến độ một thông báo: `select status, count(*) from public.campaign_announcement_recipients where announcement_id = '<id>' group by status;` và `select status, recipient_count, sent_count, failed_count from public.campaign_announcements where id = '<id>';`
   - Hủy thủ công: `update public.campaign_announcement_recipients set status = 'skipped', error_code = 'cancelled', claimed_until = null where announcement_id = '<id>' and status = 'pending';` rồi `update public.campaign_announcements set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = '<id>' and status in ('approved', 'sending');` (thư đã gửi không thu hồi được; sau `cancel_announcement` tối đa một thư đang trong quá trình gửi có thể vẫn đi). `approve_announcement` xác định mốc bắt đầu lượt chat theo đồng hồ DB (tin nhắn `user` mới nhất của thread trong `agent_messages`); `p_turn_started_at` chỉ là dự phòng.
   - Cảnh báo hạn mức gửi: Gmail thường chỉ cho khoảng 500 thư/ngày (kể cả thư xác nhận đăng ký). Mailer giới hạn `ANNOUNCE_PER_MINUTE` (mặc định 20) và `MAILER_DAILY_LIMIT` (mặc định 400) và tự chia thông báo lớn qua nhiều ngày. Mỗi thông báo tối đa 1000 người nhận, chỉ gửi tới email của tài khoản đã đăng ký (người không có tài khoản không nhận được). Chi tiết: `mailer/README.md`, mục "Thông báo hàng loạt cho người đăng ký".
   - Thứ tự triển khai: chạy migration, rồi cập nhật/khởi động lại mailer, rồi mới bật tool Agent (giai đoạn 2). Mailer bản mới chạy được cả khi chưa có migration (bỏ qua thông báo, ghi cảnh báo).

Các bảng dùng `campaign_key` để tương thích với chiến dịch HTML hiện tại. Khi admin tạo chiến dịch mới, frontend dùng UUID `campaign_id`; các chiến dịch cũ có thể được nhập dần sau.
## Email xác nhận tài khoản

Supabase gửi email xác nhận theo cài đặt của project. Để hiển thị người gửi là **Hà Nội Xanh** và nội dung “Xác nhận tài khoản”, vào Supabase Dashboard → Authentication → Email Templates → Confirm signup:

- Đặt `Sender name` trong Authentication → SMTP Settings là `Hà Nội Xanh` (cần SMTP riêng để đổi tên người gửi).
- Đổi Subject thành `Hà Nội Xanh – Xác nhận tài khoản`.
- Sửa nội dung template, giữ nguyên biến `{{ .ConfirmationURL }}` trong nút/liên kết xác nhận.

Đây là cài đặt phía Supabase, không thể đổi tên người gửi bằng mã frontend.

## Bảo mật hồ sơ và kho ảnh

- `20261122000000_protect_profile_columns.sql` thêm trigger chặn thành viên tự sửa `role`, `points_balance`, `email` và `created_at` (ngày tạo, dùng để tính thâm niên/huy hiệu) trong bảng `profiles` qua API công khai (RLS không giới hạn được từng cột). Admin, các hàm `security definer` (đổi quà, đồng bộ điểm), SQL Editor và `service_role` không bị ảnh hưởng.
- `20261122010000_harden_media_storage.sql` giới hạn bucket `hnx-media` chỉ nhận ảnh JPG, PNG, WEBP, GIF tối đa 10 MB (ảnh chụp điện thoại thường 5-12 MB), và chỉ cho thành viên upload vào thư mục mang id của chính mình (`<user id>/...`); admin được upload mọi nơi.
- `20261122020000_restrict_registration_insert.sql` thay policy INSERT của `campaign_registrations`: thành viên chỉ tạo được đăng ký của chính mình với `status = 'registered'`, không có điểm/giờ/khối lượng rác/thời điểm tham dự, và chiến dịch tham chiếu phải tồn tại; trước đây ai cũng tự chèn được dòng `attended` kèm `awarded_points` để cộng điểm. Admin vẫn chèn tự do. Migration cũng chỉ cho thành viên gửi báo cáo ô nhiễm ở trạng thái `new`, mức `medium`, không có `admin_note` (admin giữ toàn quyền). Luồng đăng ký chiến dịch và gửi báo cáo hiện tại của frontend không đổi. Migration không sửa dữ liệu cũ; xem phần rà soát bên dưới.

Thứ tự triển khai:

- `20261122000000` và `20261122020000` chạy NGAY, không phụ thuộc thứ tự deploy: frontend cũ và mới gửi cùng dữ liệu đăng ký/báo cáo, và chỉ cập nhật các cột hồ sơ không bị chặn.
- `20261122010000` phải chạy SAU khi frontend mới đã deploy (upload ảnh vào thư mục theo user id). Nếu chạy trước, frontend cũ upload vào thư mục gốc sẽ bị từ chối cho đến khi deploy xong.

### Kiểm tra trên staging

Dùng id của một tài khoản thường (không phải admin; admin bỏ qua các chặn này) và id một chiến dịch có thật (`select id from public.campaigns limit 1;`). Chạy từng ca thử trong một lần chạy riêng, vì một lỗi làm hỏng cả transaction. Mỗi lần dùng khung sau và thay phần `-- thử` bằng một câu lệnh:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true);
-- thử
rollback;
```

| Câu lệnh thử | Kết quả mong đợi |
| --- | --- |
| `update public.profiles set role = 'admin' where id = '<uid>';` | Lỗi `42501` (trigger chặn) |
| `update public.profiles set full_name = 'Test' where id = '<uid>';` | Thành công |
| `insert into public.campaign_registrations (user_id, campaign_key, status, awarded_points) values ('<uid>', '<campaign id>', 'attended', 15000);` | Lỗi `42501` (RLS chặn) |
| `insert into public.campaign_registrations (user_id, campaign_key, status) values ('<uid>', '<campaign id>', 'registered');` | Thành công (nếu tài khoản đã đăng ký chiến dịch này sẽ báo trùng `23505`; chọn chiến dịch khác) |
| `insert into public.campaign_registrations (user_id, campaign_key, status, confirmation_email_sent_at) values ('<uid>', '<campaign id>', 'registered', now());` | Lỗi `42501` (RLS chặn; cần đã chạy `20261123000000`) |
| `insert into public.campaign_registrations (user_id, campaign_key, status, confirmation_email_attempts) values ('<uid>', '<campaign id>', 'registered', -2147483648);` | Lỗi `42501` (RLS chặn) |
| `insert into public.campaign_registrations (user_id, campaign_key, status, created_at) values ('<uid>', '<campaign id>', 'registered', now() - interval '30 days');` | Lỗi `42501` (RLS chặn) |
| `insert into public.pollution_reports (user_id, address, description, status) values ('<uid>', 'Test', 'Test', 'verifying');` | Lỗi `42501` (RLS chặn) |

Vì có `rollback`, không dòng nào được giữ lại. Kiểm tra thêm không có policy INSERT thủ công nào khác làm vô hiệu việc chặn (các policy cho phép được cộng gộp bằng OR) hay trigger BEFORE INSERT tự thêm:

```sql
select tablename, policyname, cmd, roles, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('campaign_registrations', 'pollution_reports')
  and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
order by tablename, policyname;

select tgname from pg_trigger
where tgrelid = 'public.campaign_registrations'::regclass and not tgisinternal;
```

Kiểm tra thêm các policy trên kho ảnh:

```sql
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';
```

Policy permissive tạo tay qua Dashboard cho bucket `hnx-media` sẽ vượt qua migration siết kho ảnh (các policy được cộng gộp bằng OR), nên phải xóa hoặc siết lại.

### Rà soát dữ liệu cũ

Các truy vấn chỉ đọc, chạy tay sau khi áp migration. Không tự sửa dữ liệu; xử lý từng trường hợp bất thường sau khi đối chiếu với admin.

```sql
-- Tài khoản admin lạ
select id, email, full_name, created_at, last_login_at
from public.profiles
where role = 'admin'
order by created_at;

-- Dòng đã tham dự nhưng không khớp chiến dịch nào, hoặc không có thời điểm tham dự
select r.id, r.user_id, r.campaign_id, r.campaign_key, r.awarded_points, r.attended_hours, r.attended_at, r.created_at
from public.campaign_registrations as r
where r.status = 'attended'
  and (r.attended_at is null
       or not exists (select 1 from public.campaigns as c where c.id = r.campaign_id or c.id::text = r.campaign_key));

-- Điểm lệch: số dư khác tổng điểm đã tham dự trừ điểm đã đổi quà
select p.id, p.email, p.points_balance,
       coalesce(a.points, 0) as attended_points, coalesce(s.points, 0) as spent_points
from public.profiles as p
left join (select user_id, sum(awarded_points) as points from public.campaign_registrations where status = 'attended' group by user_id) as a on a.user_id = p.id
left join (select user_id, sum(points_spent) as points from public.green_redemptions group by user_id) as s on s.user_id = p.id
where p.points_balance <> greatest(0, coalesce(a.points, 0) - coalesce(s.points, 0))
order by p.points_balance desc;
```
