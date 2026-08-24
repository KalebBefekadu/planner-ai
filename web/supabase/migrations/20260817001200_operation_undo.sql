begin;

alter table public.operation_receipts
  add column reverses_receipt_id uuid,
  add column reversed_by_receipt_id uuid,
  add column reversed_at timestamptz,
  add constraint operation_receipts_reverses_fk
    foreign key (reverses_receipt_id) references public.operation_receipts(id) on delete set null,
  add constraint operation_receipts_reversed_by_fk
    foreign key (reversed_by_receipt_id) references public.operation_receipts(id) on delete set null,
  add constraint operation_receipts_distinct_inverse check (
    reverses_receipt_id is null or reverses_receipt_id <> id
  );
create unique index operation_receipts_one_inverse_idx
on public.operation_receipts (reverses_receipt_id)
where reverses_receipt_id is not null;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible)
values ('operation.undo.v1', 'medium', array['ui'], false)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

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
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_original record;
  v_target_id uuid;
  v_expected_version integer;
  v_inverse_operation_id text;
  v_inverse_input jsonb;
  v_inverse_key text;
  v_inverse_receipt_id uuid;
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
    and contract.reversible
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;

  v_target_id := coalesce(v_original.target_id, (v_original.result_json ->> 'id')::uuid);
  v_expected_version := nullif(v_original.result_json ->> 'version', '')::integer;
  if v_original.operation_id = 'goal.create.v1' then
    if exists (
      select 1 from public.goals where workspace_id = v_workspace_id
        and parent_goal_id = v_target_id and trashed_at is null
    ) or exists (
      select 1 from public.actions where workspace_id = v_workspace_id
        and goal_id = v_target_id and trashed_at is null
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_inverse_operation_id := 'trash.move.v1';
    v_inverse_input := jsonb_build_object(
      'itemType', 'goal', 'id', v_target_id, 'expectedVersion', v_expected_version
    );
  elsif v_original.operation_id = 'action.create.v1' then
    if exists (
      select 1 from public.actions where workspace_id = v_workspace_id
        and parent_action_id = v_target_id and trashed_at is null
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_inverse_operation_id := 'trash.move.v1';
    v_inverse_input := jsonb_build_object(
      'itemType', 'action', 'id', v_target_id, 'expectedVersion', v_expected_version
    );
  elsif v_original.operation_id = 'capture.create.v1' then
    if exists (
      select 1 from public.captures where id = v_target_id and workspace_id = v_workspace_id
        and state <> 'new'
    ) or exists (
      select 1 from public.capture_note_links
      where capture_id = v_target_id and workspace_id = v_workspace_id
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_inverse_operation_id := 'trash.move.v1';
    v_inverse_input := jsonb_build_object('itemType', 'capture', 'id', v_target_id);
  elsif v_original.operation_id = 'note.create.v1' then
    if exists (
      select 1 from public.notes where workspace_id = v_workspace_id
        and parent_note_id = v_target_id and trashed_at is null
    ) or exists (
      select 1 from public.note_links where workspace_id = v_workspace_id
        and (source_note_id = v_target_id or target_note_id = v_target_id)
    ) or exists (
      select 1 from public.note_goal_links where workspace_id = v_workspace_id
        and note_id = v_target_id
    ) or exists (
      select 1 from public.note_action_links where workspace_id = v_workspace_id
        and note_id = v_target_id
    ) or exists (
      select 1 from public.capture_note_links where workspace_id = v_workspace_id
        and note_id = v_target_id
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_inverse_operation_id := 'trash.move.v1';
    v_inverse_input := jsonb_build_object(
      'itemType', 'note', 'id', v_target_id, 'expectedVersion', v_expected_version
    );
  elsif v_original.operation_id = 'memory.create.v1' then
    v_inverse_operation_id := 'trash.move.v1';
    v_inverse_input := jsonb_build_object(
      'itemType', 'memory', 'id', v_target_id, 'expectedVersion', v_expected_version
    );
  elsif v_original.operation_id = 'note.link.v1' then
    v_inverse_operation_id := 'note.unlink.v1';
    v_inverse_input := jsonb_build_object('linkId', v_original.result_json ->> 'id');
  elsif v_original.operation_id = 'note.goal-link.v1' then
    v_inverse_operation_id := 'note.goal-unlink.v1';
    v_inverse_input := jsonb_build_object(
      'noteId', v_original.result_json ->> 'noteId',
      'goalId', v_original.result_json ->> 'targetId'
    );
  elsif v_original.operation_id = 'note.action-link.v1' then
    v_inverse_operation_id := 'note.action-unlink.v1';
    v_inverse_input := jsonb_build_object(
      'noteId', v_original.result_json ->> 'noteId',
      'actionId', v_original.result_json ->> 'targetId'
    );
  else
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

  v_inverse_key := 'inverse:' || v_original.id::text;
  perform public.dispatch_trusted_operation(
    v_inverse_operation_id, v_inverse_input, v_inverse_key, 'ui'
  );
  select id into v_inverse_receipt_id from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = v_inverse_operation_id
    and idempotency_key = v_inverse_key and status = 'succeeded';
  if v_inverse_receipt_id is null then
    raise exception using errcode = 'P0001', message = 'undo_inverse_missing';
  end if;

  v_result := jsonb_build_object(
    'originalReceiptId', v_original.id,
    'undoReceiptId', extensions.gen_random_uuid(),
    'status', 'undone'
  );
  v_undo_receipt_id := (v_result ->> 'undoReceiptId')::uuid;
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
  if p_operation_id = 'operation.undo.v1' then
    v_result := public.execute_operation_undo(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('goal.update.v1', 'action.move.v1') then
    v_result := public.execute_plan_edit_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'account.%' then
    v_result := public.execute_account_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('action.update.v1', 'action.status.v1', 'daily-focus.set.v1') then
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
    'goal.create.v1', 'action.create.v1', 'capture.create.v1',
    'note.create.v1', 'memory.create.v1', 'note.link.v1',
    'note.goal-link.v1', 'note.action-link.v1'
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

revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;

commit;
