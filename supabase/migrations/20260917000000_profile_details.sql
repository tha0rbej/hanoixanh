-- Extra fields are intentionally nullable: a new account only contains the
-- information supplied during signup. Members complete these fields themselves.
alter table public.profiles
  add column if not exists birth_date date,
  add column if not exists gender text,
  add column if not exists address text,
  add column if not exists occupation text,
  add column if not exists interests text,
  add column if not exists bio text;

-- Bring across details saved in Auth metadata before these columns existed.
update public.profiles as profile
set
  birth_date = coalesce(profile.birth_date, nullif(auth_user.raw_user_meta_data->>'birth_date', '')::date),
  gender = coalesce(profile.gender, auth_user.raw_user_meta_data->>'gender'),
  address = coalesce(profile.address, auth_user.raw_user_meta_data->>'address'),
  occupation = coalesce(profile.occupation, auth_user.raw_user_meta_data->>'occupation'),
  interests = coalesce(profile.interests, auth_user.raw_user_meta_data->>'interests'),
  bio = coalesce(profile.bio, auth_user.raw_user_meta_data->>'bio')
from auth.users as auth_user
where auth_user.id = profile.id;

-- A member can register for many campaigns; uniqueness is already enforced
-- per (campaign_id, user_id) and per (campaign_key, user_id).
drop index if exists public.one_volunteer_registration_per_user;

notify pgrst, 'reload schema';
