begin;
select plan(10);

select has_table('public', 'note_attachments', 'Note attachments metadata exists');
select row_security_active('public.note_attachments'), 'Note attachments metadata has RLS';
select table_privs_are(
  'public', 'note_attachments', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate attachment metadata directly'
);
select table_privs_are(
  'public', 'note_attachments', 'service_role',
  array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'the trusted server can manage quarantined attachment metadata'
);
select ok(exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'note_attachments'
    and policyname = 'note_attachments_select_owner'
), 'attachment metadata only exposes the owning workspace');
select ok(exists (
  select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'note_attachments_select_owner'
), 'private object reads require workspace ownership');
select is((select public from storage.buckets where id = 'note-attachments'), false, 'the Notes attachment bucket is private');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'attachment-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'attachment-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.execute_ui_operation(
  'note.create.v1', '{"title":"Attachment evidence","bodyMarkdown":"","parentNoteId":null}',
  'note-attachment-seed-0001'
)$$, 'the owner can create the Note that owns an attachment');
reset role;

insert into public.note_attachments (
  workspace_id, note_id, object_key, original_name, media_type, byte_size, checksum_sha256
)
select workspace.id, note.id,
  workspace.id::text || '/' || note.id::text || '/d0000000-0000-0000-0000-000000000010',
  'evidence.pdf', 'application/pdf', 1024, repeat('a', 64)
from public.workspaces workspace
join public.notes note on note.workspace_id = workspace.id
where workspace.owner_user_id = 'd0000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.note_attachments), 1, 'the owner can read attachment metadata');
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.note_attachments), 0, 'another owner cannot read attachment metadata');
select throws_ok($$insert into public.note_attachments (
  workspace_id, note_id, object_key, original_name, media_type, byte_size, checksum_sha256
) values (
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000001',
  'nope.txt', 'text/plain', 10, repeat('b', 64)
)$$, '42501', null, 'an authenticated user cannot create attachment metadata directly');

select * from finish();
rollback;
