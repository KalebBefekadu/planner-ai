begin;

create or replace function public.execute_knowledge_operation(
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
  v_note_id uuid;
  v_source_id uuid;
  v_target_id uuid;
  v_link_id uuid;
  v_capture_id uuid;
  v_relation_type text;
  v_result jsonb;
  v_link record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
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
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  if p_operation_id = 'note.tags.set.v1' then
    v_note_id := (p_input ->> 'noteId')::uuid;
    if jsonb_typeof(p_input -> 'tags') <> 'array'
      or jsonb_array_length(p_input -> 'tags') > 20
      or exists (
        select 1 from jsonb_array_elements_text(p_input -> 'tags') value
        where char_length(trim(value)) not between 1 and 80
      ) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    perform 1 from public.notes
    where id = v_note_id and workspace_id = v_workspace_id
      and archived_at is null and trashed_at is null;
    if not found then raise exception using errcode = 'P0001', message = 'note_not_found'; end if;

    delete from public.note_tags where workspace_id = v_workspace_id and note_id = v_note_id;
    insert into public.tags (workspace_id, name, normalized_name)
    select v_workspace_id, normalized_name, normalized_name
    from (
      select distinct lower(trim(value)) as normalized_name
      from jsonb_array_elements_text(p_input -> 'tags') value
    ) normalized
    on conflict (workspace_id, normalized_name) do update set name = excluded.name;
    insert into public.note_tags (workspace_id, note_id, tag_id)
    select v_workspace_id, v_note_id, id from public.tags
    where workspace_id = v_workspace_id
      and normalized_name in (
        select lower(trim(value)) from jsonb_array_elements_text(p_input -> 'tags') value
      );
    delete from public.tags tag
    where tag.workspace_id = v_workspace_id
      and not exists (
        select 1 from public.note_tags note_tag
        where note_tag.workspace_id = tag.workspace_id and note_tag.tag_id = tag.id
      );
    select jsonb_build_object(
      'noteId', v_note_id,
      'tags', coalesce(jsonb_agg(tag.name order by tag.name), '[]'::jsonb)
    ) into v_result
    from public.note_tags note_tag
    join public.tags tag on tag.id = note_tag.tag_id and tag.workspace_id = note_tag.workspace_id
    where note_tag.workspace_id = v_workspace_id and note_tag.note_id = v_note_id;
    v_target_id := v_note_id;

  elsif p_operation_id = 'note.link.v1' then
    v_source_id := (p_input ->> 'sourceNoteId')::uuid;
    v_target_id := (p_input ->> 'targetNoteId')::uuid;
    v_relation_type := p_input ->> 'relationType';
    if v_source_id = v_target_id
      or v_relation_type not in ('related', 'supports', 'contradicts', 'continues')
      or (select count(*) from public.notes where workspace_id = v_workspace_id
        and id in (v_source_id, v_target_id) and archived_at is null and trashed_at is null) <> 2 then
      raise exception using errcode = 'P0001', message = 'invalid_note_link';
    end if;
    insert into public.note_links (
      workspace_id, source_note_id, target_note_id, relation_type
    ) values (
      v_workspace_id, v_source_id, v_target_id, v_relation_type
    )
    on conflict (workspace_id, source_note_id, target_note_id, relation_type)
    do update set relation_type = excluded.relation_type
    returning id into v_link_id;
    v_result := jsonb_build_object(
      'id', v_link_id,
      'sourceNoteId', v_source_id,
      'targetNoteId', v_target_id,
      'relationType', v_relation_type
    );
    v_target_id := v_source_id;

  elsif p_operation_id = 'note.unlink.v1' then
    v_link_id := (p_input ->> 'linkId')::uuid;
    delete from public.note_links
    where id = v_link_id and workspace_id = v_workspace_id
    returning id, source_note_id, target_note_id, relation_type into v_link;
    if not found then raise exception using errcode = 'P0001', message = 'note_link_not_found'; end if;
    v_result := jsonb_build_object(
      'id', v_link.id,
      'sourceNoteId', v_link.source_note_id,
      'targetNoteId', v_link.target_note_id,
      'relationType', v_link.relation_type
    );
    v_target_id := v_link.source_note_id;

  elsif p_operation_id = 'capture.file-to-note.v1' then
    v_capture_id := (p_input ->> 'captureId')::uuid;
    v_note_id := (p_input ->> 'noteId')::uuid;
    perform 1 from public.captures
    where id = v_capture_id and workspace_id = v_workspace_id
      and archived_at is null and trashed_at is null;
    if not found then raise exception using errcode = 'P0001', message = 'capture_not_found'; end if;
    perform 1 from public.notes
    where id = v_note_id and workspace_id = v_workspace_id
      and archived_at is null and trashed_at is null;
    if not found then raise exception using errcode = 'P0001', message = 'note_not_found'; end if;
    insert into public.capture_note_links (workspace_id, capture_id, note_id)
    values (v_workspace_id, v_capture_id, v_note_id)
    on conflict (workspace_id, capture_id, note_id) do nothing;
    update public.captures set state = 'reviewed'
    where id = v_capture_id and workspace_id = v_workspace_id;
    v_result := jsonb_build_object(
      'captureId', v_capture_id, 'noteId', v_note_id, 'state', 'reviewed'
    );
    v_target_id := v_capture_id;
  end if;

  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' when p_surface = 'mcp' then 'automation' else 'user' end,
    p_surface, p_idempotency_key, 'low',
    case when p_operation_id like 'capture.%' then 'capture' else 'note' end,
    v_target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' when p_surface = 'mcp' then 'automation' else 'user' end,
    p_surface, p_operation_id,
    case when p_operation_id like 'capture.%' then 'capture' else 'note' end,
    v_target_id, 'low', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.execute_knowledge_operation(text, jsonb, text, text) from public, anon;
grant execute on function public.execute_knowledge_operation(text, jsonb, text, text) to authenticated;

create or replace function public.create_mcp_access_token(
  p_token_hash text,
  p_name text,
  p_allowed_operations text[],
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_id uuid;
  v_allowed_catalog constant text[] := array[
    'workspace.snapshot.read.v1',
    'vision.upsert.v1', 'goal.create.v1', 'goal.status.v1', 'goal.archive.v1',
    'action.create.v1', 'action.status.v1', 'action.archive.v1', 'capture.create.v1',
    'note.create.v1', 'note.update.v1', 'note.move.v1', 'note.archive.v1',
    'note.ai-exclusion.v1', 'memory.create.v1', 'memory.update.v1',
    'trash.move.v1', 'trash.restore.v1',
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ];
begin
  if v_user_id is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'aal2_required';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or char_length(trim(p_name)) not between 1 and 120
    or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp() + interval '90 days'
    or coalesce(cardinality(p_allowed_operations), 0) not between 1 and 50
    or array_position(p_allowed_operations, null) is not null
    or exists (select 1 from unnest(p_allowed_operations) op where not (op = any(v_allowed_catalog))) then
    raise exception using errcode = 'P0001', message = 'invalid_mcp_grant';
  end if;
  insert into public.workspaces (owner_user_id) values (v_user_id)
  on conflict (owner_user_id) do nothing;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  insert into public.mcp_access_tokens (
    workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
  ) values (
    v_workspace_id, v_user_id, p_token_hash, trim(p_name), p_allowed_operations, p_expires_at
  ) returning id into v_id;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', 'ui', 'mcp.token.create.v1',
    'mcp_access_token', v_id, 'high', 'succeeded'
  );
  return v_id;
end;
$$;

create or replace function public.execute_mcp_operation(
  p_token_id uuid,
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token record;
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
begin
  select id as token_id, workspace_id, owner_user_id, allowed_operations
  into v_token from public.mcp_access_tokens
  where id = p_token_id and revoked_at is null and expires_at > clock_timestamp();
  if not found then raise exception using errcode = '28000', message = 'invalid_or_limited_mcp_token'; end if;
  if not (p_operation_id = any(v_token.allowed_operations)) then
    raise exception using errcode = '42501', message = 'operation_not_granted';
  end if;
  perform set_config('request.jwt.claim.sub', v_token.owner_user_id::text, true);
  if p_operation_id in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ) then
    v_result := public.execute_knowledge_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  elsif p_operation_id like 'note.%' then
    v_result := public.execute_note_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  elsif p_operation_id like 'memory.%' then
    v_result := public.execute_memory_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  elsif p_operation_id like 'trash.%' then
    v_result := public.execute_trash_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  else
    v_result := public.execute_planner_operation(p_operation_id, p_input, p_idempotency_key, 'mcp');
  end if;
  perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
  return v_result;
end;
$$;

create or replace function public.record_assistant_turn(
  p_conversation_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_route text,
  p_proposal jsonb,
  p_model_id text,
  p_prompt_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_conversation_id uuid := p_conversation_id;
  v_proposal_id uuid;
  v_operation_id text;
  v_risk text;
  v_allowed_catalog constant text[] := array[
    'vision.upsert.v1', 'goal.create.v1', 'goal.status.v1', 'goal.archive.v1',
    'action.create.v1', 'action.status.v1', 'action.archive.v1', 'capture.create.v1',
    'note.create.v1', 'note.update.v1', 'note.move.v1', 'note.archive.v1',
    'note.ai-exclusion.v1', 'memory.create.v1', 'memory.update.v1',
    'trash.move.v1', 'trash.restore.v1', 'trash.empty.v1',
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ];
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  if char_length(p_user_content) not between 1 and 4000
    or char_length(p_assistant_content) not between 1 and 4000
    or p_route !~ '^/' or char_length(p_route) > 200
    or char_length(p_model_id) not between 1 and 120
    or char_length(p_prompt_version) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'invalid_assistant_turn';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then raise exception using errcode = 'P0001', message = 'workspace_not_found'; end if;
  if v_conversation_id is null then
    insert into public.conversations (workspace_id, title)
    values (v_workspace_id, left(p_user_content, 80)) returning id into v_conversation_id;
  else
    perform 1 from public.conversations
    where id = v_conversation_id and workspace_id = v_workspace_id and trashed_at is null;
    if not found then raise exception using errcode = '42501', message = 'conversation_not_found'; end if;
  end if;
  insert into public.conversation_messages (workspace_id, conversation_id, role, content, route)
  values
    (v_workspace_id, v_conversation_id, 'user', p_user_content, p_route),
    (v_workspace_id, v_conversation_id, 'assistant', p_assistant_content, p_route);
  if p_proposal is not null and p_proposal <> 'null'::jsonb then
    v_operation_id := p_proposal ->> 'operationId';
    if not (v_operation_id = any(v_allowed_catalog))
      or jsonb_typeof(p_proposal -> 'input') <> 'object'
      or char_length(coalesce(p_proposal ->> 'summary', '')) not between 1 and 300 then
      raise exception using errcode = 'P0001', message = 'invalid_assistant_proposal';
    end if;
    v_risk := case
      when v_operation_id = 'trash.empty.v1' then 'high'
      when v_operation_id in (
        'goal.archive.v1', 'action.archive.v1', 'note.archive.v1', 'trash.move.v1'
      ) then 'medium'
      else 'low'
    end;
    insert into public.ai_proposals (
      workspace_id, conversation_id, operation_id, input_json, summary,
      risk_class, model_id, prompt_version
    ) values (
      v_workspace_id, v_conversation_id, v_operation_id, p_proposal -> 'input',
      p_proposal ->> 'summary', v_risk, p_model_id, p_prompt_version
    ) returning id into v_proposal_id;
  end if;
  update public.conversations set updated_at = clock_timestamp() where id = v_conversation_id;
  return jsonb_build_object('conversationId', v_conversation_id, 'proposalId', v_proposal_id);
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
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  select p.* into v_proposal
  from public.ai_proposals p
  join public.workspaces w on w.id = p.workspace_id and w.owner_user_id = v_user_id
  where p.id = p_proposal_id and p.status = 'pending'
  for update of p;
  if not found then raise exception using errcode = 'P0001', message = 'proposal_not_found'; end if;
  if v_proposal.operation_id in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ) then
    v_result := public.execute_knowledge_operation(
      v_proposal.operation_id, v_proposal.input_json, v_proposal.idempotency_key::text, 'chat'
    );
  elsif v_proposal.operation_id like 'note.%' then
    v_result := public.execute_note_operation(
      v_proposal.operation_id, v_proposal.input_json, v_proposal.idempotency_key::text, 'chat'
    );
  elsif v_proposal.operation_id like 'memory.%' then
    v_result := public.execute_memory_operation(
      v_proposal.operation_id, v_proposal.input_json, v_proposal.idempotency_key::text, 'chat'
    );
  elsif v_proposal.operation_id like 'trash.%' then
    v_result := public.execute_trash_operation(
      v_proposal.operation_id, v_proposal.input_json, v_proposal.idempotency_key::text, 'chat'
    );
  else
    v_result := public.execute_planner_operation(
      v_proposal.operation_id, v_proposal.input_json, v_proposal.idempotency_key::text, 'chat'
    );
  end if;
  update public.ai_proposals
  set status = 'applied', result_json = v_result, decided_at = clock_timestamp(),
    applied_at = clock_timestamp()
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
    'result', v_result
  );
end;
$$;

revoke all on function public.create_mcp_access_token(text, text, text[], timestamptz) from public, anon;
grant execute on function public.create_mcp_access_token(text, text, text[], timestamptz) to authenticated;
revoke all on function public.execute_mcp_operation(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.execute_mcp_operation(uuid, text, jsonb, text) to service_role;
revoke all on function public.record_assistant_turn(uuid, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.record_assistant_turn(uuid, text, text, text, jsonb, text, text) to authenticated;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;

commit;
