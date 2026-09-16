begin;
select plan(11);

select has_table('public', 'beta_invites', 'beta_invites exists');
select has_table('public', 'ai_request_windows', 'AI quota windows exist');
select row_security_active('public.beta_invites'), 'beta_invites has RLS';
select row_security_active('public.ai_request_windows'), 'AI quota windows have RLS';
select function_privs_are(
  'public', 'consume_ai_quota', array['text'], 'authenticated', array['EXECUTE'],
  'authenticated users can consume only the fixed quota function'
);
-- An invite is claimed before the account it creates, so there is no identity
-- to derive anything from. The invite code is the credential: the function
-- matches on its SHA-256, so reaching it means presenting a value that hashes
-- into the table. That is a narrower secret than a key which can read and
-- write every table, which is what guarded this before.
select function_privs_are(
  'public', 'claim_beta_invite', array['text', 'text'], 'anon', array['EXECUTE'],
  'a visitor holding an invite code can claim it'
);
select function_privs_are(
  'public', 'claim_beta_invite', array['text', 'text'], 'authenticated', array[]::text[],
  'a signed-in person has no reason to claim an invite'
);
select function_privs_are(
  'public', 'claim_beta_invite', array['text', 'text'], 'service_role', array[]::text[],
  'claiming an invite no longer needs a trusted role'
);

-- Releasing used to take a bare invite id, which is not a secret, and hand a
-- use back to any invite whose id was known. It now requires the token hash
-- that claimed it, so a release is tied to a claim.
select hasnt_function(
  'public', 'release_beta_invite', array['uuid'],
  'an invite cannot be released by naming its id alone'
);
select function_privs_are(
  'public', 'release_beta_invite', array['uuid', 'text'], 'anon', array['EXECUTE'],
  'a failed signup can hand back the invite it claimed'
);
select function_privs_are(
  'public', 'release_beta_invite', array['uuid', 'text'], 'authenticated', array[]::text[],
  'a signed-in person cannot hand uses back to an invite'
);

-- The table itself stays closed. Both capabilities are the only way in.
select table_privs_are(
  'public', 'beta_invites', 'anon', array[]::text[],
  'a visitor cannot read or write invites directly'
);
select table_privs_are(
  'public', 'beta_invites', 'authenticated', array[]::text[],
  'a signed-in person cannot read or write invites directly'
);

select * from finish();
rollback;
