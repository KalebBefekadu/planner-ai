begin;
select plan(25);

select function_privs_are(
  'public', 'execute_guided_onboarding_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the guided onboarding Undo executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'd1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'onboarding-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.onboarding-complete.v1',
    '{
      "timezone":"America/New_York","weekStartsOn":0,"coachingIntensity":"direct",
      "aiEnabled":true,"weeklyReviewDay":2,"today":"2026-08-17",
      "visionText":"Build a deliberate practice.",
      "goalTitle":"Publish useful work","actionTitle":"Draft the first outline",
      "captureText":"Preserve this first thought."
    }',
    'onboarding-undo-full-0001'
  )$$,
  'guided onboarding creates the complete optional starter plan'
);
select is(
  (select undo_payload_json #>> '{vision,mode}' from public.operation_receipts
   where idempotency_key = 'onboarding-undo-full-0001'),
  'create', 'the receipt distinguishes its newly created Vision'
);
select is(
  (select jsonb_array_length(undo_payload_json -> 'horizons') from public.operation_receipts
   where idempotency_key = 'onboarding-undo-full-0001'),
  2, 'the receipt snapshots both starter planning horizons'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'onboarding-undo-full-0001')
    ),
    'onboarding-undo-full-apply-0001'
  )$$,
  'unchanged guided onboarding can be undone atomically'
);
select ok((select onboarding_completed_at is null from public.workspaces),
  'onboarding Undo restores the unfinished Workspace state');
select is((select timezone from public.workspaces), 'UTC',
  'onboarding Undo restores the prior Workspace timezone');
select is((select count(*)::integer from public.visions), 0,
  'onboarding Undo removes only its new Vision');
select is((select count(*)::integer from public.goals), 0,
  'onboarding Undo removes its starter Goal');
select is((select count(*)::integer from public.actions), 0,
  'onboarding Undo removes its starter Action');
select is((select count(*)::integer from public.captures), 0,
  'onboarding Undo removes its starter Capture');
select is((select count(*)::integer from public.planning_horizons), 0,
  'onboarding Undo removes its unreferenced new horizons');

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"Existing direction."}',
    'onboarding-undo-existing-vision-0001'
  )$$,
  'an existing Vision is created outside onboarding'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.onboarding-complete.v1',
    '{
      "timezone":"America/Los_Angeles","weekStartsOn":1,"coachingIntensity":"strict",
      "aiEnabled":false,"weeklyReviewDay":5,"today":"2026-08-17",
      "visionText":"Revised during setup.",
      "goalTitle":null,"actionTitle":null,"captureText":null
    }',
    'onboarding-undo-existing-update-0001'
  )$$,
  'guided onboarding can revise an existing Vision'
);
select is(
  (select undo_payload_json #>> '{vision,mode}' from public.operation_receipts
   where idempotency_key = 'onboarding-undo-existing-update-0001'),
  'update', 'the receipt distinguishes an existing Vision update'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'onboarding-undo-existing-update-0001')
    ),
    'onboarding-undo-existing-update-apply-0001'
  )$$,
  'onboarding Undo can restore an unchanged existing Vision'
);
select is((select body_markdown from public.visions), 'Existing direction.',
  'onboarding Undo restores the prior Vision Markdown');
select is((select version from public.visions), 3::bigint,
  'restoring the existing Vision keeps its version monotonic');
select ok((select onboarding_completed_at is null from public.workspaces),
  'existing-Vision Undo restores unfinished onboarding');

select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.onboarding-complete.v1',
    '{
      "timezone":"UTC","weekStartsOn":1,"coachingIntensity":"calm",
      "aiEnabled":true,"weeklyReviewDay":0,"today":"2026-08-17",
      "visionText":null,"goalTitle":null,"actionTitle":null,"captureText":null
    }',
    'onboarding-undo-conflict-setup-0001'
  )$$,
  'settings-only onboarding is completed for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.preferences.v1',
    '{"timezone":"America/Chicago","weekStartsOn":6,"coachingIntensity":"direct","aiEnabled":false,"weeklyReviewDay":4}',
    'onboarding-undo-conflict-preferences-0001'
  )$$,
  'later Workspace preferences supersede onboarding settings'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'onboarding-undo-conflict-setup-0001')
    ),
    'onboarding-undo-conflict-apply-0001'
  )$$,
  'P0001', 'undo_conflict',
  'Undo refuses to overwrite later Workspace preferences'
);
select is((select timezone from public.workspaces), 'America/Chicago',
  'a refused Undo preserves the newer timezone');
select ok((select onboarding_completed_at is not null from public.workspaces),
  'a refused Undo preserves completed onboarding');
select is((select count(*)::integer from public.visions), 1,
  'settings-only onboarding and refused Undo preserve the existing Vision');

select * from finish();
rollback;
