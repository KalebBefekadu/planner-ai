begin;

alter table public.note_attachments
  add column purge_after timestamptz;

alter table public.note_attachments
  add constraint note_attachments_removal_lifecycle_check check (
    (removed_at is null and purge_after is null)
    or (removed_at is not null and purge_after is not null)
  );

create index note_attachments_purge_idx
  on public.note_attachments (purge_after)
  where removed_at is not null;

commit;
