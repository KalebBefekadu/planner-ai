-- A restricted proposal-worker capability.
--
-- The three AI proposal routes read their evidence through the person's own
-- JWT already. Service-role access remained for two reasons only: `ai_jobs`
-- grants `authenticated` nothing but `select`, and the two job-bound
-- persistence functions accept the owner as a trusted parameter, so execute
-- had to stay with `service_role`.
--
-- This replaces both reasons with one capability. Four `security definer`
-- functions derive the actor from `auth.uid()` and the Workspace from
-- ownership, never from an argument, so the caller can no longer assert an
-- identity. Table grants do not change: `authenticated` still cannot write
-- `ai_jobs` directly, and these functions are the only write path.
--
-- Two defects in the breakdown path are fixed here because a route that cannot
-- start a job cannot be migrated to the capability that starts one.

begin;

-- Defect 1. `20260915140000_suggest_a_breakdown.sql` added
-- `initiative_breakdown` to the operation check but left the source shape check
-- naming two operations, so a breakdown row satisfied neither branch and every
-- insert was rejected. The new constraint is strictly wider than the old one,
-- so existing rows keep passing.
alter table public.ai_jobs
  drop constraint ai_jobs_source_shape_check;
alter table public.ai_jobs
  add constraint ai_jobs_source_shape_check check (
    (operation in ('capture_analysis', 'initiative_breakdown')
      and source_capture_id is not null and source_review_kind is null
      and source_starts_on is null and source_ends_on is null)
    or (operation = 'review_analysis' and source_capture_id is null
      and source_review_kind is not null and source_starts_on is not null
      and source_ends_on >= source_starts_on)
  );

-- Start a job for the caller's own Workspace.
--
-- The Workspace comes from ownership and the actor from the verified JWT. A
-- named Capture must already belong to that Workspace, so a job cannot be
-- attached to someone else's source. One request id maps to one job: a repeat
-- returns the job that request already started rather than opening a second
-- attempt.
create or replace function public.start_ai_job(
  p_operation text,
  p_request_id uuid,
  p_source_capture_id uuid default null,
  p_source_review_kind text default null,
  p_source_starts_on date default null,
  p_source_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_job_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'request_id_required';
  end if;
  if p_operation is null or p_operation not in
    ('capture_analysis', 'review_analysis', 'initiative_breakdown')
  then
    raise exception using errcode = '22023', message = 'unsupported_job_operation';
  end if;

  select workspace.id into v_workspace_id from public.workspaces workspace
  where workspace.owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  if p_source_capture_id is not null and not exists (
    select 1 from public.captures capture
    where capture.id = p_source_capture_id and capture.workspace_id = v_workspace_id
  ) then
    raise exception using errcode = 'P0002', message = 'source_capture_not_found';
  end if;

  insert into public.ai_jobs (
    workspace_id, actor_user_id, operation, source_capture_id,
    source_review_kind, source_starts_on, source_ends_on, request_id, status
  ) values (
    v_workspace_id, v_user_id, p_operation, p_source_capture_id,
    p_source_review_kind, p_source_starts_on, p_source_ends_on, p_request_id, 'running'
  )
  on conflict (workspace_id, request_id) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select job.id into v_job_id from public.ai_jobs job
    where job.workspace_id = v_workspace_id and job.request_id = p_request_id
      and job.operation = p_operation;
    if v_job_id is null then
      raise exception using errcode = 'P0001', message = 'job_request_conflict';
    end if;
  end if;
  return v_job_id;
end;
$$;

-- Record a successful result against a running job the caller owns.
create or replace function public.complete_ai_job(
  p_job_id uuid,
  p_result_target_id uuid
)
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
  if p_result_target_id is null then
    raise exception using errcode = '22023', message = 'result_target_required';
  end if;
  update public.ai_jobs job
  set status = 'succeeded', result_target_id = p_result_target_id,
    completed_at = now(), updated_at = now()
  where job.id = p_job_id and job.status = 'running' and exists (
    select 1 from public.workspaces workspace
    where workspace.id = job.workspace_id and workspace.owner_user_id = v_user_id
  );
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception using errcode = 'P0001', message = 'analysis_job_not_running';
  end if;
end;
$$;

-- Record a stable failure code against a running job the caller owns. The
-- table's own check keeps the code content-free; no provider text reaches it.
create or replace function public.fail_ai_job(
  p_job_id uuid,
  p_error_code text
)
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
  if p_error_code is null then
    raise exception using errcode = '22023', message = 'error_code_required';
  end if;
  update public.ai_jobs job
  set status = 'failed', error_code = p_error_code,
    completed_at = now(), updated_at = now()
  where job.id = p_job_id and job.status = 'running' and exists (
    select 1 from public.workspaces workspace
    where workspace.id = job.workspace_id and workspace.owner_user_id = v_user_id
  );
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception using errcode = 'P0001', message = 'analysis_job_not_running';
  end if;
end;
$$;

-- The two persistence functions lose `p_owner_user_id`. Everything else about
-- them is unchanged: the same job claim under `for update`, the same advisory
-- lock, the same superseded check, and the same underlying writer.
--
-- Defect 2. Job claiming named `capture_analysis` alone, so a breakdown job
-- could not be claimed by the function the breakdown route calls.
drop function if exists public.persist_capture_proposal_analysis_job(
  uuid, uuid, uuid, jsonb, text, text
);
create function public.persist_capture_proposal_analysis_job(
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
  v_user_id uuid := auth.uid();
  v_job public.ai_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select job.* into v_job from public.ai_jobs job
  join public.workspaces workspace on workspace.id = job.workspace_id
  where job.id = p_job_id and job.source_capture_id = p_capture_id
    and job.operation in ('capture_analysis', 'initiative_breakdown')
    and job.status = 'running' and workspace.owner_user_id = v_user_id
  for update of job;
  if not found then
    raise exception using errcode = 'P0001', message = 'analysis_job_not_running';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_capture_id::text || ':analysis', 0));
  if exists (
    select 1 from public.ai_jobs newer
    where newer.workspace_id = v_job.workspace_id
      and newer.source_capture_id = p_capture_id
      and newer.operation in ('capture_analysis', 'initiative_breakdown')
      and (newer.created_at, newer.id) > (v_job.created_at, v_job.id)
  ) then
    raise exception using errcode = 'P0001', message = 'analysis_superseded';
  end if;
  return public.persist_capture_proposal_analysis(
    v_user_id, p_capture_id, p_analysis, p_model_id, p_prompt_version
  );
