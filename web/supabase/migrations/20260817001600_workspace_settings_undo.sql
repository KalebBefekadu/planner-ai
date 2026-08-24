begin;

create or replace function public.capture_workspace_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), old.id, 'workspaces', old.id,
    jsonb_build_object(
      'timezone', old.timezone,
      'weekStartsOn', old.week_starts_on,
      'coachingIntensity', old.coaching_intensity,
      'aiEnabled', old.ai_enabled,
      'weeklyReviewDay', old.weekly_review_day,
      'softBudgetCents', old.ai_soft_budget_cents
    )
  );
  return new;
end;
$$;

create trigger workspaces_capture_operation_before_image
before update on public.workspaces
for each row execute function public.capture_workspace_before_image();

create or replace function public.claim_operation_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.undo_payload_json is null and new.operation_id = 'daily-focus.set.v1' then
    select jsonb_build_object(
      'focusOn', new.result_json ->> 'focusOn',
      'items', coalesce(jsonb_agg(payload_json order by (payload_json ->> 'sortOrder')::smallint)
        filter (where payload_json is not null), '[]'::jsonb)
    ) into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = 'daily_focus'
      and payload_json ->> 'focusOn' = new.result_json ->> 'focusOn';
  elsif new.undo_payload_json is null and new.operation_id in (
    'goal.update.v1', 'goal.status.v1',
    'action.update.v1', 'action.move.v1', 'action.status.v1',
    'memory.update.v1', 'workspace.preferences.v1', 'workspace.ai-budget.v1'
  ) then
    select payload_json into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = case new.target_type
        when 'goal' then 'goals'
        when 'action' then 'actions'
        when 'memory' then 'memories'
        when 'workspace' then 'workspaces'
      end
      and target_id = new.target_id
    order by id desc
    limit 1;
  end if;
  delete from public.operation_before_images where transaction_id = txid_current();
  return new;
end;
$$;

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_focus_base;

create or replace function public.execute_workspace_settings_undo(
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
  v_workspace record;
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
    and receipt.operation_id in ('workspace.preferences.v1', 'workspace.ai-budget.v1')
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
    and contract.reversible
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  if v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

  select * into v_workspace from public.workspaces
  where id = v_workspace_id for update;
  if v_original.operation_id = 'workspace.preferences.v1' then
    if v_workspace.timezone is distinct from v_original.result_json ->> 'timezone'
      or v_workspace.week_starts_on is distinct from
        (v_original.result_json ->> 'weekStartsOn')::smallint
      or v_workspace.coaching_intensity is distinct from
        v_original.result_json ->> 'coachingIntensity'
      or v_workspace.ai_enabled is distinct from
        (v_original.result_json ->> 'aiEnabled')::boolean
      or v_workspace.weekly_review_day is distinct from
        (v_original.result_json ->> 'weeklyReviewDay')::smallint then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    update public.workspaces set
      timezone = v_original.undo_payload_json ->> 'timezone',
      week_starts_on = (v_original.undo_payload_json ->> 'weekStartsOn')::smallint,
      coaching_intensity = v_original.undo_payload_json ->> 'coachingIntensity',
      ai_enabled = (v_original.undo_payload_json ->> 'aiEnabled')::boolean,
      weekly_review_day = (v_original.undo_payload_json ->> 'weeklyReviewDay')::smallint
    where id = v_workspace_id;
  else
    if v_workspace.ai_soft_budget_cents is distinct from
      (v_original.result_json ->> 'softBudgetCents')::integer then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    update public.workspaces set
      ai_soft_budget_cents = (v_original.undo_payload_json ->> 'softBudgetCents')::integer
    where id = v_workspace_id;
  end if;

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
  if v_original_operation_id in ('workspace.preferences.v1', 'workspace.ai-budget.v1') then
    return public.execute_workspace_settings_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_focus_base(
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
    'daily-focus.set.v1', 'capture.create.v1', 'note.create.v1', 'note.update.v1',
    'note.move.v1', 'note.archive.v1', 'note.ai-exclusion.v1', 'memory.create.v1',
    'memory.update.v1', 'note.link.v1', 'note.goal-link.v1', 'note.action-link.v1',
    'workspace.preferences.v1', 'workspace.ai-budget.v1'
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

revoke all on function public.capture_workspace_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_focus_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_workspace_settings_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;

commit;
