alter table public.campaigns
  add column if not exists registered_count integer not null default 0;

create or replace function public.refresh_campaign_registered_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.campaigns as campaign
  set registered_count = (
    select count(*)::integer
    from public.campaign_registrations as registration
    where registration.status <> 'cancelled'
      and (
        registration.campaign_id = campaign.id
        or registration.campaign_key = campaign.id::text
      )
  );
  return coalesce(new, old);
end;
$$;

-- Chỉ tạo trigger nếu chưa có. Không xóa trigger hoặc dữ liệu hiện có.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'campaign_registration_counts'
      and tgrelid = 'public.campaign_registrations'::regclass
  ) then
    create trigger campaign_registration_counts
    after insert or update of campaign_id, campaign_key, status or delete
    on public.campaign_registrations
    for each statement execute function public.refresh_campaign_registered_counts();
  end if;
end;
$$;

update public.campaigns as campaign
set registered_count = (
  select count(*)::integer
  from public.campaign_registrations as registration
  where registration.status <> 'cancelled'
    and (
      registration.campaign_id = campaign.id
      or registration.campaign_key = campaign.id::text
    )
);

create or replace function public.get_campaign_registration_counts()
returns table (campaign_id uuid, registered_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select campaign.id,
    count(distinct registration.user_id) filter (where registration.status <> 'cancelled')
  from public.campaigns as campaign
  left join public.campaign_registrations as registration
    on registration.campaign_id = campaign.id
    or registration.campaign_key = campaign.id::text
  group by campaign.id;
$$;

grant execute on function public.get_campaign_registration_counts() to anon, authenticated;
