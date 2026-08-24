begin;

create table public.operation_contracts (
  operation_id text primary key check (operation_id ~ '^[a-z][a-z0-9_.-]+\.v[0-9]+$'),
  risk_class text not null check (risk_class in ('read', 'low', 'medium', 'high')),
  exposures text[] not null check (
    exposures <@ array['ui', 'chat', 'mcp', 'automation', 'system']::text[]
    and cardinality(exposures) > 0
  ),
  reversible boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on public.operation_contracts from anon, authenticated;
grant select on public.operation_contracts to authenticated;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('workspace.snapshot.read.v1', 'read', array['mcp'], false),
  ('vision.upsert.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('goal.create.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('goal.status.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('goal.archive.v1', 'medium', array['ui', 'chat', 'mcp'], true),
  ('action.create.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('action.status.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('action.archive.v1', 'medium', array['ui', 'chat', 'mcp'], true),
  ('capture.create.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.create.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.update.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.move.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.archive.v1', 'medium', array['ui', 'chat', 'mcp'], true),
  ('note.ai-exclusion.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('memory.create.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('memory.update.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('trash.move.v1', 'medium', array['ui', 'chat', 'mcp'], true),
  ('trash.restore.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('trash.empty.v1', 'high', array['ui', 'chat'], false),
  ('note.tags.set.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.link.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.unlink.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('capture.file-to-note.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('review.complete-weekly.v1', 'medium', array['ui', 'chat'], true);

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
begin
  if v_user_id is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'aal2_required';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or char_length(trim(p_name)) not between 1 and 120
    or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp() + interval '90 days'
    or coalesce(cardinality(p_allowed_operations), 0) not between 1 and 50
    or array_position(p_allowed_operations, null) is not null
    or exists (
      select 1 from unnest(p_allowed_operations) granted(operation_id)
      left join public.operation_contracts contract using (operation_id)
      where contract.operation_id is null or not ('mcp' = any(contract.exposures))
    ) then
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
    select risk_class into v_risk from public.operation_contracts
    where operation_id = v_operation_id and 'chat' = any(exposures);
    if not found or jsonb_typeof(p_proposal -> 'input') <> 'object'
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
  if v_proposal.operation_id like 'review.%' then
    v_result := public.execute_review_operation(
      v_proposal.operation_id, v_proposal.input_json, v_proposal.idempotency_key::text, 'chat'
    );
  elsif v_proposal.operation_id in (
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
