begin;
select plan(24);

select has_column(
  'public', 'action_templates', 'occurrences_per_period',
  'a routine can carry a target instead of an anchor day'
);
select has_column('public', 'actions', 'occurrence_slot', 'and a session occupies a slot');
select hasnt_index(
  'public', 'actions', 'actions_occurrence_slot_idx_missing',
  'the slot index is named, so the next assertion is about the real one'
);
select has_index(
  'public', 'actions', 'actions_occurrence_slot_idx',
  'two requests cannot take the same slot'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('54000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'routine-owner@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '54000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"Anything at all","source":"typed"}', 'routine-ws-0001'
  )$$,
  'a workspace exists'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action-template.create.v1',
    jsonb_build_object(
      'title', 'Run', 'descriptionMarkdown', null, 'goalId', null,
      'cadence', 'weekly',
      'firstOccurrenceOn', date_trunc('week', current_date)::date
    ),
    'routine-create-0001'
  )$$,
  'a weekly routine is created the way it always was'
);

-- Before a target is set it is a dated routine, and logging a session is not
-- something it can do.
select throws_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', current_date
    ),
    'routine-log-0000'
  )$$,
  'P0001', 'not_a_frequency_target',
  'a dated routine has no sessions to count'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'action-template.frequency.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'expectedVersion', (select version from public.action_templates where title = 'Run'),
      'occurrencesPerPeriod', 3
    ),
    'routine-target-0001'
  )$$,
  'three times a week is a target the routine can hold'
);

-- The routine's own first dated occurrence, made before it became a target,
-- sits on the week start. Recording a session that day counts it rather than
-- inserting a rival beside it.
select lives_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', date_trunc('week', current_date)::date
    ),
    'routine-log-0001'
  )$$,
  'a dated occurrence already on that day is counted as the session'
);
select is(
  (select count(*)::integer from public.actions
   where scheduled_on = date_trunc('week', current_date)::date), 1,
  'and no second row is created beside it'
);
select is(
  (select occurrence_slot from public.actions
   where scheduled_on = date_trunc('week', current_date)::date), 1::smallint,
  'taking the first slot of the period'
);
select is(
  (select occurrence_period_start from public.actions where occurrence_slot = 1),
  date_trunc('week', current_date)::date,
  'counted in the period the day falls in, not the day it was logged'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', date_trunc('week', current_date)::date
    ),
    'routine-log-0001b'
  )$$,
  'P0001', 'occurrence_already_recorded',
  'a second session on a day that already has one is refused by name'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', (date_trunc('week', current_date)::date + 2)
    ),
    'routine-log-0002'
  )$$,
  'a second session on a different day'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', (date_trunc('week', current_date)::date + 4)
    ),
    'routine-log-0003'
  )$$,
  'and a third, which meets the target'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', (date_trunc('week', current_date)::date + 5)
    ),
    'routine-log-0004'
  )$$,
  'P0001', 'frequency_target_met',
  'a fourth is refused rather than counted, because three was the target'
);
select is(
  (select count(*)::integer from public.actions where occurrence_slot is not null), 3,
  'so the week holds exactly three sessions'
);

-- The retry guarantee. The same request twice is one session, not two.
select lives_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', (date_trunc('week', current_date)::date + 4)
    ),
    'routine-log-0003'
  )$$,
  'a repeated request answers with the session it already recorded'
);
select is(
  (select count(*)::integer from public.actions where occurrence_slot is not null), 3,
  'and does not record a fourth'
);

-- Next week is its own count.
select lives_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', (date_trunc('week', current_date)::date + 7)
    ),
    'routine-log-0005'
  )$$,
  'next week starts again at the first slot'
);
select is(
  (select occurrence_slot from public.actions
   where occurrence_period_start = date_trunc('week', current_date)::date + 7),
  1::smallint,
  'because a target is counted per period, not per routine'
);

-- Pausing stops the count without deleting what is already counted.
select lives_ok(
  $$select public.execute_ui_operation(
    'action-template.status.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'expectedVersion', (select version from public.action_templates where title = 'Run'),
      'status', 'paused'
    ),
    'routine-pause-0001'
  )$$,
  'a routine can be paused'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'action-template.log-occurrence.v1',
    jsonb_build_object(
      'id', (select id from public.action_templates where title = 'Run'),
      'on', (date_trunc('week', current_date)::date + 8)
    ),
    'routine-log-0006'
  )$$,
  'P0001', 'template_not_active',
  'and a paused routine records nothing new'
);
select is(
  (select count(*)::integer from public.actions where occurrence_slot is not null), 4,
  'while every session already recorded is still there'
);

select * from finish();
rollback;
