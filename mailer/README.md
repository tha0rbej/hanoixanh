# Mailer: email xác nhận đăng ký và thông báo hàng loạt

Chương trình Python nhỏ, chỉ dùng thư viện chuẩn, gửi một mẫu thư có sẵn cho người vừa đăng ký chiến dịch, và (từ migration `20261124000000`) gửi thông báo tùy biến do admin duyệt tới mọi người đã đăng ký một chiến dịch (xem mục "Thông báo hàng loạt cho người đăng ký"). Không dùng n8n, không dùng LLM. Nội dung thư điền từ chính dữ liệu đăng ký trong Supabase: tên người đăng ký, tên chiến dịch, địa điểm, thời gian bắt đầu/kết thúc và liên kết xem chiến dịch.

## Cách hoạt động

Đây là worker polling, chỉ gọi RA ngoài (Supabase và máy chủ SMTP), nên không cần địa chỉ công khai hay Database Webhook. Mỗi `POLL_SECONDS` giây (mặc định 30), mailer:

1. Lấy các đăng ký `status = 'registered'`, `confirmation_email_sent_at is null`, `confirmation_email_attempts < MAX_ATTEMPTS`, cũ nhất trước, tối đa 20 dòng.
2. Với mỗi dòng: lấy email từ Supabase Auth Admin API (nguồn tin cậy), tên từ `profiles.full_name` (rỗng thì dùng phần trước `@` của email, rồi đến "bạn"), thông tin chiến dịch từ `campaigns`. Chiến dịch lấy theo `campaign_id`, nếu không có thì theo `campaign_key` (chỉ chấp nhận khi là UUID hợp lệ).
3. Điền mẫu `templates/registration_confirmation.{txt,html}` rồi gửi qua SMTP (multipart text + HTML, UTF-8).
4. Ghi `confirmation_email_sent_at` ngay sau khi SMTP thành công.

Máy tắt rồi bật lại thì mailer tự gửi bù những đăng ký còn tồn.

## Cài đặt

Cần Python từ 3.10 trở lên, không cần cài thêm gói nào. Múi giờ dùng `zoneinfo` nên cần dữ liệu múi giờ của hệ điều hành (gói `tzdata`; Windows và image Docker tối giản thường thiếu: `pip install tzdata` hoặc `apt install tzdata` / `apk add tzdata`). Riêng `Asia/Ho_Chi_Minh` (mặc định) nếu thiếu `tzdata` thì mailer tự dùng UTC+7 cố định (Việt Nam không có giờ mùa hè) và ghi một dòng cảnh báo; múi giờ khác mà thiếu `tzdata` thì báo lỗi cấu hình.

```bash
cd mailer
cp env.example .env
chmod 600 .env
# mở .env và điền giá trị thật
```

