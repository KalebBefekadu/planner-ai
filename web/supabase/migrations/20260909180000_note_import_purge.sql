-- IM-05 (#168): an import preview stages the full uploaded content in
-- note_import_jobs / note_import_items before anything is committed, and
-- nothing ever removed it. A person who opened the dialog, saw the preview,
-- and closed the tab left the full staged content of their export in the
-- database permanently. RLS already makes this owner-scoped -- not an
-- exposure -- but it is an unbounded retention problem, and the owner had no
-- way to clear it themselves short of #175's new cancel Operation.
--
-- WS-01 set the precedent for staged content in this product: seven days,
-- stated in the interface. This gives 'preview' jobs (and only 'preview'
-- jobs -- a job mid-commit or already completed is never touched) the same
-- retention window, enforced by a scheduled worker alongside the existing
-- lifecycle jobs rather than a new mechanism.

begin;

-- The purge scans across every workspace for stale preview jobs, so it needs
-- an index that does not depend on workspace_id. A partial index on the
-- status this job actually queries keeps it cheap indefinitely, regardless of
-- how many committed or canceled jobs accumulate.
create index note_import_jobs_stale_preview_idx
on public.note_import_jobs (created_at)
where status = 'preview';

alter table public.lifecycle_job_runs drop constraint if exists lifecycle_job_runs_job_name_check;
alter table public.lifecycle_job_runs add constraint lifecycle_job_runs_job_name_check check (
  job_name in (
    'notification_delivery', 'account_deletion', 'note_attachment_purge', 'note_import_purge'
  )
);

commit;
