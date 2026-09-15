begin;
select plan(34);

-- The capability is the only write path into ai_jobs, so its grants matter more
-- than its behaviour. None of it is reachable without a session.
select function_privs_are(
  'public', 'start_ai_job', array['text', 'uuid', 'uuid', 'text', 'date', 'date'],
  'anon', array[]::text[], 'anonymous callers cannot start an AI job'
);
select function_privs_are(
  'public', 'start_ai_job', array['text', 'uuid', 'uuid', 'text', 'date', 'date'],
  'authenticated', array['EXECUTE'], 'signed-in people hold the job capability'
);
select function_privs_are(
  'public', 'complete_ai_job', array['uuid', 'uuid'],
  'anon', array[]::text[], 'anonymous callers cannot complete an AI job'
);
select function_privs_are(
  'public', 'fail_ai_job', array['uuid', 'text'],
  'anon', array[]::text[], 'anonymous callers cannot fail an AI job'
);
select function_privs_are(
  'public', 'persist_capture_proposal_analysis_job',
  array['uuid', 'uuid', 'jsonb', 'text', 'text'],
  'anon', array[]::text[], 'anonymous callers cannot persist a Capture analysis'
);
select function_privs_are(
  'public', 'persist_review_ai_proposal_job',
  array['uuid', 'text', 'date', 'date', 'jsonb', 'text', 'text'],
  'anon', array[]::text[], 'anonymous callers cannot persist a Review proposal'
);

-- The underlying writers stay closed. The capability reaches them; a person
-- cannot, so removing the Review writer's request-claim guard did not open a
-- direct path to it.
select function_privs_are(
  'public', 'persist_capture_proposal_analysis', array['uuid', 'uuid', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Capture writer is not callable by a person'
);
select function_privs_are(
  'public', 'persist_review_ai_proposal', array['uuid', 'text', 'date', 'date', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Review writer is not callable by a person'
);

-- The signatures that accepted an owner as a trusted argument are gone, not
-- merely unused. A caller can no longer name whose Workspace to write.
select hasnt_function(
  'public', 'persist_capture_proposal_analysis_job',
  array['uuid', 'uuid', 'uuid', 'jsonb', 'text', 'text'],
  'Capture analysis no longer accepts a caller-supplied owner'
);
select hasnt_function(
  'public', 'persist_review_ai_proposal_job',
  array['uuid', 'uuid', 'text', 'date', 'date', 'jsonb', 'text', 'text'],
  'Review proposals no longer accept a caller-supplied owner'
);

select ok(
  (select bool_and(
      proc.prosecdef
      and 'search_path=pg_catalog, public' = any(coalesce(proc.proconfig, array[]::text[]))
    )
   from pg_proc proc
   join pg_namespace space on space.oid = proc.pronamespace
   where space.nspname = 'public' and proc.proname in (
     'start_ai_job', 'complete_ai_job', 'fail_ai_job',
     'persist_capture_proposal_analysis_job', 'persist_review_ai_proposal_job'
   )),
  'every capability is security definer with a fixed search path'
);

-- The capability added no table-level write grant.
select table_privs_are(
  'public', 'ai_jobs', 'authenticated', array['SELECT'],
  'the job capability did not widen direct table access'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'worker-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('a6000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'worker-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"Analyse this one.","source":"typed"}'::jsonb,
    'worker-capture-0001'
  )$$,
  'the first owner can record a Capture to analyse'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"Break this initiative down.","source":"typed"}'::jsonb,
    'worker-capture-0002'
  )$$,
  'the first owner can record the Capture a breakdown is asked from'
);

select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"Someone else''s thought.","source":"typed"}'::jsonb,
    'worker-capture-0003'
  )$$,
  'the second owner can record a Capture of their own'
);

-- Identifiers are carried in session settings because neither owner can read
-- the other's rows, which is the property under test.
reset role;
select set_config('test.capture_one',
  (select id::text from public.captures where raw_text = 'Analyse this one.'), true);
select set_config('test.capture_breakdown',
  (select id::text from public.captures where raw_text = 'Break this initiative down.'), true);