end;
$$;

-- The Review writer carried one extra guard that no other writer in the schema
-- has: it rejected any call whose request claimed a role other than
-- `service_role`, and reported that authorization failure as
-- `invalid_review_proposal`. Its Capture-side twin,
-- `persist_capture_proposal_analysis`, relies on its EXECUTE grant alone.
--
-- The grant is the control. This function stays revoked from `public`, `anon`
-- and `authenticated`, so the only ways in are `service_role` and the job
-- function above, which derives the owner from `auth.uid()` and refuses any job
-- the caller does not own. Every payload validation below is unchanged; only
-- the request-claim term is gone.
create or replace function public.persist_review_ai_proposal(
  p_owner_user_id uuid, p_kind text, p_starts_on date, p_ends_on date,
  p_payload jsonb, p_model_id text, p_prompt_version text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid; v_id uuid; v_action_id text;
  v_recommendation jsonb; v_reference jsonb; v_reference_type text; v_reference_id uuid;
begin
  if p_kind not in ('weekly', 'monthly', 'quarterly')
    or p_ends_on < p_starts_on or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload -> 'priorityActionIds') <> 'array'
    or jsonb_array_length(p_payload -> 'priorityActionIds') > 5
    or jsonb_typeof(p_payload -> 'recommendations') <> 'array'
    or jsonb_array_length(p_payload -> 'recommendations') > 8
    or jsonb_typeof(p_payload -> 'reflectionPrompts') <> 'array'
    or jsonb_array_length(p_payload -> 'reflectionPrompts') not between 1 and 4
    or (p_kind <> 'weekly' and jsonb_array_length(p_payload -> 'priorityActionIds') <> 0)
    or char_length(trim(coalesce(p_payload ->> 'summary', ''))) not between 1 and 1000
    or (select count(*) from jsonb_array_elements_text(p_payload -> 'priorityActionIds'))
      <> (select count(distinct value) from jsonb_array_elements_text(p_payload -> 'priorityActionIds')) then
    raise exception using errcode = 'P0001', message = 'invalid_review_proposal';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = p_owner_user_id;
  if v_workspace_id is null then raise exception using errcode = 'P0001', message = 'workspace_not_found'; end if;
  for v_action_id in select jsonb_array_elements_text(p_payload -> 'priorityActionIds') loop
    perform 1 from public.actions where id = v_action_id::uuid and workspace_id = v_workspace_id
      and archived_at is null and trashed_at is null;
    if not found then raise exception using errcode = '42501', message = 'invalid_review_priority'; end if;
  end loop;
  for v_recommendation in select value from jsonb_array_elements(p_payload -> 'recommendations') loop
    if jsonb_typeof(v_recommendation) <> 'object'
      or char_length(trim(coalesce(v_recommendation ->> 'text', ''))) not between 1 and 500
      or coalesce(v_recommendation ->> 'status', '') not in ('supported', 'inferred', 'needs_input')
      or jsonb_typeof(v_recommendation -> 'evidence') <> 'array'
      or jsonb_array_length(v_recommendation -> 'evidence') > 4
      or (v_recommendation ->> 'status' = 'supported' and jsonb_array_length(v_recommendation -> 'evidence') = 0)
      or (v_recommendation ->> 'status' = 'needs_input' and jsonb_array_length(v_recommendation -> 'evidence') <> 0) then
      raise exception using errcode = 'P0001', message = 'invalid_review_proposal';
    end if;
    for v_reference in select value from jsonb_array_elements(v_recommendation -> 'evidence') loop
      v_reference_type := v_reference ->> 'type';
      v_reference_id := (v_reference ->> 'id')::uuid;
      if v_reference_type = 'action' then
        perform 1 from public.actions where id = v_reference_id and workspace_id = v_workspace_id
          and archived_at is null and trashed_at is null;
      elsif v_reference_type = 'goal' then
        perform 1 from public.goals where id = v_reference_id and workspace_id = v_workspace_id
          and archived_at is null and trashed_at is null;
      elsif v_reference_type = 'review' then
        perform 1 from public.reviews where id = v_reference_id and workspace_id = v_workspace_id;
      else
        raise exception using errcode = 'P0001', message = 'invalid_review_proposal';
      end if;
      if not found then raise exception using errcode = '42501', message = 'invalid_review_evidence'; end if;
    end loop;
  end loop;
  update public.review_ai_proposals set status = 'superseded'
  where workspace_id = v_workspace_id and kind = p_kind and starts_on = p_starts_on and status = 'active';
  insert into public.review_ai_proposals (
    workspace_id, kind, starts_on, ends_on, payload, model_id, prompt_version
  ) values (v_workspace_id, p_kind, p_starts_on, p_ends_on, p_payload, p_model_id, p_prompt_version)
  returning id into v_id;
  return v_id;
