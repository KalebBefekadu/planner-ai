-- An MCP grant cannot name an Operation the contract does not expose to MCP.
--
-- `allowed_operations` was constrained only by `cardinality(...) <= 50` on both
-- grant tables. Nothing in the database required a granted id to be a real
-- Operation, let alone one whose `operation_contracts` row lists `mcp`. The
-- catalog that builds the list a person picks from does filter on exposure, but
-- it does so in TypeScript, so the rule held only for callers who went through
-- it.
--
-- The router now refuses such a grant when it is used. This refuses it when it
-- is made, which is where a person can still be told something useful about it.
--
-- A check constraint cannot see another table, so this is a trigger. It is
-- `security definer` because `operation_contracts` forces row level security:
-- evaluated as the caller, the lookup would find nothing and every grant would
-- be rejected. That is the same fault that silently denied every attachment
-- upload one branch earlier, which is why it is called out here rather than
-- left for the next person to rediscover.

begin;

create function public.assert_mcp_grant_follows_contract()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_unexposed text[];
begin
  select array_agg(candidate order by candidate) into v_unexposed
  from unnest(new.allowed_operations) as candidate
  where not exists (
    select 1 from public.operation_contracts contract
    where contract.operation_id = candidate and 'mcp' = any(contract.exposures)
  );

  if v_unexposed is not null then
    -- The ids are the person's own input, not workspace content, so naming
    -- them tells them which entry to remove rather than that something,
    -- somewhere, was wrong.
    raise exception using
      errcode = '23514',
      message = 'mcp_grant_not_exposed',
      detail = 'Not exposed to MCP: ' || array_to_string(v_unexposed, ', ');
  end if;
  return new;
end;
$$;

revoke all on function public.assert_mcp_grant_follows_contract()
from public, anon, authenticated;

-- Existing rows are left alone deliberately. A grant made before this rule can
-- no longer be used -- the router refuses it -- and rewriting history here
-- would fail the migration on a database that holds one, which is a worse
-- outcome than a grant that simply stops working.
create trigger mcp_access_tokens_follow_contract
before insert or update of allowed_operations on public.mcp_access_tokens
for each row execute function public.assert_mcp_grant_follows_contract();

create trigger mcp_oauth_grants_follow_contract
before insert or update of allowed_operations on public.mcp_oauth_grants
for each row execute function public.assert_mcp_grant_follows_contract();

commit;
