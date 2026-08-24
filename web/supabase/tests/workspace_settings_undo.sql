begin;
select plan(18);

select function_privs_are(
  'public', 'execute_workspace_settings_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Workspace settings restore executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'settings-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c6000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.preferences.v1',
    '{"timezone":"America/New_York","weekStartsOn":0,"coachingIntensity":"direct","aiEnabled":false,"weeklyReviewDay":3}',
    'settings-preferences-0001'
  )$$,
  'Workspace preferences capture their prior values'
);
select is(
  (select undo_payload_json ->> 'timezone' from public.operation_receipts
   where idempotency_key = 'settings-preferences-0001'),
  'UTC', 'the preferences receipt retains the prior timezone'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'settings-preferences-0001')
    ),
    'settings-preferences-undo-0001'
  )$$,
  'unchanged Workspace preferences can be undone'
);
select is((select timezone from public.workspaces), 'UTC',
  'preferences undo restores timezone');
select is((select week_starts_on from public.workspaces), 1::smallint,
  'preferences undo restores the week start');
select is((select coaching_intensity from public.workspaces), 'calm',
  'preferences undo restores coaching intensity');
select is((select ai_enabled from public.workspaces), true,
  'preferences undo restores prior AI consent');
select is((select weekly_review_day from public.workspaces), 0::smallint,
  'preferences undo restores the weekly review day');

select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.ai-budget.v1', '{"softBudgetCents":900}', 'settings-budget-0001'
  )$$,
  'an AI soft budget captures its prior value'
);
select is(
  (select (undo_payload_json ->> 'softBudgetCents')::integer from public.operation_receipts
   where idempotency_key = 'settings-budget-0001'),
  500, 'the budget receipt retains the prior cents'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'settings-budget-0001')
    ),
    'settings-budget-undo-0001'
  )$$,
  'an unchanged AI soft budget can be undone'
);
select is((select ai_soft_budget_cents from public.workspaces), 500,
  'budget undo restores the prior cents');

select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.preferences.v1',
    '{"timezone":"America/New_York","weekStartsOn":0,"coachingIntensity":"direct","aiEnabled":false,"weeklyReviewDay":3}',
    'settings-conflict-first-0001'
  )$$,
  'a preference change is captured for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.preferences.v1',
    '{"timezone":"America/Chicago","weekStartsOn":6,"coachingIntensity":"strict","aiEnabled":true,"weeklyReviewDay":5}',
    'settings-conflict-second-0001'
  )$$,
  'newer preferences supersede it'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'settings-conflict-first-0001')
    ),
    'settings-conflict-undo-0001'
  )$$,
  '40001', 'undo_conflict',
  'undo refuses to overwrite newer Workspace preferences'
);
select is((select timezone from public.workspaces), 'America/Chicago',
  'a refused preferences undo preserves the newest timezone');
select is((select ai_enabled from public.workspaces), true,
  'a refused preferences undo preserves the newest AI consent');

select * from finish();
rollback;
