begin;
select plan(34);

select has_table('public', 'notifications', 'in-app notifications exist');
select has_table(
  'public', 'notification_email_deliveries', 'email delivery claims exist'
);
select ok((select relrowsecurity from pg_class
  where oid = 'public.notifications'::regclass
), 'notifications have RLS');
select ok((select relrowsecurity from pg_class
  where oid = 'public.notification_email_deliveries'::regclass
), 'email delivery claims have RLS'
);
select table_privs_are(
  'public', 'notifications', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate notifications directly'
);
select table_privs_are(
  'public', 'notification_email_deliveries', 'authenticated', array[]::text[],
  'email delivery metadata is private'
);
select function_privs_are(
  'public', 'execute_notification_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the notification executor is private'
);
select function_privs_are(
  'public', 'claim_notification_email_batch', array['integer'],
  'authenticated', array[]::text[], 'the email claim worker is private'
);
select is(
  (select count(*)::integer from public.operation_contracts
   where operation_id like 'notification.%'),
  4, 'all notification Operations are registered'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notifications-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('d2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notifications-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.workspaces set
  weekly_review_day = ((extract(dow from current_date)::integer + 1) % 7)::smallint
where owner_user_id = 'd2000000-0000-0000-0000-000000000001';

insert into public.planning_horizons (
  workspace_id, kind, starts_on, ends_on, timezone_snapshot
)
select id, 'week', current_date - 7, current_date + 7, timezone
from public.workspaces
where owner_user_id = 'd2000000-0000-0000-0000-000000000001';

insert into public.actions (
  workspace_id, horizon_id, title, status, scheduled_on
)
select workspace.id, horizon.id, 'Resolve the overdue decision', 'open', current_date - 1
from public.workspaces workspace
join public.planning_horizons horizon on horizon.workspace_id = workspace.id
where workspace.owner_user_id = 'd2000000-0000-0000-0000-000000000001';

insert into public.action_templates (
  workspace_id, title, cadence, next_occurrence_on
)
select id, 'Prepare the recurring review', 'weekly', current_date
from public.workspaces
where owner_user_id = 'd2000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'notification.refresh.v1', '{}'::jsonb, 'notification-refresh-0001'
  )$$,
  'notification refresh runs through the trusted gateway'
);
select is((select count(*)::integer from public.notifications), 2,
  'refresh creates one overdue and one recurring summary');
select is((select count(distinct dedupe_key)::integer from public.notifications), 2,
  'notification summaries have unique dedupe keys');
select lives_ok(
  $$select public.execute_ui_operation(
    'notification.refresh.v1', '{}'::jsonb, 'notification-refresh-0001'
  )$$,
  'replaying a refresh idempotency key succeeds'
);
select is((select count(*)::integer from public.notifications), 2,
  'idempotent refresh does not duplicate notifications');
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'notification-refresh-0001')
    ),
    'notification-refresh-undo-0001'
  )$$,
  'an unchanged refresh can be undone'
);
select is((select count(*)::integer from public.notifications), 0,
  'refresh Undo removes exactly the generated summaries');

select lives_ok(
  $$select public.execute_ui_operation(
    'notification.refresh.v1', '{}'::jsonb, 'notification-refresh-0002'
  )$$,
  'notification summaries can be regenerated after Undo'
);
select lives_ok(
  format(
    'select public.execute_ui_operation(''notification.read.v1'', %L::jsonb, ''notification-read-0001'')',
    jsonb_build_object(
      'id', (select id from public.notifications order by created_at limit 1),
      'expectedVersion', 1
    )::text
  ),
  'a notification can be marked read'
);
select ok(
  (select notification.read_at is not null from public.notifications notification
   where notification.id = (select target_id from public.operation_receipts
                            where idempotency_key = 'notification-read-0001')),
  'the read timestamp is durable'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'notification-read-0001')
    ),
    'notification-read-undo-0001'
  )$$,
  'an unchanged read can be undone'
);
select ok(
  (select notification.read_at is null and notification.version = 1
   from public.notifications notification
   where notification.id = (select target_id from public.operation_receipts
                            where idempotency_key = 'notification-read-0001')),
  'read Undo restores the unread version'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''notification.dismiss.v1'', %L::jsonb, ''notification-dismiss-0001'')',
    jsonb_build_object(
      'id', (select id from public.notifications order by created_at limit 1),
      'expectedVersion', 1
    )::text
  ),
  'a notification can be dismissed'
);
select ok(
  (select notification.dismissed_at is not null from public.notifications notification
   where notification.id = (select target_id from public.operation_receipts
                            where idempotency_key = 'notification-dismiss-0001')),
  'the dismissal timestamp is durable'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'notification-dismiss-0001')
    ),
    'notification-dismiss-undo-0001'
  )$$,
  'an unchanged dismissal can be undone'
);
select ok(
  (select notification.dismissed_at is null and notification.version = 1
   from public.notifications notification
   where notification.id = (select target_id from public.operation_receipts
                            where idempotency_key = 'notification-dismiss-0001')),
  'dismiss Undo restores the notification'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''notification.preferences.v1'', %L::jsonb, ''notification-preferences-0001'')',
    jsonb_build_object(
      'inAppEnabled', true, 'emailEnabled', true, 'emailHour', 0,
      'quietHoursStart', to_char(localtime + interval '1 hour', 'HH24:MI'),
      'quietHoursEnd', to_char(localtime + interval '1 hour 1 minute', 'HH24:MI')
    )::text
  ),
  'notification preferences can enable email delivery'
);
select is(
  (select undo_payload_json #>> '{before,emailEnabled}' from public.operation_receipts
   where idempotency_key = 'notification-preferences-0001'),
  'false', 'the preference receipt captures the true prior email setting'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'notification-preferences-0001')
    ),
    'notification-preferences-undo-0001'
  )$$,
  'unchanged notification preferences can be undone'
);
select is((select email_reminders_enabled from public.workspaces), false,
  'preference Undo restores disabled email reminders');

select lives_ok(
  format(
    'select public.execute_ui_operation(''notification.preferences.v1'', %L::jsonb, ''notification-preferences-0002'')',
    jsonb_build_object(
      'inAppEnabled', true, 'emailEnabled', true, 'emailHour', 0,
      'quietHoursStart', to_char(localtime + interval '1 hour', 'HH24:MI'),
      'quietHoursEnd', to_char(localtime + interval '1 hour 1 minute', 'HH24:MI')
    )::text
  ),
  'email reminders can be enabled again for worker testing'
);

reset role;
select is(
  (select count(*)::integer from public.claim_notification_email_batch(10)),
  1, 'the worker atomically claims one due Workspace email'
);
select is(
  (select notification_count from public.notification_email_deliveries),
  2, 'the email claim contains only a generic unread count'
);
select ok(
  (public.build_mcp_workspace_snapshot(
    (select id from public.workspaces
     where owner_user_id = 'd2000000-0000-0000-0000-000000000001')
  ) -> 'notifications') is not null,
  'the MCP snapshot includes bounded notification state'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.notifications), 0,
  'RLS hides another owner''s notifications');

select * from finish();
rollback;
