alter table public.partners
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists organization_type text;

alter table public.partners enable row level security;

drop policy if exists partners_create on public.partners;
create policy partners_create
  on public.partners
  for insert
  with check (user_id = auth.uid());

drop policy if exists partners_admin_read on public.partners;
create policy partners_admin_read
  on public.partners
  for select
  using (public.is_admin() or user_id = auth.uid());

notify pgrst, 'reload schema';
