-- See PL-11. Monthly recurrences drifted to the shorter day instead of
-- returning to the day the person chose.

begin;

-- PL-08 stopped month-end recurrences skipping a month, but a template
-- records only its next occurrence, so a date clamped into a short month
-- became the anchor for the one after it and the series settled there:
-- 31 January -> 28 February -> 28 March -> 28 April. The person asked for the
-- last day of the month and got the 28th from March onward.
--
-- The intended day of month has to be remembered separately from the next
-- date, so each occurrence is computed from the day that was chosen and
-- clamping applies only to the month that is too short to hold it.
alter table public.action_templates
add column monthly_anchor_day smallint;

-- Existing templates never stored an anchor, so the best available evidence
-- of the chosen day is the day their next occurrence already falls on. A
-- template that has already drifted keeps the day it drifted to rather than
-- being retroactively moved: guessing an earlier intent would silently change
-- dates the owner has been living with.
update public.action_templates
set monthly_anchor_day = extract(day from next_occurrence_on)::smallint
where cadence = 'monthly';

alter table public.action_templates
add constraint action_templates_monthly_anchor_day_check check (
  case
    when cadence = 'monthly' then monthly_anchor_day between 1 and 31
    else monthly_anchor_day is null
  end
);

-- The anchor is an argument rather than something read back out of the date,
-- because the date on its own cannot tell a genuine 28th from a 31st that was
-- clamped into February.
drop function public.next_monthly_occurrence(date);
create function public.next_monthly_occurrence(
  p_occurrence_on date,
  p_anchor_day integer
)
returns date
language sql
immutable
set search_path = pg_catalog, public
as $$
  select least(
    (date_trunc('month', p_occurrence_on)::date + interval '1 month'
      + (coalesce(p_anchor_day, extract(day from p_occurrence_on)::integer) - 1)
        * interval '1 day')::date,
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
  v_anchor_day integer;
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
      or v_occurrence_on not between v_today and v_today + 366 then
      raise exception using errcode = 'P0001', message = 'invalid_action_template';
    end if;
    -- The 29th, 30th and 31st used to be refused outright because nothing
    -- could carry them forward. The anchor carries them, so they are allowed.
    v_anchor_day := case when v_cadence = 'monthly'
      then extract(day from v_occurrence_on)::integer end;
    if v_goal_id is not null and not exists (
      select 1 from public.goals goal where goal.id = v_goal_id
        and goal.workspace_id = v_workspace.id
        and goal.archived_at is null and goal.trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'goal_not_found';
    end if;

    insert into public.action_templates (
      workspace_id, goal_id, title, description_markdown,
      cadence, next_occurrence_on, monthly_anchor_day
    ) values (
      v_workspace.id, v_goal_id, v_title, v_description, v_cadence,
      case when v_cadence = 'weekly' then v_occurrence_on + 7
        else public.next_monthly_occurrence(v_occurrence_on, v_anchor_day) end,
      v_anchor_day
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
        or v_occurrence_on not between v_today and v_today + 366 then
        raise exception using errcode = 'P0001', message = 'invalid_action_template';
      end if;
      -- Re-picking the next date is how someone re-picks the day of the month,
      -- so the edited date becomes the new anchor rather than a one-off.
      v_anchor_day := case when v_cadence = 'monthly'
        then extract(day from v_occurrence_on)::integer end;
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
        monthly_anchor_day = v_anchor_day, version = version + 1
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
        else public.next_monthly_occurrence(v_occurrence_on, v_template.monthly_anchor_day)
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


-- Undoing a template change restores the row column by column, so the anchor
-- has to be restored with it: without this an undone edit would leave the
-- template pointing at the old date while repeating on the new day. This link
-- of the undo chain was renamed by later migrations, which is why the name
-- here mentions notifications rather than Action templates.
create or replace function public.execute_operation_undo_notification_base(
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
  v_original public.operation_receipts%rowtype;
  v_template public.action_templates%rowtype;
  v_action public.actions%rowtype;
  v_action_expected jsonb;
  v_horizon_id_json jsonb;
  v_before jsonb;
  v_expected jsonb;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if p_operation_id <> 'operation.undo.v1' then
    return public.execute_operation_undo_action_template_base(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  select workspace.id into v_workspace_id
  from public.workspaces workspace where workspace.owner_user_id = v_user_id;
  select receipt.* into v_original
  from public.operation_receipts receipt
  join public.operation_undo_support support on support.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.operation_id like 'action-template.%'
    and receipt.status = 'succeeded' and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    return public.execute_operation_undo_action_template_base(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  if p_surface <> 'ui' or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200
    or v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select receipt.result_json into v_result from public.operation_receipts receipt
  where receipt.workspace_id = v_workspace_id and receipt.operation_id = p_operation_id
    and receipt.idempotency_key = p_idempotency_key and receipt.status = 'succeeded';
  if found then return v_result; end if;

  select template.* into v_template from public.action_templates template
  where template.id = v_original.target_id and template.workspace_id = v_workspace_id
  for update;
  v_expected := v_original.undo_payload_json -> 'templateExpected';
  if not found or to_jsonb(v_template) is distinct from v_expected then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  for v_action_expected in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'actionsExpected')
  loop
    select action.* into v_action from public.actions action
    where action.id = (v_action_expected ->> 'id')::uuid
      and action.workspace_id = v_workspace_id for update;
    if not found or to_jsonb(v_action) is distinct from v_action_expected
      or exists (
        select 1 from public.actions child where child.workspace_id = v_workspace_id
          and child.parent_action_id = v_action.id
      )
      or exists (
        select 1 from public.note_action_links relation where relation.workspace_id = v_workspace_id
          and relation.action_id = v_action.id
      )
      or exists (
        select 1 from public.daily_focus_items focus where focus.workspace_id = v_workspace_id
          and focus.action_id = v_action.id
      )
      or exists (
        select 1 from public.review_action_items review_item
        where review_item.workspace_id = v_workspace_id and review_item.action_id = v_action.id
      )
      or exists (
        select 1 from public.action_schedule_history history
        where history.workspace_id = v_workspace_id and history.action_id = v_action.id
      ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end loop;

  delete from public.actions action
  where action.workspace_id = v_workspace_id and action.id in (
    select (value ->> 'id')::uuid
    from jsonb_array_elements(v_original.undo_payload_json -> 'actionsExpected')
  );
  if v_original.undo_payload_json ->> 'kind' = 'create' then
    delete from public.action_templates template
    where template.id = v_original.target_id and template.workspace_id = v_workspace_id;
  else
    v_before := v_original.undo_payload_json -> 'templateBefore';
    update public.action_templates set
      goal_id = nullif(v_before ->> 'goal_id', '')::uuid,
      title = v_before ->> 'title',
      description_markdown = v_before ->> 'description_markdown',
      cadence = v_before ->> 'cadence',
      next_occurrence_on = (v_before ->> 'next_occurrence_on')::date,
      monthly_anchor_day = (v_before ->> 'monthly_anchor_day')::smallint,
      status = v_before ->> 'status',
      version = (v_before ->> 'version')::bigint,
      archived_at = nullif(v_before ->> 'archived_at', '')::timestamptz
    where id = v_original.target_id and workspace_id = v_workspace_id;
  end if;

  for v_horizon_id_json in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'createdHorizonIds')
  loop
    delete from public.planning_horizons horizon
    where horizon.id = (v_horizon_id_json #>> '{}')::uuid
      and horizon.workspace_id = v_workspace_id
      and not exists (select 1 from public.goals goal where goal.horizon_id = horizon.id)
      and not exists (select 1 from public.actions action where action.horizon_id = horizon.id);
  end loop;

  update public.operation_receipts set reversed_at = clock_timestamp()
  where id = v_original.id;
  v_undo_receipt_id := extensions.gen_random_uuid();
  v_result := jsonb_build_object(
    'originalReceiptId', v_original.id,
    'undoReceiptId', v_undo_receipt_id,
    'status', 'undone'
  );
  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_undo_receipt_id, v_workspace_id, p_operation_id, v_user_id, 'user', p_surface,
    p_idempotency_key, 'low', 'action_template', v_original.target_id,
    'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', p_surface, p_operation_id,
    'action_template', v_original.target_id, 'low', 'not_required', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.next_monthly_occurrence(date, integer)
from public, anon, authenticated, service_role;
revoke all on function public.execute_action_template_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_notification_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
