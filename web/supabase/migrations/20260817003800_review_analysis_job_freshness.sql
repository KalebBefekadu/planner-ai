begin;

alter table public.ai_jobs
  drop constraint ai_jobs_operation_check,
  add constraint ai_jobs_operation_check check (
    operation in ('capture_analysis', 'review_analysis')
  ),
  add column source_review_kind text check (
    source_review_kind is null or source_review_kind in ('weekly', 'monthly', 'quarterly')
  ),
  add column source_starts_on date,
  add column source_ends_on date,
  add constraint ai_jobs_source_shape_check check (
    (operation = 'capture_analysis' and source_capture_id is not null
      and source_review_kind is null and source_starts_on is null and source_ends_on is null)
    or (operation = 'review_analysis' and source_capture_id is null
      and source_review_kind is not null and source_starts_on is not null
      and source_ends_on >= source_starts_on)
  );
create index ai_jobs_workspace_review_source_idx
on public.ai_jobs (workspace_id, source_review_kind, source_starts_on, created_at desc)
where operation = 'review_analysis';

create or replace function public.persist_review_ai_proposal_job(
  p_owner_user_id uuid,
  p_job_id uuid,
  p_kind text,
  p_starts_on date,
  p_ends_on date,
  p_payload jsonb,
  p_model_id text,
  p_prompt_version text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.ai_jobs%rowtype;
begin
  select job.* into v_job from public.ai_jobs job
  join public.workspaces workspace on workspace.id = job.workspace_id
  where job.id = p_job_id and job.operation = 'review_analysis'
    and job.status = 'running' and job.source_review_kind = p_kind
    and job.source_starts_on = p_starts_on and job.source_ends_on = p_ends_on
    and workspace.owner_user_id = p_owner_user_id
  for update of job;
  if not found then
    raise exception using errcode = 'P0001', message = 'analysis_job_not_running';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_job.workspace_id::text || ':' || p_kind || ':' || p_starts_on::text || ':review-analysis', 0
  ));
  if exists (
    select 1 from public.ai_jobs newer
    where newer.workspace_id = v_job.workspace_id
      and newer.operation = 'review_analysis'
      and newer.source_review_kind = p_kind and newer.source_starts_on = p_starts_on
      and (newer.created_at, newer.id) > (v_job.created_at, v_job.id)
  ) then
    raise exception using errcode = 'P0001', message = 'analysis_superseded';
  end if;
  return public.persist_review_ai_proposal(
    p_owner_user_id, p_kind, p_starts_on, p_ends_on,
    p_payload, p_model_id, p_prompt_version
  );
end;
$$;

revoke all on function public.persist_review_ai_proposal_job(
  uuid, uuid, text, date, date, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.persist_review_ai_proposal_job(
  uuid, uuid, text, date, date, jsonb, text, text
) to service_role;

commit;