Biến môi trường thật được ưu tiên hơn file `.env`. Tên file mẫu là `env.example` (không có dấu chấm đầu) vì `.gitignore` của repo bỏ qua mọi file `.env*`; giống `env.example` ở thư mục gốc.

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `SUPABASE_URL` | có | Project URL, dạng `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | có | Secret key (service-role), chỉ phía server |
| `SITE_URL` | có | Địa chỉ website, dựng liên kết `${SITE_URL}/chien-dich?campaign=<id>` |
| `SMTP_HOST` | có (trừ `--dry-run`) | Máy chủ SMTP |
| `SMTP_PORT` | không | Mặc định 587 |
| `SMTP_SECURITY` | không | `starttls` (mặc định), `ssl` (thường cổng 465) hoặc `none`. `none` chỉ được dùng cùng `SMTP_USER`/`SMTP_PASSWORD` khi `SMTP_HOST` là `localhost`, `127.0.0.1` hoặc `::1` (nếu không, mật khẩu đi qua mạng dạng rõ nên chương trình từ chối khởi động) |
| `SMTP_USER`, `SMTP_PASSWORD` | không | Đặt cùng nhau hoặc cùng bỏ trống |
| `MAIL_FROM` | có (trừ `--dry-run`) | Ví dụ `Hà Nội Xanh <hanoixanhh@gmail.com>` |
| `MAIL_REPLY_TO` | không | Địa chỉ nhận phản hồi |
| `POLL_SECONDS` | không | Mặc định 30 |
| `MAX_ATTEMPTS` | không | Mặc định 5 |
| `MAILER_TIMEZONE` | không | Mặc định `Asia/Ho_Chi_Minh` |
| `ANNOUNCEMENTS_ENABLED` | không | Mặc định `true`. `false` tắt riêng phần thông báo hàng loạt (thư xác nhận vẫn chạy) |
| `ANNOUNCE_PER_MINUTE` | không | Mặc định 20 (1-120): số thư thông báo tối đa mỗi phút |
| `MAILER_DAILY_LIMIT` | không | Mặc định 400: tổng số thư mỗi ngày (xác nhận + thông báo + thư thử), xem mục thông báo hàng loạt |

Thiếu hoặc sai biến thì chương trình báo lỗi bằng tiếng Việt và thoát với mã 2.

### Lấy SMTP (ví dụ Gmail)

1. Bật xác minh 2 bước cho tài khoản Google gửi thư.
2. Vào Tài khoản Google, mục Bảo mật, "Mật khẩu ứng dụng", tạo một mật khẩu cho "Mail".
3. Điền `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURITY=starttls`, `SMTP_USER=<địa chỉ Gmail>`, `SMTP_PASSWORD=<mật khẩu ứng dụng 16 ký tự>`.

Không dùng mật khẩu đăng nhập thật của tài khoản. Gmail giới hạn số thư gửi mỗi ngày; nếu lượng đăng ký lớn, nên dùng dịch vụ SMTP chuyên dụng.

### Lấy `SUPABASE_SERVICE_KEY`

Supabase Dashboard, Project Settings, API Keys, mục Secret key. Key này bỏ qua RLS và cho đọc danh sách người dùng Auth, nên tuyệt đối không đưa vào frontend, `VITE_*`, `public/`, workflow hay commit.

## Chạy

```bash
cd mailer

# 1. Xem thử mẫu thư với dữ liệu mẫu (không cần cấu hình)
python3 registration_mailer.py --demo --html-out /tmp/mau-thu.html

# 2. Dry-run với dữ liệu thật: render và in thư, KHÔNG gửi SMTP, KHÔNG ghi DB (không cần SMTP_*)
python3 registration_mailer.py --dry-run

# 3. Chạy một vòng rồi thoát
python3 registration_mailer.py --once

# 4. Chạy liên tục (Ctrl+C hoặc SIGTERM để dừng sạch)
python3 registration_mailer.py

