-- Contact forms are intentionally public: visitors can send a message without
-- creating an account. Dashboard reads remain restricted to admins.
alter table public.contact_messages enable row level security;

grant insert on table public.contact_messages to anon, authenticated;
grant select, update on table public.contact_messages to authenticated;

drop policy if exists contact_messages_create on public.contact_messages;
create policy contact_messages_create
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists contact_messages_admin_read on public.contact_messages;
create policy contact_messages_admin_read
  on public.contact_messages
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists contact_messages_admin_write on public.contact_messages;
create policy contact_messages_admin_write
  on public.contact_messages
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
