begin;
select plan(15);

-- External access must never exceed the Operation permissions a person has in
-- the interface. The existing MCP coverage proves the happy path and that a
-- revoked token stops authenticating. What was never proven is the negative
-- space the roadmap exit gate actually rests on: that expiry, revocation and
-- capability scope are re-decided at the moment of execution rather than only
-- at the moment of authentication. Every guard below is deliberately tested
-- against the execution functions themselves, because the HTTP route is not
-- the only thing that could ever call them and an authorization boundary that
-- only holds when the caller cooperates is not a boundary.

select function_privs_are(
  'public', 'execute_mcp_operation', array['uuid', 'text', 'jsonb', 'text'],
  'authenticated', array[]::text[],
  'a signed-in person cannot execute Operations through the MCP token path'
);
select function_privs_are(
  'public', 'execute_mcp_operation', array['uuid', 'text', 'jsonb', 'text'],
  'anon', array[]::text[],
  'an anonymous caller cannot execute Operations through the MCP token path'
);
select function_privs_are(
  'public', 'read_mcp_workspace_snapshot', array['uuid'],
  'anon', array[]::text[],
  'an anonymous caller cannot read a workspace snapshot directly'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('ef000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mcp-scope-owner@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ef000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mcp-scope-stranger@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- Four tokens for one owner, each differing in exactly one property, so a
-- failure names the guard that broke rather than "something about tokens".
insert into public.mcp_access_tokens (
  id, workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at, created_at, revoked_at
)
select 'ef000000-0000-0000-0000-0000000000aa', id, owner_user_id, repeat('a', 64),
       'Read only', array['workspace.snapshot.read.v1'], now() + interval '30 days', now(), null
from public.workspaces where owner_user_id = 'ef000000-0000-0000-0000-000000000001';
insert into public.mcp_access_tokens (
  id, workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at, created_at, revoked_at
)
select 'ef000000-0000-0000-0000-0000000000bb', id, owner_user_id, repeat('b', 64),
       'Expired writer', array['workspace.snapshot.read.v1', 'capture.create.v1'],
       now() - interval '1 minute', now() - interval '2 days', null
from public.workspaces where owner_user_id = 'ef000000-0000-0000-0000-000000000001';
insert into public.mcp_access_tokens (
  id, workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at, created_at, revoked_at
)
select 'ef000000-0000-0000-0000-0000000000cc', id, owner_user_id, repeat('c', 64),
       'Revoked writer', array['workspace.snapshot.read.v1', 'capture.create.v1'],
       now() + interval '30 days', now(), clock_timestamp()
from public.workspaces where owner_user_id = 'ef000000-0000-0000-0000-000000000001';
insert into public.mcp_access_tokens (
  id, workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at, created_at, revoked_at
)
select 'ef000000-0000-0000-0000-0000000000dd', id, owner_user_id, repeat('d', 64),
       'Capture only', array['capture.create.v1'], now() + interval '30 days', now(), null
from public.workspaces where owner_user_id = 'ef000000-0000-0000-0000-000000000001';

set local role anon;
select is(
  (select count(*)::integer from public.authenticate_mcp_token(repeat('b', 64))),
  0, 'an expired token yields no claims, so the endpoint can only answer 401'
);
reset role;

set local role service_role;

-- Scope is the whole point of a scoped token. A read grant that can still
-- write is a read grant in name only.
select throws_ok(
  $$select public.execute_mcp_operation(
    'ef000000-0000-0000-0000-0000000000aa', 'capture.create.v1',
    '{"rawText":"scope probe","source":"typed"}'::jsonb, 'mcp-scope-boundary-01'
  )$$,
  '42501', 'operation_not_granted',
  'a token scoped to reads cannot perform a write it was never granted'
);

-- The mirror of the case above: holding a write grant is not a licence to read
-- everything, so the snapshot re-checks its own capability rather than
-- trusting that the caller only offered the tool when it was granted.
select throws_ok(
  $$select public.read_mcp_workspace_snapshot('ef000000-0000-0000-0000-0000000000dd')$$,
  '28000', 'invalid_or_limited_mcp_token',
  'a token never granted the snapshot cannot read the workspace'
);

-- Expiry and revocation are re-decided at execution. Authentication happening
-- earlier in the same request is not evidence that the token is still good.
select throws_ok(
  $$select public.execute_mcp_operation(
    'ef000000-0000-0000-0000-0000000000bb', 'capture.create.v1',
    '{"rawText":"expired probe","source":"typed"}'::jsonb, 'mcp-scope-boundary-02'
  )$$,
  '28000', 'invalid_or_limited_mcp_token',
  'an expired token cannot execute a granted Operation'
);
select throws_ok(
  $$select public.read_mcp_workspace_snapshot('ef000000-0000-0000-0000-0000000000bb')$$,
  '28000', 'invalid_or_limited_mcp_token',
  'an expired token cannot read the workspace snapshot'
);
select throws_ok(
  $$select public.execute_mcp_operation(
    'ef000000-0000-0000-0000-0000000000cc', 'capture.create.v1',
    '{"rawText":"revoked probe","source":"typed"}'::jsonb, 'mcp-scope-boundary-03'
  )$$,
  '28000', 'invalid_or_limited_mcp_token',
  'a revoked token cannot execute a granted Operation'
);

select lives_ok(
  $$select public.execute_mcp_operation(
    'ef000000-0000-0000-0000-0000000000dd', 'capture.create.v1',
    '{"rawText":"granted probe","source":"typed"}'::jsonb, 'mcp-scope-boundary-04'
  )$$,
  'a token granted the Operation performs the write'
);

-- The write must land in the workspace the token names and nowhere else.
select is(
  (select w.owner_user_id from public.captures c
   join public.workspaces w on w.id = c.workspace_id
   where c.raw_text = 'granted probe'),
  'ef000000-0000-0000-0000-000000000001'::uuid,
  'an MCP write lands in the token owner workspace'
);

reset role;

-- Read the audit trail as the owner of the database rather than as
-- service_role, which deliberately holds no read privilege on activity_events.
-- External work has to be distinguishable from work the person did by hand,
-- otherwise revoking a token tells you nothing about what it did while it was
-- live. The surface column is what currently carries that distinction: note
-- that actor_type is recorded as 'user' for an MCP write even though no person
-- typed it, so 'mcp' is the only honest signal in this row today.
select is(
  (select surface from public.activity_events
   where operation_id = 'capture.create.v1'
   order by created_at desc limit 1),
  'mcp', 'an MCP write is attributed to the mcp surface in the activity log'
);
select is(
  (select surface from public.operation_receipts
   where operation_id = 'capture.create.v1'
   order by created_at desc limit 1),
  'mcp', 'an MCP write leaves a receipt marked as external work'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ef000000-0000-0000-0000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"ef000000-0000-0000-0000-000000000002","aal":"aal1"}',
  true
);
select is(
  (select count(*)::integer from public.captures where raw_text = 'granted probe'),
  0, 'another owner cannot read what an MCP token wrote'
);
select is(
  (select count(*)::integer from public.mcp_access_tokens), 0,
  'another owner cannot enumerate the MCP tokens that reach this workspace'
);
reset role;

select * from finish();
rollback;
