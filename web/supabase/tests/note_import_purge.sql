-- IM-05 (#168): an abandoned import preview was stored indefinitely. This
-- pins the schema the note-import-purge worker (src/app/api/internal/
-- note-import-purge/route.ts) depends on: a cheap partial index to find stale
-- previews across every workspace, and lifecycle_job_runs accepting the new
-- job name so the worker's run evidence can be recorded at all.

begin;
select plan(4);

select has_index(
  'public', 'note_import_jobs', 'note_import_jobs_stale_preview_idx',
  'a partial index exists to find stale preview jobs cheaply'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'import-purge-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

-- lifecycle_job_runs is service-role only (the worker uses the admin
-- client), so this exercises the constraint directly as the table owner
-- rather than through an authenticated RLS path.
select lives_ok(
  $$insert into public.lifecycle_job_runs (job_name) values ('note_import_purge')$$,
  'note_import_purge is an accepted lifecycle job name'
);
select throws_ok(
  $$insert into public.lifecycle_job_runs (job_name) values ('not_a_real_job')$$,
  '23514', null,
  'an unrecognised lifecycle job name is still rejected'
);
select is(
  (select status from public.lifecycle_job_runs where job_name = 'note_import_purge'),
  'running',
  'a fresh run starts in the running state'
);

select * from finish();
rollback;
