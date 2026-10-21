-- Restore profile rows for accounts that existed before the profile trigger
-- was installed. Existing rows are left untouched so admin roles and edits
-- are preserved.
insert into public.profiles (id, email, full_name, phone, avatar_url, role, created_at)
select
  users.id,
  coalesce(users.email, ''),
  coalesce(nullif(users.raw_user_meta_data->>'full_name', ''), nullif(users.raw_user_meta_data->>'name', ''), split_part(coalesce(users.email, ''), '@', 1)),
  users.raw_user_meta_data->>'phone',
  coalesce(users.raw_user_meta_data->>'avatar_url', users.raw_user_meta_data->>'picture'),
  case
    when lower(coalesce(users.raw_user_meta_data->>'role', users.raw_user_meta_data->>'preferred_role', '')) = 'admin' then 'admin'::public.user_role
    else 'user'::public.user_role
  end,
  coalesce(users.created_at, now())
from auth.users as users
where not exists (
  select 1 from public.profiles as profiles where profiles.id = users.id
);

notify pgrst, 'reload schema';
