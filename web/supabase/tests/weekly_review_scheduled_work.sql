begin;
select plan(11);

-- Weekly Review used to consider only week-horizon Actions. Work planned at a
-- longer horizon and scheduled into the week under review -- which is exactly
-- what Today commits a person to -- was invisible, so the week could close
-- reporting nothing unresolved while that Action rolled forward with no
-- decision recorded against it.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('5a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'scheduled-review-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '5a000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Weekly work","horizonKind":"week","startsOn":"2026-08-10","endsOn":"2026-08-16","goalId":null,"parentActionId":null,"scheduledOn":"2026-08-12"}',
    'scheduled-review-action-0001'
  )$$,
  'a week-horizon Action exists in the week under review'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Monthly work committed to a day","horizonKind":"month","startsOn":"2026-08-01","endsOn":"2026-08-31","goalId":null,"parentActionId":null,"scheduledOn":"2026-08-13"}',
    'scheduled-review-action-0002'
  )$$,
  'a month-horizon Action is scheduled into the same week'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Monthly work for another week","horizonKind":"month","startsOn":"2026-08-01","endsOn":"2026-08-31","goalId":null,"parentActionId":null,"scheduledOn":"2026-08-28"}',
    'scheduled-review-action-0003'
  )$$,
  'a month-horizon Action is scheduled outside the week under review'
);

-- Omitting the scheduled monthly Action is the silent rollover this prevents.
select throws_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', '',
      'decisions', jsonb_build_array(
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Weekly work'),
          'expectedVersion', 1, 'resolution', 'done', 'reason', null, 'priority', false
        )
      )
    ),
    'scheduled-review-incomplete-0001'
  )$$,
  'P0001', 'review_action_set_changed',
  'a week cannot close while work scheduled into it has no decision'
);

-- Work scheduled outside the week is equally not this week's business.
select throws_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', '',
      'decisions', jsonb_build_array(
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Weekly work'),
          'expectedVersion', 1, 'resolution', 'done', 'reason', null, 'priority', false
        ),
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Monthly work committed to a day'),
          'expectedVersion', 1, 'resolution', 'next_week', 'reason', null, 'priority', false
        ),
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Monthly work for another week'),
          'expectedVersion', 1, 'resolution', 'next_week', 'reason', null, 'priority', false
        )
      )
    ),
    'scheduled-review-overreach-0001'
  )$$,
  'P0001', 'review_action_set_changed',
  'a week cannot decide work that was never scheduled into it'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', 'Closed with both kinds of work resolved.',
      'decisions', jsonb_build_array(
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Weekly work'),
          'expectedVersion', 1, 'resolution', 'next_week', 'reason', null, 'priority', false
        ),
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Monthly work committed to a day'),
          'expectedVersion', 1, 'resolution', 'next_week', 'reason', null, 'priority', false
        )
      )
    ),
    'scheduled-review-complete-0001'
  )$$,
  'the week closes once every Action it touches has been decided'
);

select is(
  (select count(*)::integer from public.review_action_items),
  2,
  'both kinds of work are recorded in the review'
);

-- Moving weekly work to next week means next week's horizon.
select is(
  (select horizon.kind from public.actions action
     join public.planning_horizons horizon on horizon.id = action.horizon_id
   where action.title = 'Weekly work'),
  'week',
  'weekly work stays weekly work'
);
select is(
  (select horizon.starts_on from public.actions action
     join public.planning_horizons horizon on horizon.id = action.horizon_id
   where action.title = 'Weekly work'),
  '2026-08-17'::date,
  'weekly work moves into next week''s horizon'
);

-- Moving monthly work to next week means next week's date. Rewriting its
-- horizon would silently reclassify the plan rather than reschedule the work.
select is(
  (select horizon.kind from public.actions action
     join public.planning_horizons horizon on horizon.id = action.horizon_id
   where action.title = 'Monthly work committed to a day'),
  'month',
  'monthly work is rescheduled without being reclassified as weekly'
);
select is(
  (select scheduled_on from public.actions where title = 'Monthly work committed to a day'),
  '2026-08-17'::date,
  'monthly work moves to next week by date'
);

select * from finish();
rollback;
