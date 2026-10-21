-- A new campaign registration starts with status = 'registered' and zero
-- awarded points. The points trigger previously issued an unnecessary UPDATE
-- against profiles for that insert. Skip the write when the points delta is
-- zero; attendance updates and registration deletes still synchronize points.
create or replace function public.sync_volunteer_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_points integer := 0;
  new_points integer := 0;
  target_user uuid;
begin
  if tg_op <> 'INSERT' and old.status = 'attended' then
    old_points := coalesce(old.awarded_points, 0);
  end if;

  if tg_op <> 'DELETE' and new.status = 'attended' then
    new_points := coalesce(new.awarded_points, 0);
  end if;

  if old_points = new_points then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  target_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;

  update public.profiles
  set points_balance = greatest(0, points_balance + new_points - old_points)
  where id = target_user;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
