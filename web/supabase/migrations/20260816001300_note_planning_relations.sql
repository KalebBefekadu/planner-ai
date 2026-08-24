begin;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('note.goal-link.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.goal-unlink.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.action-link.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('note.action-unlink.v1', 'low', array['ui', 'chat', 'mcp'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_note_relation_operation(
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
  v_note_id uuid;
  v_target_id uuid;
  v_target_type text;
  v_status text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'note.goal-link.v1', 'note.goal-unlink.v1',
    'note.action-link.v1', 'note.action-unlink.v1'
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

  v_note_id := (p_input ->> 'noteId')::uuid;
  v_target_type := case when p_operation_id like 'note.goal-%' then 'goal' else 'action' end;
  v_target_id := case
    when v_target_type = 'goal' then (p_input ->> 'goalId')::uuid
    else (p_input ->> 'actionId')::uuid
  end;
  v_status := case when p_operation_id like '%-unlink.v1' then 'unlinked' else 'linked' end;
  perform 1 from public.notes
  where id = v_note_id and workspace_id = v_workspace_id
    and archived_at is null and trashed_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'note_not_found'; end if;

  if v_target_type = 'goal' then
    perform 1 from public.goals
    where id = v_target_id and workspace_id = v_workspace_id
      and archived_at is null and trashed_at is null;
    if not found then raise exception using errcode = 'P0001', message = 'goal_not_found'; end if;
    if v_status = 'linked' then
      insert into public.note_goal_links (workspace_id, note_id, goal_id)
      values (v_workspace_id, v_note_id, v_target_id)
      on conflict (workspace_id, note_id, goal_id) do nothing;
    else
      delete from public.note_goal_links
      where workspace_id = v_workspace_id and note_id = v_note_id and goal_id = v_target_id;
    end if;
  else
    perform 1 from public.actions
    where id = v_target_id and workspace_id = v_workspace_id
      and archived_at is null and trashed_at is null;
    if not found then raise exception using errcode = 'P0001', message = 'action_not_found'; end if;
    if v_status = 'linked' then
      insert into public.note_action_links (workspace_id, note_id, action_id)
      values (v_workspace_id, v_note_id, v_target_id)
      on conflict (workspace_id, note_id, action_id) do nothing;
    else
      delete from public.note_action_links
      where workspace_id = v_workspace_id and note_id = v_note_id and action_id = v_target_id;
    end if;
  end if;

  v_result := jsonb_build_object(
    'noteId', v_note_id, 'targetId', v_target_id,
    'targetType', v_target_type, 'status', v_status
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' when p_surface = 'mcp' then 'automation' else 'user' end,
    p_surface, p_idempotency_key, 'low', 'note', v_note_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' when p_surface = 'mcp' then 'automation' else 'user' end,
    p_surface, p_operation_id, 'note', v_note_id, 'low', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
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
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;

  if p_operation_id in (
    'note.goal-link.v1', 'note.goal-unlink.v1',
    'note.action-link.v1', 'note.action-unlink.v1'
  ) then
    v_result := public.execute_note_relation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
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

create or replace function public.execute_ui_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  return public.dispatch_trusted_operation(p_operation_id, p_input, p_idempotency_key, 'ui');
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
  v_result := public.dispatch_trusted_operation(
    p_operation_id, p_input, p_idempotency_key, 'mcp'
  );
  perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
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
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  select p.* into v_proposal
  from public.ai_proposals p
  join public.workspaces w on w.id = p.workspace_id and w.owner_user_id = v_user_id
  where p.id = p_proposal_id and p.status = 'pending'
  for update of p;
  if not found then raise exception using errcode = 'P0001', message = 'proposal_not_found'; end if;
  v_result := public.dispatch_trusted_operation(
    v_proposal.operation_id, v_proposal.input_json, v_proposal.idempotency_key::text, 'chat'
  );
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

revoke all on function public.execute_note_relation_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_ui_operation(text, jsonb, text) from public, anon;
grant execute on function public.execute_ui_operation(text, jsonb, text) to authenticated;
revoke all on function public.execute_mcp_operation(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.execute_mcp_operation(uuid, text, jsonb, text) to service_role;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;

commit;
