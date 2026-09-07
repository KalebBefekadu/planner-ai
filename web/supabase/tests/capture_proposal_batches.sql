begin;
select plan(43);

select has_table('public', 'capture_proposal_batches', 'Capture Proposal batches exist');
select has_column('public', 'ai_proposals', 'batch_id', 'Proposal items can belong to a batch');
select has_column('public', 'ai_proposals', 'version', 'Proposal items are versioned');
select row_security_active('public.capture_proposal_batches'), 'Proposal batches have RLS';
select table_privs_are(
  'public', 'capture_proposal_batches', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate Proposal batches directly'
);
select function_privs_are(
  'public', 'persist_capture_proposal_analysis',
  array['uuid', 'uuid', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'analysis persistence is private'
);
select function_privs_are(
  'public', 'execute_capture_proposal_operation',
  array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the batch executor is private'
);
select is(
  (select count(*)::integer from public.operation_contracts
   where operation_id like 'capture-proposal.%'),
  3, 'all Capture Proposal Operations are registered'
);
select ok(
  (select not ('mcp' = any(exposures)) from public.operation_contracts
   where operation_id = 'capture-proposal.apply.v1'),
  'atomic batch apply is not exposed through MCP'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'capture-proposals-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('f4000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'capture-proposals-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"  Preserve this raw Capture exactly.  ","source":"typed"}'::jsonb,
    'capture-proposal-source-0001'
  )$$,
  'an immutable source Capture can be created'
);

set local role service_role;
select lives_ok(
  $$select public.persist_capture_proposal_analysis(
    'f4000000-0000-0000-0000-000000000001',
    (select id from public.captures where raw_text like '%Preserve this raw%'),
    '{
      "summary":"Create one review Note.",
      "insights":[{"kind":"reflection","text":"Keep the source exact."}],
      "proposals":[{
        "operationId":"note.create.v1",
        "input":{"title":"Original proposal title","bodyMarkdown":"Proposal body","parentNoteId":null},
        "summary":"Create a Note from the Capture"
      }]
    }'::jsonb,
    'test-structured-model', 'capture-analysis-v1'
  )$$,
  'validated analysis persists through the private service function'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-0000-0000-000000000001', true);
select is(
  (select raw_text from public.captures where raw_text like '%Preserve this raw%'),
  '  Preserve this raw Capture exactly.  ',
  'analysis never rewrites the source Capture'
);
select is(
  (select state from public.captures where raw_text like '%Preserve this raw%'),
  'proposed', 'analysis marks the Capture ready for review'
);
select is(
  (select count(*)::integer from public.ai_proposals where batch_id is not null),
  1, 'analysis creates one ordered Proposal item'
);
select is(
  (select model_id from public.capture_proposal_batches limit 1),
  'test-structured-model', 'batch retains model provenance'
);
select is(
  (select insights_json -> 0 ->> 'kind' from public.capture_proposal_batches limit 1),
  'reflection', 'batch retains bounded structured insights'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''capture-proposal.item-update.v1'', %L::jsonb, ''capture-proposal-edit-0001'')',
    jsonb_build_object(
      'id', (select id from public.ai_proposals where batch_id is not null),
      'batchId', (select id from public.capture_proposal_batches limit 1),
      'expectedVersion', 1,
      'input', jsonb_build_object(
        'title', 'Edited proposal title', 'bodyMarkdown', 'Edited body', 'parentNoteId', null
      ),
      'summary', 'Create the edited Note'
    )::text
  ),
  'a pending item can be edited through the trusted gateway'
);
select ok(
  (select input_json ->> 'title' = 'Edited proposal title' and version = 2
   from public.ai_proposals where batch_id is not null),
  'item editing advances its version and changes exact input'
);
select is(
  (select version from public.capture_proposal_batches limit 1),
  2::bigint, 'item editing advances the enclosing batch version'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'capture-proposal-edit-0001')
    ),
    'capture-proposal-edit-undo-0001'
  )$$,
  'an unchanged item edit can be undone'
);
select ok(
  (select input_json ->> 'title' = 'Original proposal title' and version = 1
   from public.ai_proposals where batch_id is not null),
  'item Undo restores exact prior input and version'
);
select is(
  (select version from public.capture_proposal_batches limit 1),
  1::bigint, 'item Undo restores the prior batch version'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''capture-proposal.dismiss.v1'', %L::jsonb, ''capture-proposal-dismiss-0001'')',
    jsonb_build_object(
      'id', (select id from public.capture_proposal_batches limit 1),
      'expectedVersion', 1
    )::text
  ),
  'a pending batch can be dismissed'
);
select ok(
  (select status = 'dismissed' and version = 2
   from public.capture_proposal_batches limit 1),
  'dismissal is versioned'
);
select is(
  (select state from public.captures where raw_text like '%Preserve this raw%'),
  'reviewed', 'dismissal marks the Capture reviewed without changing its source'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'capture-proposal-dismiss-0001')
    ),
    'capture-proposal-dismiss-undo-0001'
  )$$,
  'dismissal can be undone while the batch is unchanged'
);
select ok(
  (select status = 'pending' and version = 1
   from public.capture_proposal_batches limit 1),
  'dismiss Undo restores the pending batch version'
);
select is(
  (select state from public.captures where raw_text like '%Preserve this raw%'),
  'proposed', 'dismiss Undo restores the Capture review state'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''capture-proposal.apply.v1'', %L::jsonb, ''capture-proposal-apply-0001'')',
    jsonb_build_object(
      'id', (select id from public.capture_proposal_batches limit 1),
      'expectedVersion', 1
    )::text
  ),
  'a reviewed batch applies atomically through shared Operations'
);
select is(
  (select count(*)::integer from public.notes where title = 'Original proposal title'),
  1, 'batch approval creates the exact proposed Note'
);
select ok(
  (select status = 'applied' and version = 2 and applied_at is not null
   from public.capture_proposal_batches limit 1),
  'batch approval records an applied version'
);
select is(
  (select state from public.captures where raw_text like '%Preserve this raw%'),
  'reviewed', 'approval marks the Capture reviewed'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where idempotency_key like '%:%' and operation_id = 'note.create.v1'),
  1, 'each applied item retains its own Operation receipt'
);

