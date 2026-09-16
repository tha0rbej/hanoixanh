-- Editable content for the community impact page.
create extension if not exists pgcrypto;

create table if not exists public.homepage_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null unique,
  metric_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.homepage_metrics enable row level security;
grant select on table public.homepage_metrics to anon, authenticated;
grant insert, update, delete on table public.homepage_metrics to authenticated;

drop policy if exists homepage_metrics_public_read on public.homepage_metrics;
create policy homepage_metrics_public_read
  on public.homepage_metrics for select
  to anon, authenticated
  using (true);

drop policy if exists homepage_metrics_admin_write on public.homepage_metrics;
create policy homepage_metrics_admin_write
  on public.homepage_metrics for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.homepage_metrics (metric_key, metric_value) values
  ('overview', '{"campaigns":230,"volunteers":85000,"trash_tons":350,"cleanup_points":120,"cleaned_km":50}'::jsonb),
  ('monthly_waste', '{"2026-05":35,"2026-06":52,"2026-07":110,"2026-08":40,"2026-09":65}'::jsonb),
  ('before_after', '[{"title":"Dự án 1 – Chợ Tứ Liên (Tây Hồ)","description":"Mương nước ngập rác sinh hoạt dày đặc → Đã khơi thông dòng chảy hoàn toàn.","before_url":"Picture1.jpg","after_url":"Picture2.jpg"},{"title":"Dự án 2 – Ngõ 236 Âu Cơ, Hồng Hà","description":"Nước dềnh ngập rác tràn vào ngõ → Đã thu gom và khử khuẩn lối đi an toàn.","before_url":"Picture3.jpg","after_url":"Picture4.jpg"},{"title":"Dự án 3 – Bãi bồi Cầu Long Biên","description":"Hàng tấn phế thải trong bãi cỏ → Tình nguyện viên đã thu gom và làm sạch.","before_url":"Picture5.jpg","after_url":"Picture6.jpg"}]'::jsonb)
on conflict (metric_key) do nothing;

-- Ask PostgREST to pick up a newly-created table immediately.
notify pgrst, 'reload schema';
