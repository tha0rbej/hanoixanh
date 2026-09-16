alter table public.campaigns
  add column if not exists pollution_status text not null default '',
  add column if not exists action_plan text not null default '',
  add column if not exists support_equipment text not null default '';

notify pgrst, 'reload schema';
