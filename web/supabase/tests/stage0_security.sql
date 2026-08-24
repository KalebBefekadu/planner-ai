begin;
select plan(6);

select has_table('public', 'beta_invites', 'beta_invites exists');
select has_table('public', 'ai_request_windows', 'AI quota windows exist');
select row_security_active('public.beta_invites'), 'beta_invites has RLS';
select row_security_active('public.ai_request_windows'), 'AI quota windows have RLS';
select function_privs_are(
  'public', 'consume_ai_quota', array['text'], 'authenticated', array['EXECUTE'],
  'authenticated users can consume only the fixed quota function'
);
select function_privs_are(
  'public', 'claim_beta_invite', array['text', 'text'], 'anon', array[]::text[],
  'anonymous users cannot claim invites directly'
);
select function_privs_are(
  'public', 'claim_beta_invite', array['text', 'text'], 'authenticated', array[]::text[],
  'authenticated users cannot claim invites directly'
);
select function_privs_are(
  'public', 'claim_beta_invite', array['text', 'text'], 'service_role', array['EXECUTE'],
  'only the server admin role can claim invites'
);

select * from finish();
rollback;
