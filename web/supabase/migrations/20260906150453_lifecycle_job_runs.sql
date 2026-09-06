-- Content-free execution evidence for privileged, scheduled lifecycle work.
create table public.lifecycle_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null check (
    job_name in ('notification_delivery', 'account_deletion', 'note_attachment_purge')
  ),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  processed_count integer not null default 0 check (processed_count >= 0),
  succeeded_count integer not null default 0 check (succeeded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,80}$'),
  check (succeeded_count + failed_count <= processed_count),
  check (
    (status = 'running' and finished_at is null and error_code is null)
    or (status = 'succeeded' and finished_at is not null and error_code is null)
    or (status = 'failed' and finished_at is not null and error_code is not null)
  )
);

create index lifecycle_job_runs_recent_idx
on public.lifecycle_job_runs (job_name, finished_at desc nulls first);

alter table public.lifecycle_job_runs enable row level security;
alter table public.lifecycle_job_runs force row level security;

revoke all on public.lifecycle_job_runs from public, anon, authenticated;
grant select, insert, update on public.lifecycle_job_runs to service_role;

comment on table public.lifecycle_job_runs is
  'Content-free lifecycle worker run evidence. Only isolated service-role jobs may access it.';
