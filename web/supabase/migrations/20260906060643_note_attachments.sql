begin;

create table public.note_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  object_key text not null check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  original_name text not null check (char_length(original_name) between 1 and 255),
  media_type text not null check (char_length(media_type) between 1 and 255),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  scan_state text not null default 'quarantined'
    check (scan_state in ('quarantined', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (workspace_id, object_key),
  foreign key (note_id, workspace_id)
    references public.notes(id, workspace_id) on delete cascade
);

create index note_attachments_note_idx
  on public.note_attachments (workspace_id, note_id, created_at desc)
  where removed_at is null;

alter table public.note_attachments enable row level security;
alter table public.note_attachments force row level security;
revoke all on public.note_attachments from anon;
revoke insert, update, delete, truncate, references, trigger on public.note_attachments from authenticated;
grant select on public.note_attachments to authenticated;
create policy note_attachments_select_owner on public.note_attachments
  for select to authenticated
  using (
    workspace_id in (
      select id from public.workspaces where owner_user_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-attachments', 'note-attachments', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'text/markdown', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy note_attachments_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-attachments'
    and exists (
      select 1 from public.workspaces workspace
      where workspace.owner_user_id = (select auth.uid())
        and workspace.id::text = (storage.foldername(name))[1]
    )
  );

commit;
