begin;
select plan(16);

select has_table('public', 'mcp_oauth_grants', 'MCP OAuth grants exist');
select row_security_active('public.mcp_oauth_grants'), 'MCP OAuth grants have RLS';
select table_privs_are(
  'public', 'mcp_oauth_grants', 'authenticated', array[]::text[],
  'authenticated users cannot mutate OAuth grants directly'
);
select function_privs_are(
  'public', 'approve_mcp_oauth_grant', array['text', 'text', 'text[]'],
  'authenticated', array['EXECUTE'], 'AAL2 users can approve scoped OAuth grants'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'oauth-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'oauth-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-0000-0000-000000000001","aal":"aal2"}',
  true
);

select lives_ok(
  $$select public.approve_mcp_oauth_grant(
    '70000000-0000-0000-0000-000000000001', 'Test AI Client',
    array['workspace.snapshot.read.v1', 'capture.create.v1']
  )$$,
  'AAL2 consent stores a product capability grant'
);
select is((select count(*)::integer from public.mcp_oauth_grants), 1, 'one OAuth grant is stored');
select is(
  (select allowed_operations from public.mcp_oauth_grants limit 1),
  array['workspace.snapshot.read.v1', 'capture.create.v1']::text[],
  'the exact approved capability set is retained'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-0000-0000-000000000001","aal":"aal1","client_id":"70000000-0000-0000-0000-000000000001"}',
  true
);
select is(
  (select count(*)::integer from public.authenticate_mcp_oauth_grant()),
  1,
  'the matching verified OAuth client can authenticate'
);
select lives_ok(
  $$select public.execute_mcp_oauth_operation(
    (select id from public.mcp_oauth_grants limit 1),
    'capture.create.v1', '{"rawText":"  OAuth exact Capture.  ","source":"typed"}',
    'oauth-capture-0001'
  )$$,
  'the OAuth client executes only through the trusted MCP dispatcher'
);
select is(
  (select raw_text from public.captures limit 1),
  '  OAuth exact Capture.  ',
  'OAuth execution preserves exact Capture input'
);
set local role service_role;
select is(
  (select request_count from public.mcp_oauth_usage_windows limit 1),
  1, 'quota is charged by execution rather than authentication'
);
set local role authenticated;
select throws_ok(
  format(
    'select public.execute_mcp_oauth_operation(%L, ''goal.archive.v1'', ''{}''::jsonb, ''oauth-denied-0001'')',
    (select id from public.mcp_oauth_grants limit 1)
  ),
  '42501', 'operation_not_granted',
  'an ungranted Operation is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-0000-0000-000000000001","aal":"aal1","client_id":"70000000-0000-0000-0000-000000000099"}',
  true
);
select is(
  (select count(*)::integer from public.authenticate_mcp_oauth_grant()),
  0,
  'a different OAuth client cannot reuse the grant'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-0000-0000-000000000001","aal":"aal1"}',
  true
);
select lives_ok(
  $$select public.revoke_mcp_oauth_grant('70000000-0000-0000-0000-000000000001')$$,
  'the owner can revoke product authority'
);
select ok(
  (select revoked_at is not null from public.mcp_oauth_grants limit 1),
  'revocation is durable'
);

select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-0000-0000-000000000002","aal":"aal1"}',
  true
);
select is((select count(*)::integer from public.mcp_oauth_grants), 0, 'another owner cannot read OAuth grants');
select is((select count(*)::integer from public.captures), 0, 'another owner cannot read OAuth-created data');

select * from finish();
rollback;