exception when data_exception then
  raise exception using errcode = 'P0001', message = 'invalid_review_proposal';
end;
$$;

drop function if exists public.persist_review_ai_proposal_job(
  uuid, uuid, text, date, date, jsonb, text, text
);
create function public.persist_review_ai_proposal_job(
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
  v_user_id uuid := auth.uid();
  v_job public.ai_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select job.* into v_job from public.ai_jobs job
  join public.workspaces workspace on workspace.id = job.workspace_id
  where job.id = p_job_id and job.operation = 'review_analysis'
    and job.status = 'running' and job.source_review_kind = p_kind
    and job.source_starts_on = p_starts_on and job.source_ends_on = p_ends_on
    and workspace.owner_user_id = v_user_id
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
    v_user_id, p_kind, p_starts_on, p_ends_on, p_payload, p_model_id, p_prompt_version
  );
end;
$$;

-- Creation grants execute to PUBLIC, so every capability revokes first. Only
-- signed-in people hold the capability; `service_role` is deliberately not a
-- consumer of it.
revoke all on function public.start_ai_job(text, uuid, uuid, text, date, date)
from public, anon, authenticated;
grant execute on function public.start_ai_job(text, uuid, uuid, text, date, date)
to authenticated;

revoke all on function public.complete_ai_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_ai_job(uuid, uuid) to authenticated;

revoke all on function public.fail_ai_job(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_ai_job(uuid, text) to authenticated;

revoke all on function public.persist_capture_proposal_analysis_job(
  uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.persist_capture_proposal_analysis_job(
  uuid, uuid, jsonb, text, text
) to authenticated;

-- CREATE OR REPLACE keeps an existing ACL, but the underlying writers stay
-- closed to ordinary callers by intent, not by accident. Say so.
revoke all on function public.persist_review_ai_proposal(
  uuid, text, date, date, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.persist_review_ai_proposal(
  uuid, text, date, date, jsonb, text, text
) to service_role;

revoke all on function public.persist_review_ai_proposal_job(
  uuid, text, date, date, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.persist_review_ai_proposal_job(
  uuid, text, date, date, jsonb, text, text
) to authenticated;

commit;
