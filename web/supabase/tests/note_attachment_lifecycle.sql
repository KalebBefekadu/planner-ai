begin;
select plan(32);

-- Uploading crosses two services. What makes a failure between them repairable
-- is that the metadata row is written first and is never invisible to the job
-- that reconciles it. Everything below tests that ordering and the ownership
-- that holds at each step.

select function_privs_are(
  'public', 'reserve_note_attachment', array['uuid', 'text', 'text', 'bigint', 'text', 'text'],
  'anon', array[]::text[], 'an anonymous caller cannot reserve an attachment'
);
select function_privs_are(
  'public', 'reserve_note_attachment', array['uuid', 'text', 'text', 'bigint', 'text', 'text'],
  'authenticated', array['EXECUTE'], 'an owner can reserve an attachment for their own Note'
);
select function_privs_are(
  'public', 'finalize_note_attachment', array['uuid'],
  'anon', array[]::text[], 'an anonymous caller cannot finalize an upload'
);
select function_privs_are(
  'public', 'remove_note_attachment', array['uuid'],
  'anon', array[]::text[], 'an anonymous caller cannot remove an attachment'
);

-- The capability added no table-level write grant.
select table_privs_are(
  'public', 'note_attachments', 'authenticated', array['SELECT'],
  'the attachment capability did not widen direct table access'
);

select ok(exists (
  select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'note_attachments_insert_reserved'
), 'writing a private object requires a reservation of one own');

select ok(
  (select bool_and(
      proc.prosecdef
      and 'search_path=pg_catalog, public' = any(coalesce(proc.proconfig, array[]::text[]))
    )
   from pg_proc proc
   join pg_namespace space on space.oid = proc.pronamespace
   where space.nspname = 'public' and proc.proname in (
     'reserve_note_attachment', 'finalize_note_attachment', 'abandon_note_attachment',
     'remove_note_attachment', 'restore_note_attachment', 'record_note_attachment_scan'
   )),
  'every attachment capability is security definer with a fixed search path'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'attachment-life-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('d1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'attachment-life-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Owner one Note","bodyMarkdown":"","parentNoteId":null}',
    'attachment-life-note-0001'
  )$$,
  'the first owner can create a Note to attach to'
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Owner two Note","bodyMarkdown":"","parentNoteId":null}',
    'attachment-life-note-0002'
  )$$,
  'the second owner can create a Note of their own'
);

reset role;
select set_config('test.note_one',
  (select id::text from public.notes where title = 'Owner one Note'), true);
select set_config('test.note_two',
  (select id::text from public.notes where title = 'Owner two Note'), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$select public.reserve_note_attachment(
    current_setting('test.note_two')::uuid, 'wrong.pdf', 'application/pdf',
    1024, repeat('a', 64), 'approved'
  )$$,
  'P0002', 'note_not_found',
  'an attachment cannot be reserved against another Workspace Note'
);
select throws_ok(
  $$select public.reserve_note_attachment(
    current_setting('test.note_one')::uuid, 'bad.pdf', 'application/pdf',
    1024, repeat('a', 64), 'pending'
  )$$,
  '22023', 'invalid_scan_state',
  'a reservation cannot invent a scan state'
);
select lives_ok(
  $$select public.reserve_note_attachment(
    current_setting('test.note_one')::uuid, 'evidence.pdf', 'application/pdf',
    1024, repeat('a', 64), 'approved'
  )$$,
  'an owner can reserve an attachment for their own Note'
);

-- A reservation is not an attachment. Its own owner must not see it, or it
-- would appear in a Note and in an export before its bytes exist.
select is(
  (select count(*)::integer from public.note_attachments),
  0, 'a reservation is invisible even to the person who made it'
);

reset role;
select set_config('test.reservation',
  (select id::text from public.note_attachments where upload_state = 'reserved'), true);
