begin;
select plan(16);

select has_table('public', 'review_ai_proposals', 'durable Review proposals exist');
select ok((select relrowsecurity from pg_class
  where oid = 'public.review_ai_proposals'::regclass
), 'Review proposals have RLS');
select table_privs_are(
  'public', 'review_ai_proposals', 'authenticated', array['SELECT'],
  'authenticated users can only read Review proposals directly'
);
select function_privs_are(
  'public', 'persist_review_ai_proposal',
  array['uuid', 'text', 'date', 'date', 'jsonb', 'text', 'text'],
  'service_role', array['EXECUTE'], 'only the trusted provider route can persist proposals'
);
select function_privs_are(
  'public', 'consume_review_analysis_quota', array['uuid'],
  'authenticated', array['EXECUTE'], 'Review analysis has a dedicated quota boundary'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('82000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'review-ai-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('82000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'review-ai-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.planning_horizons (id, workspace_id, kind, starts_on, ends_on, timezone_snapshot)
select '82100000-0000-4000-8000-000000000001', id, 'week', '2026-08-17', '2026-08-23', 'UTC'
from public.workspaces where owner_user_id = '82000000-0000-4000-8000-000000000001';
insert into public.planning_horizons (id, workspace_id, kind, starts_on, ends_on, timezone_snapshot)
select '82100000-0000-4000-8000-000000000002', id, 'week', '2026-08-17', '2026-08-23', 'UTC'
from public.workspaces where owner_user_id = '82000000-0000-4000-8000-000000000002';
insert into public.actions (id, workspace_id, horizon_id, title)
select '82200000-0000-4000-8000-000000000001', id, '82100000-0000-4000-8000-000000000001', 'Ship the beta'
from public.workspaces where owner_user_id = '82000000-0000-4000-8000-000000000001';
insert into public.actions (id, workspace_id, horizon_id, title)
select '82200000-0000-4000-8000-000000000002', id, '82100000-0000-4000-8000-000000000002', 'Other owner Action'
from public.workspaces where owner_user_id = '82000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select is(
  public.consume_review_analysis_quota('82300000-0000-4000-8000-000000000001'),
  'allowed', 'Review analysis reserves its own quota and cost'
);
select is(
  (select operation from public.ai_quota_reservations limit 1),
  'review_analysis', 'the reservation records the exact capability'
);
select lives_ok(
  $$select public.record_ai_usage(
    '82300000-0000-4000-8000-000000000001', 'review_analysis', 'structured_analysis',
    'groq', 'openai/gpt-oss-120b', '2026-08-17-gpt-oss-120b', 'succeeded',
    200, 100, 50, null, 100, null
  )$$, 'Review analysis usage is recorded separately'
);
select is(
  (select count(*)::integer from public.ai_quota_reservations),
  0, 'recorded usage reconciles its in-flight reservation'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select public.persist_review_ai_proposal(
    '82000000-0000-4000-8000-000000000001', 'weekly', '2026-08-17', '2026-08-23',
    '{"summary":"Protect launch work.","priorityActionIds":["82200000-0000-4000-8000-000000000001"],"recommendations":[{"text":"Ship the beta is available.","status":"supported","evidence":[{"type":"action","id":"82200000-0000-4000-8000-000000000001","label":"Ship the beta","href":"/"}]}],"reflectionPrompts":["What would make this easier?"]}'::jsonb,
    'test-model', 'review-analysis-v1'
  )$$, 'a bounded owner-scoped Review proposal persists'
);
select is((select status from public.review_ai_proposals), 'active', 'the latest proposal is active');
select throws_ok(
  $$select public.persist_review_ai_proposal(
    '82000000-0000-4000-8000-000000000001', 'weekly', '2026-08-17', '2026-08-23',
    '{"summary":"Cross owner.","priorityActionIds":["82200000-0000-4000-8000-000000000002"],"recommendations":[],"reflectionPrompts":["Reflect."]}'::jsonb,
    'test-model', 'review-analysis-v1'
  )$$, '42501', 'invalid_review_priority', 'cross-Workspace priorities are rejected'
);
select throws_ok(
  $$select public.persist_review_ai_proposal(
    '82000000-0000-4000-8000-000000000001', 'weekly', '2026-08-17', '2026-08-23',
    '{"summary":"Cross evidence.","priorityActionIds":[],"recommendations":[{"text":"Other owner.","status":"supported","evidence":[{"type":"action","id":"82200000-0000-4000-8000-000000000002","label":"Other","href":"/"}]}],"reflectionPrompts":["Reflect."]}'::jsonb,
    'test-model', 'review-analysis-v1'
  )$$, '42501', 'invalid_review_evidence', 'cross-Workspace evidence is rejected'
);
select is((select count(*)::integer from public.review_ai_proposals), 1, 'rejected proposals leave no partial rows');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.review_ai_proposals), 1, 'the owner can read the proposal');
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.review_ai_proposals), 0, 'another owner cannot read the proposal');

select * from finish();
rollback;
