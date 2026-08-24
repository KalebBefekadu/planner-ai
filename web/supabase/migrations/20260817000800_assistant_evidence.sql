begin;

drop function if exists public.record_assistant_turn(uuid, text, text, text, jsonb, text, text);

create function public.record_assistant_turn(
  p_conversation_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_route text,
  p_proposal jsonb,
  p_model_id text,
  p_prompt_version text,
  p_sources jsonb
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
  v_source record;
  v_label text;
  v_href text;
  v_sources jsonb := '[]'::jsonb;
  v_seen text[] := array[]::text[];
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if char_length(p_user_content) not between 1 and 4000
    or char_length(p_assistant_content) not between 1 and 4000
    or p_route !~ '^/' or char_length(p_route) > 200
    or char_length(p_model_id) not between 1 and 120
    or char_length(p_prompt_version) not between 1 and 80
    or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) > 8 then
    raise exception using errcode = 'P0001', message = 'invalid_assistant_turn';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_not_found';
  end if;

  for v_source in
    select source.type, source.id
    from jsonb_to_recordset(p_sources) as source(type text, id uuid)
  loop
    if v_source.type not in ('vision', 'goal', 'action', 'note', 'memory')
      or v_source.type || ':' || v_source.id::text = any(v_seen) then
      continue;
    end if;
    v_label := null;
    v_href := null;
    if v_source.type = 'vision' then
      select 'Vision', '/vision' into v_label, v_href
      from public.visions where id = v_source.id and workspace_id = v_workspace_id
        and archived_at is null and trashed_at is null;
    elsif v_source.type = 'goal' then
      select title, '/goals' into v_label, v_href
      from public.goals where id = v_source.id and workspace_id = v_workspace_id
        and archived_at is null and trashed_at is null;
    elsif v_source.type = 'action' then
      select title, '/' into v_label, v_href
      from public.actions where id = v_source.id and workspace_id = v_workspace_id
        and archived_at is null and trashed_at is null;
    elsif v_source.type = 'note' then
      select title, '/notes?note=' || id::text into v_label, v_href
      from public.notes where id = v_source.id and workspace_id = v_workspace_id
        and ai_excluded = false and archived_at is null and trashed_at is null;
    elsif v_source.type = 'memory' then
      select left(statement, 120), '/settings/memory' into v_label, v_href
      from public.memories where id = v_source.id and workspace_id = v_workspace_id
        and trashed_at is null;
    end if;
    if v_label is null then
      raise exception using errcode = '42501', message = 'invalid_assistant_source';
    end if;
    v_seen := array_append(v_seen, v_source.type || ':' || v_source.id::text);
    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'type', v_source.type, 'id', v_source.id, 'label', v_label, 'href', v_href
    ));
  end loop;

  if v_conversation_id is null then
    insert into public.conversations (workspace_id, title)
    values (v_workspace_id, left(p_user_content, 80)) returning id into v_conversation_id;
  else
    perform 1 from public.conversations
    where id = v_conversation_id and workspace_id = v_workspace_id and trashed_at is null;
    if not found then
      raise exception using errcode = '42501', message = 'conversation_not_found';
    end if;
  end if;

  insert into public.conversation_messages (
    workspace_id, conversation_id, role, content, route, sources
  ) values
    (v_workspace_id, v_conversation_id, 'user', p_user_content, p_route, '[]'::jsonb),
    (v_workspace_id, v_conversation_id, 'assistant', p_assistant_content, p_route, v_sources);

  if p_proposal is not null and p_proposal <> 'null'::jsonb then
    v_operation_id := p_proposal ->> 'operationId';
    select risk_class into v_risk from public.operation_contracts
    where operation_id = v_operation_id and 'chat' = any(exposures);
    if v_risk is null or v_risk = 'read'
      or jsonb_typeof(p_proposal -> 'input') <> 'object'
      or char_length(coalesce(p_proposal ->> 'summary', '')) not between 1 and 300 then
      raise exception using errcode = 'P0001', message = 'invalid_assistant_proposal';
    end if;
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
exception
  when invalid_text_representation or not_null_violation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'invalid_assistant_turn';
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
    'result', v_result
  );
end;
$$;

revoke all on function public.record_assistant_turn(
  uuid, text, text, text, jsonb, text, text, jsonb
) from public, anon;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.record_assistant_turn(
  uuid, text, text, text, jsonb, text, text, jsonb
) to authenticated;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;

commit;
