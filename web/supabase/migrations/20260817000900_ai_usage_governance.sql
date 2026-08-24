begin;

alter table public.workspaces
add column ai_soft_budget_cents integer not null default 500
check (ai_soft_budget_cents between 100 and 2000);

create table public.ai_usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  request_id uuid not null,
  operation text not null check (
    operation in ('smart_goal', 'socratic', 'transcribe', 'assistant')
  ),
  provider_role text not null check (
    provider_role in ('structured_analysis', 'agent', 'transcription', 'internal')
  ),
  provider text not null check (char_length(provider) between 1 and 80),
  model_id text not null check (char_length(model_id) between 1 and 120),
  pricing_version text not null check (char_length(pricing_version) between 1 and 80),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  latency_ms integer not null check (latency_ms between 0 and 300000),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  audio_seconds numeric(10, 3) check (audio_seconds is null or audio_seconds >= 0),
  estimated_cost_micros bigint not null default 0
    check (estimated_cost_micros between 0 and 1000000000),
  error_code text check (
    error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  created_at timestamptz not null default now(),
  unique (workspace_id, request_id)
);
create index ai_usage_events_workspace_created_idx
on public.ai_usage_events (workspace_id, created_at desc);
create index ai_usage_events_retention_idx on public.ai_usage_events (created_at);

alter table public.ai_usage_events enable row level security;
alter table public.ai_usage_events force row level security;
create policy ai_usage_events_select_owner on public.ai_usage_events
for select to authenticated using (
  workspace_id in (select id from public.workspaces where owner_user_id = auth.uid())
);
revoke all on public.ai_usage_events from anon;
revoke insert, update, delete, truncate, references, trigger
on public.ai_usage_events from authenticated;
grant select on public.ai_usage_events to authenticated;

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
  if p_operation not in ('smart_goal', 'socratic', 'transcribe', 'assistant')
    or p_provider_role not in ('structured_analysis', 'agent', 'transcription', 'internal')
    or p_outcome not in ('succeeded', 'failed')
    or char_length(p_provider) not between 1 and 80
    or char_length(p_model_id) not between 1 and 120
    or char_length(p_pricing_version) not between 1 and 80
    or p_latency_ms not between 0 and 300000
    or coalesce(p_input_tokens, 0) < 0
    or coalesce(p_output_tokens, 0) < 0
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
    p_provider, p_model_id, p_pricing_version, p_outcome, p_latency_ms, p_input_tokens, p_output_tokens,
    p_audio_seconds, p_estimated_cost_micros, p_error_code
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
  )
  on conflict (user_id, operation, window_started_at)
  do update set request_count = public.ai_request_windows.request_count + 1,
    updated_at = clock_timestamp()
  where public.ai_request_windows.request_count < v_limit
  returning request_count into v_count;
  return v_count is not null;
end;
$$;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible)
values ('workspace.ai-budget.v1', 'medium', array['ui', 'chat'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_ai_budget_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text,
  p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_budget integer;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'workspace.ai-budget.v1'
    or p_surface not in ('ui', 'chat')
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  v_budget := (p_input ->> 'softBudgetCents')::integer;
  if v_budget not between 100 and 2000 then
    raise exception using errcode = 'P0001', message = 'invalid_ai_budget';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;
  update public.workspaces set ai_soft_budget_cents = v_budget where id = v_workspace_id;
  v_result := jsonb_build_object(
    'workspaceId', v_workspace_id,
    'softBudgetCents', v_budget
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'medium', 'workspace', v_workspace_id,
    'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'workspace', v_workspace_id, 'medium',
    case when p_surface = 'chat' then 'approved' else 'explicit_ui_commit' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

create or replace function public.dispatch_trusted_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text,
  p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
    raise exception using errcode = 'P0001', message = 'invalid_operation_surface';
  end if;
  perform 1 from public.operation_contracts
  where operation_id = p_operation_id and p_surface = any(exposures);
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;
  if p_operation_id in ('goal.update.v1', 'action.move.v1') then
    v_result := public.execute_plan_edit_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'account.%' then
    v_result := public.execute_account_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('action.update.v1', 'daily-focus.set.v1') then
    v_result := public.execute_daily_execution_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'workspace.ai-budget.v1' then
    v_result := public.execute_ai_budget_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'workspace.%' then
    v_result := public.execute_workspace_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.goal-link.v1', 'note.goal-unlink.v1',
    'note.action-link.v1', 'note.action-unlink.v1'
  ) then
    v_result := public.execute_note_relation_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'review.complete-period.v1' then
    v_result := public.execute_period_review_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'review.%' then
    v_result := public.execute_review_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ) then
    v_result := public.execute_knowledge_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'note.%' then
    v_result := public.execute_note_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'memory.%' then
    v_result := public.execute_memory_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'trash.%' then
    v_result := public.execute_trash_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  else
    v_result := public.execute_planner_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;
  return v_result;
end;
$$;

revoke all on function public.record_ai_usage(
  uuid, text, text, text, text, text, text, integer, integer, integer, numeric, bigint, text
) from public, anon;
grant execute on function public.record_ai_usage(
  uuid, text, text, text, text, text, text, integer, integer, integer, numeric, bigint, text
) to authenticated;
revoke all on function public.execute_ai_budget_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;

commit;
