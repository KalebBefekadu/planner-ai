begin;
select plan(16);

select function_privs_are(
  'public', 'execute_period_review_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the period Review undo executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'cb000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'period-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'cb000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"monthly","startsOn":"2026-09-01","endsOn":"2026-09-30","reflectionMarkdown":"Keep the plan focused."}',
    'period-undo-create-0001'
  )$$,
  'a period Review with a new horizon is completed'
);
select is(
  (select undo_payload_json ->> 'horizonMode' from public.operation_receipts
   where idempotency_key = 'period-undo-create-0001'),
  'create', 'the receipt records that the horizon was created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'period-undo-create-0001')
    ),
    'period-undo-apply-0001'
  )$$,
  'an unchanged period Review can be undone'
);
select is((select count(*)::integer from public.reviews), 0,
  'period Review undo removes the completed Review');
select is(
  (select count(*)::integer from public.planning_horizons
   where kind = 'month' and starts_on = '2026-09-01'),
  0, 'period Review undo removes its unreferenced new horizon'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where reverses_receipt_id = (select id from public.operation_receipts
                                where idempotency_key = 'period-undo-create-0001')),
  1, 'the Undo receipt links to the original completion receipt'
);

reset role;
insert into public.planning_horizons (
  workspace_id, kind, starts_on, ends_on, timezone_snapshot
) values (
  (select id from public.workspaces where owner_user_id = 'cb000000-0000-0000-0000-000000000001'),
  'quarter', '2026-10-01', '2026-12-31', 'Pacific/Honolulu'
);
set local role authenticated;
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"quarterly","startsOn":"2026-10-01","endsOn":"2026-12-31","reflectionMarkdown":"Finish the year deliberately."}',
    'period-undo-update-0001'
  )$$,
  'a period Review can reuse an existing horizon'
);
select is(
  (select undo_payload_json ->> 'horizonMode' from public.operation_receipts
   where idempotency_key = 'period-undo-update-0001'),
  'update', 'the receipt records that the horizon existed'
);
select is(
  (select timezone_snapshot from public.planning_horizons
   where kind = 'quarter' and starts_on = '2026-10-01'),
  'UTC', 'completion snapshots the current Workspace timezone'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'period-undo-update-0001')
    ),
    'period-undo-update-apply-0001'
  )$$,
  'a period Review on a pre-existing horizon can be undone'
);
select is(
  (select timezone_snapshot from public.planning_horizons
   where kind = 'quarter' and starts_on = '2026-10-01'),
  'Pacific/Honolulu', 'Undo restores the prior horizon timezone snapshot'
);
select is((select count(*)::integer from public.reviews), 0,
  'both completed period Reviews are removed after Undo');

select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"monthly","startsOn":"2026-11-01","endsOn":"2026-11-30","reflectionMarkdown":"Original reflection."}',
    'period-undo-conflict-0001'
  )$$,
  'another Review is completed for conflict testing'
);
reset role;
update public.reviews set reflection_markdown = 'Changed later.'
where id = (select (result_json ->> 'reviewId')::uuid from public.operation_receipts
            where idempotency_key = 'period-undo-conflict-0001');
set local role authenticated;
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'period-undo-conflict-0001')
    ),
    'period-undo-conflict-apply-0001'
  )$$,
  'P0001', 'undo_conflict',
  'Undo refuses to remove a Review that changed later'
);
select is(
  (select reflection_markdown from public.reviews),
  'Changed later.', 'a refused Undo preserves the newer Review content'
);

select * from finish();
rollback;
