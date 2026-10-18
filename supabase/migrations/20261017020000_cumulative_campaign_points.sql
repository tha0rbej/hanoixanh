-- A volunteer may join many campaigns. The pair constraints on
-- (campaign_id, user_id) and (campaign_key, user_id) still prevent duplicate
-- registration for the same campaign.
drop index if exists public.one_volunteer_registration_per_user;

notify pgrst, 'reload schema';
