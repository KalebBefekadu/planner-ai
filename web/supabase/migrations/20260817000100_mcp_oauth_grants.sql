begin;

create table public.mcp_oauth_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  oauth_client_id text not null check (char_length(oauth_client_id) between 1 and 500),
  client_name text not null check (char_length(client_name) between 1 and 200),
  allowed_operations text[] not null check (cardinality(allowed_operations) between 1 and 50),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, oauth_client_id),
  unique (id, workspace_id),
  foreign key (workspace_id, owner_user_id) references public.workspaces(id, owner_user_id)
);
create index mcp_oauth_grants_workspace_idx
on public.mcp_oauth_grants (workspace_id, created_at desc);
create trigger mcp_oauth_grants_set_updated_at before update on public.mcp_oauth_grants
for each row execute function public.set_updated_at();
alter table public.mcp_oauth_grants enable row level security;
alter table public.mcp_oauth_grants force row level security;
create policy mcp_oauth_grants_select_owner on public.mcp_oauth_grants
for select to authenticated using (owner_user_id = auth.uid());
revoke all on public.mcp_oauth_grants from anon;
revoke insert, update, delete, truncate, references, trigger
on public.mcp_oauth_grants from authenticated;
grant select (
  id, workspace_id, owner_user_id, oauth_client_id, client_name,
  allowed_operations, last_used_at, revoked_at, created_at, updated_at
) on public.mcp_oauth_grants to authenticated;

create table public.mcp_oauth_usage_windows (
  grant_id uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (grant_id, window_started_at)
);
alter table public.mcp_oauth_usage_windows enable row level security;
alter table public.mcp_oauth_usage_windows force row level security;
revoke all on public.mcp_oauth_usage_windows from anon, authenticated;

create or replace function public.approve_mcp_oauth_grant(
  p_oauth_client_id text,
  p_client_name text,
  p_allowed_operations text[]
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_grant_id uuid;
begin
  if v_user_id is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'aal2_required';
  end if;
  if char_length(trim(p_oauth_client_id)) not between 1 and 500
    or char_length(trim(p_client_name)) not between 1 and 200
    or coalesce(cardinality(p_allowed_operations), 0) not between 1 and 50
    or array_position(p_allowed_operations, null) is not null
    or exists (
      select 1 from unnest(p_allowed_operations) granted(operation_id)
      left join public.operation_contracts contract using (operation_id)
      where contract.operation_id is null or not ('mcp' = any(contract.exposures))
    ) then
    raise exception using errcode = 'P0001', message = 'invalid_mcp_oauth_grant';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  insert into public.mcp_oauth_grants (
    workspace_id, owner_user_id, oauth_client_id, client_name, allowed_operations
  ) values (
    v_workspace_id, v_user_id, trim(p_oauth_client_id), trim(p_client_name), p_allowed_operations
  )
  on conflict (workspace_id, oauth_client_id) do update set
    client_name = excluded.client_name,
    allowed_operations = excluded.allowed_operations,
    revoked_at = null,
    updated_at = clock_timestamp()
  returning id into v_grant_id;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', 'ui', 'mcp.oauth-grant.approve.v1',
    'mcp_oauth_grant', v_grant_id, 'high', 'aal2', 'succeeded'
  );
  return v_grant_id;
end;
$$;

create or replace function public.revoke_mcp_oauth_grant(p_oauth_client_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_grant_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  update public.mcp_oauth_grants set revoked_at = clock_timestamp()
  where owner_user_id = v_user_id and oauth_client_id = p_oauth_client_id and revoked_at is null
  returning id, workspace_id into v_grant_id, v_workspace_id;
  if v_grant_id is null then return; end if;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', 'ui', 'mcp.oauth-grant.revoke.v1',
    'mcp_oauth_grant', v_grant_id, 'high', 'succeeded'
  );
end;
$$;

