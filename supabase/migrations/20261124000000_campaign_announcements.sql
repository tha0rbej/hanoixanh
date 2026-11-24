-- Custom announcements sent to everyone registered for a campaign.
--
-- Flow: an admin tells the admin agent what to announce; the agent drafts plain
-- text (upsert_announcement_draft); the admin reads it, may ask for a test mail to
-- themselves (request_announcement_test) and confirms in a LATER message
-- (approve_announcement). Approval freezes the content and snapshots the
-- recipients. The standalone mailer worker (mailer/, no LLM, no n8n) then sends one
-- personalised mail per recipient and records the result per recipient, so a
-- restart never re-sends and never skips anybody.
--
-- MUST run AFTER 20261119000000_admin_agent.sql (agent_threads) and
-- 20261123000000_registration_confirmation_email.sql.
--
-- ===========================================================================
-- CONTRACT (every function below is SECURITY DEFINER, EXECUTE only for
-- service_role; none returns an e-mail address; every function returns jsonb
-- with a "status" field; the caller never sees a raw SQL error for business rules)
-- ===========================================================================
--
-- Common status codes:
--   invalid_input   a required argument is null or malformed ("field" names it)
--   forbidden       p_admin_id is not an admin in public.profiles, or the thread
--                   does not belong to that admin (never trusted from the caller)
--   not_found       announcement does not exist in that thread
--
-- Admin agent side (n8n tools). All take p_thread_id + p_admin_id taken from the
-- server-side workflow state, never from the model output:
--
--   find_announcement_campaigns(p_query text, p_limit int default 5)
--     -> {status:'ok', campaigns:[{id,title,start_at,end_at,location,campaign_status,registrant_count}]}
--        Title search (ilike, % and _ escaped), upcoming events first (soonest
--        first), then past events (latest first). p_limit is capped at 10.
--        Empty p_query lists events without a title filter. Matching is not
--        accent-insensitive.
--
--   announcement_campaign_registrants(p_campaign_id uuid)
--     -> {status:'ok', campaign:{id,title,start_at,end_at,location}, registrant_count,
--         max_recipients, sample_names:[up to 3 abbreviated names, e.g. "Nguyễn V. A."]}
--        | {status:'campaign_not_found'}
--        registrant = distinct user with a registration whose status <> 'cancelled'
--        (matched by campaign_id or campaign_key = campaign id as text).
--
--   upsert_announcement_draft(p_thread_id, p_admin_id, p_campaign_id, p_subject, p_body)
--     -> {status:'ok', created:bool, unchanged:bool, announcement:{...see get_announcement}}
--        | campaign_not_found | version_limit (50 versions per announcement)
--        | invalid_input {field:'subject'|'body', reason:'empty'|'too_long', max}
--        One open draft per (thread, campaign): calling again with different text
--        creates version+1 (and clears any test request); identical text changes
--        nothing. If the previous announcement of that campaign is already approved,
--        sending, sent or cancelled, a NEW announcement is created. Subject: control
--        characters / line breaks become spaces, max 150 chars. Body: plain text,
--        max 5000 chars.
--
--   get_announcement(p_thread_id uuid, p_announcement_id uuid default null)
--     -> {status:'ok', announcement:{id,status,version,subject,body_text,campaign:{...},
--         registrant_count,
--         test:{state:'none'|'pending'|'sent'|'failed', requested_version, requested_at,
--               sent_at, error_code},
--         approved_version, approved_at, recipient_count,
--         progress:{pending,sent,failed,skipped}, updated_at}}
--        p_announcement_id null = latest announcement of the thread. The thread must match.
--        announcement.status: draft | approved | sending | sent | cancelled.
--
--   request_announcement_test(p_thread_id, p_admin_id, p_announcement_id, p_version)
--     -> {status:'queued', version, tests_left_this_hour} | not_found | forbidden
--        | not_draft {announcement_status} | version_mismatch {current_version}
--        | rate_limited {retry_after_seconds}
--        The mailer sends the draft to the e-mail of p_admin_id within one poll
--        interval. Limit: 5 requests per fixed 1-hour window per announcement
--        (window start and counter live on the announcement row and are NOT reset
--        by editing the draft).
--
--   approve_announcement(p_thread_id, p_admin_id, p_announcement_id, p_version,
--                        p_confirmation_text text, p_turn_started_at timestamptz)
--     -> {status:'approved', announcement_id, version, recipient_count}
--        | already_approved {announcement_status, version, recipient_count}   (idempotent)
--        | version_mismatch {current_version} | cancelled
--        | confirmation_required   (p_confirmation_text empty)
--        | needs_admin_review      (this version was created at or after the start of the
--                                   current turn, i.e. the admin has not had a chance to
--                                   read it in an earlier turn. The start of the turn is
--                                   taken by the DATABASE clock from the newest 'user'
--                                   message of the thread in agent_messages (written by
--                                   prepare_admin_agent_turn before the Agent runs);
--                                   p_turn_started_at is only a fallback when the thread
--                                   has no user message)
--        | no_recipients | too_many_recipients {count, max}  (nothing approved)
--        Atomic: locks the row, freezes the content, snapshots the recipients.
--
--   cancel_announcement(p_thread_id, p_admin_id, p_announcement_id)
--     -> {status:'cancelled', skipped, sent_count} | already_sent | already_cancelled
--        Pending recipients become 'skipped'; mail already sent cannot be recalled. The
--        mailer asks begin_announcement_send before every mail, so after a cancel at most
--        ONE mail (the one already being handed to SMTP) can still go out.
--
-- Mailer side (service_role, called by mailer/announcements.py):
--   claim_announcement_tests(p_limit int default 5)               read-only list
--   mark_announcement_test_sent(p_announcement_id, p_version)
--   mark_announcement_test_failed(p_announcement_id, p_version, p_error_code, p_permanent)
--   claim_announcement_recipients(p_limit, p_max_attempts, p_lease_seconds)  leases rows
--   preview_announcement_recipients(p_limit int default 5)        read-only (--dry-run)
--   begin_announcement_send(p_recipient_id, p_lease_seconds int default 300)
--        -> {status:'ok'} | {status:'skip', reason:'cancelled'|'not_pending'|'lease_lost'|'announcement_not_active'}
--        Called right before EACH real mail. 'skip' = do not send (nothing is changed).
--        'ok' extends the lease so the row is not re-claimed while the mail is on its way.
--   mark_announcement_recipient(p_recipient_id, p_status, p_error_code, p_count_attempt, p_max_attempts)
--   release_announcement_recipients(p_recipient_ids uuid[])
--   mail_sent_count_between(p_from timestamptz, p_to timestamptz)  daily quota accounting
--
-- Security notes:
--   * All three tables have RLS enabled with a SELECT policy for admins only; there
--     is no INSERT/UPDATE/DELETE policy and write privileges are revoked, so every
--     change goes through the functions above (service_role).
--   * recipients stores user_id only; the address is read from Supabase Auth by the
--     mailer at send time. error_code columns hold short codes, never raw errors.
--   * UNIQUE (announcement_id, user_id) on recipients makes a second mail to the same
--     person for the same announcement impossible at the database level.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.campaign_announcements (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.agent_threads(id) on delete set null,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 150 and subject !~ '[\r\n]'),
  body_text text not null check (char_length(body_text) between 1 and 5000),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sending', 'sent', 'cancelled')),
  -- Test mail to the requesting admin (cleared whenever a new version is saved).
  test_requested_version integer,
  test_requested_at timestamptz,
  test_requested_by uuid references public.profiles(id) on delete set null,
  test_attempts integer not null default 0 check (test_attempts >= 0),
  test_sent_at timestamptz,
  test_sent_version integer,
  test_failed_at timestamptz,
  test_error_code text,
  -- Fixed one-hour window used to rate-limit test requests (not cleared by edits).
  test_window_started_at timestamptz,
  test_window_count integer not null default 0 check (test_window_count >= 0),
  -- Approval.
  approved_version integer,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  approval_text text,
  cancelled_at timestamptz,
  -- Progress (recomputed from recipients on every change).
  recipient_count integer not null default 0 check (recipient_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaign_announcements_campaign_status_idx
  on public.campaign_announcements (campaign_id, status);
create index if not exists campaign_announcements_active_idx
  on public.campaign_announcements (status) where status in ('approved', 'sending');
create index if not exists campaign_announcements_thread_idx
  on public.campaign_announcements (thread_id, updated_at desc);
-- One open draft per thread and campaign (backstop for the advisory lock in upsert_announcement_draft).
create unique index if not exists campaign_announcements_one_draft_idx
  on public.campaign_announcements (thread_id, campaign_id) where status = 'draft' and thread_id is not null;

create table if not exists public.campaign_announcement_versions (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.campaign_announcements(id) on delete cascade,
  version integer not null check (version > 0),
  subject text not null,
  body_text text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (announcement_id, version)
);

create table if not exists public.campaign_announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.campaign_announcements(id) on delete cascade,
  registration_id uuid references public.campaign_registrations(id) on delete set null,
  user_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  sent_at timestamptz,
  -- Lease so a crashed mailer never leaves a row stuck: a pending row is claimable
  -- when claimed_until is null or in the past.
  claimed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

create index if not exists campaign_announcement_recipients_status_idx
  on public.campaign_announcement_recipients (announcement_id, status);
create index if not exists campaign_announcement_recipients_sent_at_idx
  on public.campaign_announcement_recipients (sent_at) where status = 'sent';

comment on table public.campaign_announcements is 'Custom announcements to all registrants of a campaign. Written only through the announcement RPCs (service_role).';
comment on table public.campaign_announcement_versions is 'Content history of announcements; one row per saved version.';
comment on table public.campaign_announcement_recipients is 'One row per person per announcement (unique), snapshotted at approval. Holds user_id only, never an e-mail address.';
comment on column public.campaign_announcement_recipients.error_code is 'Short error code of the last failure (see mailer/README.md), never raw error text';
comment on column public.campaign_announcement_recipients.claimed_until is 'Lease expiry set by claim_announcement_recipients';

-- ---------------------------------------------------------------------------
-- RLS: admins may read; nobody but service_role / the RPCs may write
-- ---------------------------------------------------------------------------

alter table public.campaign_announcements enable row level security;
alter table public.campaign_announcement_versions enable row level security;
alter table public.campaign_announcement_recipients enable row level security;

drop policy if exists campaign_announcements_admin_read on public.campaign_announcements;
create policy campaign_announcements_admin_read on public.campaign_announcements
  for select to authenticated using (public.is_admin());
drop policy if exists campaign_announcement_versions_admin_read on public.campaign_announcement_versions;
create policy campaign_announcement_versions_admin_read on public.campaign_announcement_versions
  for select to authenticated using (public.is_admin());
drop policy if exists campaign_announcement_recipients_admin_read on public.campaign_announcement_recipients;
create policy campaign_announcement_recipients_admin_read on public.campaign_announcement_recipients
  for select to authenticated using (public.is_admin());

revoke all on public.campaign_announcements from anon, authenticated;
revoke all on public.campaign_announcement_versions from anon, authenticated;
revoke all on public.campaign_announcement_recipients from anon, authenticated;
grant select on public.campaign_announcements to authenticated;
grant select on public.campaign_announcement_versions to authenticated;
grant select on public.campaign_announcement_recipients to authenticated;
grant all on public.campaign_announcements to service_role;
grant all on public.campaign_announcement_versions to service_role;
grant all on public.campaign_announcement_recipients to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (not granted to API roles)
-- ---------------------------------------------------------------------------

create or replace function public.announcement_max_recipients()
returns integer
language sql
immutable
as $$
  select 1000;
$$;

-- True only for a real admin profile; the parameter of every RPC is checked with this.
create or replace function public.announcement_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and exists (select 1 from public.profiles where id = p_user_id and role = 'admin');
$$;

create or replace function public.announcement_owns_thread(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_thread_id is not null
    and p_user_id is not null
    and exists (select 1 from public.agent_threads where id = p_thread_id and created_by = p_user_id);
$$;

-- Distinct people with a non-cancelled registration for the campaign.
create or replace function public.announcement_registrant_count(p_campaign_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct r.user_id)::integer
  from public.campaign_registrations as r
  where r.status <> 'cancelled'
    and (r.campaign_id = p_campaign_id or r.campaign_key = p_campaign_id::text);
$$;

-- "Nguyễn Văn An" -> "Nguyễn V. A."; a single word -> "A."; blank -> null. Never exposes the full name.
create or replace function public.announcement_short_name(p_full_name text)
returns text
language sql
immutable
as $$
  select case
    when s.parts is null or s.parts[1] is null or s.parts[1] = '' then null
    when cardinality(s.parts) = 1 then upper(left(s.parts[1], 1)) || '.'
    else s.parts[1] || ' ' || (
      select string_agg(upper(left(t.part, 1)) || '.', ' ' order by t.ord)
      from unnest(s.parts[2:]) with ordinality as t(part, ord)
    )
  end
  from (select regexp_split_to_array(btrim(coalesce(p_full_name, '')), '\s+') as parts) as s;
$$;

-- Recomputes counters from recipients and moves approved/sending announcements
-- with nothing left pending to 'sent'. Returns the resulting announcement status.
create or replace function public.announcement_refresh_progress(p_announcement_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  update public.campaign_announcements as a
  set sent_count = (select count(*) from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'sent'),
      failed_count = (select count(*) from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'failed'),
      status = case
        when a.status in ('approved', 'sending')
          and not exists (select 1 from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'pending')
        then 'sent'
        else a.status
      end,
      updated_at = now()
  where a.id = p_announcement_id
  returning a.status into v_status;
  return v_status;
end;
$$;

-- Full JSON view of one announcement (used by upsert/get). No e-mail addresses.
create or replace function public.announcement_to_json(p_announcement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.campaign_announcements;
  k public.campaigns;
  v_test_state text;
begin
  select * into a from public.campaign_announcements where id = p_announcement_id;
  if not found then
    return null;
  end if;
  select * into k from public.campaigns where id = a.campaign_id;

  v_test_state := case
    when a.test_requested_at is null or a.test_requested_version is distinct from a.version then 'none'
    when a.test_sent_at is not null and a.test_sent_at >= a.test_requested_at then 'sent'
    when a.test_failed_at is not null and a.test_failed_at >= a.test_requested_at then 'failed'
    else 'pending'
  end;

  return jsonb_build_object(
    'id', a.id,
    'status', a.status,
    'version', a.version,
    'subject', a.subject,
    'body_text', a.body_text,
    'campaign', jsonb_build_object('id', k.id, 'title', k.title, 'start_at', k.start_at, 'end_at', k.end_at, 'location', k.location),
    'registrant_count', public.announcement_registrant_count(a.campaign_id),
    'test', jsonb_build_object(
      'state', v_test_state,
      'requested_version', a.test_requested_version,
      'requested_at', a.test_requested_at,
      'sent_at', a.test_sent_at,
      'error_code', case when v_test_state = 'failed' then a.test_error_code else null end
    ),
    'approved_version', a.approved_version,
    'approved_at', a.approved_at,
    'recipient_count', a.recipient_count,
    'progress', jsonb_build_object(
      'pending', (select count(*) from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'pending'),
      'sent', (select count(*) from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'sent'),
      'failed', (select count(*) from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'failed'),
      'skipped', (select count(*) from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'skipped')
    ),
    'updated_at', a.updated_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: lookups for the agent
-- ---------------------------------------------------------------------------

create or replace function public.find_announcement_campaigns(p_query text, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_pattern text;
  v_items jsonb;
begin
  if char_length(v_query) > 100 then
    return jsonb_build_object('status', 'invalid_input', 'field', 'query', 'reason', 'too_long', 'max', 100);
  end if;
  -- Escape LIKE metacharacters so the admin's text is matched literally.
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select coalesce(jsonb_agg(x.item order by x.is_past, x.upcoming_key, x.past_key desc), '[]'::jsonb)
  into v_items
  from (
    select
      (c.start_at < now()) as is_past,
      case when c.start_at >= now() then c.start_at end as upcoming_key,
      c.start_at as past_key,
      jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'start_at', c.start_at,
        'end_at', c.end_at,
        'location', c.location,
        'campaign_status', c.status,
        'registrant_count', public.announcement_registrant_count(c.id)
      ) as item
    from public.campaigns as c
    where v_query = '' or c.title ilike v_pattern escape '\'
    order by (c.start_at < now()), case when c.start_at >= now() then c.start_at end, c.start_at desc
    limit v_limit
  ) as x;

  return jsonb_build_object('status', 'ok', 'campaigns', v_items);
end;
$$;

create or replace function public.announcement_campaign_registrants(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k public.campaigns;
  v_names jsonb;
begin
  if p_campaign_id is null then
    return jsonb_build_object('status', 'invalid_input', 'field', 'campaign_id');
  end if;
  select * into k from public.campaigns where id = p_campaign_id;
  if not found then
    return jsonb_build_object('status', 'campaign_not_found');
  end if;

  select coalesce(jsonb_agg(s.short_name order by s.first_at, s.user_id), '[]'::jsonb)
  into v_names
  from (
    select u.user_id, u.first_at, public.announcement_short_name(p.full_name) as short_name
    from (
      select r.user_id, min(r.created_at) as first_at
      from public.campaign_registrations as r
      where r.status <> 'cancelled'
        and (r.campaign_id = p_campaign_id or r.campaign_key = p_campaign_id::text)
      group by r.user_id
    ) as u
    join public.profiles as p on p.id = u.user_id
    where public.announcement_short_name(p.full_name) is not null
    order by u.first_at, u.user_id
    limit 3
  ) as s;

  return jsonb_build_object(
    'status', 'ok',
    'campaign', jsonb_build_object('id', k.id, 'title', k.title, 'start_at', k.start_at, 'end_at', k.end_at, 'location', k.location),
    'registrant_count', public.announcement_registrant_count(p_campaign_id),
    'max_recipients', public.announcement_max_recipients(),
    'sample_names', v_names
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: draft, read, test, approve, cancel (admin agent)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_announcement_draft(
  p_thread_id uuid,
  p_admin_id uuid,
  p_campaign_id uuid,
  p_subject text,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_body text;
  a public.campaign_announcements;
  v_created boolean := false;
  v_unchanged boolean := false;
begin
  if p_thread_id is null or p_admin_id is null or p_campaign_id is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  if not public.announcement_is_admin(p_admin_id) or not public.announcement_owns_thread(p_thread_id, p_admin_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not exists (select 1 from public.campaigns where id = p_campaign_id) then
    return jsonb_build_object('status', 'campaign_not_found');
  end if;

  -- Subject is one line: control characters and runs of whitespace become one space.
  v_subject := btrim(regexp_replace(coalesce(p_subject, ''), '[[:cntrl:][:space:]]+', ' ', 'g'));
  v_body := btrim(replace(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n'));
  if v_subject = '' then
    return jsonb_build_object('status', 'invalid_input', 'field', 'subject', 'reason', 'empty');
  end if;
  if char_length(v_subject) > 150 then
    return jsonb_build_object('status', 'invalid_input', 'field', 'subject', 'reason', 'too_long', 'max', 150);
  end if;
  if v_body = '' then
    return jsonb_build_object('status', 'invalid_input', 'field', 'body', 'reason', 'empty');
  end if;
  if char_length(v_body) > 5000 then
    return jsonb_build_object('status', 'invalid_input', 'field', 'body', 'reason', 'too_long', 'max', 5000);
  end if;

  -- Serialise concurrent saves of the same (thread, campaign) draft.
  perform pg_advisory_xact_lock(hashtextextended(p_thread_id::text || ':' || p_campaign_id::text, 0));

  select * into a
  from public.campaign_announcements
  where thread_id = p_thread_id and campaign_id = p_campaign_id and status = 'draft'
  order by updated_at desc
  limit 1
  for update;

  if found then
    if a.subject = v_subject and a.body_text = v_body then
      v_unchanged := true;
    elsif a.version >= 50 then
      return jsonb_build_object('status', 'version_limit', 'max', 50);
    else
      update public.campaign_announcements
      set subject = v_subject,
          body_text = v_body,
          version = a.version + 1,
          test_requested_version = null,
          test_requested_at = null,
          test_requested_by = null,
          test_attempts = 0,
          test_sent_at = null,
          test_sent_version = null,
          test_failed_at = null,
          test_error_code = null,
          updated_at = now()
      where id = a.id
      returning * into a;
      insert into public.campaign_announcement_versions (announcement_id, version, subject, body_text, created_by)
      values (a.id, a.version, v_subject, v_body, p_admin_id);
    end if;
  else
    insert into public.campaign_announcements (thread_id, campaign_id, created_by, subject, body_text)
    values (p_thread_id, p_campaign_id, p_admin_id, v_subject, v_body)
    returning * into a;
    insert into public.campaign_announcement_versions (announcement_id, version, subject, body_text, created_by)
    values (a.id, a.version, v_subject, v_body, p_admin_id);
    v_created := true;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'created', v_created,
    'unchanged', v_unchanged,
    'announcement', public.announcement_to_json(a.id)
  );
end;
$$;

create or replace function public.get_announcement(
  p_thread_id uuid,
  p_announcement_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_thread_id is null then
    return jsonb_build_object('status', 'invalid_input', 'field', 'thread_id');
  end if;
  if p_announcement_id is null then
    select id into v_id
    from public.campaign_announcements
    where thread_id = p_thread_id
    order by updated_at desc
    limit 1;
  else
    select id into v_id
    from public.campaign_announcements
    where id = p_announcement_id and thread_id = p_thread_id;
  end if;
  if v_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok', 'announcement', public.announcement_to_json(v_id));
end;
$$;

create or replace function public.request_announcement_test(
  p_thread_id uuid,
  p_admin_id uuid,
  p_announcement_id uuid,
  p_version integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_per_window constant integer := 5;
  a public.campaign_announcements;
  v_window_start timestamptz;
  v_window_count integer;
begin
  if p_thread_id is null or p_admin_id is null or p_announcement_id is null or p_version is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  if not public.announcement_is_admin(p_admin_id) or not public.announcement_owns_thread(p_thread_id, p_admin_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into a
  from public.campaign_announcements
  where id = p_announcement_id and thread_id = p_thread_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if a.status <> 'draft' then
    return jsonb_build_object('status', 'not_draft', 'announcement_status', a.status);
  end if;
  if a.version <> p_version then
    return jsonb_build_object('status', 'version_mismatch', 'current_version', a.version);
  end if;

  if a.test_window_started_at is null or a.test_window_started_at < now() - interval '1 hour' then
    v_window_start := now();
    v_window_count := 0;
  else
    v_window_start := a.test_window_started_at;
    v_window_count := a.test_window_count;
  end if;
  if v_window_count >= c_max_per_window then
    return jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_window_start + interval '1 hour' - now())))::integer)
    );
  end if;

  update public.campaign_announcements
  set test_requested_version = a.version,
      test_requested_at = now(),
      test_requested_by = p_admin_id,
      test_attempts = 0,
      test_failed_at = null,
      test_error_code = null,
      test_window_started_at = v_window_start,
      test_window_count = v_window_count + 1,
      updated_at = now()
  where id = a.id;

  return jsonb_build_object('status', 'queued', 'version', a.version, 'tests_left_this_hour', c_max_per_window - v_window_count - 1);
end;
$$;

create or replace function public.approve_announcement(
  p_thread_id uuid,
  p_admin_id uuid,
  p_announcement_id uuid,
  p_version integer,
  p_confirmation_text text,
  p_turn_started_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.campaign_announcements;
  v_version_created_at timestamptz;
  v_turn_started_at timestamptz;
  v_registrants integer;
  v_recipients integer;
begin
  if p_thread_id is null or p_admin_id is null or p_announcement_id is null or p_version is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  if not public.announcement_is_admin(p_admin_id) or not public.announcement_owns_thread(p_thread_id, p_admin_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select * into a
  from public.campaign_announcements
  where id = p_announcement_id and thread_id = p_thread_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Idempotent: a repeated approval of the same version is not an error.
  if a.status in ('approved', 'sending', 'sent') then
    if a.approved_version = p_version then
      return jsonb_build_object(
        'status', 'already_approved',
        'announcement_status', a.status,
        'version', a.approved_version,
        'recipient_count', a.recipient_count
      );
    end if;
    return jsonb_build_object('status', 'version_mismatch', 'current_version', a.approved_version);
  end if;
  if a.status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled');
  end if;
  if a.version <> p_version then
    return jsonb_build_object('status', 'version_mismatch', 'current_version', a.version);
  end if;
  if p_confirmation_text is null or btrim(p_confirmation_text) = '' then
    return jsonb_build_object('status', 'confirmation_required');
  end if;

  -- Start of the current turn by the DATABASE clock: prepare_admin_agent_turn stores the
  -- admin's message (role 'user') in agent_messages at the start of every turn, before the
  -- Agent runs, so the newest user message of the thread marks the start of this turn.
  -- Both sides of the comparison below then come from the same (Postgres) clock; the
  -- n8n clock behind p_turn_started_at can be ahead of the database and let a draft
  -- created in this very turn slip through. p_turn_started_at is only used when the
  -- thread has no user message at all. If the message was a duplicate (same
  -- client_message_id, not stored again) the mark is the older message, which is the
  -- safe direction: drafts made since then need a review.
  select max(m.created_at) into v_turn_started_at
  from public.agent_messages as m
  where m.thread_id = p_thread_id and m.role = 'user';
  v_turn_started_at := coalesce(v_turn_started_at, p_turn_started_at);
  if v_turn_started_at is null then
    return jsonb_build_object('status', 'invalid_input', 'field', 'turn_started_at');
  end if;

  -- The admin must have had a turn to read exactly this version: it has to exist
  -- before the turn in which the confirmation arrived.
  select created_at into v_version_created_at
  from public.campaign_announcement_versions
  where announcement_id = a.id and version = a.version;
  if v_version_created_at is null or v_version_created_at >= v_turn_started_at then
    return jsonb_build_object('status', 'needs_admin_review', 'version', a.version);
  end if;

  v_registrants := public.announcement_registrant_count(a.campaign_id);
  if v_registrants = 0 then
    return jsonb_build_object('status', 'no_recipients');
  end if;
  if v_registrants > public.announcement_max_recipients() then
    return jsonb_build_object('status', 'too_many_recipients', 'count', v_registrants, 'max', public.announcement_max_recipients());
  end if;

  -- Snapshot the recipients: one row per person, even with several registrations.
  insert into public.campaign_announcement_recipients (announcement_id, registration_id, user_id)
  select a.id, (array_agg(r.id order by r.created_at, r.id))[1], r.user_id
  from public.campaign_registrations as r
  where r.status <> 'cancelled'
    and (r.campaign_id = a.campaign_id or r.campaign_key = a.campaign_id::text)
  group by r.user_id
  on conflict (announcement_id, user_id) do nothing;

  select count(*)::integer into v_recipients
  from public.campaign_announcement_recipients
  where announcement_id = a.id;

  update public.campaign_announcements
  set status = 'approved',
      approved_version = a.version,
      approved_at = now(),
      approved_by = p_admin_id,
      approval_text = left(btrim(p_confirmation_text), 500),
      recipient_count = v_recipients,
      sent_count = 0,
      failed_count = 0,
      updated_at = now()
  where id = a.id;

  return jsonb_build_object(
    'status', 'approved',
    'announcement_id', a.id,
    'version', a.version,
    'recipient_count', v_recipients
  );
end;
$$;

create or replace function public.cancel_announcement(
  p_thread_id uuid,
  p_admin_id uuid,
  p_announcement_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.campaign_announcements;
  v_skipped integer;
begin
  if p_thread_id is null or p_admin_id is null or p_announcement_id is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  if not public.announcement_is_admin(p_admin_id) or not public.announcement_owns_thread(p_thread_id, p_admin_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into a
  from public.campaign_announcements
  where id = p_announcement_id and thread_id = p_thread_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if a.status = 'sent' then
    return jsonb_build_object('status', 'already_sent');
  end if;
  if a.status = 'cancelled' then
    return jsonb_build_object('status', 'already_cancelled');
  end if;

  update public.campaign_announcements
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = a.id;
  with skipped as (
    update public.campaign_announcement_recipients
    set status = 'skipped', error_code = 'cancelled', claimed_until = null, updated_at = now()
    where announcement_id = a.id and status = 'pending'
    returning 1
  )
  select count(*)::integer into v_skipped from skipped;
  perform public.announcement_refresh_progress(a.id);

  return jsonb_build_object(
    'status', 'cancelled',
    'skipped', v_skipped,
    'sent_count', (select count(*) from public.campaign_announcement_recipients where announcement_id = a.id and status = 'sent')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: mailer worker (service_role)
-- ---------------------------------------------------------------------------

-- Test mails waiting to be sent. Read-only (no lease): the mailer holds a file lock,
-- and a repeated test mail after a crash is harmless.
create or replace function public.claim_announcement_tests(p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'announcement_id', a.id,
      'version', a.version,
      'subject', a.subject,
      'body_text', a.body_text,
      'requested_by', a.test_requested_by,
      'campaign_id', k.id,
      'campaign_title', k.title,
      'campaign_location', k.location,
      'campaign_start_at', k.start_at,
      'campaign_end_at', k.end_at,
      'registrant_count', public.announcement_registrant_count(a.campaign_id)
    ) order by a.test_requested_at), '[]'::jsonb)
  into v_items
  from (
    select * from public.campaign_announcements as t
    where t.status = 'draft'
      and t.test_requested_at is not null
      and t.test_requested_by is not null
      and t.test_requested_version = t.version
      and (t.test_sent_at is null or t.test_sent_at < t.test_requested_at)
      and (t.test_failed_at is null or t.test_failed_at < t.test_requested_at)
      and t.test_attempts < 3
    order by t.test_requested_at
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) as a
  join public.campaigns as k on k.id = a.campaign_id;

  return jsonb_build_object('status', 'ok', 'items', v_items);
end;
$$;

create or replace function public.mark_announcement_test_sent(p_announcement_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.campaign_announcements
  set test_sent_at = now(), test_sent_version = p_version, test_error_code = null, updated_at = now()
  where id = p_announcement_id
    and status = 'draft'
    and test_requested_version = p_version
    and version = p_version;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'stale');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- p_permanent = true stops retrying; otherwise the attempt is counted and the test
-- is retried until test_attempts reaches 3.
create or replace function public.mark_announcement_test_failed(
  p_announcement_id uuid,
  p_version integer,
  p_error_code text,
  p_permanent boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := coalesce(nullif(left(btrim(coalesce(p_error_code, '')), 64), ''), 'unknown_error');
  v_rows integer;
begin
  update public.campaign_announcements
  set test_attempts = test_attempts + 1,
      test_error_code = v_code,
      test_failed_at = case when coalesce(p_permanent, true) or test_attempts + 1 >= 3 then now() else test_failed_at end,
      updated_at = now()
  where id = p_announcement_id
    and status = 'draft'
    and test_requested_version = p_version
    and version = p_version;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'stale');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Leases the next pending recipients of approved/sending announcements. Attempts are
-- NOT incremented here: the mailer reports the outcome with mark_announcement_recipient.
-- A row is claimable again when its lease expires (mailer died mid-send).
create or replace function public.claim_announcement_recipients(
  p_limit integer default 20,
  p_max_attempts integer default 5,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_max integer := least(greatest(coalesce(p_max_attempts, 5), 1), 20);
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
  v_items jsonb;
begin
  -- Safety net: finish announcements that have nothing pending any more.
  update public.campaign_announcements as a
  set status = 'sent',
      sent_count = (select count(*) from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'sent'),
      failed_count = (select count(*) from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'failed'),
      updated_at = now()
  where a.status in ('approved', 'sending')
    and not exists (select 1 from public.campaign_announcement_recipients as r where r.announcement_id = a.id and r.status = 'pending');

  with picked as (
    select r.id
    from public.campaign_announcement_recipients as r
    join public.campaign_announcements as a on a.id = r.announcement_id
    where a.status in ('approved', 'sending')
      and r.status = 'pending'
      and r.attempts < v_max
      and (r.claimed_until is null or r.claimed_until < now())
    order by a.approved_at, r.created_at, r.id
    limit v_limit
    for update of r skip locked
  ), claimed as (
    update public.campaign_announcement_recipients as r
    set claimed_until = now() + make_interval(secs => v_lease), updated_at = now()
    from picked
    where r.id = picked.id
    returning r.id, r.announcement_id, r.registration_id, r.user_id, r.attempts
  ), started as (
    update public.campaign_announcements as a
    set status = 'sending', updated_at = now()
    where a.status = 'approved' and a.id in (select announcement_id from claimed)
    returning a.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'recipient_id', c.id,
      'announcement_id', c.announcement_id,
      'registration_id', c.registration_id,
      'user_id', c.user_id,
      'attempts', c.attempts,
      'subject', a.subject,
      'body_text', a.body_text,
      'version', a.approved_version,
      'campaign_id', k.id,
      'campaign_title', k.title,
      'campaign_location', k.location,
      'campaign_start_at', k.start_at,
      'campaign_end_at', k.end_at
    ) order by a.approved_at, c.id), '[]'::jsonb)
  into v_items
  from claimed as c
  join public.campaign_announcements as a on a.id = c.announcement_id
  join public.campaigns as k on k.id = a.campaign_id;

  return jsonb_build_object('status', 'ok', 'items', v_items);
end;
$$;

-- Same shape as claim_announcement_recipients but read-only (mailer --dry-run).
create or replace function public.preview_announcement_recipients(
  p_limit integer default 5,
  p_max_attempts integer default 5
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'recipient_id', n.id,
      'announcement_id', n.announcement_id,
      'registration_id', n.registration_id,
      'user_id', n.user_id,
      'attempts', n.attempts,
      'subject', a.subject,
      'body_text', a.body_text,
      'version', a.approved_version,
      'campaign_id', k.id,
      'campaign_title', k.title,
      'campaign_location', k.location,
      'campaign_start_at', k.start_at,
      'campaign_end_at', k.end_at
    ) order by a.approved_at, n.id), '[]'::jsonb)
  into v_items
  from (
    select r.*
    from public.campaign_announcement_recipients as r
    join public.campaign_announcements as pa on pa.id = r.announcement_id
    where pa.status in ('approved', 'sending')
      and r.status = 'pending'
      and r.attempts < least(greatest(coalesce(p_max_attempts, 5), 1), 20)
      and (r.claimed_until is null or r.claimed_until < now())
    order by pa.approved_at, r.created_at, r.id
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) as n
  join public.campaign_announcements as a on a.id = n.announcement_id
  join public.campaigns as k on k.id = a.campaign_id;

  return jsonb_build_object('status', 'ok', 'items', v_items);
end;
$$;

-- Records the outcome of one send.
--   p_status 'sent'    delivered to the SMTP server
--            'failed'  give up on this person (permanent error)
--            'pending' put back in the queue (transient error, or release without counting)
--   p_count_attempt    true adds one attempt; a 'pending' row whose attempts reach
--                      p_max_attempts becomes 'failed' automatically. A counted retry
--                      is not claimable again for 5 minutes (backoff).
-- A row that is no longer pending (already sent, or skipped by a cancel) is left
-- untouched: {status:'already_final'}.
create or replace function public.mark_announcement_recipient(
  p_recipient_id uuid,
  p_status text,
  p_error_code text default null,
  p_count_attempt boolean default true,
  p_max_attempts integer default 5
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := least(greatest(coalesce(p_max_attempts, 5), 1), 20);
  rec public.campaign_announcement_recipients;
  v_code text;
  v_attempts integer;
  v_new_status text;
  v_announcement_status text;
begin
  if p_recipient_id is null or p_status is null or p_status not in ('sent', 'failed', 'pending') then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  select * into rec from public.campaign_announcement_recipients where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if rec.status <> 'pending' then
    return jsonb_build_object('status', 'already_final', 'recipient_status', rec.status);
  end if;

  v_code := nullif(left(btrim(coalesce(p_error_code, '')), 64), '');
  v_attempts := rec.attempts + case when coalesce(p_count_attempt, true) then 1 else 0 end;
  v_new_status := p_status;
  if p_status = 'pending' and v_attempts >= v_max then
    v_new_status := 'failed';
    v_code := coalesce(v_code, 'max_attempts');
  end if;
  if v_new_status = 'failed' then
    v_code := coalesce(v_code, 'unknown_error');
  end if;

  update public.campaign_announcement_recipients
  set status = v_new_status,
      attempts = v_attempts,
      error_code = case when v_new_status = 'sent' then null else v_code end,
      sent_at = case when v_new_status = 'sent' then now() else sent_at end,
      -- A counted retry keeps a 5-minute lease so the same person is not retried
      -- in a tight loop; every other outcome clears the lease.
      claimed_until = case
        when v_new_status = 'pending' and coalesce(p_count_attempt, true) then now() + interval '5 minutes'
        else null
      end,
      updated_at = now()
  where id = rec.id;

  v_announcement_status := public.announcement_refresh_progress(rec.announcement_id);
  return jsonb_build_object('status', 'ok', 'recipient_status', v_new_status, 'announcement_status', v_announcement_status);
end;
$$;

-- Drops the leases without counting an attempt (shared outage, shutdown).
create or replace function public.release_announcement_recipients(p_recipient_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_recipient_ids is null or cardinality(p_recipient_ids) = 0 then
    return jsonb_build_object('status', 'ok', 'released', 0);
  end if;
  update public.campaign_announcement_recipients
  set claimed_until = null, updated_at = now()
  where id = any(p_recipient_ids) and status = 'pending';
  get diagnostics v_rows = row_count;
  return jsonb_build_object('status', 'ok', 'released', v_rows);
end;
$$;

-- Last check before each real mail (not for test mails). The mailer leases a batch and
-- then sends one mail every few seconds, so a cancel can arrive mid-batch; it asks here
-- right before handing a mail to SMTP.
--   {status:'ok'}                         the recipient is still pending, its lease is still
--                                         valid and the announcement is approved/sending.
--                                         The lease is extended by p_lease_seconds so the
--                                         row cannot be claimed by someone else while the
--                                         mail is on its way.
--   {status:'skip', reason:...}           do NOT send; nothing is changed. reason:
--     'cancelled'                         the announcement was cancelled
--     'announcement_not_active'           the announcement is not approved/sending (e.g. sent)
--     'not_pending'                       the recipient is gone or already sent/failed/skipped
--     'lease_lost'                        the lease expired (another worker may own the row)
-- Lock order: announcement first, then recipient (same as cancel_announcement), so the two
-- cannot deadlock. Once this returns 'ok' a concurrent cancel waits for the announcement
-- lock only for the duration of this call, so at most the one mail already on its way can
-- still go out after a cancel.
create or replace function public.begin_announcement_send(
  p_recipient_id uuid,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
  v_announcement_id uuid;
  v_announcement_status text;
  rec public.campaign_announcement_recipients;
begin
  if p_recipient_id is null then
    return jsonb_build_object('status', 'skip', 'reason', 'not_pending');
  end if;

  -- Unlocked peek only to learn which announcement to lock first.
  select announcement_id into v_announcement_id
  from public.campaign_announcement_recipients
  where id = p_recipient_id;
  if v_announcement_id is null then
    return jsonb_build_object('status', 'skip', 'reason', 'not_pending');
  end if;

  select status into v_announcement_status
  from public.campaign_announcements
  where id = v_announcement_id
  for update;
  if v_announcement_status is null then
    return jsonb_build_object('status', 'skip', 'reason', 'not_pending');
  end if;
  if v_announcement_status = 'cancelled' then
    return jsonb_build_object('status', 'skip', 'reason', 'cancelled');
  end if;
  if v_announcement_status not in ('approved', 'sending') then
    return jsonb_build_object('status', 'skip', 'reason', 'announcement_not_active');
  end if;

  select * into rec
  from public.campaign_announcement_recipients
  where id = p_recipient_id
  for update;
  if not found or rec.status <> 'pending' then
    return jsonb_build_object('status', 'skip', 'reason', 'not_pending');
  end if;
  if rec.claimed_until is null or rec.claimed_until <= now() then
    return jsonb_build_object('status', 'skip', 'reason', 'lease_lost');
  end if;

  update public.campaign_announcement_recipients
  set claimed_until = now() + make_interval(secs => v_lease), updated_at = now()
  where id = rec.id;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Mails handed to SMTP in [p_from, p_to): announcement mails, test mails and registration
-- confirmations. The mailer uses it to stay under MAILER_DAILY_LIMIT.
create or replace function public.mail_sent_count_between(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recipients bigint;
  v_tests bigint;
  v_confirmations bigint;
begin
  if p_from is null or p_to is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  select count(*) into v_recipients
  from public.campaign_announcement_recipients
  where status = 'sent' and sent_at >= p_from and sent_at < p_to;
  select count(*) into v_tests
  from public.campaign_announcements
  where test_sent_at >= p_from and test_sent_at < p_to;
  select count(*) into v_confirmations
  from public.campaign_registrations
  where confirmation_email_sent_at >= p_from and confirmation_email_sent_at < p_to;
  return jsonb_build_object(
    'status', 'ok',
    'announcement_recipients', v_recipients,
    'announcement_tests', v_tests,
    'confirmations', v_confirmations,
    'total', v_recipients + v_tests + v_confirmations
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: service_role only (the Secret key held by n8n and the mailer)
-- ---------------------------------------------------------------------------

revoke all on function public.announcement_max_recipients() from public, anon, authenticated;
revoke all on function public.announcement_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.announcement_owns_thread(uuid, uuid) from public, anon, authenticated;
revoke all on function public.announcement_registrant_count(uuid) from public, anon, authenticated;
revoke all on function public.announcement_short_name(text) from public, anon, authenticated;
revoke all on function public.announcement_refresh_progress(uuid) from public, anon, authenticated;
revoke all on function public.announcement_to_json(uuid) from public, anon, authenticated;

revoke all on function public.find_announcement_campaigns(text, integer) from public, anon, authenticated;
revoke all on function public.announcement_campaign_registrants(uuid) from public, anon, authenticated;
revoke all on function public.upsert_announcement_draft(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_announcement(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_announcement_test(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.approve_announcement(uuid, uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_announcement(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_announcement_tests(integer) from public, anon, authenticated;
revoke all on function public.mark_announcement_test_sent(uuid, integer) from public, anon, authenticated;
revoke all on function public.mark_announcement_test_failed(uuid, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.claim_announcement_recipients(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.preview_announcement_recipients(integer, integer) from public, anon, authenticated;
revoke all on function public.begin_announcement_send(uuid, integer) from public, anon, authenticated;
revoke all on function public.mark_announcement_recipient(uuid, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.release_announcement_recipients(uuid[]) from public, anon, authenticated;
revoke all on function public.mail_sent_count_between(timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.find_announcement_campaigns(text, integer) to service_role;
grant execute on function public.announcement_campaign_registrants(uuid) to service_role;
grant execute on function public.upsert_announcement_draft(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.get_announcement(uuid, uuid) to service_role;
grant execute on function public.request_announcement_test(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.approve_announcement(uuid, uuid, uuid, integer, text, timestamptz) to service_role;
grant execute on function public.cancel_announcement(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_announcement_tests(integer) to service_role;
grant execute on function public.mark_announcement_test_sent(uuid, integer) to service_role;
grant execute on function public.mark_announcement_test_failed(uuid, integer, text, boolean) to service_role;
grant execute on function public.claim_announcement_recipients(integer, integer, integer) to service_role;
grant execute on function public.preview_announcement_recipients(integer, integer) to service_role;
grant execute on function public.begin_announcement_send(uuid, integer) to service_role;
grant execute on function public.mark_announcement_recipient(uuid, text, text, boolean, integer) to service_role;
grant execute on function public.release_announcement_recipients(uuid[]) to service_role;
grant execute on function public.mail_sent_count_between(timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
