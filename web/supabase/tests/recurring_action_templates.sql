begin;
select plan(41);

select has_table('public', 'action_templates', 'recurring Action templates exist');
select row_security_active('public.action_templates'), 'Action templates have RLS';
select table_privs_are(
  'public', 'action_templates', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate templates directly'
);
select function_privs_are(
  'public', 'execute_action_template_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the recurring Action executor is private'
);
select is(
  (select count(*)::integer from public.operation_contracts
   where operation_id like 'action-template.%'),
  5, 'all recurring Action Operations are registered'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'recurrence-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('d1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'recurrence-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);

select lives_ok(
  format(
    'select public.execute_ui_operation(''action-template.create.v1'', %L::jsonb, ''template-create-0001'')',
    jsonb_build_object(
      'title', 'Publish a weekly progress note',
      'descriptionMarkdown', 'Share decisions and blockers.',
      'goalId', null,
      'cadence', 'weekly',
      'firstOccurrenceOn', current_date
    )::text
  ),
  'a weekly template creates through the trusted gateway'
);
select is((select count(*)::integer from public.action_templates), 1,
  'one template is stored');
select is((select count(*)::integer from public.actions where recurrence_template_id is not null), 1,
  'template creation materializes its first ordinary Action');
select is(
  (select scheduled_on from public.actions where recurrence_template_id is not null),
  current_date, 'the first Action uses the selected date'
);
select lives_ok(
  format(
    'select public.execute_ui_operation(''action-template.create.v1'', %L::jsonb, ''template-create-0001'')',
    jsonb_build_object(
      'title', 'Publish a weekly progress note',
      'descriptionMarkdown', 'Share decisions and blockers.',
      'goalId', null,
      'cadence', 'weekly',
      'firstOccurrenceOn', current_date
    )::text
  ),
  'replaying the same idempotency key succeeds'
);
select is((select count(*)::integer from public.actions where recurrence_template_id is not null), 1,
  'idempotent replay does not duplicate an Action');

select lives_ok(
  format(
    'select public.execute_ui_operation(''action-template.materialize.v1'', %L::jsonb, ''template-materialize-0001'')',
    jsonb_build_object(
      'id', (select id from public.action_templates),
      'expectedVersion', 1,
      'throughOn', current_date + 14
    )::text
  ),
  'due weekly occurrences materialize in one bounded operation'
);
select is((select count(*)::integer from public.actions where recurrence_template_id is not null), 3,
  'two additional weekly Actions are created');
select is(
  (select count(distinct scheduled_on)::integer from public.actions
   where recurrence_template_id is not null),
  3, 'each occurrence date is unique'
);
select is((select next_occurrence_on from public.action_templates), current_date + 21,
  'the template advances to the next unmaterialized date');
select is((select version::integer from public.action_templates), 2,
  'materialization advances the template version once');

select lives_ok(
  format(
    'select public.execute_ui_operation(''action-template.status.v1'', %L::jsonb, ''template-pause-0001'')',
    jsonb_build_object(
      'id', (select id from public.action_templates),
      'expectedVersion', 2,
      'status', 'paused'
    )::text
  ),
  'a template can be paused'
);
select is((select status from public.action_templates), 'paused', 'pause status is durable');
select throws_ok(
  format(
    'select public.execute_ui_operation(''action-template.materialize.v1'', %L::jsonb, ''template-paused-run-0001'')',
    jsonb_build_object(
      'id', (select id from public.action_templates),
      'expectedVersion', 3,
      'throughOn', current_date + 28
    )::text
  ),
  'P0001', 'template_paused', 'paused templates refuse generation'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'template-pause-0001')
    ),
    'template-pause-undo-0001'
  )$$,
  'an unchanged pause can be undone'
);
select is((select status from public.action_templates), 'active',
  'pause Undo restores active status');
select is((select version::integer from public.action_templates), 2,
  'pause Undo restores the expected version');

select lives_ok(
  format(
    'select public.execute_ui_operation(''action-template.archive.v1'', %L::jsonb, ''template-archive-0001'')',
    jsonb_build_object(
      'id', (select id from public.action_templates),
      'expectedVersion', 2
    )::text
  ),
  'a template can be archived without changing occurrences'
);
select ok((select archived_at is not null from public.action_templates),
  'archive time is recorded');
