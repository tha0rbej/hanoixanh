-- The campaign registration count trigger refreshes every campaign so that a
-- campaign whose final registration is deleted is reset to zero. Supabase's
-- safe-update guard requires an explicit WHERE clause for that UPDATE.
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
  )
  where campaign.id is not null;

  -- AFTER STATEMENT triggers ignore the returned row.
  return null;
end;
$$;

notify pgrst, 'reload schema';
