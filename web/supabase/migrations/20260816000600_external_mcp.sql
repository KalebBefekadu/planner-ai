begin;

create table public.mcp_access_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  name text not null check (char_length(name) between 1 and 120),
  allowed_operations text[] not null default '{}',
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (workspace_id, owner_user_id) references public.workspaces(id, owner_user_id),
  check (expires_at > created_at),
  check (cardinality(allowed_operations) <= 50)
);
create index mcp_access_tokens_workspace_idx on public.mcp_access_tokens (workspace_id, created_at desc);
alter table public.mcp_access_tokens enable row level security;
alter table public.mcp_access_tokens force row level security;
create policy mcp_access_tokens_select_owner on public.mcp_access_tokens for select to authenticated
using (owner_user_id = auth.uid());
revoke all on public.mcp_access_tokens from anon;
revoke insert, update, delete, truncate, references, trigger on public.mcp_access_tokens from authenticated;
grant select (id, workspace_id, owner_user_id, name, allowed_operations, expires_at, last_used_at, revoked_at, created_at)
on public.mcp_access_tokens to authenticated;

create table public.mcp_usage_windows (
  token_id uuid not null references public.mcp_access_tokens(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (token_id, window_started_at)
);
alter table public.mcp_usage_windows enable row level security;
alter table public.mcp_usage_windows force row level security;
revoke all on public.mcp_usage_windows from anon, authenticated;

create or replace function public.create_mcp_access_token(
  p_token_hash text,
  p_name text,
  p_allowed_operations text[],
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_id uuid;
  v_allowed_catalog constant text[] := array[
    'workspace.snapshot.read.v1',
    'vision.upsert.v1', 'goal.create.v1', 'goal.status.v1', 'goal.archive.v1',
    'action.create.v1', 'action.status.v1', 'action.archive.v1', 'capture.create.v1',
    'note.create.v1', 'note.update.v1', 'note.move.v1', 'note.archive.v1',
    'note.ai-exclusion.v1', 'memory.create.v1', 'memory.update.v1',
    'trash.move.v1', 'trash.restore.v1'
  ];
begin
  if v_user_id is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'aal2_required';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or char_length(trim(p_name)) not between 1 and 120
    or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp() + interval '90 days'
    or coalesce(cardinality(p_allowed_operations), 0) not between 1 and 50
    or array_position(p_allowed_operations, null) is not null
    or exists (select 1 from unnest(p_allowed_operations) op where not (op = any(v_allowed_catalog))) then
    raise exception using errcode = 'P0001', message = 'invalid_mcp_grant';
  end if;
  insert into public.workspaces (owner_user_id)
  values (v_user_id)
  on conflict (owner_user_id) do nothing;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  insert into public.mcp_access_tokens (
    workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
  ) values (
    v_workspace_id, v_user_id, p_token_hash, trim(p_name), p_allowed_operations, p_expires_at
  ) returning id into v_id;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', 'ui', 'mcp.token.create.v1',
    'mcp_access_token', v_id, 'high', 'succeeded'
  );
  return v_id;
end;
$$;

create or replace function public.revoke_mcp_access_token(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  update public.mcp_access_tokens set revoked_at = clock_timestamp()
  where id = p_token_id and owner_user_id = v_user_id and revoked_at is null
  returning workspace_id into v_workspace_id;
  if not found then raise exception using errcode = 'P0001', message = 'token_not_found'; end if;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', 'ui', 'mcp.token.revoke.v1',
    'mcp_access_token', p_token_id, 'high', 'succeeded'
  );
end;
$$;

create or replace function public.authenticate_mcp_token(p_token_hash text)
returns table(token_id uuid, workspace_id uuid, owner_user_id uuid, allowed_operations text[])
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window_start timestamptz := date_trunc('minute', clock_timestamp());
  v_token_id uuid;
  v_workspace_id uuid;
  v_owner_user_id uuid;
  v_allowed_operations text[];
  v_count integer;
begin
  select t.id, t.workspace_id, t.owner_user_id, t.allowed_operations
  into v_token_id, v_workspace_id, v_owner_user_id, v_allowed_operations
  from public.mcp_access_tokens t
  where t.token_hash = p_token_hash and t.revoked_at is null and t.expires_at > clock_timestamp();
  if v_token_id is null then return; end if;

  insert into public.mcp_usage_windows (token_id, window_started_at, request_count)
  values (v_token_id, v_window_start, 1)
  on conflict (token_id, window_started_at)
  do update set request_count = public.mcp_usage_windows.request_count + 1
  where public.mcp_usage_windows.request_count < 60
  returning request_count into v_count;
  if v_count is null then return; end if;

  update public.mcp_access_tokens set last_used_at = clock_timestamp() where id = v_token_id;
  token_id := v_token_id;
  workspace_id := v_workspace_id;
  owner_user_id := v_owner_user_id;
  allowed_operations := v_allowed_operations;
  return next;
end;
$$;

create or replace function public.execute_mcp_operation(
  p_token_id uuid,
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token record;
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
begin
  select id as token_id, workspace_id, owner_user_id, allowed_operations
  into v_token
  from public.mcp_access_tokens
  where id = p_token_id and revoked_at is null and expires_at > clock_timestamp();
  if not found then raise exception using errcode = '28000', message = 'invalid_or_limited_mcp_token'; end if;
  if not (p_operation_id = any(v_token.allowed_operations)) then
    raise exception using errcode = '42501', message = 'operation_not_granted';
  end if;
  perform set_config('request.jwt.claim.sub', v_token.owner_user_id::text, true);
  if p_operation_id like 'note.%' then
    v_result := public.execute_note_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  elsif p_operation_id like 'memory.%' then
    v_result := public.execute_memory_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  elsif p_operation_id like 'trash.%' then
    v_result := public.execute_trash_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  else
    v_result := public.execute_planner_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  end if;
  perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
  return v_result;
end;
$$;

create or replace function public.read_mcp_workspace_snapshot(p_token_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token record;
  v_result jsonb;
begin
  select id as token_id, workspace_id, owner_user_id
  into v_token
  from public.mcp_access_tokens
  where id = p_token_id and revoked_at is null and expires_at > clock_timestamp();
  if not found then raise exception using errcode = '28000', message = 'invalid_or_limited_mcp_token'; end if;
  select jsonb_build_object(
    'vision', (select body_markdown from public.visions where workspace_id = v_token.workspace_id and archived_at is null and trashed_at is null),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'version', version)) from public.goals where workspace_id = v_token.workspace_id and archived_at is null and trashed_at is null), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'version', version)) from public.actions where workspace_id = v_token.workspace_id and archived_at is null and trashed_at is null), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'version', version)) from public.notes where workspace_id = v_token.workspace_id and ai_excluded = false and archived_at is null and trashed_at is null), '[]'::jsonb)
  ) into v_result;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, risk_class, outcome
  ) values (
    v_token.workspace_id, v_token.owner_user_id, 'automation', 'mcp',
    'workspace.snapshot.read.v1', 'workspace', 'read', 'succeeded'
  );
  return v_result;
end;
$$;

revoke all on function public.create_mcp_access_token(text, text, text[], timestamptz) from public, anon;
revoke all on function public.revoke_mcp_access_token(uuid) from public, anon;
grant execute on function public.create_mcp_access_token(text, text, text[], timestamptz) to authenticated;
grant execute on function public.revoke_mcp_access_token(uuid) to authenticated;

revoke all on function public.authenticate_mcp_token(text) from public, authenticated;
revoke all on function public.execute_mcp_operation(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.read_mcp_workspace_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.authenticate_mcp_token(text) to anon;
grant execute on function public.execute_mcp_operation(uuid, text, jsonb, text) to service_role;
grant execute on function public.read_mcp_workspace_snapshot(uuid) to service_role;

commit;
