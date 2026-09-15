-- Hà Nội Xanh: Auth, nghiệp vụ và RLS
create extension if not exists pgcrypto;

do $$ begin create type public.user_role as enum ('user', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.content_status as enum ('draft', 'published'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  avatar_url text,
  role public.user_role not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(), title text not null, description text not null default '',
  image_url text, status text not null default 'upcoming' check (status in ('upcoming','completed')),
  start_at timestamptz not null, end_at timestamptz, location text not null default '',
  latitude double precision, longitude double precision, capacity integer, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table if not exists public.campaign_registrations (
  id uuid primary key default gen_random_uuid(), campaign_id uuid references public.campaigns(id) on delete cascade,
  campaign_key text, user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered','cancelled','attended')),
  created_at timestamptz not null default now(), unique (campaign_id, user_id), unique (campaign_key, user_id)
);

create table if not exists public.pollution_reports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  location_name text, address text not null, latitude double precision, longitude double precision,
  description text not null, photo_url text, severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'new' check (status in ('new','verifying','resolved','rejected')),
  admin_note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.pollution_reports add column if not exists photo_urls jsonb not null default '[]'::jsonb;

create table if not exists public.cleanup_points (
  id uuid primary key default gen_random_uuid(), name text not null, address text not null,
  latitude double precision not null, longitude double precision not null, pollution_level text not null default 'medium',
  description text not null default '', image_url text, status text not null default 'proposed',
  campaign_id uuid references public.campaigns(id) on delete set null, event_date date, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(), title text not null, slug text not null unique,
  content text not null default '', excerpt text not null default '', image_url text, source_name text, source_url text,
  category text not null default 'Báo tin tức', status public.content_status not null default 'draft',
  author_id uuid references public.profiles(id), published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.contact_messages (id uuid primary key default gen_random_uuid(), name text not null default '', email text not null, message text not null, user_id uuid references public.profiles(id) on delete set null, status text not null default 'new', created_at timestamptz not null default now());
create table if not exists public.partners (id uuid primary key default gen_random_uuid(), name text not null, email text, phone text, organization text, status text not null default 'active', created_at timestamptz not null default now());
create table if not exists public.homepage_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null unique,
  metric_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.homepage_metrics (metric_key, metric_value) values
('overview', '{"campaigns":250,"volunteers":1200,"trash_tons":350,"cleaned_km":50}'::jsonb),
('monthly_waste', '{"2026-05":62,"2026-06":78,"2026-07":84,"2026-08":71,"2026-09":55}'::jsonb),
('impact_tiers', '[{"amount":100000,"text":"Một bộ đồ bảo hộ và găng tay"},{"amount":500000,"text":"Dụng cụ thu gom cho một đội"},{"amount":2000000,"text":"Xử lý rác cho một buổi quy mô lớn"}]'::jsonb)
on conflict (metric_key) do nothing;
create table if not exists public.volunteer_registrations (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, name text not null, email text not null, phone text, created_at timestamptz not null default now());
insert into public.posts (title, slug, content, excerpt, image_url, source_name, source_url, category, status, published_at)
select seed.title, seed.slug, seed.content, seed.excerpt, seed.image_url, seed.source_name, seed.source_url, seed.category, 'published', seed.published_at
from (values
 ('Nhà sáng lập Hà Nội Xanh: Người dân ném rác khi chúng tôi dọn sông Tô Lịch', 'nha-sang-lap-ha-noi-xanh-don-song-to-lich', 'Câu chuyện về hành trình làm sạch các dòng sông Hà Nội, những rủi ro của tình nguyện viên và kế hoạch mở rộng điểm xanh trên toàn thành phố.', 'Câu chuyện thật về hành trình làm sạch các dòng sông Hà Nội.', 'news-hanoi-xanh.png', 'VnExpress', 'https://vnexpress.net', 'Báo tin tức', '2026-09-10'::timestamptz),
 ('Hà Nội khuyến cáo hạn chế ra ngoài khi không khí ô nhiễm', 'ha-noi-khuyen-cao-han-che-ra-ngoai', 'Khuyến cáo bảo vệ sức khỏe trong những ngày chất lượng không khí xuống thấp.', 'Khuyến cáo bảo vệ sức khỏe người dân.', 'news-air-pollution.jpg', 'VnExpress', 'https://vnexpress.net', 'Góc xanh', '2025-12-02'::timestamptz),
 ('Vì sao không khí ở Hà Nội ô nhiễm hơn TP.HCM?', 'vi-sao-khong-khi-ha-noi-o-nhiem', 'Bụi đường, PM10, PM2.5 và điều kiện thời tiết là những nguyên nhân chính.', 'Bụi đường và điều kiện thời tiết là những nguyên nhân chính.', 'news-pm25.webp', 'VietnamPlus', 'https://www.vietnamplus.vn', 'Ấn phẩm', '2025-03-27'::timestamptz),
 ('Bịt mũi đi học, né rác đi làm giữa Hà Nội', 'bit-mui-di-hoc-ne-rac-di-lam', 'Ghi nhận các điểm đổ trộm rác, phế thải xây dựng trên đường phố.', 'Ghi nhận các điểm đổ trộm rác giữa Hà Nội.', 'news-waste-hanoi.jpg', 'VOV', 'https://vov.vn', 'Podcast', '2025-07-17'::timestamptz)
) as seed(title,slug,content,excerpt,image_url,source_name,source_url,category,published_at)
where not exists (select 1 from public.posts p where p.slug = seed.slug);
alter table public.volunteer_registrations enable row level security;
drop policy if exists volunteer_create on public.volunteer_registrations;
create policy volunteer_create on public.volunteer_registrations for insert with check (user_id = auth.uid());
drop policy if exists volunteer_admin_read on public.volunteer_registrations;
create policy volunteer_admin_read on public.volunteer_registrations for select using (public.is_admin() or user_id = auth.uid());
alter table public.campaigns add column if not exists pollution_status text not null default '';
alter table public.campaigns add column if not exists action_plan text not null default '';
alter table public.campaigns add column if not exists support_equipment text not null default '';
create unique index if not exists one_volunteer_registration_per_user on public.campaign_registrations (user_id);
create unique index if not exists one_volunteer_per_email on public.volunteer_registrations (lower(email));
create unique index if not exists one_partner_per_email on public.partners (lower(email)) where email is not null and email <> '';
insert into public.campaigns (title, description, status, start_at, end_at, location, capacity)
select 'Ra quân làm sạch kênh mương - Xanh bầu trời', 'Hưởng ứng Ngày Không khí sạch quốc tế. Vớt bèo tây và rác nhựa khơi thông dòng chảy.', 'upcoming', '2026-09-12 06:15:00+07', '2026-09-12 12:00:00+07', 'Đường CN8, P. Xuân Phương, Hà Nội', 100
where not exists (select 1 from public.campaigns where title = 'Ra quân làm sạch kênh mương - Xanh bầu trời');
insert into public.campaigns (title, description, status, start_at, end_at, location, capacity, image_url)
select * from (values
 ('Dọn dẹp rác đỉnh sau mưa lũ tại Chợ Tứ Liên', 'Sau mưa lớn, rác sinh hoạt tràn vào khu dân cư. Dọn bùn rác và khơi thông lối đi.', 'completed', '2026-07-27 07:00:00+07'::timestamptz, '2026-07-27 12:00:00+07'::timestamptz, 'Chợ Tứ Liên, Tây Hồ, Hà Nội', 45, 'Picture1.jpg'),
 ('Chủ nhật xanh tại Ngõ 236 Âu Cơ', 'Dọn sạch mặt bằng và vận chuyển rác thải xây dựng ven ngõ.', 'completed', '2026-07-12 06:30:00+07'::timestamptz, '2026-07-12 12:00:00+07'::timestamptz, 'Ngõ 236 Âu Cơ, P. Hồng Hà, Hà Nội', 80, 'Picture10.jpg'),
 ('Trục vớt bãi rác tự phát bãi bồi Cầu Long Biên', 'Phát quang và thu gom an toàn rác thải lâu năm.', 'completed', '2026-06-15 07:00:00+07'::timestamptz, '2026-06-15 12:00:00+07'::timestamptz, 'Chân Cầu Long Biên, Hoàn Kiếm', 90, 'Picture9.jpg'),
 ('Chiến dịch Chung tay vì Thủ đô tại Xóm Quán', 'Nạo vét khơi thông dòng chảy và tuyên truyền phân loại rác.', 'completed', '2026-05-31 07:00:00+07'::timestamptz, '2026-05-31 12:00:00+07'::timestamptz, 'Xã Đại Thanh, Hà Nội', 150, 'Picture8.jpg')
) as seed(title,description,status,start_at,end_at,location,capacity,image_url)
where not exists (select 1 from public.campaigns c where c.title = seed.title);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone) values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'phone') on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_registrations enable row level security;
alter table public.pollution_reports enable row level security;
alter table public.cleanup_points enable row level security;
alter table public.posts enable row level security;
alter table public.contact_messages enable row level security;
alter table public.partners enable row level security;
alter table public.homepage_metrics enable row level security;
drop policy if exists homepage_metrics_public_read on public.homepage_metrics;
create policy homepage_metrics_public_read on public.homepage_metrics for select using (true);
drop policy if exists homepage_metrics_admin_write on public.homepage_metrics;
create policy homepage_metrics_admin_write on public.homepage_metrics for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists campaigns_public_read on public.campaigns;
create policy campaigns_public_read on public.campaigns for select using (true);
drop policy if exists campaigns_admin_write on public.campaigns;
create policy campaigns_admin_write on public.campaigns for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists registrations_read on public.campaign_registrations;
create policy registrations_read on public.campaign_registrations for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists registrations_create on public.campaign_registrations;
create policy registrations_create on public.campaign_registrations for insert with check (user_id = auth.uid());
drop policy if exists registrations_admin_write on public.campaign_registrations;
create policy registrations_admin_write on public.campaign_registrations for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists reports_read on public.pollution_reports;
create policy reports_read on public.pollution_reports for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists reports_create on public.pollution_reports;
create policy reports_create on public.pollution_reports for insert with check (user_id = auth.uid());
drop policy if exists reports_admin_write on public.pollution_reports;
create policy reports_admin_write on public.pollution_reports for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists points_public_read on public.cleanup_points;
create policy points_public_read on public.cleanup_points for select using (status in ('verified','in_progress','completed') or public.is_admin());
drop policy if exists points_admin_write on public.cleanup_points;
create policy points_admin_write on public.cleanup_points for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts for select using (status = 'published' or public.is_admin());
drop policy if exists posts_admin_write on public.posts;
create policy posts_admin_write on public.posts for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists contact_messages_create on public.contact_messages;
create policy contact_messages_create on public.contact_messages for insert with check (true);
drop policy if exists contact_messages_admin_read on public.contact_messages;
create policy contact_messages_admin_read on public.contact_messages for select using (public.is_admin());
drop policy if exists contact_messages_admin_write on public.contact_messages;
create policy contact_messages_admin_write on public.contact_messages for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists partners_admin_all on public.partners;
create policy partners_admin_all on public.partners for all using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public) values ('hnx-media', 'hnx-media', true) on conflict (id) do nothing;
drop policy if exists hnx_media_public_read on storage.objects;
create policy hnx_media_public_read on storage.objects for select using (bucket_id = 'hnx-media');
drop policy if exists hnx_media_admin_insert on storage.objects;
create policy hnx_media_admin_insert on storage.objects for insert with check (bucket_id = 'hnx-media' and auth.uid() is not null);
drop policy if exists hnx_media_admin_update on storage.objects;
create policy hnx_media_admin_update on storage.objects for update using (bucket_id = 'hnx-media' and public.is_admin());