select is((select count(*)::integer from public.actions where recurrence_template_id is not null), 3,
  'archiving leaves independent Actions unchanged');
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'template-archive-0001')
    ),
    'template-archive-undo-0001'
  )$$,
  'an unchanged archive can be undone'
);
select ok((select archived_at is null from public.action_templates),
  'archive Undo restores the template');

select lives_ok(
  format(
    'select public.execute_ui_operation(''action-template.create.v1'', %L::jsonb, ''template-create-0002'')',
    jsonb_build_object(
      'title', 'Close the month deliberately',
      'descriptionMarkdown', null,
      'goalId', null,
      'cadence', 'monthly',
      'firstOccurrenceOn', (date_trunc('month', current_date) + interval '1 month 14 days')::date
    )::text
  ),
  'a monthly template can be created on a mid-month day'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'template-create-0002')
    ),
    'template-create-undo-0002'
  )$$,
  'an unchanged template creation can be undone atomically'
);
select is((select count(*)::integer from public.action_templates), 1,
  'create Undo removes only the new template');
select is((select count(*)::integer from public.actions where title = 'Close the month deliberately'), 0,
  'create Undo removes its generated Action');

-- See PL-11. Month-end recurrences used to be refused outright at creation
-- because a template stored only its next date and nothing could carry a 31st
-- through February. The anchor carries it, so the last day of the month is a
-- schedule someone is allowed to ask for. The first 31 January on or after
-- today is used so the case is exercised whenever the suite runs.
select lives_ok(
  format(
    'select public.execute_ui_operation(''action-template.create.v1'', %L::jsonb, ''template-create-0003'')',
    jsonb_build_object(
      'title', 'Close the books on the last day',
      'descriptionMarkdown', null,
      'goalId', null,
      'cadence', 'monthly',
      'firstOccurrenceOn', case
        when current_date <= (date_trunc('year', current_date) + interval '1 month - 1 day')::date
          then (date_trunc('year', current_date) + interval '1 month - 1 day')::date
        else (date_trunc('year', current_date) + interval '1 year 1 month - 1 day')::date
      end
    )::text
  ),
  'a monthly template can be created on the 31st'
);
select is(
  (select monthly_anchor_day::integer from public.action_templates
   where title = 'Close the books on the last day'),
  31, 'the chosen day of month is recorded on the template'
);
select is(
  (select extract(day from scheduled_on)::integer from public.actions
   where title = 'Close the books on the last day'),
  31, 'the first occurrence lands on the day that was asked for'
);
select is(
  (select next_occurrence_on from public.action_templates
   where title = 'Close the books on the last day'),
  (select (date_trunc('month', scheduled_on) + interval '2 months - 1 day')::date
   from public.actions where title = 'Close the books on the last day'),
  'the occurrence after a 31 January is the last day of February, not 3 March'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''action-template.update.v1'', %L::jsonb, ''template-update-0003'')',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Close the books on the last day'),
      'expectedVersion', 1,
      'title', 'Close the books mid month',
      'descriptionMarkdown', null,
      'goalId', null,
      'cadence', 'monthly',
      'nextOccurrenceOn', (date_trunc('month', current_date) + interval '1 month 14 days')::date
    )::text
  ),
  'the next date can be moved to a different day of month'
);
select is(
  (select monthly_anchor_day::integer from public.action_templates
   where title = 'Close the books mid month'),
  15, 'moving the next date moves the anchor with it, not just that one occurrence'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'template-update-0003')
    ),
    'template-update-undo-0003'
  )$$,
  'an unchanged reschedule can be undone'
);
select is(
  (select monthly_anchor_day::integer from public.action_templates
   where title = 'Close the books on the last day'),
  31, 'Undo restores the anchor along with the date, so the series repeats as it did'
);

select ok(
  (select bool_and(monthly_anchor_day is null) from public.action_templates
   where cadence = 'weekly'),
  'weekly templates carry no day-of-month anchor'
);

select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.action_templates), 0,
  'RLS hides another owner''s templates');
select is((select count(*)::integer from public.actions where recurrence_template_id is not null), 0,
  'RLS hides another owner''s generated Actions');

select * from finish();
rollback;
