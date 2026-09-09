-- Favouriting a Note had no representation at all: nothing in the schema, no
-- Operation, and so no way to mark the handful of pages someone returns to
-- daily. Reaching them meant walking the tree or searching by name every time.
--
-- A favourite is stored as the instant it was marked rather than a flag, so the
-- list has an order that means something -- most recently marked first -- and so
-- Undo can restore the exact prior instant instead of guessing one. Writes go
-- through the same versioned Operation path as every other Note change, which
-- is what makes a favourite survive a conflict, appear in Activity, and undo.

begin;

alter table public.notes add column favorited_at timestamptz;

-- The sidebar reads favourites on every render of the Notes page; the partial
-- index keeps that read proportional to the favourites, not to the workspace.
create index notes_favorited_at_idx
  on public.notes (workspace_id, favorited_at desc)
  where favorited_at is not null;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible)
values ('note.favorite.v1', 'low', array['ui', 'chat', 'mcp'], true);

insert into public.operation_undo_support (operation_id, strategy)
values ('note.favorite.v1', 'snapshot');

CREATE OR REPLACE FUNCTION public.execute_note_operation(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text DEFAULT 'ui'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    'note.archive.v1', 'note.ai-exclusion.v1', 'note.favorite.v1'
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

  elsif p_operation_id = 'note.favorite.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    -- The prior instant, not merely the prior boolean, is what Undo restores.
    -- Re-favouriting a Note otherwise moved it to the top of the list, so an
    -- Undo would have silently reordered favourites it was asked to leave alone.
    select jsonb_build_object('favoritedAt', favorited_at) into v_undo_payload
    from public.notes where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null for update;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;
    update public.notes set
      favorited_at = case
        when (p_input ->> 'favorite')::boolean
          then coalesce(favorited_at, clock_timestamp())
        else null
      end,
      version = version + 1
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
$function$;

CREATE OR REPLACE FUNCTION public.execute_operation_undo_base(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    'note.update.v1', 'note.move.v1', 'note.archive.v1', 'note.ai-exclusion.v1',
    'note.favorite.v1'
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
    elsif v_original.operation_id = 'note.ai-exclusion.v1' then
      update public.notes set
        ai_excluded = (v_original.undo_payload_json ->> 'aiExcluded')::boolean,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    else
      update public.notes set
        favorited_at = nullif(v_original.undo_payload_json ->> 'favoritedAt', '')::timestamptz,
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
$function$;

commit;