set local role service_role;
select lives_ok(
  $$select public.persist_capture_proposal_analysis(
    'f4000000-0000-0000-0000-000000000001',
    (select id from public.captures where raw_text like '%Preserve this raw%'),
    '{"summary":"A useful zero-write analysis.","insights":[],"proposals":[]}'::jsonb,
    'test-structured-model', 'capture-analysis-v1'
  )$$,
  'reprocessing can persist a zero-item batch'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::integer from public.capture_proposal_batches where status = 'pending'),
  1, 'zero-item analysis remains reviewable'
);
select is(
  (select count(*)::integer from public.ai_proposals item
   join public.capture_proposal_batches batch on batch.id = item.batch_id
   where batch.status = 'pending'),
  0, 'zero-item analysis does not invent a write'
);

set local role service_role;
select lives_ok(
  $$select public.persist_capture_proposal_analysis(
    'f4000000-0000-0000-0000-000000000001',
    (select id from public.captures where raw_text like '%Preserve this raw%'),
    '{
      "summary":"This batch must roll back together.",
      "insights":[],
      "proposals":[
        {
          "operationId":"note.create.v1",
          "input":{"title":"Must roll back","bodyMarkdown":"Never commit alone","parentNoteId":null},
          "summary":"Create a Note"
        },
        {
          "operationId":"note.update.v1",
          "input":{"id":"f4999999-0000-0000-0000-000000000001","title":"Missing","bodyMarkdown":"Missing","expectedVersion":1},
          "summary":"Update a missing Note"
        }
      ]
    }'::jsonb,
    'test-structured-model', 'capture-analysis-v1'
  )$$,
  'a multi-item batch can be staged for atomicity testing'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-0000-0000-000000000001', true);
select throws_ok(
  format(
    'select public.execute_ui_operation(''capture-proposal.apply.v1'', %L::jsonb, ''capture-proposal-rollback-0001'')',
    jsonb_build_object(
      'id', (select id from public.capture_proposal_batches
             where status = 'pending' order by created_at desc limit 1),
      'expectedVersion', 1
    )::text
  ),
  'P0001', 'version_conflict_or_not_found',
  'one failed item rejects the whole batch'
);
select is(
  (select count(*)::integer from public.notes where title = 'Must roll back'),
  0, 'a later item failure rolls back an earlier successful item'
);
select is(
  (select status from public.capture_proposal_batches
   where analysis_summary = 'This batch must roll back together.'),
  'pending', 'a failed atomic apply leaves the batch reviewable'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where idempotency_key like '%:%' and result_json ->> 'title' = 'Must roll back'),
  0, 'rolled-back item receipts do not survive'
);
select lives_ok(
  format(
    'select public.execute_ui_operation(''trash.move.v1'', %L::jsonb, ''capture-proposal-trash-0001'')',
    jsonb_build_object(
      'itemType', 'capture',
      'id', (select id from public.captures where raw_text like '%Preserve this raw%')
    )::text
  ),
  'the source Capture can move to recoverable Trash'
);
select throws_ok(
  format(
    'select public.execute_ui_operation(''capture-proposal.dismiss.v1'', %L::jsonb, ''capture-proposal-trashed-dismiss-0001'')',
    jsonb_build_object(
      'id', (select id from public.capture_proposal_batches
             where analysis_summary = 'This batch must roll back together.'),
      'expectedVersion', 1
    )::text
  ),
  'P0001', 'version_conflict_or_not_found',
  'a batch cannot change while its source Capture is in Trash'
);

select set_config('request.jwt.claim.sub', 'f4000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.capture_proposal_batches),
  0, 'another Workspace cannot read Capture Proposal batches'
);

select * from finish();
rollback;
