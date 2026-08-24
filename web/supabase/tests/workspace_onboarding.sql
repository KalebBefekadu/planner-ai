begin;
select plan(14);

select has_column('public', 'workspaces', 'ai_enabled', 'Workspace stores AI consent');
select has_column(
  'public', 'workspaces', 'onboarding_completed_at', 'Workspace stores setup completion'
);
select function_privs_are(
  'public', 'execute_workspace_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the domain operation cannot be invoked directly'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'onboarding-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('81000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'onboarding-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

select ok(
  (select onboarding_completed_at is null from public.workspaces
   where owner_user_id = '81000000-0000-0000-0000-000000000001'),
  'a newly created Workspace begins unfinished'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","aal":"aal1"}', true
);

select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.preferences.v1',
    '{"timezone":"America/New_York","weekStartsOn":1,"coachingIntensity":"direct","aiEnabled":false,"weeklyReviewDay":0}',
    'workspace-setup-0001'
  )$$,
  'the trusted UI gateway saves setup preferences'
);
select is(
  (select timezone from public.workspaces
   where owner_user_id = '81000000-0000-0000-0000-000000000001'),
  'America/New_York', 'timezone is saved'
);
select is(
  (select coaching_intensity from public.workspaces
   where owner_user_id = '81000000-0000-0000-0000-000000000001'),
  'direct', 'coaching preference is saved'
);
select is(
  (select ai_enabled from public.workspaces
   where owner_user_id = '81000000-0000-0000-0000-000000000001'),
  false, 'AI processing can be disabled'
);
select ok(
  (select onboarding_completed_at is not null from public.workspaces
   where owner_user_id = '81000000-0000-0000-0000-000000000001'),
  'saving preferences completes setup'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'workspace.preferences.v1'),
  1, 'setup writes one operation receipt'
);
select is(
  (select count(*)::integer from public.activity_events
   where operation_id = 'workspace.preferences.v1'),
  1, 'setup is visible in Activity'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.preferences.v1',
    '{"timezone":"UTC","weekStartsOn":0,"coachingIntensity":"strict","aiEnabled":true,"weeklyReviewDay":6}',
    'workspace-setup-0001'
  )$$,
  'an idempotent retry returns the original result'
);
select is(
  (select timezone from public.workspaces
   where owner_user_id = '81000000-0000-0000-0000-000000000001'),
  'America/New_York', 'an idempotent retry does not overwrite preferences'
);

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000002","aal":"aal1"}', true
);
select is(
  (select count(*)::integer from public.activity_events
   where operation_id = 'workspace.preferences.v1'),
  0, 'another owner cannot inspect setup Activity'
);

select * from finish();
rollback;