# 5. Xem thử mẫu thư thông báo hàng loạt với dữ liệu giả (không cần cấu hình)
python3 registration_mailer.py --demo-announcement --html-out /tmp/mau-thong-bao.html
```

`--dry-run` luôn chỉ chạy một vòng (với thông báo: in tối đa 5 thư thử và 5 người nhận kế tiếp, chỉ đọc, không giành lease, không ghi DB). `-v` bật log chi tiết, `--env-file` chọn file env khác.

Mã thoát: `0` bình thường (kể cả khi có dòng bị lỗi riêng), `1` gặp sự cố chung ở chế độ `--once`/`--dry-run` (lý do được in ra stderr, ví dụ `Lỗi hệ thống [smtp_auth_failed]`), `2` thiếu/sai cấu hình, `3` đã có tiến trình mailer khác đang chạy.

### Chỉ chạy một tiến trình trên một cơ sở dữ liệu

Hai tiến trình cùng chạy (ví dụ systemd và một lần `--once` gõ tay) sẽ gửi trùng thư. Mailer giữ khóa file `mailer/.mailer.lock` (`fcntl.flock`, không chặn, tự nhả khi tiến trình thoát hay chết); nếu khóa đang bị giữ thì thoát với mã 3 và báo bằng tiếng Việt. `--dry-run` và `--demo` không cần khóa. Giới hạn: khóa chỉ có hiệu lực trong MỘT máy (và một thư mục `mailer/`). Chạy mailer trên hai máy, hoặc hai bản clone, cho cùng một cơ sở dữ liệu vẫn gửi trùng, nên đừng làm vậy. Trên Windows (không có `fcntl`) khóa bị bỏ qua. Muốn chạy tay khi service đang chạy: `systemctl --user stop hnx-registration-mailer` trước.

### Chạy nền

systemd user (khuyên dùng), xem `hnx-registration-mailer.service`:

```bash
mkdir -p ~/.config/systemd/user
cp hnx-registration-mailer.service ~/.config/systemd/user/   # sửa đường dẫn cho đúng máy
systemctl --user daemon-reload
systemctl --user enable --now hnx-registration-mailer
loginctl enable-linger "$USER"
journalctl --user -u hnx-registration-mailer -f              # xem log
```

Hoặc tmux/nohup:

```bash
nohup python3 registration_mailer.py >> mailer.log 2>&1 &
```

Log ghi ra stderr. Địa chỉ email trong log được che (`a***@gmail.com`); mật khẩu và key không bao giờ được ghi.

## Khi nào thư không được gửi

Xem cột trạng thái trên `campaign_registrations`:

```sql
select id, user_id, campaign_key, confirmation_email_attempts, confirmation_email_error, created_at
from public.campaign_registrations
where confirmation_email_sent_at is null
order by created_at desc;
```

Mailer chia lỗi thành ba loại:

- **Sự cố chung** (không do dòng nào gây ra): mật khẩu ứng dụng SMTP sai hoặc bị thu hồi, không kết nối được SMTP/Supabase, hết hạn mức gửi, `SUPABASE_SERVICE_KEY` sai (HTTP 401/403), Supabase trả 429/5xx. Mailer KHÔNG tăng `confirmation_email_attempts` của dòng nào, dừng vòng hiện tại, ghi cảnh báo (đã che secret) rồi chờ lâu dần: `POLL_SECONDS` × 2, × 4, ... tối đa 5 phút (30 s → 60 s → 120 s → 240 s → 300 s). Vòng đầu tiên thành công thì quay về chu kỳ bình thường. Nhờ vậy một sự cố vài phút hay vài giờ không làm mất thư của ai: sửa xong là thư được gửi tiếp. Với `--once` mailer in lý do ra stderr và thoát mã 1.
- **Lỗi tạm thời của một dòng** (ví dụ máy chủ nhận thư tạm từ chối riêng địa chỉ đó, mã 4xx): `confirmation_email_attempts` tăng 1 mỗi lần, vòng sau thử lại; đạt `MAX_ATTEMPTS` thì dừng thử và ghi log cảnh báo.
- **Lỗi vĩnh viễn của một dòng** (địa chỉ bị từ chối 5xx, tài khoản không có email hoặc đã bị xóa, chiến dịch không tồn tại, `campaign_key` không phải UUID, thư bị từ chối nội dung): `attempts` đặt ngay bằng `MAX_ATTEMPTS`, không lặp vô hạn.

Cột `confirmation_email_error` chỉ lưu MÃ LỖI ngắn (bảng dưới) chứ không lưu chuỗi lỗi thô, vì người đăng ký đọc được hàng của chính mình (kể cả `select=*` từ frontend) và chuỗi lỗi SMTP/HTTP có thể lộ chi tiết nội bộ. Chi tiết đầy đủ (đã che secret) chỉ có trong log của mailer (`journalctl --user -u hnx-registration-mailer`). Khi dòng đạt `MAX_ATTEMPTS` sau nhiều lỗi tạm thời, cột này giữ mã của lỗi cuối cùng.

Mã lỗi ghi vào `confirmation_email_error` (lỗi riêng của dòng):

| Mã | Loại | Ý nghĩa |
| --- | --- | --- |
| `smtp_recipient_refused` | vĩnh viễn | Máy chủ thư từ chối địa chỉ nhận (5xx: không tồn tại, bị chặn) |
| `smtp_recipient_deferred` | tạm thời | Máy chủ thư tạm từ chối địa chỉ nhận (4xx, ví dụ greylisting) |
| `smtp_data_rejected` | vĩnh viễn | Máy chủ từ chối nội dung thư (5xx: nghi spam, quá cỡ, ...) |
| `invalid_recipient` | vĩnh viễn | Email của tài khoản không đúng dạng |
| `no_auth_email` | vĩnh viễn | Tài khoản Supabase Auth không có địa chỉ email |
| `auth_user_not_found` | vĩnh viễn | `user_id` không có trong Supabase Auth (404) |
| `invalid_user_id` | vĩnh viễn | `user_id` không phải UUID hợp lệ |
| `invalid_campaign_id` | vĩnh viễn | Dòng không có `campaign_id`/`campaign_key` là UUID hợp lệ |
| `campaign_not_found` | vĩnh viễn | Chiến dịch không tồn tại |
| `supabase_error` | tạm thời | Supabase trả lỗi 4xx riêng cho dòng này (không phải 401/403/429; riêng 404 của Auth Admin API là `auth_user_not_found`) |
| `smtp_error` | tạm thời | Lỗi SMTP khác không thuộc nhóm nào ở trên |
| `unexpected_error` | tạm thời | Lỗi không lường trước trong mailer (xem log) |

Mã sự cố chung chỉ xuất hiện trong log và trong thông báo của `--once`, không bao giờ ghi vào bảng: `smtp_auth_failed`, `smtp_connect_failed`, `smtp_server_disconnected`, `smtp_not_supported`, `smtp_helo_failed`, `smtp_sender_refused`, `smtp_tls_error`, `smtp_timeout`, `smtp_network_error`, `smtp_quota_exceeded`, `smtp_temporary_failure`, `smtp_server_error`, `smtp_not_configured`, `supabase_unreachable`, `supabase_unauthorized`, `supabase_rate_limited`, `supabase_server_error`, `supabase_bad_response`, `supabase_write_failed`. Riêng `supabase_write_failed` nghĩa là thư ĐÃ gửi nhưng không ghi được `confirmation_email_sent_at`; mailer dừng vòng để không gửi thêm và vòng sau có thể gửi trùng đúng thư đó (xem phần đánh đổi bên dưới).

- Muốn thử lại một dòng sau khi sửa nguyên nhân: `update public.campaign_registrations set confirmation_email_attempts = 0, confirmation_email_error = null where id = '<id>';`
- Đăng ký đã `cancelled` hoặc `attended` không được gửi thư.

## Đánh đổi: gửi trùng hiếm gặp

Đánh dấu "đã gửi" được ghi ngay SAU khi SMTP thành công. Nếu tiến trình chết đúng giữa hai bước (SMTP xong nhưng chưa ghi được vào DB), vòng sau sẽ gửi lại thư đó một lần nữa. Đổi lại, không bao giờ mất thư. Mailer thử ghi đánh dấu tối đa 3 lần trước khi bỏ cuộc. Mức rủi ro này được chấp nhận.

## Thông báo hàng loạt cho người đăng ký

Admin nhắn Admin Agent một câu ngắn ("báo mọi người đăng ký chiến dịch La Phù là dời sang 8h sáng Chủ nhật"). Agent soạn nội dung văn bản thuần, admin đọc, có thể gửi thử cho riêng mình, rồi xác nhận ở một tin nhắn sau. Từ đó việc gửi do mailer này đảm nhiệm (không LLM, không n8n): một nơi giữ SMTP, bật lại sau khi máy tắt vẫn gửi tiếp, theo dõi từng người, không gửi trùng. Dữ liệu và hợp đồng RPC nằm trong migration `supabase/migrations/20261124000000_campaign_announcements.sql` (bảng `campaign_announcements`, `campaign_announcement_versions`, `campaign_announcement_recipients`).

### Luồng

1. Agent gọi `upsert_announcement_draft` (tạo/sửa bản nháp, mỗi lần sửa tăng `version`). Admin đọc nội dung trong chat.
2. Tùy chọn: `request_announcement_test`. Mỗi vòng mailer lấy yêu cầu bằng `claim_announcement_tests`, gửi bản thử TỚI ĐÚNG email Auth của admin đã yêu cầu (tiêu đề và dòng đầu thư bắt đầu bằng `[THỬ]`, ghi rõ chưa gửi cho ai khác), rồi `mark_announcement_test_sent`. Tối đa 5 lần yêu cầu thử mỗi giờ cho mỗi thông báo; sửa nội dung thì yêu cầu thử cũ bị hủy.
3. Admin xác nhận ở tin nhắn sau: `approve_announcement` đóng băng nội dung và chụp danh sách người nhận (mỗi người một dòng, chống trùng bằng `UNIQUE (announcement_id, user_id)`). Bản nháp vừa tạo trong CÙNG lượt chat với lời xác nhận bị từ chối (`needs_admin_review`). Mốc bắt đầu lượt được lấy theo đồng hồ DB từ tin nhắn `user` mới nhất của thread (`agent_messages`, do `prepare_admin_agent_turn` ghi ở đầu mỗi lượt); `p_turn_started_at` (đồng hồ n8n) chỉ là dự phòng khi thread chưa có tin nhắn user, nên lệch đồng hồ giữa n8n và DB không làm lọt bản nháp.
4. Mailer nhận người đăng ký theo lô bằng `claim_announcement_recipients` (lease 5 phút, `for update skip locked`; một mailer chết giữa chừng thì lease hết hạn và người đó được gửi tiếp). Với mỗi người: lấy email Auth, tên từ `profiles.full_name`, dựng thư theo mẫu `templates/announcement.{txt,html}`, gửi, rồi ghi kết quả bằng `mark_announcement_recipient`. NGAY TRƯỚC mỗi thư thật (sau khi đã chờ giãn cách, không áp dụng cho thư thử) mailer gọi `begin_announcement_send`: DB chỉ cho gửi khi người đó còn `pending`, lease còn hạn và thông báo đang `approved`/`sending` (đồng thời gia hạn lease). Trả `skip` (đã hủy, không còn pending, mất lease) thì mailer không gửi, không tính lần thử, không báo lỗi (chỉ log mức info); thông báo bị hủy thì cả phần còn lại của lô bị bỏ qua và lô kết thúc sớm. Lỗi HTTP ở bước này (0/401/403/429/5xx) là sự cố chung như các RPC khác. Hết người chờ thì thông báo chuyển `sent`.

Mỗi vòng, thư xác nhận đăng ký được xử lý TRƯỚC; thông báo chỉ chạy khi phần xác nhận không gặp sự cố chung. Một vòng thông báo chỉ gửi một lô nhỏ (khoảng 20 giây gửi) rồi quay lại kiểm tra thư xác nhận mới, nên thư xác nhận không phải chờ cả đợt thông báo dài.

Ai nhận được: người có tài khoản và đăng ký chiến dịch (trạng thái khác `cancelled`), mỗi `user_id` một thư dù đăng ký nhiều lần. Thư gửi tới email của tài khoản Supabase Auth, nên NGƯỜI KHÔNG CÓ TÀI KHOẢN KHÔNG NHẬN ĐƯỢC. Tối đa 1000 người mỗi thông báo (vượt thì không duyệt được).

Nội dung thư: tiêu đề do admin/Agent đặt (làm sạch xuống dòng và ký tự điều khiển); "Chào {tên},"; nội dung tùy biến; khối thông tin chiến dịch (tên, thời gian, địa điểm, nút xem chi tiết) LẤY TỪ BẢNG `campaigns`, không từ nội dung thông báo; dòng "Bạn nhận thư này vì đã đăng ký tham gia {chiến dịch}"; liên hệ; chữ ký "Ban Quản trị Hà Nội Xanh". Vì vậy, nếu thông báo là dời giờ/địa điểm, hãy cập nhật chiến dịch trong trang quản trị TRƯỚC khi gửi, nếu không khối thông tin vẫn hiện giờ cũ. Nội dung văn bản thuần được escape hoàn toàn khi dựng HTML (không thẻ HTML nào đi qua), xuống dòng đơn thành `<br>`, dòng trống tách đoạn, chỉ URL `http`/`https` được tự động thành liên kết. Thư có `Auto-Submitted: auto-generated`, `X-Entity-Ref-ID` và `Message-ID` hợp lệ.

### Giới hạn tốc độ và hạn mức ngày

Gmail thường giới hạn khoảng 500 thư/ngày với tài khoản thường (và bị khóa tạm nếu gửi dồn dập), nên:

- `ANNOUNCE_PER_MINUTE` (mặc định 20): giữa hai thư thông báo mailer ngủ `60 / ANNOUNCE_PER_MINUTE` giây (ngủ bằng `stop_event.wait` nên Ctrl+C/SIGTERM vẫn dừng ngay). 1000 người ở 20 thư/phút mất khoảng 50 phút.
- `MAILER_DAILY_LIMIT` (mặc định 400, để dư an toàn dưới 500): tổng số thư của ngày theo `MAILER_TIMEZONE`, gồm thư xác nhận (`campaign_registrations.confirmation_email_sent_at`), thư thông báo (`campaign_announcement_recipients.sent_at`) và thư thử (`test_sent_at`), đếm bằng RPC `mail_sent_count_between`. Đạt hạn mức thì mailer nhả lease, ghi cảnh báo và dừng gửi thông báo tới 00:00 ngày hôm sau (rồi tự gửi tiếp phần còn lại); thư xác nhận đăng ký mới vẫn được gửi. Thông báo cho nhiều người hơn hạn mức còn lại trong ngày sẽ được chia ra nhiều ngày. Lưu ý: ngày chạy migration `20261123000000` đã đánh dấu toàn bộ lịch sử đăng ký là "đã gửi" lúc đó, nên ngày ấy hạn mức còn lại bị tính thiếu (an toàn, không nguy hiểm).
- Dùng dịch vụ SMTP chuyên dụng nếu cần gửi nhiều hơn; khi đó tăng hai biến trên theo hạn mức của dịch vụ.

### Xem tiến độ

```sql
select a.id, c.title, a.status, a.version, a.recipient_count, a.sent_count, a.failed_count, a.updated_at
from public.campaign_announcements a join public.campaigns c on c.id = a.campaign_id
order by a.created_at desc limit 20;

