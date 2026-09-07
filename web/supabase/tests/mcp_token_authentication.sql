begin;
select plan(7);

select function_privs_are(
  'public', 'authenticate_mcp_token', array['text'], 'anon', array['EXECUTE'],
  'only the anonymous MCP credential verifier can invoke token authentication'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'ee000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'mcp-auth@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.mcp_access_tokens (
  id, workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
)
select
  'ee000000-0000-0000-0000-000000000002', id, owner_user_id, repeat('e', 64),
  'Authentication test', array['workspace.snapshot.read.v1'], now() + interval '30 days'
from public.workspaces
where owner_user_id = 'ee000000-0000-0000-0000-000000000001';

set local role anon;
select lives_ok(
  $$select * from public.authenticate_mcp_token(repeat('e', 64))$$,
  'an anonymous MCP request can authenticate a valid token'
);
select is(
  (select count(*)::integer from public.authenticate_mcp_token(repeat('e', 64))),
  1, 'a valid token yields exactly one claim set'
);
select is(
  (select token_id from public.authenticate_mcp_token(repeat('e', 64))),
  'ee000000-0000-0000-0000-000000000002'::uuid, 'the returned claim identifies the token'
);
select is(
  (select allowed_operations from public.authenticate_mcp_token(repeat('e', 64))),
  array['workspace.snapshot.read.v1']::text[], 'the returned claim preserves granted capability scope'
);
reset role;

select ok(
  (select last_used_at is not null from public.mcp_access_tokens
   where id = 'ee000000-0000-0000-0000-000000000002'),
  'authentication records token use'
);

update public.mcp_access_tokens
set revoked_at = clock_timestamp()
where id = 'ee000000-0000-0000-0000-000000000002';

set local role anon;
select is(
  (select count(*)::integer from public.authenticate_mcp_token(repeat('e', 64))),
  0, 'a revoked token no longer yields claims'
);

select * from finish();
rollback;
