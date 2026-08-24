begin;
select plan(11);

select has_column('public', 'ai_jobs', 'source_review_kind', 'Review jobs retain source kind');
select has_column('public', 'ai_jobs', 'source_starts_on', 'Review jobs retain period start');
select has_column('public', 'ai_jobs', 'source_ends_on', 'Review jobs retain period end');
select function_privs_are(
  'public', 'persist_review_ai_proposal_job',
  array['uuid', 'uuid', 'text', 'date', 'date', 'jsonb', 'text', 'text'],
  'service_role', array['EXECUTE'], 'only the trusted route can publish a job result'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('83000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'review-job-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('83000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'review-job-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.ai_jobs (
  id, workspace_id, actor_user_id, operation, request_id, status,
  source_review_kind, source_starts_on, source_ends_on, created_at
)
select '83100000-0000-4000-8000-000000000001', id,
  '83000000-0000-4000-8000-000000000001', 'review_analysis',
  '83200000-0000-4000-8000-000000000001', 'running',
  'weekly', '2026-08-17', '2026-08-23', '2026-08-17T10:00:00Z'
from public.workspaces where owner_user_id = '83000000-0000-4000-8000-000000000001';
insert into public.ai_jobs (
  id, workspace_id, actor_user_id, operation, request_id, status,
  source_review_kind, source_starts_on, source_ends_on, created_at
)
select '83100000-0000-4000-8000-000000000002', id,
  '83000000-0000-4000-8000-000000000001', 'review_analysis',
  '83200000-0000-4000-8000-000000000002', 'running',
  'weekly', '2026-08-17', '2026-08-23', '2026-08-17T10:01:00Z'
from public.workspaces where owner_user_id = '83000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.persist_review_ai_proposal_job(
    '83000000-0000-4000-8000-000000000001', '83100000-0000-4000-8000-000000000001',
    'weekly', '2026-08-17', '2026-08-23',
    '{"summary":"Stale","priorityActionIds":[],"recommendations":[],"reflectionPrompts":["Old?"]}',
    'test-model', 'review-analysis-v1'
  )$$, 'P0001', 'analysis_superseded', 'an older result cannot publish after a newer request'
);
select lives_ok(
  $$select public.persist_review_ai_proposal_job(
    '83000000-0000-4000-8000-000000000001', '83100000-0000-4000-8000-000000000002',
    'weekly', '2026-08-17', '2026-08-23',
    '{"summary":"Newest","priorityActionIds":[],"recommendations":[],"reflectionPrompts":["What changed?"]}',
    'test-model', 'review-analysis-v1'
  )$$, 'the newest running job can publish'
);
select is((select count(*)::integer from public.review_ai_proposals), 1, 'only one proposal persists');
select is((select payload ->> 'summary' from public.review_ai_proposals), 'Newest', 'the newest payload wins');
select throws_ok(
  $$insert into public.ai_jobs (
    workspace_id, actor_user_id, operation, request_id, status, source_review_kind
  ) select id, '83000000-0000-4000-8000-000000000001', 'review_analysis',
    '83200000-0000-4000-8000-000000000099', 'running', 'weekly'
    from public.workspaces where owner_user_id = '83000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a Review job without exact period source is rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.ai_jobs), 2, 'the owner can inspect Review job status');
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.ai_jobs), 0, 'another owner cannot inspect Review jobs');

select * from finish();
rollback;
