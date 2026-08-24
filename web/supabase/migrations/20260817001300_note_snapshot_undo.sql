begin;

alter table public.operation_receipts
  add column undo_payload_json jsonb;

create or replace function public.execute_note_operation(
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
  v_target_id uuid;
  v_parent_id uuid;
  v_expected_version bigint;
  v_receipt_id uuid;
  v_result jsonb;
  v_undo_payload jsonb;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'note.create.v1', 'note.update.v1', 'note.move.v1',
    'note.archive.v1', 'note.ai-exclusion.v1'
  ) then
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
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0));

  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;
  v_receipt_id := extensions.gen_random_uuid();

  if p_operation_id = 'note.create.v1' then
    v_parent_id := nullif(p_input ->> 'parentNoteId', '')::uuid;
    if char_length(p_input ->> 'title') not between 1 and 300
      or char_length(coalesce(p_input ->> 'bodyMarkdown', '')) > 500000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if v_parent_id is not null and not exists (
      select 1 from public.notes where id = v_parent_id and workspace_id = v_workspace_id
        and archived_at is null and trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'parent_not_found';
    end if;
    insert into public.notes (workspace_id, parent_note_id, title, body_markdown, sort_key)
    values (
      v_workspace_id, v_parent_id, p_input ->> 'title', coalesce(p_input ->> 'bodyMarkdown', ''),
      coalesce((select max(sort_key) + 1000 from public.notes where workspace_id = v_workspace_id and parent_note_id is not distinct from v_parent_id), 1000)
    ) returning * into v_row;

  elsif p_operation_id = 'note.update.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if char_length(p_input ->> 'title') not between 1 and 300
      or char_length(coalesce(p_input ->> 'bodyMarkdown', '')) > 500000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select * into v_row from public.notes where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    v_undo_payload := jsonb_build_object(
      'title', v_row.title,
      'bodyMarkdown', v_row.body_markdown
    );
    if v_row.title is distinct from (p_input ->> 'title')
      or v_row.body_markdown is distinct from coalesce(p_input ->> 'bodyMarkdown', '') then
      insert into public.note_revisions (
        workspace_id, note_id, title, body_markdown, source_version,
        author_user_id, surface, operation_receipt_id
      ) values (
        v_workspace_id, v_target_id, v_row.title, v_row.body_markdown,
        v_row.version, v_user_id, p_surface, v_receipt_id
      );
    end if;
    update public.notes set
      title = p_input ->> 'title', body_markdown = coalesce(p_input ->> 'bodyMarkdown', ''),
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;

  elsif p_operation_id = 'note.move.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_parent_id := nullif(p_input ->> 'parentNoteId', '')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if v_target_id = v_parent_id then
      raise exception using errcode = 'P0001', message = 'invalid_note_parent';
    end if;
    if v_parent_id is not null and exists (
      with recursive descendants as (
        select id from public.notes where id = v_target_id and workspace_id = v_workspace_id
        union all
        select n.id from public.notes n join descendants d on n.parent_note_id = d.id
        where n.workspace_id = v_workspace_id
      ) select 1 from descendants where id = v_parent_id
    ) then
      raise exception using errcode = 'P0001', message = 'note_cycle';
    end if;
    select jsonb_build_object(
      'parentNoteId', parent_note_id,
      'sortKey', sort_key
    ) into v_undo_payload
    from public.notes where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null for update;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;
    update public.notes set
      parent_note_id = v_parent_id, sort_key = (p_input ->> 'sortKey')::numeric,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;

  elsif p_operation_id = 'note.archive.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select jsonb_build_object('archivedAt', archived_at) into v_undo_payload
    from public.notes where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null for update;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;
    update public.notes set archived_at = clock_timestamp(), version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;

  elsif p_operation_id = 'note.ai-exclusion.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select jsonb_build_object('aiExcluded', ai_excluded) into v_undo_payload
    from public.notes where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null for update;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;
    update public.notes set
      ai_excluded = (p_input ->> 'aiExcluded')::boolean, version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;
  end if;

  v_target_id := v_row.id;
  v_result := to_jsonb(v_row);
  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json,
    undo_payload_json
  ) values (
    v_receipt_id, v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key,
    case when p_operation_id = 'note.archive.v1' then 'medium' else 'low' end,
    'note', v_target_id, 'succeeded', v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'note', v_target_id,
    case when p_operation_id = 'note.archive.v1' then 'medium' else 'low' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
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
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_original record;
  v_current_note record;
  v_target_id uuid;
  v_expected_version bigint;
  v_inverse_operation_id text;
  v_inverse_input jsonb;
  v_inverse_key text;
  v_inverse_receipt_id uuid;
  v_undo_receipt_id uuid;
  v_direct_inverse boolean := false;
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
  v_expected_version := nullif(v_original.result_json ->> 'version', '')::bigint;
  v_undo_receipt_id := extensions.gen_random_uuid();

  if v_original.operation_id in (
    'note.update.v1', 'note.move.v1', 'note.archive.v1', 'note.ai-exclusion.v1'
  ) then
    if v_original.undo_payload_json is null then
      raise exception using errcode = 'P0001', message = 'undo_not_supported';
    end if;
    select * into v_current_note from public.notes
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

    if v_original.operation_id = 'note.update.v1' then
      insert into public.note_revisions (
        workspace_id, note_id, title, body_markdown, source_version,
        author_user_id, surface, operation_receipt_id
      ) values (
        v_workspace_id, v_target_id, v_current_note.title, v_current_note.body_markdown,
        v_current_note.version, v_user_id, p_surface, v_undo_receipt_id
      );
      update public.notes set
        title = v_original.undo_payload_json ->> 'title',
        body_markdown = v_original.undo_payload_json ->> 'bodyMarkdown',
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    elsif v_original.operation_id = 'note.move.v1' then
      if nullif(v_original.undo_payload_json ->> 'parentNoteId', '')::uuid is not null
        and exists (
          with recursive descendants as (
            select id from public.notes where id = v_target_id and workspace_id = v_workspace_id
            union all
            select n.id from public.notes n join descendants d on n.parent_note_id = d.id
            where n.workspace_id = v_workspace_id
          )
          select 1 from descendants
          where id = nullif(v_original.undo_payload_json ->> 'parentNoteId', '')::uuid
        ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      update public.notes set
        parent_note_id = nullif(v_original.undo_payload_json ->> 'parentNoteId', '')::uuid,
        sort_key = (v_original.undo_payload_json ->> 'sortKey')::numeric,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    elsif v_original.operation_id = 'note.archive.v1' then
      update public.notes set
        archived_at = nullif(v_original.undo_payload_json ->> 'archivedAt', '')::timestamptz,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    else
      update public.notes set
        ai_excluded = (v_original.undo_payload_json ->> 'aiExcluded')::boolean,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    end if;
    v_direct_inverse := true;

  elsif v_original.operation_id = 'goal.create.v1' then
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

  if not v_direct_inverse then
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
    'note.create.v1', 'note.update.v1', 'note.move.v1', 'note.archive.v1',
    'note.ai-exclusion.v1', 'memory.create.v1', 'note.link.v1',
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

revoke all on function public.execute_note_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;

commit;
