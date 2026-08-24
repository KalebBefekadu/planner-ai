begin;

alter table public.ai_request_windows
  drop constraint ai_request_windows_operation_check,
  add constraint ai_request_windows_operation_check check (
    operation in (
      'smart_goal', 'socratic', 'transcribe', 'assistant', 'capture_analysis', 'review_analysis'
    )
  );
alter table public.ai_quota_reservations
  drop constraint ai_quota_reservations_operation_check,
  add constraint ai_quota_reservations_operation_check check (
    operation in (
      'smart_goal', 'socratic', 'transcribe', 'assistant', 'capture_analysis', 'review_analysis'
    )
  );

alter table public.ai_usage_events
  drop constraint ai_usage_events_operation_check,
  add constraint ai_usage_events_operation_check check (
    operation in (
      'smart_goal', 'socratic', 'transcribe', 'assistant', 'capture_analysis', 'review_analysis'
    )
  );

create table public.review_ai_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('weekly', 'monthly', 'quarterly')),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'active' check (status in ('active', 'superseded')),
  model_id text not null check (char_length(model_id) between 1 and 120),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  created_at timestamptz not null default now()
);
create index review_ai_proposals_workspace_period_idx
on public.review_ai_proposals (workspace_id, kind, starts_on, created_at desc);
alter table public.review_ai_proposals enable row level security;
alter table public.review_ai_proposals force row level security;
create policy review_ai_proposals_select_owner on public.review_ai_proposals
for select to authenticated using (
  workspace_id in (select id from public.workspaces where owner_user_id = auth.uid())
);
revoke all on public.review_ai_proposals from anon;
revoke insert, update, delete, truncate, references, trigger
on public.review_ai_proposals from authenticated;
grant select on public.review_ai_proposals to authenticated;

alter function public.record_ai_usage(
  uuid, text, text, text, text, text, text, integer, integer, integer, numeric, bigint, text
) rename to record_ai_usage_review_base;

create or replace function public.record_ai_usage(
  p_request_id uuid, p_operation text, p_provider_role text, p_provider text,
  p_model_id text, p_pricing_version text, p_outcome text, p_latency_ms integer,
  p_input_tokens integer, p_output_tokens integer, p_audio_seconds numeric,
  p_estimated_cost_micros bigint, p_error_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
begin
  if p_operation <> 'review_analysis' then
    perform public.record_ai_usage_review_base(
      p_request_id, p_operation, p_provider_role, p_provider, p_model_id,
      p_pricing_version, p_outcome, p_latency_ms, p_input_tokens, p_output_tokens,
      p_audio_seconds, p_estimated_cost_micros, p_error_code
    );
    return;
  end if;
  if v_user_id is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  if p_provider_role <> 'structured_analysis' or p_outcome not in ('succeeded', 'failed')
    or char_length(p_provider) not between 1 and 80
    or char_length(p_model_id) not between 1 and 120
    or char_length(p_pricing_version) not between 1 and 80
    or p_latency_ms not between 0 and 300000
    or coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0
    or p_estimated_cost_micros not between 0 and 1000000000
    or (p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,79}$') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_usage_event';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then raise exception using errcode = 'P0001', message = 'workspace_required'; end if;
  insert into public.ai_usage_events (
    workspace_id, actor_user_id, request_id, operation, provider_role, provider,
    model_id, pricing_version, outcome, latency_ms, input_tokens, output_tokens,
    audio_seconds, estimated_cost_micros, error_code
  ) values (
    v_workspace_id, v_user_id, p_request_id, p_operation, p_provider_role, p_provider,
    p_model_id, p_pricing_version, p_outcome, p_latency_ms, p_input_tokens, p_output_tokens,
    p_audio_seconds, p_estimated_cost_micros, p_error_code
  ) on conflict (workspace_id, request_id) do nothing;
  delete from public.ai_quota_reservations
  where request_id = p_request_id and workspace_id = v_workspace_id;
end;
$$;

create or replace function public.consume_review_analysis_quota(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid(); v_workspace_id uuid; v_count integer;
  v_committed bigint; v_reserved bigint; v_window timestamptz;
begin
  if v_user_id is null or p_request_id is null then return 'invalid'; end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':ai-quota', 0));
  delete from public.ai_quota_reservations where expires_at <= clock_timestamp();
  if exists (select 1 from public.ai_quota_reservations where request_id = p_request_id and workspace_id = v_workspace_id) then return 'allowed'; end if;
  select coalesce(sum(estimated_cost_micros), 0) into v_committed from public.ai_usage_events
  where workspace_id = v_workspace_id and created_at >= date_trunc('month', clock_timestamp());
  select coalesce(sum(reserved_cost_micros), 0) into v_reserved from public.ai_quota_reservations where workspace_id = v_workspace_id;
  if v_committed + v_reserved + 250000 > 20000000 then return 'monthly_cap'; end if;
  v_window := date_trunc('minute', clock_timestamp());
  insert into public.ai_request_windows (user_id, operation, window_started_at, request_count, updated_at)
  values (v_user_id, 'review_analysis', v_window, 1, clock_timestamp())
  on conflict (user_id, operation, window_started_at) do update
  set request_count = public.ai_request_windows.request_count + 1, updated_at = clock_timestamp()
  where public.ai_request_windows.request_count < 6 returning request_count into v_count;
  if v_count is null then return 'rate_limited'; end if;
  insert into public.ai_quota_reservations (request_id, workspace_id, operation, reserved_cost_micros)
  values (p_request_id, v_workspace_id, 'review_analysis', 250000);
  return 'allowed';
end;
$$;

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
  if auth.role() <> 'service_role' or p_kind not in ('weekly', 'monthly', 'quarterly')
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

revoke all on function public.record_ai_usage_review_base(
  uuid, text, text, text, text, text, text, integer, integer, integer, numeric, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_ai_usage(
  uuid, text, text, text, text, text, text, integer, integer, integer, numeric, bigint, text
) from public, anon;
grant execute on function public.record_ai_usage(
  uuid, text, text, text, text, text, text, integer, integer, integer, numeric, bigint, text
) to authenticated;
revoke all on function public.consume_review_analysis_quota(uuid) from public, anon;
grant execute on function public.consume_review_analysis_quota(uuid) to authenticated;
revoke all on function public.persist_review_ai_proposal(uuid, text, date, date, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.persist_review_ai_proposal(uuid, text, date, date, jsonb, text, text)
to service_role;

commit;
