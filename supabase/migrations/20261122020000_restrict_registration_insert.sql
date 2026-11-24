-- Members may only create their own registrations in the initial state.
--
-- The previous INSERT policies only checked user_id = auth.uid(). A member could
-- therefore POST a campaign_registrations row with status = 'attended' and
-- awarded_points = 15000: the AFTER INSERT trigger sync_volunteer_points
-- (security definer) credited the points to profiles.points_balance, and a new
-- campaign_key per request made it repeatable. Attendance, hours, waste weight
-- and points are decided by administrators through UPDATE
-- (registrations_admin_write) and must never be accepted from a member on INSERT.
--
-- WITH CHECK is evaluated against the final row, after column defaults and
-- BEFORE triggers. The frontend sends { user_id, campaign_key, status: 'registered' };
-- the column defaults (awarded_points 0, attended_hours 0, trash_kg 0,
-- attended_at null) satisfy the check, so that flow is unchanged.
-- campaign_id is uuid and campaign_key is text, so each is compared with the
-- matching type of campaigns.id (no cast of campaign_key). When both are sent
-- they must refer to the same campaign. Administrators keep full INSERT rights.
drop policy if exists registrations_create on public.campaign_registrations;
create policy registrations_create on public.campaign_registrations
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      user_id = (select auth.uid())
      and status = 'registered'
      and coalesce(awarded_points, 0) = 0
      and coalesce(attended_hours, 0) = 0
      and coalesce(trash_kg, 0) = 0
      and attended_at is null
      and exists (
        select 1
        from public.campaigns as campaign
        where (campaign_registrations.campaign_id is null or campaign.id = campaign_registrations.campaign_id)
          and (campaign_registrations.campaign_key is null or campaign.id::text = campaign_registrations.campaign_key)
          and (campaign_registrations.campaign_id is not null or campaign_registrations.campaign_key is not null)
      )
    )
  );

-- Pollution reports: members may only file a new, unreviewed report. Status,
-- severity and admin_note are triage fields owned by administrators (who keep
-- full access through reports_admin_write). The frontend always sends
-- status = 'new' and severity = 'medium', which are also the column defaults.
drop policy if exists reports_create on public.pollution_reports;
create policy reports_create on public.pollution_reports
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      user_id = (select auth.uid())
      and status = 'new'
      and severity = 'medium'
      and admin_note is null
    )
  );

-- Review of existing data (run manually; this migration does not change any rows):
--   -- attended rows that match no campaign, or have no attendance time
--   select r.id, r.user_id, r.campaign_id, r.campaign_key, r.awarded_points, r.attended_hours, r.attended_at, r.created_at
--   from public.campaign_registrations as r
--   where r.status = 'attended'
--     and (r.attended_at is null
--          or not exists (select 1 from public.campaigns as c where c.id = r.campaign_id or c.id::text = r.campaign_key));
--   -- balances that differ from attended points minus redeemed points
--   select p.id, p.email, p.points_balance, coalesce(a.points, 0) as attended_points, coalesce(s.points, 0) as spent_points
--   from public.profiles as p
--   left join (select user_id, sum(awarded_points) as points from public.campaign_registrations where status = 'attended' group by user_id) as a on a.user_id = p.id
--   left join (select user_id, sum(points_spent) as points from public.green_redemptions group by user_id) as s on s.user_id = p.id
--   where p.points_balance <> greatest(0, coalesce(a.points, 0) - coalesce(s.points, 0));
