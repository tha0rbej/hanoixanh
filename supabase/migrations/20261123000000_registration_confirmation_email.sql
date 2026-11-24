-- Delivery state for the registration confirmation email.
--
-- The standalone mailer worker (mailer/registration_mailer.py) polls this table
-- for rows with status = 'registered' and confirmation_email_sent_at is null,
-- sends one confirmation email per row, then stamps confirmation_email_sent_at.
-- The worker uses the service_role (Secret) key, which bypasses RLS.
--
-- Column meaning:
--   confirmation_email_sent_at  when the email was handed to the SMTP server (null = not sent yet)
--   confirmation_email_attempts how many row-specific delivery attempts failed so far (permanent failures jump to
--                               the limit; shared outages such as SMTP/Supabase being down are not counted)
--   confirmation_email_error    short error CODE of the last failure, for example smtp_recipient_refused
--                               (never free text: members can read their own row, details go to the mailer log)
alter table public.campaign_registrations
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists confirmation_email_attempts integer not null default 0,
  add column if not exists confirmation_email_error text;

comment on column public.campaign_registrations.confirmation_email_sent_at is 'When the registration confirmation email was sent; null means pending';
comment on column public.campaign_registrations.confirmation_email_attempts is 'Failed delivery attempts of the confirmation email (row-specific failures only)';
comment on column public.campaign_registrations.confirmation_email_error is 'Short error code of the last delivery failure of the confirmation email (see mailer/README.md)';

-- The attempts counter can never be negative (a negative value would keep a row
-- at the head of the mailer queue). Written so that re-running is harmless.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaign_registrations_confirmation_attempts_nonneg'
      and conrelid = 'public.campaign_registrations'::regclass
  ) then
    alter table public.campaign_registrations
      add constraint campaign_registrations_confirmation_attempts_nonneg
      check (confirmation_email_attempts >= 0);
  end if;
end;
$$;

-- One-time backfill: mark every row that exists when this migration runs as
-- "already handled" so the mailer does not send a confirmation email for the
-- whole registration history. Only registrations created after this migration
-- (sent_at stays null) are picked up. Run once, when migrating; do not re-run
-- it later or it would silently skip registrations that are still pending.
-- Rollout order matters: run this migration BEFORE deploying the frontend that
-- no longer calls the old webhook, otherwise registrations made in between are
-- backfilled as "sent" without ever receiving an email (see mailer/README.md
-- for the SQL that re-queues them by hand).
update public.campaign_registrations
set confirmation_email_sent_at = now()
where confirmation_email_sent_at is null;

-- INSERT policy for members, replacing registrations_create from
-- 20261122020000_restrict_registration_insert.sql (that migration runs earlier
-- and the columns below did not exist yet, so it could not check them).
-- The conditions are an exact copy of that policy plus, for the non-admin branch:
--   * confirmation_email_sent_at is null, confirmation_email_attempts = 0 and
--     confirmation_email_error is null: a member cannot pre-mark their row as
--     sent, push the counter to the limit or plant text in the error column;
--   * created_at must be within [now() - 1 day, now() + 1 minute]: the mailer
--     serves the oldest pending rows first (order by created_at), so a back-dated
--     row could jump the queue. The column default is now() (always inside the
--     window) and the frontend does not send created_at; no trigger or function
--     in supabase/migrations inserts into campaign_registrations or depends on a
--     member-chosen created_at. The window only limits how far a member can
--     back-date a row (at most one day); admins are not restricted.
-- Any future migration that recreates this policy must keep these conditions.
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
      and confirmation_email_sent_at is null
      and coalesce(confirmation_email_attempts, 0) = 0
      and confirmation_email_error is null
      and created_at >= now() - interval '1 day'
      and created_at <= now() + interval '1 minute'
      and exists (
        select 1
        from public.campaigns as campaign
        where (campaign_registrations.campaign_id is null or campaign.id = campaign_registrations.campaign_id)
          and (campaign_registrations.campaign_key is null or campaign.id::text = campaign_registrations.campaign_key)
          and (campaign_registrations.campaign_id is not null or campaign_registrations.campaign_key is not null)
      )
    )
  );

-- Partial index: the worker only scans the small set of pending rows.
create index if not exists campaign_registrations_pending_confirmation_idx
  on public.campaign_registrations (created_at)
  where confirmation_email_sent_at is null;

-- Security notes:
--   * registrations_create (recreated above) forces the three confirmation_email_*
--     columns to their defaults and bounds created_at on a member's INSERT, and
--     the check constraint keeps the counter non-negative.
--   * confirmation_email_error is readable by the row's owner (registrations_read),
--     which is why the mailer stores only a short error code, never raw error text.
--   * UPDATE on campaign_registrations is allowed to admins (registrations_admin_write)
--     and service_role only, so members cannot reset or change these columns later.
--   * The recipient address is never stored here; the worker reads it from
--     Supabase Auth (Admin API) at send time.
