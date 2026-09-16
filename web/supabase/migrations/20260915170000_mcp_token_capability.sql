-- The MCP manual-token path stops needing a service-role client.
--
-- The OAuth half of this endpoint already runs on the caller's own credential:
-- `execute_mcp_oauth_operation` takes a grant id but proves the caller with
-- `auth.uid()` and the verified `client_id`, and it is granted to
-- `authenticated`. The manual half took a token **id** -- a database
-- identifier, not a secret -- so possession of it proved nothing, and the
-- functions had to be granted to `service_role`. That is the only reason the
-- MCP route held table-wide admin access on every request.
--
-- Both manual functions now take the token hash instead, exactly as
-- `authenticate_mcp_token` already does, and are granted to `anon`. The
-- credential is the token, and presenting its hash is the only way in.
--
-- Nothing else changes. Expiry, revocation and capability scope are still
-- re-decided inside each function at the moment of execution rather than only
-- at authentication, which is the property the scope-boundary tests rest on.

begin;

drop function if exists public.read_mcp_workspace_snapshot(uuid);
drop function if exists public.execute_mcp_operation(uuid, text, jsonb, text);

create function public.read_mcp_workspace_snapshot(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token record;
  v_result jsonb;
begin
  select id as token_id, workspace_id, owner_user_id, allowed_operations
  into v_token
  from public.mcp_access_tokens
  where token_hash = p_token_hash and revoked_at is null
    and expires_at > clock_timestamp();
  if not found or not ('workspace.snapshot.read.v1' = any(v_token.allowed_operations)) then
    raise exception using errcode = '28000', message = 'invalid_or_limited_mcp_token';
  end if;
  v_result := public.build_mcp_workspace_snapshot(v_token.workspace_id);
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

create function public.execute_mcp_operation(
  p_token_hash text,
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
  into v_token from public.mcp_access_tokens
  where token_hash = p_token_hash and revoked_at is null
    and expires_at > clock_timestamp();
  if not found then
    raise exception using errcode = '28000', message = 'invalid_or_limited_mcp_token';
  end if;
  if not (p_operation_id = any(v_token.allowed_operations)) then
    raise exception using errcode = '42501', message = 'operation_not_granted';
  end if;
  perform set_config('request.jwt.claim.sub', v_token.owner_user_id::text, true);
  v_result := public.dispatch_trusted_operation(
    p_operation_id, p_input, p_idempotency_key, 'mcp'
  );
  perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
  return v_result;
end;
$$;

revoke all on function public.read_mcp_workspace_snapshot(text)
from public, authenticated;
grant execute on function public.read_mcp_workspace_snapshot(text) to anon;

revoke all on function public.execute_mcp_operation(text, text, jsonb, text)
from public, authenticated;
grant execute on function public.execute_mcp_operation(text, text, jsonb, text) to anon;

commit;
