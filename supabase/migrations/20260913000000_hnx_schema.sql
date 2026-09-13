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

insert into storage.buckets (id, name, public) values ('hnx-media', 'hnx-media', true) on conflict (id) do nothing;
drop policy if exists hnx_media_public_read on storage.objects;
create policy hnx_media_public_read on storage.objects for select using (bucket_id = 'hnx-media');
drop policy if exists hnx_media_admin_insert on storage.objects;
create policy hnx_media_admin_insert on storage.objects for insert with check (bucket_id = 'hnx-media' and auth.uid() is not null);
drop policy if exists hnx_media_admin_update on storage.objects;
create policy hnx_media_admin_update on storage.objects for update using (bucket_id = 'hnx-media' and public.is_admin());
