-- Keep every leaderboard period in sync with the points balance remaining after redemptions.
create or replace function public.get_points_leaderboard(
  period_key text default 'all',
  row_limit integer default 10
)
returns table (
  rank bigint,
  display_name text,
  avatar_url text,
  points bigint
)
language sql
security definer
set search_path = public
as $$
  with scores as (
    select
      profile.id,
      coalesce(nullif(profile.full_name, ''), 'Thành viên Hà Nội Xanh') as display_name,
      profile.avatar_url,
      greatest(0, coalesce(profile.points_balance, 0))::bigint as points
    from public.profiles as profile
  ),
  ranked as (
    select
      row_number() over (order by scores.points desc, scores.display_name asc) as rank,
      scores.display_name,
      scores.avatar_url,
      scores.points
    from scores
    where scores.points > 0
  )
  select ranked.rank, ranked.display_name, ranked.avatar_url, ranked.points
  from ranked
  order by ranked.rank
  limit greatest(1, least(coalesce(row_limit, 10), 10));
$$;

revoke all on function public.get_points_leaderboard(text, integer) from public;
grant execute on function public.get_points_leaderboard(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
