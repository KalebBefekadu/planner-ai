begin;
select plan(25);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('51000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'direction-owner-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('51000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'direction-owner-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"An overall direction."}', 'dir-vision-00001'
  )$$,
  'the overall Vision still saves through its original contract'
);
select is(
  (select area_id from public.visions), null,
  'the overall Vision names itself by having no area'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    '{"name":"Health","parentAreaId":null,"existingNoteId":null,"icon":null,"color":null}',
    'dir-area-0000001'
  )$$,
  'an area can be created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    '{"name":"Business","parentAreaId":null,"existingNoteId":null,"icon":null,"color":null}',
    'dir-area-0000002'
  )$$,
  'and a second one'
);
select is(
  (select primary_area_id from public.notes where title = 'Health'),
  (select id from public.life_areas where name = 'Health'),
  'an area page files itself under its own area'
);

-- Two areas each holding a direction is the thing the old unique index made
-- impossible.
select lives_ok(
  $$select public.execute_ui_operation(
    'area.vision.v1',
    jsonb_build_object(
      'areaId', (select id from public.life_areas where name = 'Health'),
      'bodyMarkdown', 'Strong enough to keep up with the children.'
    ),
    'dir-areavis-0001'
  )$$,
  'an area can hold its own direction'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'area.vision.v1',
    jsonb_build_object(
      'areaId', (select id from public.life_areas where name = 'Business'),
      'bodyMarkdown', 'A practice that runs without me in the room.'
    ),
    'dir-areavis-0002'
  )$$,
  'so can a second area at the same time'
);
select is(
  (select count(*)::integer from public.visions where archived_at is null and trashed_at is null),
  3,
  'three active directions coexist: one overall and one per area'
);

-- An old client writing the overall Vision must not reach an area's.
select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"A revised overall direction."}', 'dir-vision-00002'
  )$$,
  'the overall Vision can be revised'
);
select is(
  (select body_markdown from public.visions
    where area_id = (select id from public.life_areas where name = 'Health')),
  'Strong enough to keep up with the children.',
  'revising the overall Vision leaves an area''s direction alone'
);

-- A Goal inside an area answers to that area's direction.
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'Run a half marathon', 'horizonKind', 'year',
      'startsOn', '2026-01-01', 'endsOn', '2026-12-31', 'parentGoalId', null,
      'areaId', (select id from public.life_areas where name = 'Health')
    ),
    'dir-goal-0000001'
  )$$,
  'a Goal can be created inside an area'
);
select is(
  (select primary_area_id from public.goals where title = 'Run a half marathon'),
  (select id from public.life_areas where name = 'Health'),
  'the Goal is filed under that area'
);
select is(
  (select vision_id from public.goals where title = 'Run a half marathon'),
  (select id from public.visions
    where area_id = (select id from public.life_areas where name = 'Health')),
  'and answers to that area''s direction rather than the overall one'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'Finish the first quarter strongly', 'horizonKind', 'quarter',
      'startsOn', '2026-01-01', 'endsOn', '2026-03-31',
      'parentGoalId', (select id from public.goals where title = 'Run a half marathon')
    ),
    'dir-goal-0000002'
  )$$,
  'a quarterly Goal can be created under it without naming an area'
);
select is(
  (select primary_area_id from public.goals where title = 'Finish the first quarter strongly'),
  (select id from public.life_areas where name = 'Health'),
  'it inherits the area of the Goal above it'
);

-- Work created in context lands in context.
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Book the running club session', 'horizonKind', 'week',
      'startsOn', '2026-02-02', 'endsOn', '2026-02-08', 'goalId', null,
      'parentActionId', null, 'scheduledOn', '2026-02-03',
      'areaId', (select id from public.life_areas where name = 'Health')
    ),
    'dir-action-000001'
  )$$,
  'a task can be typed straight into an area'
);
select is(
  (select primary_area_id from public.actions where title = 'Book the running club session'),
  (select id from public.life_areas where name = 'Health'),
  'and lands there'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Check the session times', 'horizonKind', 'week',
      'startsOn', '2026-02-02', 'endsOn', '2026-02-08', 'goalId', null,
      'parentActionId', (select id from public.actions
        where title = 'Book the running club session'),
      'scheduledOn', '2026-02-03'
    ),
    'dir-action-000002'
  )$$,
  'a subtask needs no area of its own'
);
select is(
  (select primary_area_id from public.actions where title = 'Check the session times'),
  (select id from public.life_areas where name = 'Health'),
  'it takes the area of the task it sits under'
);

-- Refiling a parent leaves its children where they are.
select lives_ok(
  $$select public.execute_ui_operation(
    'area.assign.v1',
    jsonb_build_object(
      'itemType', 'action',
      'id', (select id from public.actions where title = 'Book the running club session'),
      'areaId', (select id from public.life_areas where name = 'Business'),
      'expectedVersion', 1
    ),
    'dir-assign-00001'
  )$$,
  'work can be refiled under a different area'
);
select is(
  (select primary_area_id from public.actions where title = 'Check the session times'),
  (select id from public.life_areas where name = 'Health'),
  'refiling a parent does not silently refile everything under it'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
        where operation_id = 'area.assign.v1' and idempotency_key = 'dir-assign-00001')
    ),
    'dir-undo-0000001'
  )$$,
  'refiling can be undone'
);
select is(
  (select primary_area_id from public.actions where title = 'Book the running club session'),
  (select id from public.life_areas where name = 'Health'),
  'and the work returns to where it was'
);

-- An area with work in it is no longer an accidental keystroke.
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
        where operation_id = 'area.create.v1' and idempotency_key = 'dir-area-0000001')
    ),
    'dir-undo-0000002'
  )$$,
  'P0001', 'undo_conflict',
  'creating an area cannot be undone once work is filed under it'
);

select set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.execute_ui_operation(
    'area.vision.v1',
    '{"areaId":"51000000-0000-0000-0000-0000000000ff","bodyMarkdown":"Not mine to write."}',
    'dir-cross-000001'
  )$$,
  'P0001', 'area_not_found',
  'another owner cannot write a direction into an area they cannot see'
);

select * from finish();
rollback;