select is(
  (select object_key from public.note_attachments
   where id = current_setting('test.reservation')::uuid),
  (select workspace.id::text || '/' || current_setting('test.note_one') || '/'
     || current_setting('test.reservation')
   from public.workspaces workspace
   where workspace.owner_user_id = 'd1000000-0000-0000-0000-000000000001'),
  'the object key is computed from the Workspace, Note and attachment'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.finalize_note_attachment(current_setting('test.reservation')::uuid)$$,
  'P0001', 'attachment_not_reserved',
  'another Workspace cannot finalize a reservation it does not own'
);
select lives_ok(
  $$select public.abandon_note_attachment(current_setting('test.reservation')::uuid)$$,
  'abandoning another Workspace reservation is accepted and does nothing'
);

reset role;
select is(
  (select upload_state from public.note_attachments
   where id = current_setting('test.reservation')::uuid),
  'reserved', 'the reservation survives every attempt by another Workspace'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.finalize_note_attachment(current_setting('test.reservation')::uuid)$$,
  'the owner finalizes their own upload'
);
select is(
  (select count(*)::integer from public.note_attachments),
  1, 'a finalized upload becomes a readable attachment'
);
select throws_ok(
  $$select public.finalize_note_attachment(current_setting('test.reservation')::uuid)$$,
  'P0001', 'attachment_not_reserved',
  'an upload that is already stored cannot be finalized again'
);

-- Called once and held, because BETWEEN evaluates its first operand twice and
-- removing an attachment is deliberately not repeatable.
select set_config('test.purge_after',
  (select public.remove_note_attachment(current_setting('test.reservation')::uuid)::text), true);
select ok(
  current_setting('test.purge_after')::timestamptz
    between now() + interval '29 days' and now() + interval '31 days',
  'retention is decided in the database, not sent by the caller'
);
select throws_ok(
  $$select public.remove_note_attachment(current_setting('test.reservation')::uuid)$$,
  'P0002', 'attachment_not_found',
  'an attachment already waiting to be purged is not removed twice'
);
select is(
  (select count(*)::integer from public.note_attachments where removed_at is not null),
  1, 'removal is recoverable rather than immediate'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.restore_note_attachment(current_setting('test.reservation')::uuid)$$,
  'P0002', 'attachment_not_restorable',
  'another Workspace cannot restore an attachment it does not own'
);
select lives_ok(
  $$select public.record_note_attachment_scan(
    current_setting('test.reservation')::uuid, 'rejected'
  )$$,
  'recording a scan for another Workspace is accepted and does nothing'
);

reset role;
select is(
  (select scan_state from public.note_attachments
   where id = current_setting('test.reservation')::uuid),
  'approved', 'another Workspace cannot mark an attachment unreadable'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.restore_note_attachment(current_setting('test.reservation')::uuid)$$,
  'the owner restores inside the retention window'
);
select is(
  (select count(*)::integer from public.note_attachments
   where removed_at is null and purge_after is null),
  1, 'a restored attachment carries no purge deadline'
);
select lives_ok(
  $$select public.record_note_attachment_scan(
    current_setting('test.reservation')::uuid, 'rejected'
  )$$,
  'the deferred content check can write its answer back'
);
select is(
  (select scan_state from public.note_attachments
   where id = current_setting('test.reservation')::uuid),
  'rejected', 'a file whose bytes do not match its type is marked, not served'
);

-- Reconciliation is the reason the row is written first: an upload that dies
-- between the two services leaves something findable.
select lives_ok(
  $$select public.reserve_note_attachment(
    current_setting('test.note_one')::uuid, 'abandoned.pdf', 'application/pdf',
    2048, repeat('c', 64), 'approved'
  )$$,
  'a second upload reserves its own row'
);
reset role;
select is(
  (select count(*)::integer from public.note_attachments where upload_state = 'reserved'),
  1, 'an upload that never finalizes is still on record for reconciliation'
);

select * from finish();
rollback;
