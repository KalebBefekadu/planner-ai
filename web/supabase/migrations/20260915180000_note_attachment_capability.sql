-- Attachments become reserve, upload, finalize, and reconcile.
--
-- Uploading crossed two services with no record between them: the object was
-- written to private Storage first and the metadata row second, so a failure
-- after the upload left an object nothing pointed at. The route papered over
-- the common case by deleting the object again, which only works when the
-- process survives long enough to do it. A crash, a timeout or a lost
-- connection left an orphan that nothing would ever find.
--
-- A reservation is written first. It is a real row in `reserved` state that
-- names the exact object key the upload is allowed to write, and it is the only
-- thing that authorizes writing that key at all. The upload happens, the row is
-- finalized, and if anything fails in between the reservation is still there
-- for the purge job to reconcile. Nothing is invisible any more.
--
-- The same change removes the last reason these routes needed service-role
-- access. Metadata writes go through owner-scoped functions that derive the
-- Workspace from `auth.uid()`, and Storage authorizes the person directly.

begin;

alter table public.note_attachments
  add column upload_state text not null default 'stored'
    check (upload_state in ('reserved', 'stored'));

-- Every existing row is a completed upload, which is what the default says.
-- The index serves reconciliation, which asks only for stale reservations.
create index note_attachments_reserved_idx
  on public.note_attachments (created_at)
  where upload_state = 'reserved';

-- A reservation is not an attachment yet. It must not appear in a Note, in an
-- export, or in the listing a person removes things from. Hiding it in the
-- policy rather than in each query means no reader can forget.
drop policy note_attachments_select_owner on public.note_attachments;
create policy note_attachments_select_owner on public.note_attachments
  for select to authenticated
  using (
    upload_state = 'stored'
    and workspace_id in (
      select id from public.workspaces where owner_user_id = (select auth.uid())
    )
  );

-- Whether the caller has a reservation waiting for exactly this object.
--
-- This is a function rather than a subquery inside the policy for two reasons,
-- both of which silently denied every upload when it was written inline.
--
-- `note_attachments` forces RLS and its select policy hides reservations, so a
-- subquery evaluated as the caller could never see the row it was looking for.
-- And a policy on `storage.objects` that joins `workspaces` has two `name`
-- columns in scope: the bare `name` bound to `workspaces.name` rather than the
-- object key, so the check compared an object key to a Workspace title. Naming
-- the key as a parameter removes both traps.
create function public.note_attachment_reservation_exists(p_object_key text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select exists (
    select 1 from public.note_attachments attachment
    join public.workspaces workspace on workspace.id = attachment.workspace_id
    where attachment.object_key = p_object_key
      and attachment.upload_state = 'reserved'
      and workspace.owner_user_id = auth.uid()
  );
$$;

revoke all on function public.note_attachment_reservation_exists(text)
from public, anon, authenticated;
grant execute on function public.note_attachment_reservation_exists(text) to authenticated;

-- Whether the caller owns the attachment an object belongs to.
--
-- The read policy written with the bucket in 20260906060643 has the same
-- shadowing fault: inside its subquery the bare `name` bound to
-- `workspaces.name`, so it compared a Workspace id to a path segment of the
-- Workspace's own title and granted nothing to anybody. Nothing noticed,
-- because every read went through the service-role client, which does not
-- consult policies at all. This branch is what starts depending on it.
--
-- The replacement is also narrower than the original intent: ownership of the
-- attachment row, not merely of the Workspace prefix the key sits under.
create function public.note_attachment_object_is_readable(p_object_key text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select exists (
    select 1 from public.note_attachments attachment
    join public.workspaces workspace on workspace.id = attachment.workspace_id
    where attachment.object_key = p_object_key
      and attachment.upload_state = 'stored'
      and workspace.owner_user_id = auth.uid()
  );
$$;

revoke all on function public.note_attachment_object_is_readable(text)
from public, anon, authenticated;
grant execute on function public.note_attachment_object_is_readable(text) to authenticated;

drop policy note_attachments_select_owner on storage.objects;
create policy note_attachments_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-attachments'
    and public.note_attachment_object_is_readable(name)
  );

-- Storage authorizes the person, not a trusted key. The grant is deliberately
-- narrower still on the write side: a person may write exactly the object a
-- reservation of their own is waiting for, and nothing else. There is no delete policy, because no request path needs one -- an
-- object whose row never finalized is reconciled by the purge job.
create policy note_attachments_insert_reserved on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-attachments'
    and public.note_attachment_reservation_exists(name)
  );