select status, count(*) from public.campaign_announcement_recipients
where announcement_id = '<id thông báo>' group by status;

-- Những người gửi lỗi
select user_id, status, attempts, error_code from public.campaign_announcement_recipients
where announcement_id = '<id thông báo>' and status in ('failed', 'pending') order by status, error_code;
```

Mailer ghi log từng thư (email được che `a***@gmail.com`); `journalctl --user -u hnx-registration-mailer -f`.

### Hủy

Admin nhờ Agent hủy (`cancel_announcement`), hoặc hủy tay trong SQL Editor (người đã nhận thư thì không thu hồi được; sau khi hủy, tối đa MỘT thư đang trong quá trình gửi có thể vẫn đi, các thư sau đó bị chặn bởi `begin_announcement_send`):

```sql
update public.campaign_announcement_recipients set status = 'skipped', error_code = 'cancelled', claimed_until = null
where announcement_id = '<id thông báo>' and status = 'pending';
update public.campaign_announcements set status = 'cancelled', cancelled_at = now(), updated_at = now()
where id = '<id thông báo>' and status in ('approved', 'sending');
```

Gửi lại cho người bị lỗi sau khi sửa nguyên nhân (ví dụ đã có email): `update public.campaign_announcement_recipients set status = 'pending', attempts = 0, error_code = null, claimed_until = null where id = '<id>';` rồi đặt thông báo về `sending` nếu nó đã `sent`.

### Lỗi và mã lỗi

Phân loại giống thư xác nhận:

- **Sự cố chung** (SMTP sai mật khẩu/hết hạn mức/không kết nối, Supabase 401/403/429/5xx/mất mạng): KHÔNG tăng `attempts` của người nào, mailer nhả lease của cả lô chưa gửi, dừng vòng và chờ lâu dần (backoff như thư xác nhận). Sửa xong thì thư được gửi tiếp.
- **Lỗi riêng tạm thời** (máy chủ thư tạm từ chối riêng địa chỉ, 4xx): `attempts` tăng 1, người đó được thử lại sau 5 phút, tối đa `MAX_ATTEMPTS` lần rồi thành `failed`.
- **Lỗi riêng vĩnh viễn** (địa chỉ bị từ chối, tài khoản không có email): `failed` ngay.

`campaign_announcement_recipients.error_code` (và `campaign_announcements.test_error_code` cho thư thử) chỉ lưu MÃ ngắn, không bao giờ lưu chuỗi lỗi thô; chi tiết đã che secret chỉ nằm trong log:

| Mã | Ý nghĩa |
| --- | --- |
| `no_auth_email` | Tài khoản Supabase Auth không có địa chỉ email |
| `auth_user_not_found` | `user_id` không còn trong Supabase Auth |
| `invalid_user_id` | `user_id` không phải UUID hợp lệ |
| `invalid_recipient` | Email của tài khoản không đúng dạng |
| `invalid_campaign_id` | Thông báo không có chiến dịch hợp lệ |
| `smtp_recipient_refused` | Máy chủ thư từ chối địa chỉ nhận vĩnh viễn (5xx) |
| `smtp_recipient_deferred` | Máy chủ thư tạm từ chối địa chỉ nhận (4xx), được thử lại |
| `smtp_data_rejected` | Máy chủ từ chối nội dung thư (5xx) |
| `smtp_error`, `supabase_error`, `unexpected_error` | Lỗi riêng tạm thời khác (xem log) |
| `max_attempts` | Hết số lần thử khi không có mã cụ thể |
| `cancelled` | Người nhận bị bỏ qua vì thông báo bị hủy (trạng thái `skipped`) |

### Gửi trùng hiếm gặp

Mailer ghi `sent` ngay sau khi SMTP thành công (thử 3 lần). Nếu Supabase đang không ghi được, mailer dừng vòng, GIỮ trạng thái "đã gửi" trong bộ nhớ và ghi lại ở vòng sau trước khi gửi tiếp, nên không gửi lại những người đó khi mailer còn chạy. Chỉ khi tiến trình chết đúng lúc đó thì người ấy có thể nhận thư lần hai. Mức rủi ro này được chấp nhận (như thư xác nhận).

### Triển khai

Chạy migration `20261124000000_campaign_announcements.sql` SAU `20261119000000_admin_agent.sql` và `20261123000000_registration_confirmation_email.sql`. Mailer bản mới chạy được trước khi có migration: nó chỉ ghi một cảnh báo mỗi giờ ("hãy chạy migration ...") và bỏ qua thông báo, thư xác nhận vẫn gửi bình thường. Tắt riêng phần thông báo bằng `ANNOUNCEMENTS_ENABLED=false`.

## Thứ tự triển khai

Dọn đường cho luồng cũ (n8n) và siết tài khoản:

1. Tắt hoặc xóa workflow n8n cloud cũ trên `hanoixanh.app.n8n.cloud` (path webhook cũ `3a99fa36-f158-4b77-8b52-f6b30a52c044`). Tại thời điểm 2026-11-24 instance này trả "404 - No instance here" nên có thể đã bị xóa, nhưng bản frontend production hiện tại vẫn gửi tên và email người đăng ký tới địa chỉ đó cho tới khi deploy frontend mới; nếu ai đó tạo lại instance trùng tên họ sẽ nhận được dữ liệu này, và nếu workflow còn chạy thì người đăng ký sẽ nhận hai thư (thư cũ và thư của mailer).
2. Nếu từng tạo Supabase Database Webhook cho bảng `campaign_registrations` (Database → Webhooks) thì xóa nó, để không còn gì đẩy dữ liệu đăng ký ra ngoài song song với mailer.
3. Bật "Confirm email" trong Supabase Dashboard → Authentication → Providers → Email. Mailer gửi tới email của tài khoản Auth; nếu không bắt xác nhận email, một người có thể đăng ký tài khoản bằng email của người khác rồi đăng ký chiến dịch, và hệ thống sẽ gửi thư tới địa chỉ đó (thư rác, mạo danh).

Triển khai mailer và frontend (thứ tự này quan trọng):

4. Chạy migration `supabase/migrations/20261123000000_registration_confirmation_email.sql`. Nó thêm cột trạng thái, siết policy INSERT của `campaign_registrations`, và đánh dấu MỌI đăng ký đang có là "đã gửi" (để không gửi thư hàng loạt cho lịch sử). Câu `update` backfill trong file chỉ được chạy MỘT lần lúc migrate; đừng chạy lại về sau, vì nó sẽ đánh dấu bỏ qua cả những đăng ký đang chờ gửi.
5. Tạo `mailer/.env` từ `env.example`.
6. Chạy `--dry-run` rồi đối chiếu thư in ra. Đăng ký thử một chiến dịch bằng tài khoản thật để có dòng chờ gửi.
7. Chạy `--once` để gửi thật một lần, kiểm tra hộp thư.
8. Chạy liên tục (systemd hoặc tmux/nohup).
9. SAU CÙNG mới deploy frontend mới (merge lên `main`, GitHub Actions tự chạy), bản không còn gọi webhook n8n.

Vì sao migration và mailer phải đi TRƯỚC frontend mới: frontend mới không còn gọi webhook, nên từ lúc nó lên production, mọi đăng ký chỉ có thư nếu mailer đã chạy. Nếu deploy frontend trước rồi mới chạy migration, các đăng ký phát sinh giữa hai thời điểm đó sẽ bị backfill đánh dấu "đã gửi" và không bao giờ có thư. Đánh đổi của thứ tự đúng: trong khoảng giữa bước 4 và bước 9, frontend cũ vẫn gọi webhook cũ (đã tắt ở bước 1) nên chỉ có thư của mailer, không có thư trùng.

Nếu lỡ làm ngược (hoặc có đăng ký bị bỏ sót vì lý do khác), gửi bù thủ công cho các dòng đó bằng cách đưa chúng về trạng thái chờ gửi trong SQL Editor; mailer sẽ gửi ở vòng kế tiếp. Xác định các dòng bị sót bằng `created_at` (sau thời điểm deploy frontend mới, trước thời điểm chạy migration):

```sql
select id, user_id, campaign_key, created_at
from public.campaign_registrations
where status = 'registered' and created_at >= '<thời điểm deploy frontend mới>'
order by created_at;

