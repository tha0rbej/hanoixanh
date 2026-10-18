-- Volunteer points, campaign rewards and configurable badge milestones.
alter table public.profiles
  add column if not exists points_balance bigint not null default 0;

alter table public.profiles
  drop constraint if exists profiles_points_balance_nonnegative;
alter table public.profiles
  add constraint profiles_points_balance_nonnegative check (points_balance >= 0);

alter table public.campaigns
  add column if not exists reward_points integer not null default 10000;

alter table public.campaigns
  drop constraint if exists campaigns_reward_points_range;
alter table public.campaigns
  add constraint campaigns_reward_points_range check (reward_points between 10000 and 15000);

alter table public.campaign_registrations
  add column if not exists awarded_points integer not null default 0;

alter table public.campaign_registrations
  drop constraint if exists registrations_awarded_points_range;
alter table public.campaign_registrations
  add constraint registrations_awarded_points_range check (awarded_points = 0 or awarded_points between 10000 and 15000);

-- Credit historic confirmed attendance once when the reward system is introduced.
update public.campaign_registrations as registration
set awarded_points = coalesce((
  select campaign.reward_points
  from public.campaigns as campaign
  where campaign.id::text = coalesce(registration.campaign_id::text, registration.campaign_key)
  limit 1
), 10000)
where registration.status = 'attended'
  and registration.awarded_points = 0;

update public.profiles as profile
set points_balance = coalesce((
  select sum(registration.awarded_points)
  from public.campaign_registrations as registration
  where registration.user_id = profile.id and registration.status = 'attended'
), 0);

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
  if tg_op <> 'INSERT' and old.status = 'attended' then old_points := coalesce(old.awarded_points, 0); end if;
  if tg_op <> 'DELETE' and new.status = 'attended' then new_points := coalesce(new.awarded_points, 0); end if;
  target_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  update public.profiles
  set points_balance = greatest(0, points_balance + new_points - old_points)
  where id = target_user;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sync_volunteer_points_after_change on public.campaign_registrations;
create trigger sync_volunteer_points_after_change
after insert or update of status, awarded_points or delete on public.campaign_registrations
for each row execute function public.sync_volunteer_points();

insert into public.homepage_metrics (metric_key, metric_value)
values (
  'reward_program',
  '{"campaignMinPoints":10000,"campaignMaxPoints":15000,"badges":[{"id":"mam-xanh","name":"Mầm xanh","description":"Hoàn thành chiến dịch đầu tiên","icon":"fa-seedling","minCampaigns":1,"minHours":0,"minActiveMonths":0,"minTenureMonths":0},{"id":"nhip-xanh","name":"Nhịp xanh đều đặn","description":"Tham gia ít nhất 3 chiến dịch trong 2 tháng hoạt động","icon":"fa-calendar-check","minCampaigns":3,"minHours":0,"minActiveMonths":2,"minTenureMonths":0},{"id":"ben-bi","name":"Bền bỉ theo mùa","description":"Hoàn thành 6 chiến dịch, 24 giờ trong 3 tháng hoạt động","icon":"fa-person-hiking","minCampaigns":6,"minHours":24,"minActiveMonths":3,"minTenureMonths":0},{"id":"dong-hanh","name":"Đồng hành dài lâu","description":"Gắn bó 6 tháng, hoàn thành 10 chiến dịch và 40 giờ","icon":"fa-tree","minCampaigns":10,"minHours":40,"minActiveMonths":0,"minTenureMonths":6},{"id":"dai-su","name":"Đại sứ xanh","description":"Gắn bó 1 năm, hoạt động trong 8 tháng, hoàn thành 20 chiến dịch và 100 giờ","icon":"fa-medal","minCampaigns":20,"minHours":100,"minActiveMonths":8,"minTenureMonths":12}]}'::jsonb
)
on conflict (metric_key) do nothing;

notify pgrst, 'reload schema';
