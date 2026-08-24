begin;

create table public.operation_before_images (
  id bigint generated always as identity primary key,
  transaction_id bigint not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  payload_json jsonb not null,
  created_at timestamptz not null default now()
);
create index operation_before_images_claim_idx
on public.operation_before_images (transaction_id, workspace_id, target_type, target_id, id desc);
alter table public.operation_before_images enable row level security;
alter table public.operation_before_images force row level security;
revoke all on public.operation_before_images from public, anon, authenticated;

create or replace function public.capture_operation_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_payload jsonb;
begin
  if tg_table_name = 'goals' then
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
    return new;
  end if;

  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (txid_current(), old.workspace_id, tg_table_name, old.id, v_payload);
  return new;
end;
$$;

create trigger goals_capture_operation_before_image
before update on public.goals
for each row execute function public.capture_operation_before_image();
create trigger actions_capture_operation_before_image
before update on public.actions
for each row execute function public.capture_operation_before_image();
create trigger memories_capture_operation_before_image
before update on public.memories
for each row execute function public.capture_operation_before_image();

create or replace function public.claim_operation_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.undo_payload_json is null and new.operation_id in (
    'goal.update.v1', 'goal.status.v1',
    'action.update.v1', 'action.move.v1', 'action.status.v1',
    'memory.update.v1'
  ) then
    select payload_json into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = case new.target_type
        when 'goal' then 'goals'
        when 'action' then 'actions'
        when 'memory' then 'memories'
      end
      and target_id = new.target_id
    order by id desc
    limit 1;
  end if;
  delete from public.operation_before_images where transaction_id = txid_current();
  return new;
end;
$$;

create trigger operation_receipts_claim_before_image
before insert on public.operation_receipts
for each row execute function public.claim_operation_before_image();

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_base;

create or replace function public.execute_planning_snapshot_undo(
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
  if v_original_operation_id in (
    'goal.update.v1', 'goal.status.v1',
    'action.update.v1', 'action.move.v1', 'action.status.v1',
    'memory.update.v1'
  ) then
    return public.execute_planning_snapshot_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

create or replace function public.execute_assistant_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_proposal record;
  v_result jsonb;
  v_receipt_id uuid;
  v_undoable_receipt_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  select p.* into v_proposal
  from public.ai_proposals p
  join public.workspaces w on w.id = p.workspace_id and w.owner_user_id = v_user_id
  join public.operation_contracts contract
    on contract.operation_id = p.operation_id and 'chat' = any(contract.exposures)
  where p.id = p_proposal_id and p.status = 'pending'
  for update of p;
  if not found then
    raise exception using errcode = 'P0001', message = 'proposal_not_found';
  end if;

  v_result := public.dispatch_trusted_operation(
    v_proposal.operation_id,
    v_proposal.input_json,
    v_proposal.idempotency_key::text,
    'chat'
  );
  select id into v_receipt_id from public.operation_receipts
  where workspace_id = v_proposal.workspace_id
    and operation_id = v_proposal.operation_id
    and idempotency_key = v_proposal.idempotency_key::text
    and status = 'succeeded';
  if v_proposal.operation_id = any(array[
    'goal.create.v1', 'goal.update.v1', 'goal.status.v1',
    'action.create.v1', 'action.update.v1', 'action.move.v1', 'action.status.v1',
    'capture.create.v1', 'note.create.v1', 'note.update.v1', 'note.move.v1',
    'note.archive.v1', 'note.ai-exclusion.v1', 'memory.create.v1',
    'memory.update.v1', 'note.link.v1', 'note.goal-link.v1', 'note.action-link.v1'
  ]) then
    v_undoable_receipt_id := v_receipt_id;
  end if;
  update public.ai_proposals set
    status = 'applied', result_json = v_result,
    decided_at = clock_timestamp(), applied_at = clock_timestamp()
  where id = p_proposal_id;
  insert into public.conversation_messages (workspace_id, conversation_id, role, content)
  values (
    v_proposal.workspace_id, v_proposal.conversation_id,
    'assistant', 'Applied: ' || v_proposal.summary
  );
  return jsonb_build_object(
    'conversationId', v_proposal.conversation_id,
    'operationId', v_proposal.operation_id,
    'summary', v_proposal.summary,
    'result', v_result,
    'undoableReceiptId', v_undoable_receipt_id
  );
end;
$$;

revoke all on function public.capture_operation_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.claim_operation_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_planning_snapshot_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;

commit;
