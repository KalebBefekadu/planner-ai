begin;

create table public.operation_undo_support (
  operation_id text primary key references public.operation_contracts(operation_id) on delete cascade,
  strategy text not null check (strategy in ('trash-create', 'snapshot', 'inverse-operation')),
  created_at timestamptz not null default now()
);
alter table public.operation_undo_support enable row level security;
alter table public.operation_undo_support force row level security;
revoke all on public.operation_undo_support from public, anon, authenticated;

insert into public.operation_undo_support (operation_id, strategy) values
  ('goal.create.v1', 'trash-create'),
  ('goal.update.v1', 'snapshot'),
  ('goal.status.v1', 'snapshot'),
  ('action.create.v1', 'trash-create'),
  ('action.update.v1', 'snapshot'),
  ('action.move.v1', 'snapshot'),
  ('action.status.v1', 'snapshot'),
  ('daily-focus.set.v1', 'snapshot'),
  ('capture.create.v1', 'trash-create'),
  ('note.create.v1', 'trash-create'),
  ('note.update.v1', 'snapshot'),
  ('note.move.v1', 'snapshot'),
  ('note.archive.v1', 'snapshot'),
  ('note.ai-exclusion.v1', 'snapshot'),
  ('note.tags.set.v1', 'inverse-operation'),
  ('note.link.v1', 'inverse-operation'),
  ('note.unlink.v1', 'inverse-operation'),
  ('note.goal-link.v1', 'inverse-operation'),
  ('note.goal-unlink.v1', 'inverse-operation'),
  ('note.action-link.v1', 'inverse-operation'),
  ('note.action-unlink.v1', 'inverse-operation'),
  ('memory.create.v1', 'trash-create'),
  ('memory.update.v1', 'snapshot'),
  ('workspace.preferences.v1', 'snapshot'),
  ('workspace.ai-budget.v1', 'snapshot');

create or replace function public.capture_note_metadata_before_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_payload jsonb;
begin
  if tg_table_name = 'note_tags' then
    select jsonb_build_object('noteId', old.note_id, 'tag', tag.name)
    into v_payload
    from public.tags tag
    where tag.id = old.tag_id and tag.workspace_id = old.workspace_id;
  elsif tg_table_name = 'note_goal_links' then
    v_payload := jsonb_build_object('noteId', old.note_id, 'goalId', old.goal_id);
  elsif tg_table_name = 'note_action_links' then
    v_payload := jsonb_build_object('noteId', old.note_id, 'actionId', old.action_id);
  else
    return old;
  end if;
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (txid_current(), old.workspace_id, tg_table_name, old.note_id, v_payload);
  return old;
end;
$$;

create trigger note_tags_capture_before_delete
before delete on public.note_tags
for each row execute function public.capture_note_metadata_before_delete();
create trigger note_goal_links_capture_before_delete
before delete on public.note_goal_links
for each row execute function public.capture_note_metadata_before_delete();
create trigger note_action_links_capture_before_delete
before delete on public.note_action_links
for each row execute function public.capture_note_metadata_before_delete();

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
  elsif new.undo_payload_json is null and new.operation_id = 'note.tags.set.v1' then
    select jsonb_build_object(
      'tags', coalesce(jsonb_agg(payload_json ->> 'tag' order by payload_json ->> 'tag')
        filter (where payload_json is not null), '[]'::jsonb)
    ) into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = 'note_tags'
      and target_id = new.target_id;
  elsif new.undo_payload_json is null and new.operation_id in (
    'note.goal-unlink.v1', 'note.action-unlink.v1'
  ) then
    select payload_json into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = case new.operation_id
        when 'note.goal-unlink.v1' then 'note_goal_links'
        else 'note_action_links'
      end
      and target_id = new.target_id
    order by id desc
    limit 1;
    if new.undo_payload_json is null then
      raise exception using errcode = 'P0001', message = 'relation_not_found';
    end if;
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
rename to execute_operation_undo_workspace_base;

create or replace function public.execute_note_metadata_undo(
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
  v_current_tags jsonb;
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
  join public.operation_undo_support support on support.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.operation_id in (
      'note.tags.set.v1', 'note.unlink.v1',
      'note.goal-unlink.v1', 'note.action-unlink.v1'
    )
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;

  if v_original.operation_id = 'note.tags.set.v1' then
    if v_original.undo_payload_json is null then
      raise exception using errcode = 'P0001', message = 'undo_not_supported';
    end if;
    select coalesce(jsonb_agg(tag.name order by tag.name), '[]'::jsonb)
    into v_current_tags
    from public.note_tags note_tag
    join public.tags tag on tag.id = note_tag.tag_id and tag.workspace_id = note_tag.workspace_id
    where note_tag.workspace_id = v_workspace_id
      and note_tag.note_id = (v_original.result_json ->> 'noteId')::uuid;
    if v_current_tags is distinct from v_original.result_json -> 'tags' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_inverse_operation_id := 'note.tags.set.v1';
    v_inverse_input := jsonb_build_object(
      'noteId', v_original.result_json ->> 'noteId',
      'tags', v_original.undo_payload_json -> 'tags'
    );
  elsif v_original.operation_id = 'note.unlink.v1' then
    if exists (
      select 1 from public.note_links
      where workspace_id = v_workspace_id
        and source_note_id = (v_original.result_json ->> 'sourceNoteId')::uuid
        and target_note_id = (v_original.result_json ->> 'targetNoteId')::uuid
        and relation_type = v_original.result_json ->> 'relationType'
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_inverse_operation_id := 'note.link.v1';
    v_inverse_input := jsonb_build_object(
      'sourceNoteId', v_original.result_json ->> 'sourceNoteId',
      'targetNoteId', v_original.result_json ->> 'targetNoteId',
      'relationType', v_original.result_json ->> 'relationType'
    );
  elsif v_original.operation_id = 'note.goal-unlink.v1' then
    if v_original.undo_payload_json is null or exists (
      select 1 from public.note_goal_links
      where workspace_id = v_workspace_id
        and note_id = (v_original.result_json ->> 'noteId')::uuid
        and goal_id = (v_original.result_json ->> 'targetId')::uuid
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_inverse_operation_id := 'note.goal-link.v1';
    v_inverse_input := jsonb_build_object(
      'noteId', v_original.result_json ->> 'noteId',
      'goalId', v_original.result_json ->> 'targetId'
    );
  else
    if v_original.undo_payload_json is null or exists (
      select 1 from public.note_action_links
      where workspace_id = v_workspace_id
        and note_id = (v_original.result_json ->> 'noteId')::uuid
        and action_id = (v_original.result_json ->> 'targetId')::uuid
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_inverse_operation_id := 'note.action-link.v1';
    v_inverse_input := jsonb_build_object(
      'noteId', v_original.result_json ->> 'noteId',
      'actionId', v_original.result_json ->> 'targetId'
    );
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
  if v_original_operation_id in (
    'note.tags.set.v1', 'note.unlink.v1',
    'note.goal-unlink.v1', 'note.action-unlink.v1'
  ) then
    return public.execute_note_metadata_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_workspace_base(
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
  if exists (
    select 1 from public.operation_undo_support
    where operation_id = v_proposal.operation_id
  ) then
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

revoke all on function public.capture_note_metadata_before_delete()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_workspace_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_note_metadata_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;

commit;