create or replace function public.authenticate_mcp_oauth_grant()
returns table(
  grant_id uuid,
  workspace_id uuid,
  owner_user_id uuid,
  allowed_operations text[]
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_id text := auth.jwt() ->> 'client_id';
  v_window_start timestamptz := date_trunc('minute', clock_timestamp());
  v_grant record;
  v_count integer;
begin
  if v_user_id is null or v_client_id is null then return; end if;
  select grant_row.id, grant_row.workspace_id, grant_row.owner_user_id,
    grant_row.allowed_operations
  into v_grant
  from public.mcp_oauth_grants grant_row
  where grant_row.owner_user_id = v_user_id
    and grant_row.oauth_client_id = v_client_id
    and grant_row.revoked_at is null;
  if not found then return; end if;
  insert into public.mcp_oauth_usage_windows (grant_id, window_started_at, request_count)
  values (v_grant.id, v_window_start, 1)
  on conflict (grant_id, window_started_at)
  do update set request_count = public.mcp_oauth_usage_windows.request_count + 1
  where public.mcp_oauth_usage_windows.request_count < 60
  returning request_count into v_count;
  if v_count is null then return; end if;
  update public.mcp_oauth_grants set last_used_at = clock_timestamp() where id = v_grant.id;
  grant_id := v_grant.id;
  workspace_id := v_grant.workspace_id;
  owner_user_id := v_grant.owner_user_id;
  allowed_operations := v_grant.allowed_operations;
  return next;
end;
$$;

create or replace function public.execute_mcp_oauth_operation(
  p_grant_id uuid,
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
  v_user_id uuid := auth.uid();
  v_client_id text := auth.jwt() ->> 'client_id';
  v_grant record;
begin
  select id, allowed_operations into v_grant
  from public.mcp_oauth_grants
  where id = p_grant_id and owner_user_id = v_user_id
    and oauth_client_id = v_client_id and revoked_at is null;
  if not found then raise exception using errcode = '28000', message = 'invalid_mcp_oauth_grant'; end if;
  if not (p_operation_id = any(v_grant.allowed_operations)) then
    raise exception using errcode = '42501', message = 'operation_not_granted';
  end if;
  return public.dispatch_trusted_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
end;
$$;

create or replace function public.read_mcp_oauth_workspace_snapshot(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_id text := auth.jwt() ->> 'client_id';
  v_grant record;
  v_result jsonb;
begin
  select id, workspace_id, allowed_operations into v_grant
  from public.mcp_oauth_grants
  where id = p_grant_id and owner_user_id = v_user_id
    and oauth_client_id = v_client_id and revoked_at is null;
  if not found or not ('workspace.snapshot.read.v1' = any(v_grant.allowed_operations)) then
    raise exception using errcode = '42501', message = 'snapshot_not_granted';
  end if;
  select jsonb_build_object(
    'vision', (select body_markdown from public.visions where workspace_id = v_grant.workspace_id and archived_at is null and trashed_at is null),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'version', version)) from public.goals where workspace_id = v_grant.workspace_id and archived_at is null and trashed_at is null), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'version', version)) from public.actions where workspace_id = v_grant.workspace_id and archived_at is null and trashed_at is null), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'version', version)) from public.notes where workspace_id = v_grant.workspace_id and ai_excluded = false and archived_at is null and trashed_at is null), '[]'::jsonb)
  ) into v_result;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, risk_class, outcome
  ) values (
    v_grant.workspace_id, v_user_id, 'automation', 'mcp',
    'workspace.snapshot.read.v1', 'workspace', 'read', 'succeeded'
  );
  return v_result;
end;
$$;

revoke all on function public.approve_mcp_oauth_grant(text, text, text[]) from public, anon;
revoke all on function public.revoke_mcp_oauth_grant(text) from public, anon;
revoke all on function public.authenticate_mcp_oauth_grant() from public, anon;
revoke all on function public.execute_mcp_oauth_operation(uuid, text, jsonb, text) from public, anon;
revoke all on function public.read_mcp_oauth_workspace_snapshot(uuid) from public, anon;
grant execute on function public.approve_mcp_oauth_grant(text, text, text[]) to authenticated;
grant execute on function public.revoke_mcp_oauth_grant(text) to authenticated;
grant execute on function public.authenticate_mcp_oauth_grant() to authenticated;
grant execute on function public.execute_mcp_oauth_operation(uuid, text, jsonb, text) to authenticated;
grant execute on function public.read_mcp_oauth_workspace_snapshot(uuid) to authenticated;

commit;
