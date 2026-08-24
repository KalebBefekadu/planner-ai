begin;

alter table public.ai_usage_events
  drop constraint ai_usage_events_operation_check,
  add constraint ai_usage_events_operation_check check (
    operation in ('smart_goal', 'socratic', 'transcribe', 'assistant', 'capture_analysis')
  );

create or replace function public.record_ai_usage(
  p_request_id uuid,
  p_operation text,
  p_provider_role text,
  p_provider text,
  p_model_id text,
  p_pricing_version text,
  p_outcome text,
  p_latency_ms integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_audio_seconds numeric,
  p_estimated_cost_micros bigint,
  p_error_code text
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
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation not in (
      'smart_goal', 'socratic', 'transcribe', 'assistant', 'capture_analysis'
    ) or p_provider_role not in ('structured_analysis', 'agent', 'transcription', 'internal')
    or p_outcome not in ('succeeded', 'failed')
    or char_length(p_provider) not between 1 and 80
    or char_length(p_model_id) not between 1 and 120
    or char_length(p_pricing_version) not between 1 and 80
    or p_latency_ms not between 0 and 300000
    or coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0
    or coalesce(p_audio_seconds, 0) < 0
    or p_estimated_cost_micros not between 0 and 1000000000
    or (p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,79}$') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_usage_event';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  insert into public.ai_usage_events (
    workspace_id, actor_user_id, request_id, operation, provider_role,
    provider, model_id, pricing_version, outcome, latency_ms, input_tokens, output_tokens,
    audio_seconds, estimated_cost_micros, error_code
  ) values (
    v_workspace_id, v_user_id, p_request_id, p_operation, p_provider_role,
    p_provider, p_model_id, p_pricing_version, p_outcome, p_latency_ms,
    p_input_tokens, p_output_tokens, p_audio_seconds, p_estimated_cost_micros, p_error_code
  ) on conflict (workspace_id, request_id) do nothing;
  delete from public.ai_usage_events
  where created_at < clock_timestamp() - interval '90 days';
end;
$$;

create or replace function public.consume_ai_quota(p_operation text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_limit integer;
  v_window_start timestamptz;
  v_count integer;
  v_monthly_cost bigint;
begin
  if v_user_id is null then return false; end if;
  v_limit := case p_operation
    when 'smart_goal' then 20
    when 'socratic' then 10
    when 'transcribe' then 8
    when 'assistant' then 30
    when 'capture_analysis' then 10
    else 0
  end;
  if v_limit = 0 then return false; end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then return false; end if;
  select coalesce(sum(estimated_cost_micros), 0) into v_monthly_cost
  from public.ai_usage_events
  where workspace_id = v_workspace_id
    and created_at >= date_trunc('month', clock_timestamp());
  if v_monthly_cost >= 20000000 then return false; end if;
  v_window_start := date_trunc('minute', clock_timestamp());
  insert into public.ai_request_windows (
    user_id, operation, window_started_at, request_count, updated_at
  ) values (
    v_user_id, p_operation, v_window_start, 1, clock_timestamp()
  ) on conflict (user_id, operation, window_started_at)
  do update set request_count = public.ai_request_windows.request_count + 1,
    updated_at = clock_timestamp()
  where public.ai_request_windows.request_count < v_limit
  returning request_count into v_count;
  return v_count is not null;
end;
$$;

revoke all on function public.record_ai_usage(
  uuid, text, text, text, text, text, text, integer, integer, integer, numeric, bigint, text
) from public, anon;
grant execute on function public.record_ai_usage(
  uuid, text, text, text, text, text, text, integer, integer, integer, numeric, bigint, text
) to authenticated;
revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;

commit;
