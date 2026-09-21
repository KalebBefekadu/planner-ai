begin;
select plan(27);

select has_table('public', 'projects', 'a project is its own record, not a flag on a goal');
select col_not_null(
  'public', 'projects', 'finish_condition',
  'and it cannot exist without saying what finishing means'
);
select has_column('public', 'actions', 'project_id', 'a task can belong to a project');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('56000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'project-owner@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '56000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"Anything at all","source":"typed"}', 'project-ws-0001'
  )$$,
  'a workspace exists'
);

-- A project with no stated finish is an initiative wearing another name, and
-- the table exists precisely to refuse it.
select throws_ok(
  $$select public.execute_ui_operation(
    'project.create.v1',
    jsonb_build_object('title', 'Repaint the kitchen', 'finishCondition', ''),
    'project-nofinish-0001'
  )$$,
  'P0001', 'invalid_input',
  'a project without a finish condition is refused'
);

-- Spanning the turn of a year is the case that forced this table: the work is
-- one thing, not one project per calendar year.
select lives_ok(
  $$select public.execute_ui_operation(
    'project.create.v1',
    jsonb_build_object(
      'title', 'Repaint the kitchen',
      'finishCondition', 'Every wall painted and the trim done',
      'startsOn', '2026-11-03', 'targetOn', '2027-02-26'
    ),
    'project-create-0001'
  )$$,
  'a project can run from November into February'
);
select is(
  (select status from public.projects where title = 'Repaint the kitchen'),
  'active',
  'and it starts active'
);
select is(
  (select completed_at from public.projects where title = 'Repaint the kitchen'),
  null,
  'with nothing claiming it is finished'
);
select is(
  (select extract(year from target_on)::integer - extract(year from starts_on)::integer
   from public.projects where title = 'Repaint the kitchen'),
  1,
  'spanning two calendar years as one record rather than two'
);

-- A span that ends before it starts is a typo.
select throws_ok(
  $$select public.execute_ui_operation(
    'project.create.v1',
    jsonb_build_object(
      'title', 'Backwards', 'finishCondition', 'Never',
      'startsOn', '2027-02-26', 'targetOn', '2026-11-03'
    ),
    'project-backwards-0001'
  )$$,
  'P0001', 'invalid_input',
  'a project that ends before it begins is refused'
);

-- References are resolved in this workspace, so another owner's area cannot be
-- named into a project by guessing an id.
select throws_ok(
  $$select public.execute_ui_operation(
    'project.create.v1',
    jsonb_build_object(
      'title', 'Borrowed', 'finishCondition', 'Done',
      'areaId', '00000000-0000-0000-0000-0000000000ff'
    ),
    'project-badarea-0001'
  )$$,
  'P0001', 'area_not_found',
  'a project cannot be filed under an area this workspace does not have'
);

-- The point of the whole table: it can be finished.
select lives_ok(
  $$select public.execute_ui_operation(
    'project.status.v1',
    jsonb_build_object(
      'id', (select id from public.projects where title = 'Repaint the kitchen'),
      'expectedVersion', (select version from public.projects where title = 'Repaint the kitchen'),
      'status', 'completed'
    ),
    'project-complete-0001'
  )$$,
  'a project can be completed'
);
select is(
  (select status from public.projects where title = 'Repaint the kitchen'),
  'completed',
  'and says so'
);
select isnt(
  (select completed_at from public.projects where title = 'Repaint the kitchen'),
  null,
  'with the time it happened, which the constraint requires to agree'
);

-- Reopening is a decision, not a trap. A project finished early that turns out
-- not to be must not keep a date claiming it was.
select lives_ok(
  $$select public.execute_ui_operation(
    'project.status.v1',
    jsonb_build_object(
      'id', (select id from public.projects where title = 'Repaint the kitchen'),
      'expectedVersion', (select version from public.projects where title = 'Repaint the kitchen'),
      'status', 'active'
    ),
    'project-reopen-0001'
  )$$,
  'a completed project can be reopened'
);
select is(
  (select completed_at from public.projects where title = 'Repaint the kitchen'),
  null,
  'and stops claiming it was ever finished'
);

-- Undo restores the state the receipt described, not a guess at it.
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'project-reopen-0001')
    ),
    'project-reopen-undo-0001'
  )$$,
  'reopening can itself be undone'
);
select is(
  (select status from public.projects where title = 'Repaint the kitchen'),
  'completed',
  'putting the project back to finished'
);
select isnt(
  (select completed_at from public.projects where title = 'Repaint the kitchen'),
  null,
  'with its completion time restored rather than invented'
);

-- Editing carries a version, and a stale one loses rather than overwriting.
select throws_ok(
  $$select public.execute_ui_operation(
    'project.update.v1',
    jsonb_build_object(
      'id', (select id from public.projects where title = 'Repaint the kitchen'),
      'expectedVersion', 1,
      'title', 'Repaint the kitchen', 'finishCondition', 'Changed under someone'
    ),
    'project-stale-0001'
  )$$,
  'P0001', 'version_conflict_or_not_found',
  'an edit against a stale version is refused'
);

-- A task belongs to a project without needing one to exist.
select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title','Sand the cupboard doors','horizonKind','week',
      'startsOn','2026-11-02','endsOn','2026-11-08',
      'goalId',null,'parentActionId',null,'scheduledOn','2026-11-03'
    ),
    'project-task-0001')$$,
  'a task exists'
);
select is(
  (select project_id from public.actions where title = 'Sand the cupboard doors'),
  null,
  'and belongs to no project, because a task never needs one'
);

-- Undoing a creation that has been worked on since would throw away the work
-- without saying so, so it is refused rather than quietly winning.
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'project-create-0001')
    ),
    'project-create-undo-0001'
  )$$,
  'P0001', 'undo_conflict',
  'undoing a creation the project has moved on from is refused'
);

-- An untouched creation undoes to Trash, not to deletion: anything already
-- filed under it is recoverable rather than gone.
select lives_ok(
  $$select public.execute_ui_operation(
    'project.create.v1',
    jsonb_build_object('title', 'Mistake', 'finishCondition', 'Should not exist'),
    'project-mistake-0001'
  )$$,
  'a project created by accident exists'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'project-mistake-0001')
    ),
    'project-mistake-undo-0001'
  )$$,
  'and creating it can be undone'
);
select isnt(
  (select trashed_at from public.projects where title = 'Mistake'),
  null,
  'moving it to Trash rather than deleting it outright'
);
select isnt(
  (select purge_after from public.projects where title = 'Mistake'),
  null,
  'with a purge date, so Trash is recoverable and not permanent'
);

select * from finish();
rollback;
