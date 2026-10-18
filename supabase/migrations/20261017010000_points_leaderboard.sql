-- Public, privacy-safe point leaderboards. Only display data is exposed.
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
stable
security definer
set search_path = public
as $$
  with scores as (
    select
      profile.id,
      coalesce(nullif(profile.full_name, ''), 'Thành viên Hà Nội Xanh') as display_name,
      profile.avatar_url,
      case
        when period_key = 'all' then profile.points_balance
        else coalesce(sum(
          case
            when registration.status = 'attended'
              and (
                (period_key = 'month'
                  and coalesce(registration.attended_at, registration.created_at) >= date_trunc('month', now())
                  and coalesce(registration.attended_at, registration.created_at) < date_trunc('month', now()) + interval '1 month')
                or
                (period_key = 'year'
                  and coalesce(registration.attended_at, registration.created_at) >= date_trunc('year', now())
                  and coalesce(registration.attended_at, registration.created_at) < date_trunc('year', now()) + interval '1 year')
              )
            then registration.awarded_points
            else 0
          end
        ), 0)::bigint
      end as points
    from public.profiles as profile
    left join public.campaign_registrations as registration on registration.user_id = profile.id
    group by profile.id, profile.full_name, profile.avatar_url, profile.points_balance
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
