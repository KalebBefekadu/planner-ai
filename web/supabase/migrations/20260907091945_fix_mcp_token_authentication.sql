begin;

-- RETURNS TABLE creates output variables named token_id/workspace_id/etc. The
-- original conflict target `on conflict (token_id, ...)` therefore became
-- ambiguous in PL/pgSQL and rejected every valid manual token lookup.
create or replace function public.authenticate_mcp_token(p_token_hash text)
returns table(token_id uuid, workspace_id uuid, owner_user_id uuid, allowed_operations text[])
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
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

revoke all on function public.authenticate_mcp_token(text) from public, authenticated;
grant execute on function public.authenticate_mcp_token(text) to anon;

commit;
