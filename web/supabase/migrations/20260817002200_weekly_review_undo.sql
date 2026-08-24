begin;

alter table public.action_schedule_history
drop constraint if exists action_schedule_history_reason_check;
alter table public.action_schedule_history
add constraint action_schedule_history_reason_check check (
  reason in ('completed', 'rescheduled', 'blocked', 'dropped', 'left_overdue', 'undo')
);

insert into public.operation_undo_support (operation_id, strategy)
values ('review.complete-weekly.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.capture_operation_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
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
$$;

create or replace function public.claim_weekly_review_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_review record;
  v_items jsonb;
  v_actions jsonb;
  v_histories jsonb;
  v_horizons jsonb;
begin
  if new.undo_payload_json is not null
    or new.operation_id <> 'review.complete-weekly.v1' then
    return new;
  end if;

  select * into v_review from public.reviews
  where id = new.target_id and workspace_id = new.workspace_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'actionId', item.action_id,
    'actionTitleSnapshot', item.action_title_snapshot,
    'actionStatusSnapshot', item.action_status_snapshot,
    'actionVersionSnapshot', item.action_version_snapshot,
    'resolution', item.resolution,
    'reason', item.reason,
    'priority', item.priority,
    'createdAt', item.created_at
  ) order by item.action_id), '[]'::jsonb)
  into v_items
  from public.review_action_items item
  where item.workspace_id = new.workspace_id and item.review_id = v_review.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'actionId', action.id,
    'changed', snapshot.payload_json is not null,
    'priorAction', coalesce(snapshot.payload_json, jsonb_build_object(
      'horizonId', action.horizon_id,
      'scheduledOn', action.scheduled_on,
      'status', action.status,
      'completedAt', action.completed_at,
      'blockerText', action.blocker_text,
      'dropReason', action.drop_reason,
      'version', action.version
    )),
    'expectedAction', jsonb_build_object(
      'horizonId', action.horizon_id,
      'scheduledOn', action.scheduled_on,
      'status', action.status,
      'completedAt', action.completed_at,
      'blockerText', action.blocker_text,
      'dropReason', action.drop_reason,
      'version', action.version
    )
  ) order by action.id), '[]'::jsonb)
  into v_actions
  from public.review_action_items item
  join public.actions action
    on action.id = item.action_id and action.workspace_id = item.workspace_id
  left join lateral (
    select before_image.payload_json
    from public.operation_before_images before_image
    where before_image.transaction_id = txid_current()
      and before_image.workspace_id = new.workspace_id
      and before_image.target_type = 'actions'
      and before_image.target_id = action.id
    order by before_image.id desc
    limit 1
  ) snapshot on true
  where item.workspace_id = new.workspace_id and item.review_id = v_review.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history.id,
    'actionId', history.action_id,
    'previousHorizonId', history.previous_horizon_id,
    'newHorizonId', history.new_horizon_id,
    'previousScheduledOn', history.previous_scheduled_on,
    'newScheduledOn', history.new_scheduled_on,
    'reason', history.reason,
    'actorUserId', history.actor_user_id,
    'createdAt', history.created_at
  ) order by history.id), '[]'::jsonb)
  into v_histories
  from public.action_schedule_history history
  where history.workspace_id = new.workspace_id and history.review_id = v_review.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', horizon.id,
    'mode', snapshot.payload_json ->> 'mode',
    'priorHorizon', snapshot.payload_json -> 'priorHorizon',
    'expectedHorizon', jsonb_build_object(
      'kind', horizon.kind,
      'startsOn', horizon.starts_on,
      'endsOn', horizon.ends_on,
      'timezoneSnapshot', horizon.timezone_snapshot
    )
  ) order by horizon.id), '[]'::jsonb)
  into v_horizons
  from (
    select distinct on (target_id) target_id, payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = 'planning_horizons'
    order by target_id, id desc
  ) snapshot
  join public.planning_horizons horizon
    on horizon.id = snapshot.target_id and horizon.workspace_id = new.workspace_id;

  if jsonb_array_length(v_actions) <> jsonb_array_length(v_items)
    or jsonb_array_length(v_histories) <> jsonb_array_length(v_items)
    or jsonb_array_length(v_horizons) < 1 then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;

  new.undo_payload_json := jsonb_build_object(
    'expectedReview', jsonb_build_object(
      'horizonId', v_review.horizon_id,
      'kind', v_review.kind,
      'status', v_review.status,
      'reflectionMarkdown', v_review.reflection_markdown,
      'version', v_review.version,
      'completedAt', v_review.completed_at,
      'createdAt', v_review.created_at,
      'updatedAt', v_review.updated_at
    ),
    'expectedItems', v_items,
    'actions', v_actions,
    'expectedHistories', v_histories,
    'horizons', v_horizons
  );
  return new;
