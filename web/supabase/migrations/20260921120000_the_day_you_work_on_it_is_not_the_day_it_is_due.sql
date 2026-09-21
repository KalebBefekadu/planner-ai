-- The day you work on it is not the day it is due.
--
-- An Action carries one date, `scheduled_on`, and it has had to mean both
-- things at once: the day you intend to sit down with something, and the day it
-- has to be finished. Those are different facts and they move independently. A
-- report due Friday that you mean to draft on Tuesday could only be recorded as
-- one or the other, so moving the draft to Wednesday looked like moving the
-- deadline, and a task scheduled for today told you nothing about whether today
-- was late.
--
-- `actions.due_on` separates them. It is nullable and stays null for everything
-- that exists, because most work has no deadline and inventing one would be a
-- claim nobody made. `scheduled_on` keeps its meaning untouched: the day you
-- plan to do the work.
--
-- The deadline is optional on `action.update.v1` rather than required. A caller
-- that does not mention it leaves it alone, so every existing writer keeps
-- working unchanged; sending it as null is how a deadline is cleared. That is
-- also why this is not a new Operation: a person editing a task usually changes
-- its title and its dates in one gesture, and two Operations would mean two
-- version bumps, the second one conflicting with the first.
--
-- Undo has to carry the new column or it would silently drop a deadline while
-- claiming to restore the edit, so the before-image trigger records it and the
-- snapshot restore puts it back.

begin;

alter table public.actions add column due_on date;

-- The same bound the rest of the schema puts on a user-supplied date, so a
-- mistyped year is refused at the boundary rather than stored.
alter table public.actions
  drop constraint if exists actions_due_on_range;
alter table public.actions
  add constraint actions_due_on_range check (
    due_on is null or due_on between date '2020-01-01' and date '2100-12-31'
  );

-- What is due, soonest first, for one workspace. Partial because most Actions
-- have no deadline and should not be in the index at all.
create index actions_due_on_idx
  on public.actions (workspace_id, due_on)
  where due_on is not null;

-- The before-image now carries the deadline, so undoing an edit restores it.
CREATE OR REPLACE FUNCTION public.capture_operation_before_image()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_payload jsonb;
begin
  if tg_table_name = 'daily_focus_items' then
    insert into public.operation_before_images (
      transaction_id, workspace_id, target_type, target_id, payload_json
    ) values (
      txid_current(), old.workspace_id, 'daily_focus', null,
      jsonb_build_object(
        'focusOn', old.focus_on,
        'actionId', old.action_id,
        'sortOrder', old.sort_order
      )
    );
    return old;
  elsif tg_table_name = 'goals' then
    v_payload := jsonb_build_object(
      'title', old.title,
      'descriptionMarkdown', old.description_markdown,
      'parentGoalId', old.parent_goal_id,
      'targetValue', old.target_value,
      'currentValue', old.current_value,
      'unit', old.unit,
      'dueOn', old.due_on,
      'status', old.status,
      'archivedAt', old.archived_at
    );
  elsif tg_table_name = 'actions' then
    v_payload := jsonb_build_object(
      'title', old.title,
      'descriptionMarkdown', old.description_markdown,
      'scheduledOn', old.scheduled_on,
      'dueOn', old.due_on,
      'goalId', old.goal_id,
      'parentActionId', old.parent_action_id,
      'horizonId', old.horizon_id,
      'status', old.status,
      'completedAt', old.completed_at,
      'blockerText', old.blocker_text,
      'dropReason', old.drop_reason,
      'version', old.version,
      'focusItems', coalesce((
        select jsonb_agg(
          jsonb_build_object('focusOn', focus_on, 'sortOrder', sort_order)
          order by focus_on, sort_order
        )
        from public.daily_focus_items
        where workspace_id = old.workspace_id and action_id = old.id
      ), '[]'::jsonb)
    );
  elsif tg_table_name = 'memories' then
    v_payload := jsonb_build_object('statement', old.statement);
  else
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (txid_current(), old.workspace_id, tg_table_name, old.id, v_payload);
  return new;
end;
$function$
;

