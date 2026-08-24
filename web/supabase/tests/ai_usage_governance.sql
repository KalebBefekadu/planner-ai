begin;
select plan(16);

select has_table('public', 'ai_usage_events', 'AI usage ledger exists');
select has_column('public', 'workspaces', 'ai_soft_budget_cents', 'Workspace soft budget exists');
select has_column('public', 'ai_usage_events', 'pricing_version', 'pricing versions are retained');
select row_security_active('public.ai_usage_events'), 'AI usage ledger has RLS';
select table_privs_are(
  'public', 'ai_usage_events', 'authenticated', array['SELECT'],
  'authenticated users can only read their usage rows directly'
);
select function_privs_are(
  'public', 'record_ai_usage',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'integer', 'numeric', 'bigint', 'text'],
  'authenticated', array['EXECUTE'], 'authenticated provider routes can record bounded usage'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'usage-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'usage-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.record_ai_usage(
    'b1000000-0000-0000-0000-000000000001', 'assistant', 'agent', 'groq',
    'llama-3.3-70b-versatile', '2026-08-17', 'succeeded', 420,
    1000, 500, null, 985, null
  )$$,
  'a bounded content-free usage event can be recorded'
);
select is((select count(*)::integer from public.ai_usage_events), 1, 'one event is stored');
select is(
  (select pricing_version from public.ai_usage_events),
  '2026-08-17',
  'the estimate keeps its pricing version'
);
select lives_ok(
  $$select public.record_ai_usage(
    'b1000000-0000-0000-0000-000000000001', 'assistant', 'agent', 'groq',
    'llama-3.3-70b-versatile', '2026-08-17', 'succeeded', 420,
    1000, 500, null, 985, null
  )$$,
  'request IDs make usage recording idempotent'
);
select is((select count(*)::integer from public.ai_usage_events), 1, 'a retry is not double counted');
select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.ai-budget.v1', '{"softBudgetCents":900}', 'ai-budget-update-0001'
  )$$,
  'the soft budget is changed through the trusted Operation gateway'
);
select is(
  (select ai_soft_budget_cents from public.workspaces where owner_user_id = auth.uid()),
  900,
  'the Workspace soft budget is updated'
);
select is(
  (select risk_class from public.operation_receipts where operation_id = 'workspace.ai-budget.v1'),
  'medium',
  'budget changes are audited as medium risk'
);
select lives_ok(
  $$select public.record_ai_usage(
    'b1000000-0000-0000-0000-000000000002', 'assistant', 'agent', 'groq',
    'llama-3.3-70b-versatile', '2026-08-17', 'succeeded', 100,
    0, 0, null, 20000000, null
  )$$,
  'a platform-cap fixture can be recorded'
);
select is(
  public.consume_ai_quota('assistant'),
  false,
  'the hard monthly platform cap blocks another provider request'
);

select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.ai_usage_events), 0, 'another owner cannot read usage');

select * from finish();
rollback;