select set_config('test.capture_other',
  (select id::text from public.captures where raw_text = 'Someone else''s thought.'), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.start_ai_job(
    'capture_analysis', 'a6100000-0000-4000-8000-000000000001',
    current_setting('test.capture_one')::uuid
  )$$,
  'an owner can start an analysis job for their own Capture'
);
select is(
  (select count(*)::integer from public.ai_jobs job
   join public.workspaces workspace on workspace.id = job.workspace_id
   where job.request_id = 'a6100000-0000-4000-8000-000000000001'
     and job.status = 'running'
     and job.actor_user_id = 'a6000000-0000-0000-0000-000000000001'
     and workspace.owner_user_id = 'a6000000-0000-0000-0000-000000000001'),
  1, 'the job is filed to the caller Workspace with the caller as actor'
);
select is(
  (select public.start_ai_job(
    'capture_analysis', 'a6100000-0000-4000-8000-000000000001',
    current_setting('test.capture_one')::uuid
  )),
  (select id from public.ai_jobs where request_id = 'a6100000-0000-4000-8000-000000000001'),
  'one request id starts one job, and a repeat returns that job'
);
select throws_ok(
  $$select public.start_ai_job(
    'note_rewrite', 'a6100000-0000-4000-8000-000000000009',
    current_setting('test.capture_one')::uuid
  )$$,
  '22023', 'unsupported_job_operation',
  'a job cannot be opened for an operation the contract does not name'
);
select throws_ok(
  $$select public.start_ai_job(
    'capture_analysis', 'a6100000-0000-4000-8000-000000000002',
    current_setting('test.capture_other')::uuid
  )$$,
  'P0002', 'source_capture_not_found',
  'a job cannot be attached to another Workspace Capture'
);
select throws_ok(
  $$insert into public.ai_jobs (workspace_id, operation, source_capture_id, request_id, status)
    select workspace.id, 'capture_analysis', current_setting('test.capture_one')::uuid,
      'a6100000-0000-4000-8000-000000000003', 'running'
    from public.workspaces workspace
    where workspace.owner_user_id = 'a6000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'an owner still cannot write job status directly'
);
select throws_ok(
  $$update public.ai_jobs set status = 'succeeded'$$,
  '42501', null,
  'an owner still cannot forge a job result directly'
);

select set_config('test.job_one',
  (select id::text from public.ai_jobs
   where request_id = 'a6100000-0000-4000-8000-000000000001'), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.complete_ai_job(
    current_setting('test.job_one')::uuid, extensions.gen_random_uuid()
  )$$,
  'P0001', 'analysis_job_not_running',
  'another Workspace cannot complete a job it does not own'
);
select throws_ok(
  $$select public.fail_ai_job(current_setting('test.job_one')::uuid, 'provider_timeout')$$,
  'P0001', 'analysis_job_not_running',
  'another Workspace cannot fail a job it does not own'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);
select is(
  (select status from public.ai_jobs where id = current_setting('test.job_one')::uuid),
  'running', 'the job is untouched by the other Workspace attempts'
);
select lives_ok(
  $$select public.complete_ai_job(
    current_setting('test.job_one')::uuid, extensions.gen_random_uuid()
  )$$,
  'the owner can record their own job result'
);
select is(
  (select status from public.ai_jobs where id = current_setting('test.job_one')::uuid),
  'succeeded', 'a completed job carries a result'
);
select throws_ok(
  $$select public.complete_ai_job(
    current_setting('test.job_one')::uuid, extensions.gen_random_uuid()
  )$$,
  'P0001', 'analysis_job_not_running',
  'a job that is no longer running cannot be completed twice'
);

-- initiative_breakdown was added to the operation check without being added to
-- the source shape check, and job claiming named capture_analysis alone, so the
-- breakdown path could neither start nor persist. Both are fixed; these are the
-- assertions that would have caught them.
select lives_ok(
  $$select public.start_ai_job(
    'initiative_breakdown', 'a6100000-0000-4000-8000-000000000004',
    current_setting('test.capture_breakdown')::uuid
  )$$,
  'a breakdown job can be started at all'
);
select is(
  (select operation from public.ai_jobs
   where request_id = 'a6100000-0000-4000-8000-000000000004'),
  'initiative_breakdown', 'a breakdown job is distinguishable from a typed Capture analysis'
);
select set_config('test.job_breakdown',
  (select id::text from public.ai_jobs
   where request_id = 'a6100000-0000-4000-8000-000000000004'), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.persist_capture_proposal_analysis_job(
    current_setting('test.capture_breakdown')::uuid,
    current_setting('test.job_breakdown')::uuid,
    '{"summary":"Stolen result","insights":[],"proposals":[]}'::jsonb,
    'test-model', 'initiative-breakdown-v1'
  )$$,
  'P0001', 'analysis_job_not_running',
  'another Workspace cannot publish into a job it does not own'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.persist_capture_proposal_analysis_job(
    current_setting('test.capture_breakdown')::uuid,
    current_setting('test.job_breakdown')::uuid,
    '{"summary":"A first list","insights":[],"proposals":[]}'::jsonb,
    'test-model', 'initiative-breakdown-v1'
  )$$,
  'a breakdown job can publish its batch'
);
select is(
  (select count(*)::integer from public.capture_proposal_batches batch
   where batch.source_capture_id = current_setting('test.capture_breakdown')::uuid),
  1, 'the breakdown produces exactly one reviewable batch'
);
select lives_ok(
  $$select public.complete_ai_job(
    current_setting('test.job_breakdown')::uuid, extensions.gen_random_uuid()
  )$$,
  'the breakdown job reaches a terminal state'
);

select * from finish();
rollback;
