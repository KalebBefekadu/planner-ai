begin;

create table public.ai_quota_reservations (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  operation text not null check (
    operation in ('smart_goal', 'socratic', 'transcribe', 'assistant', 'capture_analysis')
  ),
  reserved_cost_micros bigint not null check (reserved_cost_micros between 1 and 2000000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  check (expires_at > created_at)
);
create index ai_quota_reservations_workspace_expiry_idx
on public.ai_quota_reservations (workspace_id, expires_at);
alter table public.ai_quota_reservations enable row level security;
alter table public.ai_quota_reservations force row level security;
create policy ai_quota_reservations_select_owner on public.ai_quota_reservations
for select to authenticated using (
  workspace_id in (select id from public.workspaces where owner_user_id = auth.uid())
);
revoke all on public.ai_quota_reservations from anon;
revoke insert, update, delete, truncate, references, trigger
on public.ai_quota_reservations from authenticated;
grant select on public.ai_quota_reservations to authenticated;

create or replace function public.consume_ai_quota_status(p_operation text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_limit integer;
  v_window_start timestamptz;
  v_count integer;
  v_monthly_cost bigint;
begin
  if v_user_id is null then return 'invalid'; end if;
  v_limit := case p_operation
    when 'smart_goal' then 20
    when 'socratic' then 10
    when 'transcribe' then 8
    when 'assistant' then 30
    when 'capture_analysis' then 10
    else 0
  end;
  if v_limit = 0 then return 'invalid'; end if;

  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':ai-quota', 0));

  select coalesce(sum(estimated_cost_micros), 0) into v_monthly_cost
  from public.ai_usage_events
  where workspace_id = v_workspace_id
    and created_at >= date_trunc('month', clock_timestamp());
  if v_monthly_cost >= 20000000 then return 'monthly_cap'; end if;

  v_window_start := date_trunc('minute', clock_timestamp());
  insert into public.ai_request_windows (
    user_id, operation, window_started_at, request_count, updated_at
  ) values (
    v_user_id, p_operation, v_window_start, 1, clock_timestamp()
  ) on conflict (user_id, operation, window_started_at)
  do update set request_count = public.ai_request_windows.request_count + 1,
    updated_at = clock_timestamp()
  where public.ai_request_windows.request_count < v_limit
  returning request_count into v_count;
  if v_count is null then return 'rate_limited'; end if;
  return 'allowed';
end;
$$;

create or replace function public.consume_ai_quota(p_operation text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.consume_ai_quota_status(p_operation) = 'allowed';
$$;

create or replace function public.consume_ai_quota_status(
  p_operation text,
  p_request_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_limit integer;
  v_reservation bigint;
  v_window_start timestamptz;
  v_count integer;
  v_committed_cost bigint;
  v_reserved_cost bigint;
begin
  if v_user_id is null or p_request_id is null then return 'invalid'; end if;
  v_limit := case p_operation
    when 'smart_goal' then 20
    when 'socratic' then 10
    when 'transcribe' then 8
    when 'assistant' then 30
    when 'capture_analysis' then 10
    else 0
  end;
  v_reservation := case p_operation
    when 'transcribe' then 2000000
    when 'assistant' then 250000
    when 'smart_goal' then 250000
    when 'socratic' then 250000
    when 'capture_analysis' then 250000
    else 0
  end;
  if v_limit = 0 or v_reservation = 0 then return 'invalid'; end if;

  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':ai-quota', 0));
  delete from public.ai_quota_reservations where expires_at <= clock_timestamp();
  if exists (
    select 1 from public.ai_quota_reservations
    where request_id = p_request_id and workspace_id = v_workspace_id
  ) then
    return 'allowed';
  end if;

  select coalesce(sum(estimated_cost_micros), 0) into v_committed_cost
  from public.ai_usage_events
  where workspace_id = v_workspace_id
    and created_at >= date_trunc('month', clock_timestamp());
  select coalesce(sum(reserved_cost_micros), 0) into v_reserved_cost
  from public.ai_quota_reservations where workspace_id = v_workspace_id;
  if v_committed_cost + v_reserved_cost + v_reservation > 20000000 then
    return 'monthly_cap';
  end if;

  v_window_start := date_trunc('minute', clock_timestamp());
  insert into public.ai_request_windows (
    user_id, operation, window_started_at, request_count, updated_at
  ) values (
    v_user_id, p_operation, v_window_start, 1, clock_timestamp()
  ) on conflict (user_id, operation, window_started_at)
  do update set request_count = public.ai_request_windows.request_count + 1,
    updated_at = clock_timestamp()
  where public.ai_request_windows.request_count < v_limit
  returning request_count into v_count;
  if v_count is null then return 'rate_limited'; end if;

  insert into public.ai_quota_reservations (
    request_id, workspace_id, operation, reserved_cost_micros
  ) values (p_request_id, v_workspace_id, p_operation, v_reservation);
  return 'allowed';
end;
$$;

create or replace function public.release_ai_quota_reservation(p_request_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  delete from public.ai_quota_reservations reservation
  using public.workspaces workspace
  where reservation.request_id = p_request_id
    and workspace.id = reservation.workspace_id
    and workspace.owner_user_id = auth.uid();
$$;

revoke all on function public.consume_ai_quota_status(text) from public, anon;
grant execute on function public.consume_ai_quota_status(text) to authenticated;
revoke all on function public.consume_ai_quota_status(text, uuid) from public, anon;
grant execute on function public.consume_ai_quota_status(text, uuid) to authenticated;
revoke all on function public.release_ai_quota_reservation(uuid) from public, anon;
grant execute on function public.release_ai_quota_reservation(uuid) to authenticated;
revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;

commit;
