begin;
select plan(27);

-- A Capture is the raw words a person recorded before anyone interpreted them.
-- The reason to keep them is being able to go back to what was actually said,
-- which is only possible if the record made from them remembers where it came
-- from. These tests are about that trail surviving: the moment it is written,
-- the ownership that keeps it private, Trash, and undo.

select function_privs_are(
  'public', 'execute_capture_action_filing_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Capture-to-Action filing executor is private'
);
select function_privs_are(
  'public', 'execute_capture_action_filing_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Capture-to-Action filing restore executor is private'
);
-- The link is written only by an Operation. A person who could insert or
-- delete rows directly could claim an origin a Capture never had.
select table_privs_are(
  'public', 'capture_action_links', 'authenticated', array['SELECT'],
  'the Capture-to-Action link is readable but never writable by a person'
);
select table_privs_are(
  'public', 'capture_action_links', 'anon', array[]::text[],
  'the Capture-to-Action link is invisible to an unauthenticated caller'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'ca000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'capture-action@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
), (
  'ca000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'capture-action-other@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"chase the roof quote before it expires","source":"typed"}',
    'capture-action-create-0001'
  )$$,
  'a Capture is recorded'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-action.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures
                    where raw_text = 'chase the roof quote before it expires'),
      'title', 'chase the roof quote before it expires',
      'startsOn', '2026-03-09', 'endsOn', '2026-03-15',
      'descriptionMarkdown', null
    ),
    'capture-action-file-0001'
  )$$,
  'a Capture is filed as an Action'
);

-- The three writes are one Operation, so asserting them together is the point:
-- any one of them missing is the inconsistency this table exists to remove.
select is(
  (select count(*)::integer from public.capture_action_links link
   join public.captures capture on capture.id = link.capture_id
   where capture.raw_text = 'chase the roof quote before it expires'),
  1, 'filing as an Action records the link back to the Capture'
);
select is(
  (select state from public.captures where raw_text = 'chase the roof quote before it expires'),
  'reviewed', 'filing as an Action moves the Capture out of the unprocessed inbox'
);
select is(
  (select count(*)::integer from public.actions
   where title = 'chase the roof quote before it expires'),
  1, 'filing as an Action creates exactly one Action'
);

-- A retry after a reload or a double tap must land on the Action the first
-- attempt made, not add a second one carrying the same thought.
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-action.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures
                    where raw_text = 'chase the roof quote before it expires'),
      'title', 'chase the roof quote before it expires',
      'startsOn', '2026-03-09', 'endsOn', '2026-03-15',
      'descriptionMarkdown', null
    ),
    'capture-action-file-0001'
  )$$,
  'filing the same Capture again replays the first receipt'
);
select is(
  (select count(*)::integer from public.capture_action_links link
   join public.captures capture on capture.id = link.capture_id
   where capture.raw_text = 'chase the roof quote before it expires'),
  1, 'a replayed filing adds no second link'
);

-- Trash is recoverable, so the trail has to survive it. An Action that comes
-- back from Trash without its origin has lost the thing the Capture was kept
-- for. A separate Capture is used so the trip through Trash cannot disturb the
-- untouched filing the undo cases below depend on.
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"return the ladder to Sam","source":"typed"}',
    'capture-action-create-0002'
  )$$,
  'a second Capture is recorded for the Trash round trip'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-action.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures where raw_text = 'return the ladder to Sam'),
      'title', 'return the ladder to Sam',
      'startsOn', '2026-03-09', 'endsOn', '2026-03-15',
      'descriptionMarkdown', null
    ),
    'capture-action-file-trash-0001'
  )$$,
  'the second Capture is filed as an Action'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.move.v1',
    jsonb_build_object(
      'itemType', 'action',
      'id', (select id from public.actions where title = 'return the ladder to Sam'),
      'expectedVersion', (select version from public.actions
                          where title = 'return the ladder to Sam')
    ),
    'capture-action-trash-0001'
  )$$,
  'the Action made from a Capture can be moved to Trash'
);
select is(
  (select count(*)::integer from public.capture_action_links link
   join public.actions a on a.id = link.action_id
   where a.title = 'return the ladder to Sam'),
  1, 'Trash keeps the link, because Trash is recoverable rather than final'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.restore.v1',
    jsonb_build_object(
      'batchId', (select id from public.trash_batches order by created_at desc limit 1)
    ),
    'capture-action-restore-0001'
  )$$,
  'the Action is restored from Trash'
);
select is(
  (select count(*)::integer from public.capture_action_links link
   join public.actions a on a.id = link.action_id
   where a.title = 'return the ladder to Sam' and a.trashed_at is null),
  1, 'a restored Action still knows which Capture it came from'
);

-- Export exists so a person can leave with everything. Provenance that is not
-- exported is provenance that only Planner AI can read.
select is(
  (select count(*)::integer from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'capture_action_links'
     and grantee = 'authenticated' and privilege_type = 'SELECT'
     and column_name in ('workspace_id', 'capture_id', 'action_id', 'created_at')),
  4, 'every column of the link is readable, so an export carries the whole trail'
);

-- Undo takes back the Action as well as the link. Leaving the Action behind
-- would restore the same orphan this change removes.
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'capture-action-file-0001')
    ),
    'capture-action-undo-0001'
  )$$,
  'an untouched Capture-to-Action filing can be undone'
);
select is(
  (select count(*)::integer from public.capture_action_links link
   join public.captures capture on capture.id = link.capture_id
   where capture.raw_text = 'chase the roof quote before it expires'),
  0, 'undo removes the link it created'
);
select is(
  (select count(*)::integer from public.actions
   where title = 'chase the roof quote before it expires'),
  0, 'undo removes the Action the filing created'
);
select is(
  (select state from public.captures where raw_text = 'chase the roof quote before it expires'),
  'new', 'undo restores the exact prior Capture state'
);

-- Once real work has been done on the Action, undo has to refuse. A person
-- scheduling or completing it outranks the convenience of taking it back.
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-action.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures
                    where raw_text = 'chase the roof quote before it expires'),
      'title', 'chase the roof quote before it expires',
      'startsOn', '2026-03-09', 'endsOn', '2026-03-15',
      'descriptionMarkdown', 'chase the roof quote before it expires today'
    ),
    'capture-action-file-0002'
  )$$,
  'the Capture is filed again for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.status.v1',
    jsonb_build_object(
      'id', (select id from public.actions
             where title = 'chase the roof quote before it expires'),
      'expectedVersion', (select version from public.actions
                          where title = 'chase the roof quote before it expires'),
      'status', 'done'
    ),
    'capture-action-status-0001'
  )$$,
  'the person marks the Action done'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'capture-action-file-0002')
    ),
    'capture-action-undo-0002'
  )$$,
  'P0001', 'undo_conflict',
  'undo refuses to delete an Action someone has since worked on'
);
select is(
  (select count(*)::integer from public.capture_action_links link
   join public.captures capture on capture.id = link.capture_id
   where capture.raw_text = 'chase the roof quote before it expires'),
  1, 'a refused undo leaves the link and the Action exactly as they were'
);

-- A second person must not be able to read another Workspace's trail.
select set_config('request.jwt.claim.sub', 'ca000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.capture_action_links), 0,
  'the link is scoped to the Workspace that owns the Capture');

select * from finish();
rollback;
