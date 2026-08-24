begin;

create or replace function public.consume_mcp_oauth_quota(p_grant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_id text := auth.jwt() ->> 'client_id';
  v_window_start timestamptz := date_trunc('minute', clock_timestamp());
  v_count integer;
begin
  if not exists (
    select 1 from public.mcp_oauth_grants
    where id = p_grant_id and owner_user_id = v_user_id
      and oauth_client_id = v_client_id and revoked_at is null
  ) then
    return false;
  end if;
  insert into public.mcp_oauth_usage_windows (grant_id, window_started_at, request_count)
  values (p_grant_id, v_window_start, 1)
  on conflict (grant_id, window_started_at)
  do update set request_count = public.mcp_oauth_usage_windows.request_count + 1
  where public.mcp_oauth_usage_windows.request_count < 60
  returning request_count into v_count;
  if v_count is null then return false; end if;
  update public.mcp_oauth_grants set last_used_at = clock_timestamp() where id = p_grant_id;
  return true;
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
begin
  if v_user_id is null or v_client_id is null then return; end if;
  return query
  select grant_row.id, grant_row.workspace_id, grant_row.owner_user_id,
    grant_row.allowed_operations
  from public.mcp_oauth_grants grant_row
  where grant_row.owner_user_id = v_user_id
    and grant_row.oauth_client_id = v_client_id
    and grant_row.revoked_at is null;
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
  if not found then
    raise exception using errcode = '28000', message = 'invalid_mcp_oauth_grant';
  end if;
  if not (p_operation_id = any(v_grant.allowed_operations)) then
    raise exception using errcode = '42501', message = 'operation_not_granted';
  end if;
  if not public.consume_mcp_oauth_quota(p_grant_id) then
    raise exception using errcode = 'P0001', message = 'mcp_rate_limit_exceeded';
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
  if not public.consume_mcp_oauth_quota(p_grant_id) then
    raise exception using errcode = 'P0001', message = 'mcp_rate_limit_exceeded';
  end if;
  v_result := public.build_mcp_workspace_snapshot(v_grant.workspace_id);
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

revoke all on function public.consume_mcp_oauth_quota(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.authenticate_mcp_oauth_grant() from public, anon;
revoke all on function public.execute_mcp_oauth_operation(uuid, text, jsonb, text)
from public, anon;
revoke all on function public.read_mcp_oauth_workspace_snapshot(uuid) from public, anon;
grant execute on function public.authenticate_mcp_oauth_grant() to authenticated;
grant execute on function public.execute_mcp_oauth_operation(uuid, text, jsonb, text)
to authenticated;
grant execute on function public.read_mcp_oauth_workspace_snapshot(uuid) to authenticated;

commit;
