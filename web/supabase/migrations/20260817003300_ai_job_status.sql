begin;

create table public.ai_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  operation text not null check (operation in ('capture_analysis')),
  source_capture_id uuid,
  request_id uuid not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  attempt_count smallint not null default 1 check (attempt_count between 1 and 10),
  result_target_id uuid,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, workspace_id),
  unique (workspace_id, request_id),
  foreign key (source_capture_id, workspace_id)
    references public.captures(id, workspace_id) on delete set null (source_capture_id),
  check (
    (status = 'running' and completed_at is null and error_code is null)
    or (status = 'succeeded' and completed_at is not null and error_code is null
      and result_target_id is not null)
    or (status = 'failed' and completed_at is not null and error_code is not null)
  )
);
create index ai_jobs_workspace_source_idx
on public.ai_jobs (workspace_id, source_capture_id, created_at desc);
create index ai_jobs_running_idx on public.ai_jobs (created_at)
where status = 'running';

alter table public.ai_jobs enable row level security;
alter table public.ai_jobs force row level security;
create policy ai_jobs_owner_select on public.ai_jobs
for select to authenticated using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = ai_jobs.workspace_id and workspace.owner_user_id = auth.uid()
  )
);
revoke all on public.ai_jobs from public, anon, authenticated;
grant select on public.ai_jobs to authenticated;
grant all on public.ai_jobs to service_role;

commit;
