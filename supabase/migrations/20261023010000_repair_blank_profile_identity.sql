-- Repair profile rows created with blank identity fields so admin joins remain complete.
update public.profiles as profile
set
  email = coalesce(nullif(trim(profile.email), ''), users.email, ''),
  full_name = coalesce(
    nullif(trim(profile.full_name), ''),
    nullif(users.raw_user_meta_data->>'full_name', ''),
    nullif(users.raw_user_meta_data->>'name', ''),
    split_part(coalesce(users.email, ''), '@', 1)
  )
from auth.users as users
where profile.id = users.id
  and (
    coalesce(trim(profile.email), '') = ''
    or coalesce(trim(profile.full_name), '') = ''
  );

notify pgrst, 'reload schema';
