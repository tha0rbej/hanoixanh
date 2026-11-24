-- Prevent members from escalating privileges or editing points through the public API.
-- The profiles_update policy lets a member update their own row, but RLS cannot
-- restrict individual columns, so a plain PATCH could set role = 'admin'.
-- created_at is protected as well: the client derives tenure and badges from it.
-- The function stays security invoker (current_user must be the API role).
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only requests arriving through the public API run as authenticated/anon.
  -- security definer functions (redeem_green_reward, sync_volunteer_points, ...),
  -- the SQL Editor and service_role run as other roles and are not affected.
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.role is distinct from old.role
       or new.points_balance is distinct from old.points_balance
       or new.email is distinct from old.email
       or new.created_at is distinct from old.created_at then
      raise exception 'Không được tự thay đổi vai trò, điểm, email hoặc ngày tạo tài khoản.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on public.profiles;
create trigger protect_profile_privileged_columns
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();