update public.campaign_registrations
set confirmation_email_sent_at = null, confirmation_email_attempts = 0, confirmation_email_error = null
where id in ('<id 1>', '<id 2>');
```

Chỉ liệt kê đúng các `id` cần gửi bù. Tuyệt đối không chạy lại câu `update ... set confirmation_email_sent_at = now()` của migration.

## Bảo mật

- `SUPABASE_SERVICE_KEY` và `SMTP_PASSWORD` chỉ nằm ở máy chạy mailer (`mailer/.env`, `chmod 600`), không đưa vào frontend, git, workflow hay chat.
- Địa chỉ nhận lấy từ Supabase Auth, không từ dữ liệu người dùng nhập hay bảng `profiles`.
- Mọi UUID được kiểm tra trước khi ghép vào URL REST (chống chèn bộ lọc PostgREST). Giá trị chèn vào HTML được escape, liên kết chỉ nhận http/https, tiêu đề thư được làm sạch xuống dòng.
- Policy INSERT `registrations_create` (tạo lại trong migration `20261123000000`) buộc người dùng thường để các cột `confirmation_email_*` ở giá trị mặc định (chưa gửi, 0 lần thử, không có lỗi) và chỉ cho `created_at` nằm trong khoảng từ 1 ngày trước tới 1 phút sau (không chen lên đầu hàng đợi bằng dòng giả cũ); cột `confirmation_email_attempts` có ràng buộc `>= 0`. UPDATE chỉ dành cho admin và `service_role`.
- `confirmation_email_error` chỉ chứa mã lỗi ngắn vì chính người đăng ký đọc được hàng của mình; chi tiết lỗi chỉ nằm trong log của mailer.
- `SMTP_SECURITY=none` kèm đăng nhập chỉ được phép với SMTP máy cục bộ (mật khẩu không đi qua mạng dạng rõ).
- Các bảng thông báo chỉ cho admin ĐỌC (RLS), mọi ghi đi qua RPC `security definer` chỉ cấp cho `service_role`; không RPC nào trả địa chỉ email, và mọi RPC kiểm `p_admin_id` là admin thật trong `profiles` cùng với quyền sở hữu thread.
- Nội dung thông báo là văn bản thuần, được escape hoàn toàn khi dựng HTML; tiêu đề được làm sạch xuống dòng; địa chỉ nhận lấy từ Supabase Auth.

## Kiểm thử

```bash
cd mailer
python3 -m unittest -v
```
