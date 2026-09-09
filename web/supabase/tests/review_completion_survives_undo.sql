begin;
select plan(19);

-- Undo deletes the review row and keeps the original receipt, marked reversed,
-- because history is not rewritten. Both review completions keyed idempotency
-- on the period alone, so completing the same period again matched that
-- receipt and returned the recorded result of a review that no longer existed:
-- the person was told it was saved and nothing was written. See #158.
--
-- The application now keys on the period, its undo generation, and the
-- submission, so a completion after an undo carries a key of its own -- which
-- it must, because receipt keys are unique per workspace and Operation. The
-- Operations no longer replay reversed receipts either. The keys below are the
-- shape src/lib/reviews/completion-intent.ts produces.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'ce000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'review-redo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ce000000-0000-0000-0000-000000000001', true);

-- Weekly.

select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Draft the retrospective","horizonKind":"week","startsOn":"2026-08-10","endsOn":"2026-08-16","goalId":null,"scheduledOn":"2026-08-12"}',
    'review-redo-action-0001'
  )$$,
  'a week has one unfinished Action to decide'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', 'First pass.',
      'decisions', jsonb_build_array(jsonb_build_object(
        'actionId', (select id from public.actions where title = 'Draft the retrospective'),
        'expectedVersion', 1, 'resolution', 'done', 'reason', null, 'priority', false
      ))
    ),
    'review-redo-weekly-0001'
  )$$,
  'the week is completed'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'review-redo-weekly-0001')
    ),
    'review-redo-weekly-undo-0001'
  )$$,
  'the completion is undone'
);
select is((select count(*)::integer from public.reviews where kind = 'weekly'), 0,
  'undo removed the weekly Review');

-- The same key again. Before the fix this replayed the reversed receipt and
-- reported success without writing anything.
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', 'First pass.',
      'decisions', jsonb_build_array(jsonb_build_object(
        'actionId', (select id from public.actions where title = 'Draft the retrospective'),
        'expectedVersion', 3, 'resolution', 'done', 'reason', null, 'priority', false
      ))
    ),
    'weekly-review:2026-08-10:1:aaaaaaaaaaaaaaaa'
  )$$,
  'the same week can be completed again after undo'
);
select is((select count(*)::integer from public.reviews where kind = 'weekly'), 1,
  'completing again after undo writes a real weekly Review');
select is(
  (select count(*)::integer from public.operation_receipts
   where idempotency_key = 'weekly-review:2026-08-10:1:aaaaaaaaaaaaaaaa'
     and reversed_at is null),
  1, 'the replacement completion has its own live receipt'
);
select ok(
  (select reversed_at is not null from public.operation_receipts
   where idempotency_key = 'review-redo-weekly-0001'),
  'the undone completion keeps its receipt, marked reversed'
);

-- An unchanged retry of the live submission is still exactly one result.
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', 'First pass.',
      'decisions', jsonb_build_array(jsonb_build_object(
        'actionId', (select id from public.actions where title = 'Draft the retrospective'),
        'expectedVersion', 3, 'resolution', 'done', 'reason', null, 'priority', false
      ))
    ),
    'weekly-review:2026-08-10:1:aaaaaaaaaaaaaaaa'
  )$$,
  'an unchanged retry is accepted'
);
select is((select count(*)::integer from public.reviews where kind = 'weekly'), 1,
  'an unchanged retry produces exactly one durable weekly Review');

-- A different submission for a week that is already reviewed is reported as a
-- conflict rather than being accepted or surfacing as "invalid_input".
select throws_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', 'A rewritten reflection.',
      'decisions', jsonb_build_array(jsonb_build_object(
        'actionId', (select id from public.actions where title = 'Draft the retrospective'),
        'expectedVersion', 3, 'resolution', 'done', 'reason', null, 'priority', false
      ))
    ),
    'weekly-review:2026-08-10:1:bbbbbbbbbbbbbbbb'
  )$$,
  'P0001', 'review_already_completed',
  'a changed submission for a completed week is refused by name'
);

-- Monthly and quarterly take the same path.

select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"monthly","startsOn":"2026-09-01","endsOn":"2026-09-30","reflectionMarkdown":"September held."}',
    'review-redo-monthly-0001'
  )$$,
  'a month is completed'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'review-redo-monthly-0001')
    ),
    'review-redo-monthly-undo-0001'
  )$$,
  'the monthly completion is undone'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"monthly","startsOn":"2026-09-01","endsOn":"2026-09-30","reflectionMarkdown":"September held."}',
    'monthly-review:2026-09-01:1:aaaaaaaaaaaaaaaa'
  )$$,
  'the same month can be completed again after undo'
);
select is((select count(*)::integer from public.reviews where kind = 'monthly'), 1,
  'completing again after undo writes a real monthly Review'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"quarterly","startsOn":"2026-07-01","endsOn":"2026-09-30","reflectionMarkdown":"The quarter closed."}',
    'review-redo-quarterly-0001'
  )$$,
  'a quarter is completed'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'review-redo-quarterly-0001')
    ),
    'review-redo-quarterly-undo-0001'
  )$$,
  'the quarterly completion is undone'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"quarterly","startsOn":"2026-07-01","endsOn":"2026-09-30","reflectionMarkdown":"The quarter closed."}',
    'quarterly-review:2026-07-01:1:aaaaaaaaaaaaaaaa'
  )$$,
  'the same quarter can be completed again after undo'
);
select is((select count(*)::integer from public.reviews where kind = 'quarterly'), 1,
  'completing again after undo writes a real quarterly Review'
);

reset role;

select * from finish();
rollback;
