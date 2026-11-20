-- Persistent state and audit trail for the Hà Nội Xanh admin agent.

create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Cuộc trò chuyện mới',
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  workflow_state text not null default 'idle',
  active_skill text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content text not null default '',
  tool_name text,
  tool_call_id text,
  payload jsonb not null default '{}'::jsonb,
  client_message_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists agent_messages_client_message_idx on public.agent_messages(client_message_id) where client_message_id is not null;

create table if not exists public.pollution_findings (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  location_name text not null,
  district text,
  address text,
  latitude double precision,
  longitude double precision,
  pollution_type text not null,
  summary text not null,
  observed_at timestamptz,
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  sources jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  finding_id uuid references public.pollution_findings(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'publishing', 'published', 'partial_failure')),
  current_version integer not null default 1 check (current_version > 0),
  approved_version integer,
  cleanup_start_at timestamptz not null,
  cleanup_end_at timestamptz,
  meeting_point text,
  contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

create table if not exists public.draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  version integer not null check (version > 0),
  website_payload jsonb not null default '{}'::jsonb,
  threads_payload jsonb not null default '{}'::jsonb,
  images jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  preview_url text,
  file_url text,
  feedback text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (draft_id, version)
);

create table if not exists public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  draft_version integer not null,
  channel text not null check (channel in ('website', 'threads')),
  status text not null default 'queued' check (status in ('queued', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  publish_at timestamptz,
  provider_post_id text,
  published_url text,
  error_message text,
  attempts integer not null default 0,
  requested_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (draft_id, draft_version, channel)
);

create table if not exists public.agent_tool_logs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.agent_threads(id) on delete set null,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  status text not null check (status in ('started', 'succeeded', 'failed', 'blocked')),
  requested_by uuid references public.profiles(id) on delete set null,
  duration_ms integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists agent_messages_thread_created_idx on public.agent_messages(thread_id, created_at);
create index if not exists pollution_findings_thread_idx on public.pollution_findings(thread_id, created_at desc);
create index if not exists content_drafts_thread_idx on public.content_drafts(thread_id, updated_at desc);
create index if not exists publication_jobs_status_time_idx on public.publication_jobs(status, publish_at);
create index if not exists agent_tool_logs_thread_idx on public.agent_tool_logs(thread_id, created_at desc);

alter table public.agent_threads enable row level security;
alter table public.agent_messages enable row level security;
alter table public.pollution_findings enable row level security;
alter table public.content_drafts enable row level security;
alter table public.draft_versions enable row level security;
alter table public.publication_jobs enable row level security;
alter table public.agent_tool_logs enable row level security;

drop policy if exists agent_threads_admin_all on public.agent_threads;
create policy agent_threads_admin_all on public.agent_threads for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists agent_messages_admin_all on public.agent_messages;
create policy agent_messages_admin_all on public.agent_messages for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists pollution_findings_admin_all on public.pollution_findings;
create policy pollution_findings_admin_all on public.pollution_findings for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists content_drafts_admin_all on public.content_drafts;
create policy content_drafts_admin_all on public.content_drafts for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists draft_versions_admin_all on public.draft_versions;
create policy draft_versions_admin_all on public.draft_versions for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists publication_jobs_admin_all on public.publication_jobs;
create policy publication_jobs_admin_all on public.publication_jobs for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists agent_tool_logs_admin_read on public.agent_tool_logs;
create policy agent_tool_logs_admin_read on public.agent_tool_logs for select using (public.is_admin());

comment on table public.agent_tool_logs is 'Append-only audit data. n8n writes with a server-side service role; admins can read it.';

create or replace function public.prepare_admin_agent_turn(
  requested_user_id uuid,
  requested_thread_id uuid,
  requested_message text,
  requested_client_message_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_thread public.agent_threads;
  result jsonb;
begin
  if not exists (select 1 from public.profiles where id = requested_user_id and role = 'admin') then
    raise exception 'admin_required';
  end if;
  if requested_message is null or btrim(requested_message) = '' then
    raise exception 'message_required';
  end if;
  if requested_thread_id is not null then
    select * into selected_thread from public.agent_threads where id = requested_thread_id and created_by = requested_user_id;
  end if;
  if selected_thread.id is null then
    insert into public.agent_threads (created_by, title, workflow_state, active_skill)
    values (requested_user_id, left(requested_message, 80), 'active', 'pollution-campaign-post')
    returning * into selected_thread;
  end if;
  insert into public.agent_messages (thread_id, role, content, client_message_id)
  values (selected_thread.id, 'user', requested_message, requested_client_message_id)
  on conflict (client_message_id) where client_message_id is not null do nothing;
  update public.agent_threads set updated_at = now(), workflow_state = 'active' where id = selected_thread.id;
  select jsonb_build_object(
    'thread_id', selected_thread.id,
    'state', selected_thread.state,
    'workflow_state', selected_thread.workflow_state,
    'recent_messages', coalesce((select jsonb_agg(x order by x.created_at) from (select role, content, created_at from public.agent_messages where thread_id = selected_thread.id order by created_at desc limit 20) x), '[]'::jsonb),
    'findings', coalesce((select jsonb_agg(f order by f.created_at desc) from public.pollution_findings f where f.thread_id = selected_thread.id), '[]'::jsonb),
    'draft', (select to_jsonb(d) from public.content_drafts d where d.thread_id = selected_thread.id order by d.updated_at desc limit 1)
  ) into result;
  return result;
end;
$$;

create or replace function public.finalize_admin_agent_turn(
  requested_thread_id uuid,
  assistant_message text,
  requested_workflow_state text default 'active'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_thread public.agent_threads;
begin
  select * into selected_thread from public.agent_threads where id = requested_thread_id;
  if selected_thread.id is null then raise exception 'thread_not_found'; end if;
  insert into public.agent_messages (thread_id, role, content) values (selected_thread.id, 'assistant', coalesce(assistant_message, ''));
  update public.agent_threads set workflow_state = requested_workflow_state, updated_at = now() where id = selected_thread.id;
  return jsonb_build_object(
    'thread_id', selected_thread.id,
    'message', coalesce(assistant_message, ''),
    'state', requested_workflow_state,
    'findings', coalesce((select jsonb_agg(f order by f.created_at desc) from public.pollution_findings f where f.thread_id = selected_thread.id), '[]'::jsonb),
    'draft', (select to_jsonb(d) || jsonb_build_object('draft_id', d.id, 'version', d.current_version, 'preview_url', v.preview_url, 'file_url', v.file_url, 'image_url', coalesce(v.website_payload->>'image_url', v.images->0->>'url'), 'website_payload', v.website_payload, 'threads_payload', v.threads_payload, 'images', v.images, 'sources', v.sources) from public.content_drafts d left join public.draft_versions v on v.draft_id = d.id and v.version = d.current_version where d.thread_id = selected_thread.id order by d.updated_at desc limit 1)
  );
end;
$$;

revoke all on function public.prepare_admin_agent_turn(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finalize_admin_agent_turn(uuid, text, text) from public, anon, authenticated;
grant execute on function public.prepare_admin_agent_turn(uuid, uuid, text, uuid) to service_role;
grant execute on function public.finalize_admin_agent_turn(uuid, text, text) to service_role;
