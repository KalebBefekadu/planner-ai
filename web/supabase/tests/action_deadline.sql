begin;
select plan(17);

select has_column(
  'public', 'actions', 'due_on',
  'an Action can say when it is due, separately from when it is worked on'
);
select has_index(
  'public', 'actions', 'actions_due_on_idx',
  'and what is due can be read without scanning everything that is not'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('55000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deadline-owner@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '55000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"Anything at all","source":"typed"}', 'deadline-ws-0001'
  )$$,
  'a workspace exists'
);

select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title','Draft the quarterly report','horizonKind','week',
      'startsOn','2026-08-10','endsOn','2026-08-16',
      'goalId',null,'parentActionId',null,'scheduledOn','2026-08-11'
    ),
    'deadline-create-0001')$$,
  'a task exists, planned for the Tuesday'
);
select is(
  (select due_on from public.actions where title = 'Draft the quarterly report'),
  null,
  'and it has no deadline, because nothing has claimed one for it'
);

-- The point of the column: the day it is due and the day it is worked on are
-- set independently and neither moves the other.
select lives_ok(
  $$select public.execute_ui_operation('action.update.v1',
    jsonb_build_object(
      'id',(select id from public.actions where title = 'Draft the quarterly report'),
      'expectedVersion',(select version from public.actions where title = 'Draft the quarterly report'),
      'title','Draft the quarterly report','descriptionMarkdown',null,
      'scheduledOn','2026-08-11','dueOn','2026-08-14'
    ),
    'deadline-set-0001')$$,
  'a deadline can be given to work already scheduled'
);
select is(
  (select due_on from public.actions where title = 'Draft the quarterly report'),
  date '2026-08-14',
  'the deadline is the Friday'
);
select is(
  (select scheduled_on from public.actions where title = 'Draft the quarterly report'),
  date '2026-08-11',
  'and the day the work is planned for did not move with it'
);

-- Moving the work does not move the deadline.
select lives_ok(
  $$select public.execute_ui_operation('action.update.v1',
    jsonb_build_object(
      'id',(select id from public.actions where title = 'Draft the quarterly report'),
      'expectedVersion',(select version from public.actions where title = 'Draft the quarterly report'),
      'title','Draft the quarterly report','descriptionMarkdown',null,
      'scheduledOn','2026-08-12','dueOn','2026-08-14'
    ),
    'deadline-reschedule-0001')$$,
  'the drafting day moves to the Wednesday'
);
select is(
  (select due_on from public.actions where title = 'Draft the quarterly report'),
  date '2026-08-14',
  'and the report is still due on the Friday'
);

-- An edit written before deadlines existed omits the key entirely. It must not
-- read as "clear the deadline", or every old caller would quietly erase one.
select lives_ok(
  $$select public.execute_ui_operation('action.update.v1',
    jsonb_build_object(
      'id',(select id from public.actions where title = 'Draft the quarterly report'),
      'expectedVersion',(select version from public.actions where title = 'Draft the quarterly report'),
      'title','Draft the quarterly report v2','descriptionMarkdown',null,
      'scheduledOn','2026-08-12'
    ),
    'deadline-omitted-0001')$$,
  'an edit that never mentions the deadline is accepted'
);
select is(
  (select due_on from public.actions where title = 'Draft the quarterly report v2'),
  date '2026-08-14',
  'and leaves the deadline exactly where it was'
);

-- Sending it as null is how a deadline is actually removed.
select lives_ok(
  $$select public.execute_ui_operation('action.update.v1',
    jsonb_build_object(
      'id',(select id from public.actions where title = 'Draft the quarterly report v2'),
      'expectedVersion',(select version from public.actions where title = 'Draft the quarterly report v2'),
      'title','Draft the quarterly report v2','descriptionMarkdown',null,
      'scheduledOn','2026-08-12','dueOn',null
    ),
    'deadline-clear-0001')$$,
  'sending the deadline as null clears it'
);
select is(
  (select due_on from public.actions where title = 'Draft the quarterly report v2'),
  null,
  'and the task has no deadline again'
);

-- Undo has to carry the column, or it restores an edit while silently dropping
-- the deadline that edit removed.
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'deadline-clear-0001')
    ),
    'deadline-clear-undo-0001'
  )$$,
  'clearing a deadline can be undone'
);
select is(
  (select due_on from public.actions where title = 'Draft the quarterly report v2'),
  date '2026-08-14',
  'and the undone deadline comes back rather than staying lost'
);

-- A mistyped year is a wrong fact, not a far-future plan. Checked with the
-- governed-write restriction lifted, so this asserts the constraint itself
-- rather than the permission that normally stops a direct insert first.
reset role;
select throws_ok(
  $$update public.actions set due_on = date '0202-08-14'
    where title = 'Draft the quarterly report v2'$$,
  '23514',
  null,
  'a deadline outside the supported range is refused by the database'
);

select * from finish();
rollback;
