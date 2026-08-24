begin;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible)
values ('workspace.onboarding-complete.v1', 'medium', array['ui'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_guided_onboarding_operation(
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
  v_timezone text;
  v_week_starts_on smallint;
  v_coaching_intensity text;
  v_ai_enabled boolean;
  v_weekly_review_day smallint;
  v_today date;
  v_vision_text text;
  v_goal_title text;
  v_action_title text;
  v_capture_text text;
  v_year_start date;
  v_year_end date;
  v_month_start date;
  v_month_end date;
  v_horizon_id uuid;
  v_vision_id uuid;
  v_goal_id uuid;
  v_action_id uuid;
  v_capture_id uuid;
  v_completed_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'workspace.onboarding-complete.v1'
    or p_surface <> 'ui'
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;

  v_timezone := p_input ->> 'timezone';
  v_week_starts_on := (p_input ->> 'weekStartsOn')::smallint;
  v_coaching_intensity := p_input ->> 'coachingIntensity';
  v_ai_enabled := (p_input ->> 'aiEnabled')::boolean;
  v_weekly_review_day := (p_input ->> 'weeklyReviewDay')::smallint;
  v_today := (p_input ->> 'today')::date;
  v_vision_text := p_input ->> 'visionText';
  v_goal_title := p_input ->> 'goalTitle';
  v_action_title := p_input ->> 'actionTitle';
  v_capture_text := p_input ->> 'captureText';
  if not exists (select 1 from pg_timezone_names where name = v_timezone)
    or v_week_starts_on not between 0 and 6
    or v_coaching_intensity not in ('calm', 'direct', 'strict')
    or jsonb_typeof(p_input -> 'aiEnabled') <> 'boolean'
    or v_weekly_review_day not between 0 and 6
    or v_today not between date '2020-01-01' and date '2100-12-31'
    or (v_vision_text is not null and char_length(trim(v_vision_text)) not between 3 and 50000)
    or (v_goal_title is not null and char_length(trim(v_goal_title)) not between 3 and 1000)
    or (v_action_title is not null and char_length(trim(v_action_title)) not between 3 and 1000)
    or (v_capture_text is not null and char_length(trim(v_capture_text)) not between 3 and 60000) then
    raise exception using errcode = 'P0001', message = 'invalid_guided_onboarding';
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

  if v_vision_text is not null then
    insert into public.visions (workspace_id, body_markdown)
    values (v_workspace_id, trim(v_vision_text))
    on conflict (workspace_id) where archived_at is null and trashed_at is null
    do update set body_markdown = excluded.body_markdown, version = public.visions.version + 1
    returning id into v_vision_id;
  else
    select id into v_vision_id from public.visions
    where workspace_id = v_workspace_id and archived_at is null and trashed_at is null;
  end if;

  if v_goal_title is not null then
    if v_vision_id is null then
      raise exception using errcode = 'P0001', message = 'vision_required';
    end if;
    v_year_start := date_trunc('year', v_today)::date;
    v_year_end := (v_year_start + interval '1 year - 1 day')::date;
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    ) values (
      v_workspace_id, 'year', v_year_start, v_year_end, v_timezone
    ) on conflict (workspace_id, kind, starts_on)
      do update set ends_on = excluded.ends_on, timezone_snapshot = excluded.timezone_snapshot
    returning id into v_horizon_id;
    insert into public.goals (
      workspace_id, vision_id, horizon_id, title, status, due_on
    ) values (
      v_workspace_id, v_vision_id, v_horizon_id, trim(v_goal_title), 'active', v_year_end
    ) returning id into v_goal_id;
  end if;

  if v_action_title is not null then
    v_month_start := date_trunc('month', v_today)::date;
    v_month_end := (v_month_start + interval '1 month - 1 day')::date;
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    ) values (
      v_workspace_id, 'month', v_month_start, v_month_end, v_timezone
    ) on conflict (workspace_id, kind, starts_on)
      do update set ends_on = excluded.ends_on, timezone_snapshot = excluded.timezone_snapshot
    returning id into v_horizon_id;
    insert into public.actions (
      workspace_id, goal_id, horizon_id, title, status, scheduled_on
    ) values (
      v_workspace_id, v_goal_id, v_horizon_id, trim(v_action_title), 'open', v_today
    ) returning id into v_action_id;
  end if;

  if v_capture_text is not null then
    insert into public.captures (workspace_id, raw_text, source)
    values (v_workspace_id, v_capture_text, 'typed')
    returning id into v_capture_id;
  end if;

  update public.workspaces set
    timezone = v_timezone,
    week_starts_on = v_week_starts_on,
    coaching_intensity = v_coaching_intensity,
    ai_enabled = v_ai_enabled,
    weekly_review_day = v_weekly_review_day,
    onboarding_completed_at = coalesce(onboarding_completed_at, clock_timestamp())
  where id = v_workspace_id
  returning onboarding_completed_at into v_completed_at;

  v_result := jsonb_build_object(
    'workspaceId', v_workspace_id,
    'onboardingCompletedAt', v_completed_at,
    'visionId', v_vision_id,
    'goalId', v_goal_id,
    'actionId', v_action_id,
    'captureId', v_capture_id
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id, 'user', p_surface,
    p_idempotency_key, 'medium', 'workspace', v_workspace_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', p_surface, p_operation_id,
    'workspace', v_workspace_id, 'medium', 'explicit_ui_commit', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or check_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'invalid_guided_onboarding';
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
  if not found then raise exception using errcode = '42501', message = 'operation_surface_not_allowed'; end if;
  if p_operation_id in ('goal.update.v1', 'action.move.v1') then
    v_result := public.execute_plan_edit_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'account.%' then
    v_result := public.execute_account_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('action.update.v1', 'daily-focus.set.v1') then
    v_result := public.execute_daily_execution_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'workspace.onboarding-complete.v1' then
    v_result := public.execute_guided_onboarding_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'workspace.ai-budget.v1' then
    v_result := public.execute_ai_budget_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'workspace.%' then
    v_result := public.execute_workspace_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('note.import-preview.v1', 'note.import-commit.v1') then
    v_result := public.execute_note_import_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.goal-link.v1', 'note.goal-unlink.v1', 'note.action-link.v1', 'note.action-unlink.v1'
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

revoke all on function public.execute_guided_onboarding_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
