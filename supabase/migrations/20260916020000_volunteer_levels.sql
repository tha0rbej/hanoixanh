-- Verified volunteer participation data used to calculate account levels.
alter table public.campaign_registrations
  add column if not exists attended_hours numeric(8,2) not null default 0,
  add column if not exists trash_kg numeric(10,2) not null default 0,
  add column if not exists attended_at timestamptz;

comment on column public.campaign_registrations.attended_hours is 'Hours verified by an admin after the campaign';
comment on column public.campaign_registrations.trash_kg is 'Individual attributed waste in kilograms, verified by an admin';

notify pgrst, 'reload schema';
