begin;

create or replace function public.persist_capture_proposal_analysis_job(
  p_owner_user_id uuid,
  p_capture_id uuid,
  p_job_id uuid,
  p_analysis jsonb,
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
  where job.id = p_job_id and job.source_capture_id = p_capture_id
    and job.operation = 'capture_analysis' and job.status = 'running'
    and workspace.owner_user_id = p_owner_user_id
  for update of job;
  if not found then
    raise exception using errcode = 'P0001', message = 'analysis_job_not_running';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_capture_id::text || ':analysis', 0));
  if exists (
    select 1 from public.ai_jobs newer
    where newer.workspace_id = v_job.workspace_id
      and newer.source_capture_id = p_capture_id
      and newer.operation = 'capture_analysis'
      and (newer.created_at, newer.id) > (v_job.created_at, v_job.id)
  ) then
    raise exception using errcode = 'P0001', message = 'analysis_superseded';
  end if;
  return public.persist_capture_proposal_analysis(
    p_owner_user_id, p_capture_id, p_analysis, p_model_id, p_prompt_version
  );
end;
$$;

revoke all on function public.persist_capture_proposal_analysis_job(
  uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.persist_capture_proposal_analysis_job(
  uuid, uuid, uuid, jsonb, text, text
) to service_role;

commit;
