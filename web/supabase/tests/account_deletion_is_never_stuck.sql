begin;
select plan(18);

-- The worker claimed a request by flipping it to `processing`, and nothing
-- released that claim if the process stopped before writing an outcome. The
-- cron only selected `scheduled`, so the request was never looked at again --
-- a deletion somebody asked for, stopping with nothing failing and nothing
-- saying so. These are the assertions that would have caught it.

select has_column('public', 'account_deletion_requests', 'attempt_count',
  'a deletion request counts its attempts');
select has_column('public', 'account_deletion_requests', 'next_attempt_at',
  'a deletion request carries its backoff');
select function_privs_are(
  'public', 'claim_account_deletion_batch', array['integer'],
  'authenticated', array[]::text[], 'a person cannot claim deletion work'
);
select function_privs_are(
  'public', 'claim_account_deletion_batch', array['integer'],
  'anon', array[]::text[], 'an anonymous caller cannot claim deletion work'
);
select ok(
  (select bool_and(proc.prosecdef
     and 'search_path=pg_catalog, public' = any(coalesce(proc.proconfig, array[]::text[])))
   from pg_proc proc join pg_namespace space on space.oid = proc.pronamespace
   where space.nspname = 'public' and proc.proname in (
     'claim_account_deletion_batch', 'release_account_deletion', 'complete_account_deletion')),
  'the job capability is security definer with a fixed search path'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deletion-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('f2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deletion-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- One request a worker abandoned six hours ago, one claimed a moment ago.
insert into public.account_deletion_requests (
  workspace_id, user_id, status, scheduled_for, processing_started_at, attempt_count
)
select workspace.id, workspace.owner_user_id, 'processing',
  now() - interval '30 days', now() - interval '6 hours', 1
from public.workspaces workspace
where workspace.owner_user_id = 'f2000000-0000-4000-8000-000000000001';
insert into public.account_deletion_requests (
  workspace_id, user_id, status, scheduled_for, processing_started_at, attempt_count
)
select workspace.id, workspace.owner_user_id, 'processing',
  now() - interval '30 days', now(), 1
from public.workspaces workspace
where workspace.owner_user_id = 'f2000000-0000-4000-8000-000000000002';

select throws_ok(
  $$select * from public.claim_account_deletion_batch(0)$$,
  'P0001', 'invalid_deletion_batch_limit',
  'a batch size outside the allowed range is refused'
);
select throws_ok(
  $$select * from public.claim_account_deletion_batch(101)$$,
  'P0001', 'invalid_deletion_batch_limit',
  'an oversized batch is refused'
);

/* The whole point. The abandoned request is claimed again; the one a live
   worker is holding is left alone. */
select is(
  (select count(*)::integer from public.claim_account_deletion_batch(25)),
  1, 'exactly the abandoned request is reclaimed'
);
select is(
  (select count(*)::integer from public.claim_account_deletion_batch(25)),
  0, 'a second pass finds nothing, because both requests are now freshly claimed'
);
select is(
  (select attempt_count from public.account_deletion_requests
   where user_id = 'f2000000-0000-4000-8000-000000000001'),
  2, 'reclaiming counts as another attempt'
);
select is(
  (select status from public.account_deletion_requests
   where user_id = 'f2000000-0000-4000-8000-000000000002'),
  'processing', 'a request a live worker still holds is not stolen'
);
select is(
  (select attempt_count from public.account_deletion_requests
   where user_id = 'f2000000-0000-4000-8000-000000000002'),
  1, 'and its attempt count is untouched'
);

select set_config('test.request',
  (select id::text from public.account_deletion_requests
   where user_id = 'f2000000-0000-4000-8000-000000000001'), true);

/* Releasing sets a backoff, so a request that cannot succeed is not retried
   every minute forever. At two attempts that is sixteen minutes. */
select lives_ok(
  $$select public.release_account_deletion(
    current_setting('test.request')::uuid, 'auth_delete_failed')$$,
  'a failed attempt hands the claim back'
);
select is(
  (select status from public.account_deletion_requests
   where id = current_setting('test.request')::uuid),
  'scheduled', 'the request is schedulable again'
);
select ok(
  (select next_attempt_at from public.account_deletion_requests
   where id = current_setting('test.request')::uuid)
    between now() + interval '15 minutes' and now() + interval '17 minutes',
  'the backoff widens with the attempt count'
);
select is(
  (select count(*)::integer from public.claim_account_deletion_batch(25)),
  0, 'a request inside its backoff is not claimed'
);

/* Completing is only possible from a claim, so a lost race cannot mark a
   request deleted that another worker is still working on. */
select lives_ok(
  $$select public.complete_account_deletion(current_setting('test.request')::uuid)$$,
  'completing a request that is not claimed is accepted and does nothing'
);
select is(
  (select status from public.account_deletion_requests
   where id = current_setting('test.request')::uuid),
  'scheduled', 'and it stays schedulable rather than being marked complete'
);

select * from finish();
rollback;
