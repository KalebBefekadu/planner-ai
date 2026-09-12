-- Weekly Review was blind to work planned at a longer horizon and scheduled
-- into the week under review. An Action planned monthly and committed to a
-- day this week never appeared in the review, so a person could leave it
-- undone, be told "Nothing unresolved", and close the week while that Action
-- rolled forward with no decision recorded against it.
--
-- The eligibility rule lived in the Operation rather than the page, and it
-- was enforced from both directions, so this could not be fixed by widening
-- the query alone. See https://github.com/KalebBefekadu/planner-ai/issues/155.

begin;

-- The eligibility rule is named once and used from three places: the check
-- that nothing eligible was omitted, the check that nothing ineligible was
-- decided, and the loop that applies the decisions. A set this exact cannot
-- afford three copies of its own definition.
--
-- A function rather than a temporary table: two reviews can be completed
-- inside one transaction, and `on commit drop` does not drop between
-- statements, so the second call would fail on a table that already exists.
create or replace function public.review_week_eligible_actions(
  p_workspace_id uuid,
  p_starts_on date,
  p_ends_on date
) returns table (action_id uuid, horizon_kind text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select action.id, horizon.kind
  from public.actions action
  join public.planning_horizons horizon
    on horizon.id = action.horizon_id and horizon.workspace_id = action.workspace_id
  where action.workspace_id = p_workspace_id
    and action.status not in ('done', 'dropped')
    and action.archived_at is null
    and action.trashed_at is null
    and (
      -- Weekly work carried into or planned for the week under review.
      (horizon.kind = 'week' and horizon.starts_on <= p_ends_on)
      -- Longer-horizon work a person committed to a day inside it.
      or (horizon.kind <> 'week' and action.scheduled_on between p_starts_on and p_ends_on)
    );
$$;

create or replace function public.execute_review_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text,
  p_surface text default 'ui'
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
  v_starts_on date;
  v_ends_on date;
  v_horizon_id uuid;
  v_next_horizon_id uuid;
  v_review_id uuid;
  v_resolved_count integer;
  v_priority_count integer;
  v_result jsonb;
  v_decision record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'review.complete-weekly.v1' then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'automation', 'system')
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200
    or jsonb_typeof(p_input -> 'decisions') <> 'array'
    or jsonb_array_length(p_input -> 'decisions') > 100
    or char_length(coalesce(p_input ->> 'reflectionMarkdown', '')) > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  v_starts_on := (p_input ->> 'startsOn')::date;
  v_ends_on := (p_input ->> 'endsOn')::date;
  if v_ends_on <> v_starts_on + 6 then
    raise exception using errcode = 'P0001', message = 'invalid_review_range';
  end if;

  select id, timezone into v_workspace_id, v_timezone
  from public.workspaces where owner_user_id = v_user_id;
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

  if exists (
    select 1
    from jsonb_to_recordset(p_input -> 'decisions') as decision(
      "actionId" text, "expectedVersion" bigint, resolution text, reason text, priority boolean
    )
    where decision."actionId" is null
      or decision."expectedVersion" is null or decision."expectedVersion" < 1
      or decision.resolution not in ('done', 'next_week', 'blocked', 'dropped', 'left_overdue')
      or char_length(coalesce(decision.reason, '')) > 500
      or (decision.resolution in ('blocked', 'dropped') and char_length(trim(coalesce(decision.reason, ''))) < 1)
      or (coalesce(decision.priority, false) and decision.resolution in ('done', 'dropped'))
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_review_decision';
  end if;
  select count(*) filter (where coalesce(priority, false))
  into v_priority_count
  from jsonb_to_recordset(p_input -> 'decisions') as decision(priority boolean);
  if v_priority_count > 5 then
    raise exception using errcode = 'P0001', message = 'too_many_weekly_priorities';
  end if;
  if (
    select count(distinct "actionId")
    from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" text)
  ) <> jsonb_array_length(p_input -> 'decisions') then
    raise exception using errcode = 'P0001', message = 'duplicate_review_action';
  end if;

  -- What the week is allowed to ask about. Week-horizon work carried into or
  -- planned for these seven days, and work planned at a longer horizon that
  -- was scheduled into them. The second half is why this changed: an Action
  -- planned monthly and committed to a day this week is unfinished work of
  -- this week, and leaving it out let a week close reporting nothing
  -- unresolved while that Action rolled forward untouched.
  --
  -- Both directions use the same definition so the decision set stays exact:
  -- nothing eligible may be omitted, and nothing ineligible may be decided.
  if exists (
    select 1 from public.review_week_eligible_actions(v_workspace_id, v_starts_on, v_ends_on) eligible
    where not exists (
      select 1
      from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" uuid)
      where decision."actionId" = eligible.action_id
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" uuid)
    where not exists (
      select 1
      from public.review_week_eligible_actions(v_workspace_id, v_starts_on, v_ends_on) eligible
      where eligible.action_id = decision."actionId"
    )
  ) then
    raise exception using errcode = '40001', message = 'review_action_set_changed';
  end if;

  insert into public.planning_horizons (
    workspace_id, kind, starts_on, ends_on, timezone_snapshot
  ) values (
    v_workspace_id, 'week', v_starts_on, v_ends_on, v_timezone
  )
  on conflict (workspace_id, kind, starts_on)
  do update set timezone_snapshot = excluded.timezone_snapshot
  returning id into v_horizon_id;
  -- Only week-horizon work moves into next week's horizon, so the horizon is
  -- created only when something will actually live in it.
  if exists (
    select 1
    from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" uuid, resolution text)
    join public.review_week_eligible_actions(v_workspace_id, v_starts_on, v_ends_on) eligible
      on eligible.action_id = decision."actionId"
    where decision.resolution = 'next_week' and eligible.horizon_kind = 'week'
  ) then
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    ) values (
      v_workspace_id, 'week', v_starts_on + 7, v_ends_on + 7, v_timezone
    )
    on conflict (workspace_id, kind, starts_on)
    do update set timezone_snapshot = excluded.timezone_snapshot
    returning id into v_next_horizon_id;
  end if;

  insert into public.reviews (
    workspace_id, horizon_id, kind, status, reflection_markdown, completed_at
  ) values (
    v_workspace_id, v_horizon_id, 'weekly', 'completed',
    coalesce(p_input ->> 'reflectionMarkdown', ''), clock_timestamp()
  ) returning id into v_review_id;

  for v_decision in
    select action.*, eligible.horizon_kind, decision."expectedVersion" as expected_version,
      decision.resolution, decision.reason, coalesce(decision.priority, false) as priority
    from jsonb_to_recordset(p_input -> 'decisions') as decision(
      "actionId" uuid, "expectedVersion" bigint, resolution text, reason text, priority boolean
    )
    join public.actions action
      on action.id = decision."actionId" and action.workspace_id = v_workspace_id
    join public.review_week_eligible_actions(v_workspace_id, v_starts_on, v_ends_on) eligible
      on eligible.action_id = action.id
    order by action.id
    for update of action
  loop
    if v_decision.version <> v_decision.expected_version then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    insert into public.review_action_items (
      workspace_id, review_id, action_id, action_title_snapshot, action_status_snapshot,
      action_version_snapshot, resolution, reason, priority
    ) values (
      v_workspace_id, v_review_id, v_decision.id, v_decision.title, v_decision.status,
      v_decision.version, v_decision.resolution, nullif(trim(v_decision.reason), ''), v_decision.priority
    );
    insert into public.action_schedule_history (
      workspace_id, action_id, review_id, previous_horizon_id, new_horizon_id,
      previous_scheduled_on, new_scheduled_on, reason, actor_user_id
    ) values (
      v_workspace_id, v_decision.id, v_review_id, v_decision.horizon_id,
      case when v_decision.resolution = 'next_week' and v_decision.horizon_kind = 'week'
        then v_next_horizon_id else v_decision.horizon_id end,
      v_decision.scheduled_on,
      case when v_decision.resolution = 'next_week' then v_starts_on + 7 else v_decision.scheduled_on end,
      case v_decision.resolution
        when 'done' then 'completed'
        when 'next_week' then 'rescheduled'
        else v_decision.resolution
      end,
      v_user_id
    );
    if v_decision.resolution = 'done' then
      update public.actions set status = 'done', completed_at = clock_timestamp(),
        blocker_text = null, drop_reason = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    elsif v_decision.resolution = 'next_week' then
      -- Moving a weekly Action to next week means next week's horizon. Moving
      -- a monthly one means next week's date: it is still monthly work, and
      -- rewriting its horizon would silently reclassify the plan rather than
      -- reschedule the work.
      update public.actions set status = 'open',
        horizon_id = case when v_decision.horizon_kind = 'week'
          then v_next_horizon_id else v_decision.horizon_id end,
        scheduled_on = v_starts_on + 7, completed_at = null, blocker_text = null,
        drop_reason = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    elsif v_decision.resolution = 'blocked' then
      update public.actions set status = 'blocked', blocker_text = trim(v_decision.reason),
        completed_at = null, drop_reason = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    elsif v_decision.resolution = 'dropped' then
      update public.actions set status = 'dropped', drop_reason = trim(v_decision.reason),
        completed_at = null, blocker_text = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    end if;
  end loop;

  v_resolved_count := jsonb_array_length(p_input -> 'decisions');
  v_result := jsonb_build_object(
    'reviewId', v_review_id,
    'status', 'completed',
    'resolvedCount', v_resolved_count,
    'priorityCount', v_priority_count
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'medium', 'review', v_review_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'review', v_review_id, 'medium',
    case when p_surface = 'chat' then 'approved' else 'explicit_ui_commit' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range
    or not_null_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.review_week_eligible_actions(uuid, date, date)
from public, anon, authenticated, service_role;
revoke all on function public.execute_review_operation(text, jsonb, text, text) from public, anon;
grant execute on function public.execute_review_operation(text, jsonb, text, text) to authenticated;

commit;
