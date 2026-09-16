begin;
select plan(9);

-- `allowed_operations` was constrained only by its length. A grant could name
-- an Operation the contract does not expose to MCP, or an id that is not an
-- Operation at all. The router refuses such a grant when it is used; this
-- refuses it when it is made.

select has_function(
  'public', 'assert_mcp_grant_follows_contract',
  'the grant contract check exists'
);
select ok(
  (select proc.prosecdef
     and 'search_path=pg_catalog, public' = any(coalesce(proc.proconfig, array[]::text[]))
   from pg_proc proc join pg_namespace space on space.oid = proc.pronamespace
   where space.nspname = 'public' and proc.proname = 'assert_mcp_grant_follows_contract'),
  'it is security definer with a fixed search path'
);
-- operation_contracts forces RLS, so evaluated as the caller the lookup would
-- find nothing and every grant would be rejected.
select ok(
  (select count(*)::integer from pg_trigger trigger_row
   join pg_class table_row on table_row.oid = trigger_row.tgrelid
   where not trigger_row.tgisinternal
     and table_row.relname in ('mcp_access_tokens', 'mcp_oauth_grants')
     and trigger_row.tgname like '%follow_contract') = 2,
  'both grant tables carry the check'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'grant-contract@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

select set_config('test.workspace',
  (select id::text from public.workspaces
   where owner_user_id = 'e1000000-0000-4000-8000-000000000001'), true);

-- A grant naming only Operations the contract exposes to MCP is accepted.
select lives_ok(
  $$insert into public.mcp_access_tokens (
      workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
    ) values (
      current_setting('test.workspace')::uuid, 'e1000000-0000-4000-8000-000000000001',
      repeat('1', 64), 'Exposed only',
      array['workspace.snapshot.read.v1', 'goal.create.v1'],
      now() + interval '30 days'
    )$$,
  'a grant naming exposed Operations is accepted'
);

/* `note.appearance.v1` carries exposure {ui}. Before the router was
   consolidated, a token naming it could reach the handler over MCP, because
   the contract was never consulted for that family. */
select throws_ok(
  $$insert into public.mcp_access_tokens (
      workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
    ) values (
      current_setting('test.workspace')::uuid, 'e1000000-0000-4000-8000-000000000001',
      repeat('2', 64), 'Ui only', array['note.appearance.v1'],
      now() + interval '30 days'
    )$$,
  '23514', 'mcp_grant_not_exposed',
  'a grant naming a ui-only Operation is refused'
);
select throws_ok(
  $$insert into public.mcp_access_tokens (
      workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
    ) values (
      current_setting('test.workspace')::uuid, 'e1000000-0000-4000-8000-000000000001',
      repeat('3', 64), 'Not an Operation', array['not.an.operation.v1'],
      now() + interval '30 days'
    )$$,
  '23514', 'mcp_grant_not_exposed',
  'a grant naming something that is not an Operation is refused'
);

/* One bad entry among good ones is still a bad grant -- otherwise the check
   could be walked past by padding. */
select throws_ok(
  $$insert into public.mcp_access_tokens (
      workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
    ) values (
      current_setting('test.workspace')::uuid, 'e1000000-0000-4000-8000-000000000001',
      repeat('4', 64), 'Mostly fine',
      array['goal.create.v1', 'note.appearance.v1', 'action.create.v1'],
      now() + interval '30 days'
    )$$,
  '23514', 'mcp_grant_not_exposed',
  'one unexposed entry among exposed ones still refuses the grant'
);

/* Widening an existing grant is the same decision as making one, so the check
   has to fire on update too, not only on insert. */
select throws_ok(
  $$update public.mcp_access_tokens
    set allowed_operations = array['goal.create.v1', 'note.appearance.v1']
    where token_hash = repeat('1', 64)$$,
  '23514', 'mcp_grant_not_exposed',
  'widening a grant to an unexposed Operation is refused'
);
select lives_ok(
  $$update public.mcp_access_tokens
    set allowed_operations = array['goal.create.v1']
    where token_hash = repeat('1', 64)$$,
  'narrowing a grant to exposed Operations is accepted'
);

select * from finish();
rollback;
