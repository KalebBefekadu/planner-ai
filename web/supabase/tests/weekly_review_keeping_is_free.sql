begin;
select plan(15);

-- Weekly Review demanded an explicit decision on every unfinished Action. That
-- was right while the week was the only container: an Action that rolled over
-- unremarked left no trace, so the forced decision was the only thing between
-- the owner and an invisible backlog.
--
-- The Review now shows how long each open Action has sat, counted as completed
-- Weekly Reviews it has outlived. Rolling over is no longer silent, so the tax
-- can go -- except on the part that earns it. Work past three checkpoints must
-- still be answered.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('5b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'keeping-free-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '5b000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Carried a long time","horizonKind":"week","startsOn":"2026-08-10","endsOn":"2026-08-16","goalId":null,"parentActionId":null,"scheduledOn":"2026-08-12"}',
    'keeping-free-action-0001'
  )$$,
  'an Action exists in the week under review'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Written this week","horizonKind":"week","startsOn":"2026-08-10","endsOn":"2026-08-16","goalId":null,"parentActionId":null,"scheduledOn":"2026-08-13"}',
    'keeping-free-action-0002'
  )$$,
  'a second Action exists in the same week'
);

-- Nothing has been reviewed yet, so nothing has outlived anything, and the
-- week closes with no decisions at all. This is the change: staying open is
-- free and needs no interaction.
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    '{"startsOn":"2026-08-10","endsOn":"2026-08-16","reflectionMarkdown":"","decisions":[]}',
    'keeping-free-review-0001'
  )$$,
  'a week closes with no decisions at all'
);
select is(
  (select count(*)::integer from public.actions where status = 'open'),
  2,
  'work left out of the review stays open'
);
select is(
  (select count(*)::integer from public.review_action_items),
  0,
  'and nothing is recorded against it'
);

-- Each completed week is one checkpoint the open work has now outlived. Two is
-- not yet enough to make the Review ask about it, which is what these two
-- closures prove: both are refused if the threshold is wrong.
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    '{"startsOn":"2026-08-17","endsOn":"2026-08-23","reflectionMarkdown":"","decisions":[]}',
    'keeping-free-review-0002'
  )$$,
  'one checkpoint outlived is not a question worth asking'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    '{"startsOn":"2026-08-24","endsOn":"2026-08-30","reflectionMarkdown":"","decisions":[]}',
    'keeping-free-review-0003'
  )$$,
  'and neither is two'
);

-- Three is. The week will not close while that work is unanswered.
select throws_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    '{"startsOn":"2026-08-31","endsOn":"2026-09-06","reflectionMarkdown":"","decisions":[]}',
    'keeping-free-review-0004'
  )$$,
  'P0001', 'review_action_set_changed',
  'a week cannot close while work past three checkpoints is undecided'
);

-- 'keep' is the answer that means "I looked at this and it stays". It records
-- the decision, may carry a priority, and changes nothing about the Action.
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-31', 'endsOn', '2026-09-06',
      'reflectionMarkdown', 'Both still live.',
      'decisions', jsonb_build_array(
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Carried a long time'),
          'expectedVersion', 1, 'resolution', 'keep', 'reason', null, 'priority', true
        ),
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Written this week'),
          'expectedVersion', 1, 'resolution', 'keep', 'reason', null, 'priority', false
        )
      )
    ),
    'keeping-free-review-0005'
  )$$,
  'stalled work closes the week by being kept'
);
select is(
  (select version from public.actions where title = 'Carried a long time'),
  1::bigint,
  'keeping an Action does not touch it'
);
select is(
  (select scheduled_on from public.actions where title = 'Carried a long time'),
  '2026-08-12'::date,
  'and does not move it to another day'
);
select is(
  (select status from public.actions where title = 'Carried a long time'),
  'open',
  'and leaves it open'
);
select is(
  (select count(*)::integer from public.review_action_items where resolution = 'keep'),
  2,
  'but the decision is on the record'
);
select is(
  (select count(*)::integer from public.action_schedule_history where reason = 'kept'),
  2,
  'and so is the checkpoint it survived'
);
select is(
  (select count(*)::integer from public.review_action_items where priority),
  1,
  'work that needs no change can still be a next-week priority'
);

select * from finish();
rollback;
