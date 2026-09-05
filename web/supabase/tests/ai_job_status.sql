begin;
select plan(20);

select has_table('public', 'ai_jobs', 'content-free AI job status exists');
select has_column('public', 'ai_jobs', 'source_capture_id', 'jobs can reference a Capture');
select has_column('public', 'ai_jobs', 'error_code', 'jobs retain stable failure codes');
select row_security_active('public.ai_jobs'), 'AI jobs have RLS';
select table_privs_are(
  'public', 'ai_jobs', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate job status directly'
);
select function_privs_are(
  'public', 'persist_capture_proposal_analysis_job',
  array['uuid', 'uuid', 'uuid', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'job-bound analysis persistence is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ai-jobs-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('a5000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ai-jobs-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"Keep this source while analysis fails.","source":"typed"}'::jsonb,
    'ai-job-capture-0001'
  )$$,
  'an owned Capture can be created for a job'
);

set local role service_role;
select lives_ok(
  $$insert into public.ai_jobs (
    workspace_id, actor_user_id, operation, source_capture_id,
    request_id, status
  ) select workspace.id, workspace.owner_user_id, 'capture_analysis', capture.id,
    'a5100000-0000-4000-8000-000000000001', 'running'
  from public.workspaces workspace
  join public.captures capture on capture.workspace_id = workspace.id
  where workspace.owner_user_id = 'a5000000-0000-0000-0000-000000000001'$$,
  'the trusted provider route can create running job status'
);
select is(
  (select status from public.ai_jobs
   where request_id = 'a5100000-0000-4000-8000-000000000001'),
  'running', 'a new job starts in running state'
);
select throws_ok(
  $$update public.ai_jobs set status = 'succeeded', completed_at = now()
    where request_id = 'a5100000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a successful job requires a result target'
);
select lives_ok(
  $$update public.ai_jobs set status = 'failed', error_code = 'provider_timeout',
    completed_at = now(), updated_at = now()
    where request_id = 'a5100000-0000-4000-8000-000000000001'$$,
  'a trusted route can persist a stable failed state'
);
select is(
  (select error_code from public.ai_jobs
   where request_id = 'a5100000-0000-4000-8000-000000000001'),
  'provider_timeout', 'job status never stores provider error text'
);
select lives_ok(
  $$insert into public.ai_jobs (
    workspace_id, actor_user_id, operation, source_capture_id,
    request_id, status, created_at
  ) select workspace.id, workspace.owner_user_id, 'capture_analysis', capture.id,
    request_id, 'running', requests.request_created_at
  from public.workspaces workspace
  join public.captures capture on capture.workspace_id = workspace.id
  cross join (values
    ('a5100000-0000-4000-8000-000000000002'::uuid, now() - interval '1 minute'),
    ('a5100000-0000-4000-8000-000000000003'::uuid, now() + interval '1 minute')
  ) requests(request_id, request_created_at)
  where workspace.owner_user_id = 'a5000000-0000-0000-0000-000000000001'$$,
  'two overlapping analysis attempts can be represented safely'
);
select throws_ok(
  $$select public.persist_capture_proposal_analysis_job(
    'a5000000-0000-0000-0000-000000000001',
    (select source_capture_id from public.ai_jobs
     where request_id = 'a5100000-0000-4000-8000-000000000002'),
    (select id from public.ai_jobs where request_id = 'a5100000-0000-4000-8000-000000000002'),
    '{"summary":"Stale result","insights":[],"proposals":[]}'::jsonb,
    'test-model', 'capture-analysis-v1'
  )$$,
  'P0001', 'analysis_superseded',
  'an older request cannot publish after a retry starts'
);
select lives_ok(
  $$select public.persist_capture_proposal_analysis_job(
    'a5000000-0000-0000-0000-000000000001',
    (select source_capture_id from public.ai_jobs
     where request_id = 'a5100000-0000-4000-8000-000000000003'),
    (select id from public.ai_jobs where request_id = 'a5100000-0000-4000-8000-000000000003'),
    '{"summary":"Newest result","insights":[],"proposals":[]}'::jsonb,
    'test-model', 'capture-analysis-v1'
  )$$,
  'the newest request may publish its result'
);
select is(
  (select count(*)::integer from public.capture_proposal_batches batch
   where batch.source_capture_id = (
     select source_capture_id from public.ai_jobs
     where request_id = 'a5100000-0000-4000-8000-000000000003'
   )),
  1, 'only the newest overlapping request creates a batch'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::integer from public.ai_jobs),
  3, 'the owner can inspect job status and attempt history'
);
select is(
  (select raw_text from public.captures
   where id = (
     select source_capture_id from public.ai_jobs
     where request_id = 'a5100000-0000-4000-8000-000000000001'
   )),
  'Keep this source while analysis fails.',
  'a failed job does not change source input'
);
select throws_ok(
  $$update public.ai_jobs set status = 'running'$$,
  '42501', null,
  'the owner cannot forge a retry state'
);

select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.ai_jobs),
  0, 'another Workspace cannot read job status'
);
select is(
  (select count(*)::integer from public.ai_usage_events
   where operation = 'capture_analysis'),
  0, 'job status is distinct from provider usage accounting'
);

select * from finish();
rollback;