end;
$$;

create trigger operation_receipts_aa_claim_weekly_review
before insert on public.operation_receipts
for each row execute function public.claim_weekly_review_before_image();

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_period_review_base;

create or replace function public.execute_weekly_review_undo(
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
  v_original record;
  v_review record;
  v_current_action record;
  v_current_items jsonb;
  v_current_histories jsonb;
  v_action_snapshot jsonb;
  v_expected_action jsonb;
  v_prior_action jsonb;
  v_horizon_snapshot jsonb;
  v_current_horizon record;
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
  join public.operation_undo_support support on support.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.operation_id = 'review.complete-weekly.v1'
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  if v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

  select * into v_review from public.reviews
  where id = v_original.target_id and workspace_id = v_workspace_id
  for update;
  if not found
    or v_review.horizon_id is distinct from (v_original.undo_payload_json #>> '{expectedReview,horizonId}')::uuid
    or v_review.kind is distinct from v_original.undo_payload_json #>> '{expectedReview,kind}'
    or v_review.status is distinct from v_original.undo_payload_json #>> '{expectedReview,status}'
    or v_review.reflection_markdown is distinct from v_original.undo_payload_json #>> '{expectedReview,reflectionMarkdown}'
    or v_review.version is distinct from (v_original.undo_payload_json #>> '{expectedReview,version}')::bigint
    or v_review.completed_at is distinct from (v_original.undo_payload_json #>> '{expectedReview,completedAt}')::timestamptz
    or v_review.created_at is distinct from (v_original.undo_payload_json #>> '{expectedReview,createdAt}')::timestamptz
    or v_review.updated_at is distinct from (v_original.undo_payload_json #>> '{expectedReview,updatedAt}')::timestamptz then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'actionId', item.action_id,
    'actionTitleSnapshot', item.action_title_snapshot,
    'actionStatusSnapshot', item.action_status_snapshot,
    'actionVersionSnapshot', item.action_version_snapshot,
    'resolution', item.resolution,
    'reason', item.reason,
    'priority', item.priority,
    'createdAt', item.created_at
  ) order by item.action_id), '[]'::jsonb)
  into v_current_items
  from public.review_action_items item
  where item.workspace_id = v_workspace_id and item.review_id = v_review.id;
  if v_current_items is distinct from v_original.undo_payload_json -> 'expectedItems' then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history.id,
    'actionId', history.action_id,
    'previousHorizonId', history.previous_horizon_id,
    'newHorizonId', history.new_horizon_id,
    'previousScheduledOn', history.previous_scheduled_on,
    'newScheduledOn', history.new_scheduled_on,
    'reason', history.reason,
    'actorUserId', history.actor_user_id,
    'createdAt', history.created_at
  ) order by history.id), '[]'::jsonb)
  into v_current_histories
  from public.action_schedule_history history
  where history.workspace_id = v_workspace_id and history.review_id = v_review.id;
  if v_current_histories is distinct from v_original.undo_payload_json -> 'expectedHistories' then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  perform 1 from public.actions action
  join jsonb_to_recordset(v_original.undo_payload_json -> 'actions')
    as snapshot("actionId" uuid) on snapshot."actionId" = action.id
  where action.workspace_id = v_workspace_id
  order by action.id
  for update of action;

  for v_action_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'actions')
  loop
    v_expected_action := v_action_snapshot -> 'expectedAction';
    v_prior_action := v_action_snapshot -> 'priorAction';
    select * into v_current_action from public.actions
    where id = (v_action_snapshot ->> 'actionId')::uuid
      and workspace_id = v_workspace_id;
    if not found
      or v_current_action.horizon_id is distinct from (v_expected_action ->> 'horizonId')::uuid
      or v_current_action.scheduled_on is distinct from nullif(v_expected_action ->> 'scheduledOn', '')::date
      or v_current_action.status is distinct from v_expected_action ->> 'status'
      or v_current_action.completed_at is distinct from nullif(v_expected_action ->> 'completedAt', '')::timestamptz
      or v_current_action.blocker_text is distinct from nullif(v_expected_action ->> 'blockerText', '')
      or v_current_action.drop_reason is distinct from nullif(v_expected_action ->> 'dropReason', '')
      or v_current_action.version is distinct from (v_expected_action ->> 'version')::bigint then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

    if (v_action_snapshot ->> 'changed')::boolean then
      update public.actions set
        horizon_id = (v_prior_action ->> 'horizonId')::uuid,
        scheduled_on = nullif(v_prior_action ->> 'scheduledOn', '')::date,
        status = v_prior_action ->> 'status',
        completed_at = nullif(v_prior_action ->> 'completedAt', '')::timestamptz,
        blocker_text = nullif(v_prior_action ->> 'blockerText', ''),
        drop_reason = nullif(v_prior_action ->> 'dropReason', ''),
        version = version + 1
      where id = v_current_action.id and workspace_id = v_workspace_id;
      if v_current_action.horizon_id is distinct from (v_prior_action ->> 'horizonId')::uuid
        or v_current_action.scheduled_on is distinct from nullif(v_prior_action ->> 'scheduledOn', '')::date then
        insert into public.action_schedule_history (
          workspace_id, action_id, previous_horizon_id, new_horizon_id,
          previous_scheduled_on, new_scheduled_on, reason, actor_user_id
        ) values (
          v_workspace_id, v_current_action.id, v_current_action.horizon_id,
          (v_prior_action ->> 'horizonId')::uuid, v_current_action.scheduled_on,
          nullif(v_prior_action ->> 'scheduledOn', '')::date, 'undo', v_user_id
        );
      end if;
    end if;
  end loop;

  for v_horizon_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'horizons')
  loop
    select * into v_current_horizon from public.planning_horizons
    where id = (v_horizon_snapshot ->> 'id')::uuid and workspace_id = v_workspace_id
    for update;
    if not found
      or v_current_horizon.kind is distinct from v_horizon_snapshot #>> '{expectedHorizon,kind}'
      or v_current_horizon.starts_on is distinct from (v_horizon_snapshot #>> '{expectedHorizon,startsOn}')::date
      or v_current_horizon.ends_on is distinct from (v_horizon_snapshot #>> '{expectedHorizon,endsOn}')::date
      or v_current_horizon.timezone_snapshot is distinct from v_horizon_snapshot #>> '{expectedHorizon,timezoneSnapshot}' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end loop;

  delete from public.reviews where id = v_review.id and workspace_id = v_workspace_id;

  for v_horizon_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'horizons')
  loop
    if v_horizon_snapshot ->> 'mode' = 'update' then
      update public.planning_horizons set
        kind = v_horizon_snapshot #>> '{priorHorizon,kind}',
        starts_on = (v_horizon_snapshot #>> '{priorHorizon,startsOn}')::date,
        ends_on = (v_horizon_snapshot #>> '{priorHorizon,endsOn}')::date,
        timezone_snapshot = v_horizon_snapshot #>> '{priorHorizon,timezoneSnapshot}'
      where id = (v_horizon_snapshot ->> 'id')::uuid and workspace_id = v_workspace_id;
    elsif v_horizon_snapshot ->> 'mode' = 'create' then
      delete from public.planning_horizons horizon
      where horizon.id = (v_horizon_snapshot ->> 'id')::uuid
        and horizon.workspace_id = v_workspace_id
        and not exists (select 1 from public.reviews where workspace_id = v_workspace_id and horizon_id = horizon.id)
        and not exists (select 1 from public.goals where workspace_id = v_workspace_id and horizon_id = horizon.id)
        and not exists (select 1 from public.actions where workspace_id = v_workspace_id and horizon_id = horizon.id)
        and not exists (
          select 1 from public.action_schedule_history
          where workspace_id = v_workspace_id
            and (previous_horizon_id = horizon.id or new_horizon_id = horizon.id)
        );
    else
      raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
    end if;
  end loop;

  v_undo_receipt_id := extensions.gen_random_uuid();
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
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

create or replace function public.execute_operation_undo(
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
  v_original_operation_id text;
begin
  select receipt.operation_id into v_original_operation_id
  from public.operation_receipts receipt
  join public.workspaces workspace on workspace.id = receipt.workspace_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and workspace.owner_user_id = auth.uid();
  if v_original_operation_id = 'review.complete-weekly.v1' then
    return public.execute_weekly_review_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_period_review_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.claim_weekly_review_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_period_review_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_weekly_review_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
