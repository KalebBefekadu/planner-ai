begin;

insert into public.operation_undo_support (operation_id, strategy) values
  ('goal.archive.v1', 'snapshot'),
  ('action.archive.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.capture_planning_archive_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_payload jsonb;
begin
  if tg_table_name = 'actions' then
    v_payload := jsonb_build_object(
      'archivedAt', old.archived_at,
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
  else
    v_payload := jsonb_build_object(
      'archivedAt', old.archived_at,
      'version', old.version
    );
  end if;
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), old.workspace_id, 'archive_' || tg_table_name, old.id, v_payload
  );
  return new;
end;
$$;

create trigger actions_capture_planning_archive
before update on public.actions
for each row when (old.archived_at is distinct from new.archived_at)
execute function public.capture_planning_archive_before_image();
create trigger goals_capture_planning_archive
before update on public.goals
for each row when (old.archived_at is distinct from new.archived_at)
execute function public.capture_planning_archive_before_image();

create or replace function public.claim_planning_archive_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_snapshots jsonb;
begin
  if new.undo_payload_json is not null
    or new.operation_id not in ('goal.archive.v1', 'action.archive.v1') then
    return new;
  end if;

  select coalesce(jsonb_agg(snapshot order by snapshot ->> 'targetType', snapshot ->> 'targetId'), '[]'::jsonb)
  into v_snapshots
  from (
    select jsonb_build_object(
      'targetType', 'action',
      'targetId', action.id,
      'priorArchivedAt', before_image.payload_json -> 'archivedAt',
      'priorVersion', before_image.payload_json -> 'version',
      'priorFocusItems', before_image.payload_json -> 'focusItems',
      'expectedArchivedAt', to_jsonb(action.archived_at),
      'expectedVersion', action.version,
      'expectedFocusItems', coalesce((
        select jsonb_agg(
          jsonb_build_object('focusOn', focus.focus_on, 'sortOrder', focus.sort_order)
          order by focus.focus_on, focus.sort_order
        )
        from public.daily_focus_items focus
        where focus.workspace_id = action.workspace_id and focus.action_id = action.id
      ), '[]'::jsonb)
    ) as snapshot
    from public.operation_before_images before_image
    join public.actions action
      on action.id = before_image.target_id and action.workspace_id = before_image.workspace_id
    where before_image.transaction_id = txid_current()
      and before_image.workspace_id = new.workspace_id
      and before_image.target_type = 'archive_actions'
    union all
    select jsonb_build_object(
      'targetType', 'goal',
      'targetId', goal.id,
      'priorArchivedAt', before_image.payload_json -> 'archivedAt',
      'priorVersion', before_image.payload_json -> 'version',
      'expectedArchivedAt', to_jsonb(goal.archived_at),
      'expectedVersion', goal.version
    ) as snapshot
    from public.operation_before_images before_image
    join public.goals goal
      on goal.id = before_image.target_id and goal.workspace_id = before_image.workspace_id
    where before_image.transaction_id = txid_current()
      and before_image.workspace_id = new.workspace_id
      and before_image.target_type = 'archive_goals'
  ) captured;

  if jsonb_array_length(v_snapshots) < 1 or not exists (
    select 1 from jsonb_array_elements(v_snapshots) snapshot
    where snapshot ->> 'targetId' = new.target_id::text
  ) then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;
  new.undo_payload_json := jsonb_build_object('snapshots', v_snapshots);
  return new;
end;
$$;

create trigger operation_receipts_ab_claim_planning_archive
before insert on public.operation_receipts
for each row execute function public.claim_planning_archive_before_image();

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_weekly_review_base;

create or replace function public.execute_planning_archive_undo(
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
  v_snapshot jsonb;
  v_current record;
  v_current_focus jsonb;
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
    and receipt.operation_id in ('goal.archive.v1', 'action.archive.v1')
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

  for v_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'snapshots')
    order by value ->> 'targetType', value ->> 'targetId'
  loop
    if v_snapshot ->> 'targetType' = 'action' then
      select * into v_current from public.actions
      where id = (v_snapshot ->> 'targetId')::uuid and workspace_id = v_workspace_id
      for update;
      select coalesce(jsonb_agg(
        jsonb_build_object('focusOn', focus_on, 'sortOrder', sort_order)
        order by focus_on, sort_order
      ), '[]'::jsonb) into v_current_focus
      from public.daily_focus_items
      where workspace_id = v_workspace_id and action_id = (v_snapshot ->> 'targetId')::uuid;
      if v_current.id is null
        or v_current.archived_at is distinct from (v_snapshot ->> 'expectedArchivedAt')::timestamptz
        or v_current.version is distinct from (v_snapshot ->> 'expectedVersion')::bigint
        or v_current_focus is distinct from v_snapshot -> 'expectedFocusItems' then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(v_snapshot -> 'priorFocusItems')
          as prior_focus("focusOn" date, "sortOrder" smallint)
        join public.daily_focus_items current_focus
          on current_focus.workspace_id = v_workspace_id
          and current_focus.focus_on = prior_focus."focusOn"
          and current_focus.sort_order = prior_focus."sortOrder"
          and current_focus.action_id <> (v_snapshot ->> 'targetId')::uuid
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
    elsif v_snapshot ->> 'targetType' = 'goal' then
      select * into v_current from public.goals
      where id = (v_snapshot ->> 'targetId')::uuid and workspace_id = v_workspace_id
      for update;
      if not found
        or v_current.archived_at is distinct from (v_snapshot ->> 'expectedArchivedAt')::timestamptz
        or v_current.version is distinct from (v_snapshot ->> 'expectedVersion')::bigint then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
    else
      raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
    end if;
  end loop;

  for v_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'snapshots')
    order by value ->> 'targetType', value ->> 'targetId'
  loop
    if v_snapshot ->> 'targetType' = 'action' then
      update public.actions set
        archived_at = (v_snapshot ->> 'priorArchivedAt')::timestamptz,
        version = version + 1
      where id = (v_snapshot ->> 'targetId')::uuid and workspace_id = v_workspace_id;
      insert into public.daily_focus_items (workspace_id, focus_on, action_id, sort_order)
      select v_workspace_id, prior_focus."focusOn",
        (v_snapshot ->> 'targetId')::uuid, prior_focus."sortOrder"
      from jsonb_to_recordset(v_snapshot -> 'priorFocusItems')
        as prior_focus("focusOn" date, "sortOrder" smallint)
      on conflict do nothing;
    else
      update public.goals set
        archived_at = (v_snapshot ->> 'priorArchivedAt')::timestamptz,
        version = version + 1
      where id = (v_snapshot ->> 'targetId')::uuid and workspace_id = v_workspace_id;
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
  if v_original_operation_id in ('goal.archive.v1', 'action.archive.v1') then
    return public.execute_planning_archive_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_weekly_review_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.capture_planning_archive_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.claim_planning_archive_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_weekly_review_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_planning_archive_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
