create table if not exists public.volunteer_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

alter table public.volunteer_registrations
  add column if not exists address text;

create unique index if not exists one_volunteer_registration_per_user
  on public.volunteer_registrations (user_id);

create unique index if not exists one_volunteer_registration_per_email
  on public.volunteer_registrations (lower(email));

alter table public.volunteer_registrations enable row level security;

drop policy if exists volunteer_create on public.volunteer_registrations;
create policy volunteer_create
  on public.volunteer_registrations
  for insert
  with check (user_id = auth.uid());

drop policy if exists volunteer_admin_read on public.volunteer_registrations;
create policy volunteer_admin_read
  on public.volunteer_registrations
  for select
  using (public.is_admin() or user_id = auth.uid());

notify pgrst, 'reload schema';
