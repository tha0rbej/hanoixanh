-- Let administrators physically remove a campaign registration. Deleting the
-- row releases the unique (campaign, user) constraint, so the user can register
-- for the same campaign again.
drop policy if exists registrations_admin_delete on public.campaign_registrations;
create policy registrations_admin_delete
on public.campaign_registrations
for delete
using (public.is_admin());
