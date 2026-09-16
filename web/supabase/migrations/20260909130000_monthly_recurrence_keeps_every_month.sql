-- See PL-08. Monthly recurrences anchored at month end skipped a month.

begin;

-- A monthly recurrence anchored on a day that the next month does not have
-- used to skip that month entirely. Adding "day-of-month minus one" days to
-- the first of the next month walks off the end of a short month: from
-- 31 January it landed on 3 March, so February never happened, and each
-- overshoot pushed the series further from the day the person chose.
--
-- Clamping to the last day of the target month keeps every month in the
-- series. It does not fully remove drift -- the template records only its
-- next occurrence, so a clamped date becomes the anchor for the one after --
-- but a monthly Action that skips a month is a different kind of wrong from
-- one that lands on the 28th.
create or replace function public.next_monthly_occurrence(p_occurrence_on date)
returns date
language sql
immutable
set search_path = pg_catalog, public
as $$
  select least(
    (date_trunc('month', p_occurrence_on)::date + interval '1 month'
      + (extract(day from p_occurrence_on)::integer - 1) * interval '1 day')::date,
    -- Last day of the month after this one.
    (date_trunc('month', p_occurrence_on)::date + interval '2 months - 1 day')::date
  );
$$;

create or replace function public.execute_action_template_operation(
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
  v_workspace public.workspaces%rowtype;
  v_template public.action_templates%rowtype;
  v_before public.action_templates%rowtype;
  v_action public.actions%rowtype;
  v_template_id uuid;
  v_goal_id uuid;
  v_expected_version bigint;
  v_title text;
  v_description text;
  v_cadence text;
  v_status text;
  v_occurrence_on date;
  v_through_on date;
  v_today date;
  v_horizon_kind text;
  v_horizon_start date;
  v_horizon_end date;
  v_horizon_id uuid;
  v_horizon_existed boolean;
  v_created_action_ids uuid[] := array[]::uuid[];
  v_created_horizon_ids uuid[] := array[]::uuid[];
  v_actions_expected jsonb := '[]'::jsonb;
  v_result jsonb;
  v_undo_payload jsonb;
  v_actor_type text;
  v_risk text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'action-template.create.v1', 'action-template.update.v1',
    'action-template.status.v1', 'action-template.materialize.v1',
    'action-template.archive.v1'
  ) or p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200
    or jsonb_typeof(p_input) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  perform 1 from public.operation_contracts contract
  where contract.operation_id = p_operation_id and p_surface = any(contract.exposures);
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;

  select workspace.* into v_workspace
  from public.workspaces workspace where workspace.owner_user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  v_today := (clock_timestamp() at time zone v_workspace.timezone)::date;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace.id::text || p_operation_id || p_idempotency_key, 0)
  );
  select receipt.result_json into v_result from public.operation_receipts receipt
  where receipt.workspace_id = v_workspace.id
    and receipt.operation_id = p_operation_id
    and receipt.idempotency_key = p_idempotency_key
    and receipt.status = 'succeeded';
  if found then return v_result; end if;

  v_actor_type := case
    when p_surface = 'chat' then 'assistant'
    when p_surface in ('mcp', 'automation') then 'automation'
    else 'user'
  end;
  v_risk := case when p_operation_id = 'action-template.archive.v1' then 'medium' else 'low' end;

  if p_operation_id = 'action-template.create.v1' then
    v_title := trim(p_input ->> 'title');
    v_description := p_input ->> 'descriptionMarkdown';
    v_goal_id := nullif(p_input ->> 'goalId', '')::uuid;
    v_cadence := p_input ->> 'cadence';
    v_occurrence_on := (p_input ->> 'firstOccurrenceOn')::date;
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) as keys(key)) is distinct from
      array['cadence', 'descriptionMarkdown', 'firstOccurrenceOn', 'goalId', 'title']::text[]
      or char_length(v_title) not between 3 and 1000
      or (v_description is not null and char_length(v_description) > 50000)
      or v_cadence not in ('weekly', 'monthly')
      or v_occurrence_on not between v_today and v_today + 366
      or (v_cadence = 'monthly' and extract(day from v_occurrence_on)::integer > 28) then
      raise exception using errcode = 'P0001', message = 'invalid_action_template';
    end if;
    if v_goal_id is not null and not exists (
      select 1 from public.goals goal where goal.id = v_goal_id
        and goal.workspace_id = v_workspace.id
        and goal.archived_at is null and goal.trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'goal_not_found';
    end if;

    insert into public.action_templates (
      workspace_id, goal_id, title, description_markdown,
      cadence, next_occurrence_on
    ) values (
      v_workspace.id, v_goal_id, v_title, v_description, v_cadence,
      case when v_cadence = 'weekly' then v_occurrence_on + 7
        else (date_trunc('month', v_occurrence_on)::date + interval '1 month'
          + (extract(day from v_occurrence_on)::integer - 1) * interval '1 day')::date end
    ) returning * into v_template;

  else
    v_template_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select template.* into v_template from public.action_templates template
    where template.id = v_template_id and template.workspace_id = v_workspace.id
      and template.archived_at is null for update;
    if not found or v_template.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    v_before := v_template;

    if p_operation_id = 'action-template.update.v1' then
      v_title := trim(p_input ->> 'title');
      v_description := p_input ->> 'descriptionMarkdown';
      v_goal_id := nullif(p_input ->> 'goalId', '')::uuid;
      v_cadence := p_input ->> 'cadence';
      v_occurrence_on := (p_input ->> 'nextOccurrenceOn')::date;
      if (select array_agg(key order by key) from jsonb_object_keys(p_input) as keys(key)) is distinct from
        array['cadence', 'descriptionMarkdown', 'expectedVersion', 'goalId', 'id', 'nextOccurrenceOn', 'title']::text[]
        or char_length(v_title) not between 3 and 1000
        or (v_description is not null and char_length(v_description) > 50000)
        or v_cadence not in ('weekly', 'monthly')
        or v_occurrence_on not between v_today and v_today + 366
        or (v_cadence = 'monthly' and extract(day from v_occurrence_on)::integer > 28) then
        raise exception using errcode = 'P0001', message = 'invalid_action_template';
      end if;
      if v_goal_id is not null and not exists (
        select 1 from public.goals goal where goal.id = v_goal_id
          and goal.workspace_id = v_workspace.id
          and goal.archived_at is null and goal.trashed_at is null
      ) then
        raise exception using errcode = 'P0001', message = 'goal_not_found';
      end if;
      update public.action_templates set
        goal_id = v_goal_id, title = v_title, description_markdown = v_description,
        cadence = v_cadence, next_occurrence_on = v_occurrence_on,
        version = version + 1
      where id = v_template.id returning * into v_template;

    elsif p_operation_id = 'action-template.status.v1' then
      v_status := p_input ->> 'status';
      if (select array_agg(key order by key) from jsonb_object_keys(p_input) as keys(key)) is distinct from
        array['expectedVersion', 'id', 'status']::text[]
        or v_status not in ('active', 'paused') then
        raise exception using errcode = 'P0001', message = 'invalid_action_template';
      end if;
      update public.action_templates set status = v_status, version = version + 1
      where id = v_template.id returning * into v_template;

    elsif p_operation_id = 'action-template.archive.v1' then
      if (select array_agg(key order by key) from jsonb_object_keys(p_input) as keys(key)) is distinct from
        array['expectedVersion', 'id']::text[] then
        raise exception using errcode = 'P0001', message = 'invalid_action_template';
      end if;
      update public.action_templates set archived_at = clock_timestamp(), version = version + 1
      where id = v_template.id returning * into v_template;

    else
      v_through_on := (p_input ->> 'throughOn')::date;
      if (select array_agg(key order by key) from jsonb_object_keys(p_input) as keys(key)) is distinct from
        array['expectedVersion', 'id', 'throughOn']::text[]
        or v_through_on not between v_today and v_today + 90 then
        raise exception using errcode = 'P0001', message = 'invalid_materialization_window';
      end if;
      if v_template.status <> 'active' then
        raise exception using errcode = 'P0001', message = 'template_paused';
      end if;
    end if;
  end if;

  if p_operation_id in ('action-template.create.v1', 'action-template.materialize.v1') then
    if p_operation_id = 'action-template.create.v1' then
      v_occurrence_on := (p_input ->> 'firstOccurrenceOn')::date;
      v_through_on := v_occurrence_on;
    else
      v_occurrence_on := v_template.next_occurrence_on;
    end if;

    while v_occurrence_on <= v_through_on loop
      v_horizon_kind := case when v_template.cadence = 'weekly' then 'week' else 'month' end;
      if v_horizon_kind = 'week' then
        v_horizon_start := v_occurrence_on -
          ((extract(dow from v_occurrence_on)::integer - v_workspace.week_starts_on + 7) % 7);
        v_horizon_end := v_horizon_start + 6;
      else
        v_horizon_start := date_trunc('month', v_occurrence_on)::date;
        v_horizon_end := (v_horizon_start + interval '1 month - 1 day')::date;
      end if;
      select exists (
        select 1 from public.planning_horizons horizon
        where horizon.workspace_id = v_workspace.id and horizon.kind = v_horizon_kind
          and horizon.starts_on = v_horizon_start
      ) into v_horizon_existed;
      insert into public.planning_horizons (
        workspace_id, kind, starts_on, ends_on, timezone_snapshot
      ) values (
        v_workspace.id, v_horizon_kind, v_horizon_start, v_horizon_end, v_workspace.timezone
      ) on conflict (workspace_id, kind, starts_on) do update set
        ends_on = excluded.ends_on, timezone_snapshot = excluded.timezone_snapshot
      returning id into v_horizon_id;
      if not v_horizon_existed and not (v_horizon_id = any(v_created_horizon_ids)) then
        v_created_horizon_ids := array_append(v_created_horizon_ids, v_horizon_id);
      end if;

      insert into public.actions (
        workspace_id, goal_id, horizon_id, recurrence_template_id,
        title, description_markdown, status, scheduled_on
      ) values (
        v_workspace.id, v_template.goal_id, v_horizon_id, v_template.id,
        v_template.title, v_template.description_markdown, 'open', v_occurrence_on
      ) on conflict (workspace_id, recurrence_template_id, scheduled_on)
        where recurrence_template_id is not null and scheduled_on is not null do nothing
      returning * into v_action;
      if found then
        v_created_action_ids := array_append(v_created_action_ids, v_action.id);
        v_actions_expected := v_actions_expected || jsonb_build_array(to_jsonb(v_action));
      end if;
      v_occurrence_on := case
        when v_template.cadence = 'weekly' then v_occurrence_on + 7
        else public.next_monthly_occurrence(v_occurrence_on)
      end;
    end loop;

    if p_operation_id = 'action-template.materialize.v1'
      and v_occurrence_on is distinct from v_template.next_occurrence_on then
      update public.action_templates set
        next_occurrence_on = v_occurrence_on, version = version + 1
      where id = v_template.id returning * into v_template;
    end if;
  end if;

  if p_operation_id = 'action-template.create.v1' then
    v_undo_payload := jsonb_build_object(
      'kind', 'create', 'templateExpected', to_jsonb(v_template),
      'actionsExpected', v_actions_expected,
      'createdHorizonIds', to_jsonb(v_created_horizon_ids)
    );
  elsif p_operation_id = 'action-template.materialize.v1' then
    v_undo_payload := jsonb_build_object(
      'kind', 'materialize', 'templateBefore', to_jsonb(v_before),
      'templateExpected', to_jsonb(v_template), 'actionsExpected', v_actions_expected,
      'createdHorizonIds', to_jsonb(v_created_horizon_ids)
    );
  else
    v_undo_payload := jsonb_build_object(
      'kind', 'snapshot', 'templateBefore', to_jsonb(v_before),
      'templateExpected', to_jsonb(v_template)
    );
  end if;

  v_result := jsonb_build_object(
    'id', v_template.id,
    'workspaceId', v_template.workspace_id,
    'title', v_template.title,
    'cadence', v_template.cadence,
    'status', case when v_template.archived_at is not null then 'archived' else v_template.status end,
    'nextOccurrenceOn', v_template.next_occurrence_on,
    'version', v_template.version,
    'createdActionIds', to_jsonb(v_created_action_ids)
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status,
    result_json, undo_payload_json
  ) values (
    v_workspace.id, p_operation_id, v_user_id, v_actor_type, p_surface,
    p_idempotency_key, v_risk, 'action_template', v_template.id, 'succeeded',
    v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace.id, v_user_id, v_actor_type, p_surface, p_operation_id,
    'action_template', v_template.id, v_risk,
    case when v_risk = 'medium' then 'explicit_confirmation' else 'not_required' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or check_violation or foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'invalid_action_template';
end;
$$;
revoke all on function public.next_monthly_occurrence(date)
from public, anon, authenticated, service_role;
-- The executor stays private: it is reached only through the fixed-surface
-- gateway, never called directly by an authenticated session.
revoke all on function public.execute_action_template_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