-- action.update.v1 accepts an optional deadline alongside the work date.
CREATE OR REPLACE FUNCTION public.execute_daily_execution_operation(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_target_id uuid;
  v_expected_version bigint;
  v_focus_on date;
  v_action_ids uuid[];
  v_previous_scheduled_on date;
  v_previous_horizon_id uuid;
  v_result jsonb;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('action.update.v1', 'action.status.v1', 'daily-focus.set.v1') then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
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

  if p_operation_id = 'action.update.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if not (p_input ?& array['id', 'expectedVersion', 'title', 'descriptionMarkdown', 'scheduledOn'])
      or char_length(trim(p_input ->> 'title')) not between 3 and 1000
      or char_length(coalesce(p_input ->> 'descriptionMarkdown', '')) > 50000
      or jsonb_typeof(p_input -> 'scheduledOn') not in ('string', 'null')
      -- The deadline is optional on this edit. Absent leaves it alone, which is
      -- what every caller written before deadlines existed means; present and
      -- null clears it, which is how a deadline is removed.
      or (p_input ? 'dueOn' and jsonb_typeof(p_input -> 'dueOn') not in ('string', 'null')) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select scheduled_on, horizon_id into v_previous_scheduled_on, v_previous_horizon_id
    from public.actions
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and archived_at is null and trashed_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    update public.actions set
      title = trim(p_input ->> 'title'),
      description_markdown = nullif(p_input ->> 'descriptionMarkdown', ''),
      scheduled_on = nullif(p_input ->> 'scheduledOn', '')::date,
      due_on = case
        when p_input ? 'dueOn' then nullif(p_input ->> 'dueOn', '')::date
        else due_on
      end,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and archived_at is null and trashed_at is null
    returning * into v_row;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if v_previous_scheduled_on is distinct from v_row.scheduled_on then
      insert into public.action_schedule_history (
        workspace_id, action_id, previous_horizon_id, new_horizon_id,
        previous_scheduled_on, new_scheduled_on, reason, actor_user_id
      ) values (
        v_workspace_id, v_target_id, v_previous_horizon_id, v_row.horizon_id,
        v_previous_scheduled_on, v_row.scheduled_on, 'rescheduled', v_user_id
      );
    end if;
    v_result := to_jsonb(v_row);
  elsif p_operation_id = 'action.status.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if (p_input ->> 'status') not in ('open', 'in_progress', 'blocked', 'done', 'dropped') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    update public.actions set
      status = p_input ->> 'status',
      version = version + 1,
      completed_at = case when (p_input ->> 'status') = 'done' then clock_timestamp() else null end
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    returning * into v_row;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if (p_input ->> 'status') in ('done', 'dropped') then
      delete from public.daily_focus_items
      where workspace_id = v_workspace_id and action_id = v_target_id;
    end if;
    v_result := to_jsonb(v_row);
  else
    v_focus_on := (p_input ->> 'focusOn')::date;
    if not (p_input ?& array['focusOn', 'actionIds'])
      or jsonb_typeof(p_input -> 'actionIds') <> 'array'
      or jsonb_array_length(p_input -> 'actionIds') > 5
      or v_focus_on not between current_date - 31 and current_date + 31 then
      raise exception using errcode = 'P0001', message = 'invalid_daily_focus';
    end if;
    select coalesce(array_agg(value::uuid order by ordinality), array[]::uuid[])
    into v_action_ids
    from jsonb_array_elements_text(p_input -> 'actionIds')
      with ordinality as item(value, ordinality);
    if cardinality(v_action_ids) <> (
      select count(distinct action_id) from unnest(v_action_ids) as focused(action_id)
    ) or exists (
      select 1 from unnest(v_action_ids) as focused(action_id)
      left join public.actions action
        on action.id = action_id and action.workspace_id = v_workspace_id
        and action.status not in ('done', 'dropped')
        and action.archived_at is null and action.trashed_at is null
      where action.id is null
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_daily_focus';
    end if;
    delete from public.daily_focus_items
    where workspace_id = v_workspace_id and focus_on = v_focus_on;
    insert into public.daily_focus_items (workspace_id, focus_on, action_id, sort_order)
    select v_workspace_id, v_focus_on, action_id, (ordinality - 1)::smallint
    from unnest(v_action_ids) with ordinality as focused(action_id, ordinality);
    v_target_id := null;
    v_result := jsonb_build_object('focusOn', v_focus_on, 'actionIds', to_jsonb(v_action_ids));
  end if;

  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low',
    case when p_operation_id in ('action.update.v1', 'action.status.v1') then 'action' else 'daily_focus' end,
    v_target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_operation_id,
    case when p_operation_id in ('action.update.v1', 'action.status.v1') then 'action' else 'daily_focus' end,
    v_target_id, 'low',
    case when p_surface = 'ui' then 'explicit_ui_commit' else 'approved' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$function$
;

-- Undoing that edit puts the previous deadline back.
CREATE OR REPLACE FUNCTION public.execute_planning_snapshot_undo(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_original record;
  v_current record;
  v_target_id uuid;
  v_expected_version bigint;
  v_parent_id uuid;
  v_goal_id uuid;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'operation.undo.v1'
    or p_surface <> 'ui'
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
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

  select receipt.* into v_original
  from public.operation_receipts receipt
  join public.operation_contracts contract on contract.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
    and receipt.operation_id in (
      'goal.update.v1', 'goal.status.v1',
      'action.update.v1', 'action.move.v1', 'action.status.v1',
      'memory.update.v1'
    )
    and contract.reversible
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  if v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

  v_target_id := v_original.target_id;
  v_expected_version := (v_original.result_json ->> 'version')::bigint;
  v_undo_receipt_id := extensions.gen_random_uuid();

  if v_original.operation_id in ('goal.update.v1', 'goal.status.v1') then
    select * into v_current from public.goals
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    for update;
    if not found then raise exception using errcode = '40001', message = 'undo_conflict'; end if;

    if v_original.operation_id = 'goal.update.v1' then
      v_parent_id := nullif(v_original.undo_payload_json ->> 'parentGoalId', '')::uuid;
      if v_parent_id is not null and not exists (
        select 1 from public.goals where id = v_parent_id and workspace_id = v_workspace_id
          and archived_at is null and trashed_at is null
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      update public.goals set
        title = v_original.undo_payload_json ->> 'title',
        description_markdown = nullif(v_original.undo_payload_json ->> 'descriptionMarkdown', ''),
        parent_goal_id = v_parent_id,
        target_value = nullif(v_original.undo_payload_json ->> 'targetValue', '')::numeric,
        current_value = nullif(v_original.undo_payload_json ->> 'currentValue', '')::numeric,
        unit = nullif(v_original.undo_payload_json ->> 'unit', ''),
        due_on = nullif(v_original.undo_payload_json ->> 'dueOn', '')::date,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    else
      update public.goals set
        status = v_original.undo_payload_json ->> 'status',
        archived_at = nullif(v_original.undo_payload_json ->> 'archivedAt', '')::timestamptz,
        -- Undoing an achievement has to clear the achievement date too, or the
        -- Goal comes back active while still claiming a day it was reached.
        achieved_at = case
          when (v_original.undo_payload_json ->> 'status') = 'achieved' then coalesce(achieved_at, clock_timestamp())
          else null
        end,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    end if;

  elsif v_original.operation_id in (
    'action.update.v1', 'action.move.v1', 'action.status.v1'
  ) then
    select * into v_current from public.actions
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    for update;
    if not found then raise exception using errcode = '40001', message = 'undo_conflict'; end if;

    if v_original.operation_id = 'action.update.v1' then
      update public.actions set
        title = v_original.undo_payload_json ->> 'title',
        description_markdown = nullif(v_original.undo_payload_json ->> 'descriptionMarkdown', ''),
        scheduled_on = nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date,
        due_on = nullif(v_original.undo_payload_json ->> 'dueOn', '')::date,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
      if v_current.scheduled_on is distinct from
        nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date then
        insert into public.action_schedule_history (
          workspace_id, action_id, previous_horizon_id, new_horizon_id,
          previous_scheduled_on, new_scheduled_on, reason, actor_user_id
        ) values (
          v_workspace_id, v_target_id, v_current.horizon_id, v_current.horizon_id,
          v_current.scheduled_on,
          nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date,
          'undo', v_user_id
        );
      end if;
    elsif v_original.operation_id = 'action.move.v1' then
      v_parent_id := nullif(v_original.undo_payload_json ->> 'parentActionId', '')::uuid;
      v_goal_id := nullif(v_original.undo_payload_json ->> 'goalId', '')::uuid;
      if v_goal_id is not null and not exists (
        select 1 from public.goals where id = v_goal_id and workspace_id = v_workspace_id
          and archived_at is null and trashed_at is null
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      if v_parent_id is not null and (
        not exists (
          select 1 from public.actions where id = v_parent_id and workspace_id = v_workspace_id
            and archived_at is null and trashed_at is null
        ) or exists (
          with recursive descendants as (
            select id from public.actions where id = v_target_id and workspace_id = v_workspace_id
            union all
            select action.id from public.actions action
            join descendants d on action.parent_action_id = d.id
            where action.workspace_id = v_workspace_id
          )
          select 1 from descendants where id = v_parent_id
        )
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      update public.actions set
        goal_id = v_goal_id,
        parent_action_id = v_parent_id,
        horizon_id = (v_original.undo_payload_json ->> 'horizonId')::uuid,
        scheduled_on = nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
      insert into public.action_schedule_history (
        workspace_id, action_id, previous_horizon_id, new_horizon_id,
        previous_scheduled_on, new_scheduled_on, reason, actor_user_id
      ) values (
        v_workspace_id, v_target_id, v_current.horizon_id,
        (v_original.undo_payload_json ->> 'horizonId')::uuid,
        v_current.scheduled_on,
        nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date,
        'undo', v_user_id
      );
    else
      if exists (
        select 1
        from jsonb_to_recordset(v_original.undo_payload_json -> 'focusItems')
          as prior_focus("focusOn" date, "sortOrder" smallint)
        join public.daily_focus_items current_focus
          on current_focus.workspace_id = v_workspace_id
          and current_focus.focus_on = prior_focus."focusOn"
          and current_focus.sort_order = prior_focus."sortOrder"
          and current_focus.action_id <> v_target_id
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      update public.actions set
        status = v_original.undo_payload_json ->> 'status',
        completed_at = nullif(v_original.undo_payload_json ->> 'completedAt', '')::timestamptz,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
      insert into public.daily_focus_items (workspace_id, focus_on, action_id, sort_order)
      select v_workspace_id, prior_focus."focusOn", v_target_id, prior_focus."sortOrder"
      from jsonb_to_recordset(v_original.undo_payload_json -> 'focusItems')
        as prior_focus("focusOn" date, "sortOrder" smallint)
      on conflict do nothing;
    end if;

  else
    select * into v_current from public.memories
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    for update;
    if not found then raise exception using errcode = '40001', message = 'undo_conflict'; end if;
    update public.memories set
      statement = v_original.undo_payload_json ->> 'statement',
      version = version + 1,
      updated_at = clock_timestamp()
    where id = v_target_id and workspace_id = v_workspace_id;
  end if;

  v_result := jsonb_build_object(
    'originalReceiptId', v_original.id,
    'undoReceiptId', v_undo_receipt_id,
    'status', 'undone'
  );
  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status,
    result_json, reverses_receipt_id
  ) values (
    v_undo_receipt_id, v_workspace_id, p_operation_id, v_user_id, 'user', p_surface,
    p_idempotency_key, 'medium', 'operation_receipt', v_original.id, 'succeeded',
    v_result, v_original.id
  );
  update public.operation_receipts set
    reversed_by_receipt_id = v_undo_receipt_id,
    reversed_at = clock_timestamp()
  where id = v_original.id;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', p_surface, p_operation_id,
    'operation_receipt', v_original.id, 'medium', 'explicit_ui_commit', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$function$
;

commit;