-- Reserve. The Workspace comes from ownership, the Note must be the caller's
-- own and still live, and the object key is computed here so no caller can
-- choose where their bytes land.
create function public.reserve_note_attachment(
  p_note_id uuid,
  p_original_name text,
  p_media_type text,
  p_byte_size bigint,
  p_checksum_sha256 text,
  p_scan_state text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_attachment_id uuid := extensions.gen_random_uuid();
  v_object_key text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_scan_state is null or p_scan_state not in ('quarantined', 'approved', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_scan_state';
  end if;
  select workspace.id into v_workspace_id from public.workspaces workspace
  where workspace.owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;
  if not exists (
    select 1 from public.notes note
    where note.id = p_note_id and note.workspace_id = v_workspace_id
      and note.archived_at is null and note.trashed_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'note_not_found';
  end if;

  v_object_key := v_workspace_id::text || '/' || p_note_id::text || '/' || v_attachment_id::text;
  insert into public.note_attachments (
    id, workspace_id, note_id, object_key, original_name, media_type,
    byte_size, checksum_sha256, scan_state, upload_state
  ) values (
    v_attachment_id, v_workspace_id, p_note_id, v_object_key, p_original_name,
    p_media_type, p_byte_size, p_checksum_sha256, p_scan_state, 'reserved'
  );
  return jsonb_build_object('attachmentId', v_attachment_id, 'objectKey', v_object_key);
end;
$$;

-- Finalize. The bytes are in Storage; the row becomes an attachment.
create function public.finalize_note_attachment(p_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  update public.note_attachments attachment
  set upload_state = 'stored'
  where attachment.id = p_attachment_id and attachment.upload_state = 'reserved'
    and exists (
      select 1 from public.workspaces workspace
      where workspace.id = attachment.workspace_id and workspace.owner_user_id = v_user_id
    );
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception using errcode = 'P0001', message = 'attachment_not_reserved';
  end if;
end;
$$;

-- Abandon. The tidy path when the upload itself failed and no object exists.
-- Reconciliation is what covers the untidy paths.
create function public.abandon_note_attachment(p_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  delete from public.note_attachments attachment
  where attachment.id = p_attachment_id and attachment.upload_state = 'reserved'
    and exists (
      select 1 from public.workspaces workspace
      where workspace.id = attachment.workspace_id and workspace.owner_user_id = v_user_id
    );
end;
$$;

-- Remove. Retention is decided here rather than by the caller, so a request
-- cannot ask for a purge date of its own choosing.
create function public.remove_note_attachment(p_attachment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_purge_after timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  update public.note_attachments attachment
  set removed_at = now(), purge_after = now() + interval '30 days'
  where attachment.id = p_attachment_id and attachment.removed_at is null
    and attachment.upload_state = 'stored'
    and exists (
      select 1 from public.workspaces workspace
      where workspace.id = attachment.workspace_id and workspace.owner_user_id = v_user_id
    )
  returning attachment.purge_after into v_purge_after;
  if v_purge_after is null then
    raise exception using errcode = 'P0002', message = 'attachment_not_found';
  end if;
  return v_purge_after;
end;
$$;

-- Restore, while the retention window is still open.
create function public.restore_note_attachment(p_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  update public.note_attachments attachment
  set removed_at = null, purge_after = null
  where attachment.id = p_attachment_id and attachment.removed_at is not null
    and attachment.purge_after > now() and attachment.upload_state = 'stored'
    and exists (
      select 1 from public.workspaces workspace
      where workspace.id = attachment.workspace_id and workspace.owner_user_id = v_user_id
    );
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception using errcode = 'P0002', message = 'attachment_not_restorable';
  end if;
end;
$$;

-- The deferred content check writes its answer back the first time a file is
-- asked for. A row that is not the caller's own is left alone rather than
-- refused, because this runs inside a read the caller has already been denied.
create function public.record_note_attachment_scan(
  p_attachment_id uuid,
  p_scan_state text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_scan_state is null or p_scan_state not in ('quarantined', 'approved', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_scan_state';
  end if;
  update public.note_attachments attachment
  set scan_state = p_scan_state
  where attachment.id = p_attachment_id and attachment.upload_state = 'stored'
    and exists (
      select 1 from public.workspaces workspace
      where workspace.id = attachment.workspace_id and workspace.owner_user_id = v_user_id
    );
end;
$$;

revoke all on function public.reserve_note_attachment(uuid, text, text, bigint, text, text)
from public, anon, authenticated;
grant execute on function public.reserve_note_attachment(uuid, text, text, bigint, text, text)
to authenticated;

revoke all on function public.finalize_note_attachment(uuid) from public, anon, authenticated;
grant execute on function public.finalize_note_attachment(uuid) to authenticated;

revoke all on function public.abandon_note_attachment(uuid) from public, anon, authenticated;
grant execute on function public.abandon_note_attachment(uuid) to authenticated;

revoke all on function public.remove_note_attachment(uuid) from public, anon, authenticated;
grant execute on function public.remove_note_attachment(uuid) to authenticated;

revoke all on function public.restore_note_attachment(uuid) from public, anon, authenticated;
grant execute on function public.restore_note_attachment(uuid) to authenticated;

revoke all on function public.record_note_attachment_scan(uuid, text)
from public, anon, authenticated;
grant execute on function public.record_note_attachment_scan(uuid, text) to authenticated;

commit;
