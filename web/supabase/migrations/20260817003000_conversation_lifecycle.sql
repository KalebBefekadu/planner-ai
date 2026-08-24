begin;

alter table public.conversations
  add column version bigint not null default 1 check (version > 0),
  add constraint conversations_id_workspace_unique unique (id, workspace_id);

alter table public.conversation_messages
  drop constraint conversation_messages_conversation_id_fkey,
  add constraint conversation_messages_conversation_workspace_fkey
    foreign key (conversation_id, workspace_id)
    references public.conversations(id, workspace_id) on delete cascade;

alter table public.ai_proposals
  drop constraint ai_proposals_conversation_id_fkey,
  add constraint ai_proposals_conversation_workspace_fkey
    foreign key (conversation_id, workspace_id)
    references public.conversations(id, workspace_id) on delete cascade;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('conversation.rename.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('conversation.status.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('conversation.delete.v1', 'high', array['ui', 'chat'], false)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

insert into public.operation_undo_support (operation_id, strategy) values
  ('conversation.rename.v1', 'snapshot'),
  ('conversation.status.v1', 'snapshot');

create or replace function public.execute_conversation_operation(
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
  v_conversation public.conversations%rowtype;
  v_before public.conversations%rowtype;
  v_conversation_id uuid;
  v_expected_version bigint;
  v_result jsonb;
  v_undo_payload jsonb;
  v_actor_type text;
  v_risk text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'conversation.rename.v1', 'conversation.status.v1', 'conversation.delete.v1'
  ) or p_surface not in ('ui', 'chat', 'mcp')
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200
    or jsonb_typeof(p_input) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  select contract.risk_class into v_risk from public.operation_contracts contract
  where contract.operation_id = p_operation_id and p_surface = any(contract.exposures);
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;
  select workspace.id into v_workspace_id from public.workspaces workspace
  where workspace.owner_user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select receipt.result_json into v_result from public.operation_receipts receipt
  where receipt.workspace_id = v_workspace_id
    and receipt.operation_id = p_operation_id
    and receipt.idempotency_key = p_idempotency_key
    and receipt.status = 'succeeded';
  if found then return v_result; end if;

  v_conversation_id := (p_input ->> 'id')::uuid;
  v_expected_version := (p_input ->> 'expectedVersion')::bigint;
  if v_expected_version < 1 then
    raise exception using errcode = 'P0001', message = 'invalid_conversation_input';
  end if;
  select conversation.* into v_conversation from public.conversations conversation
  where conversation.id = v_conversation_id
    and conversation.workspace_id = v_workspace_id
    and conversation.trashed_at is null
  for update;
  if not found or v_conversation.version <> v_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
  end if;
  v_before := v_conversation;

  if p_operation_id = 'conversation.rename.v1' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) keys(key))
      is distinct from array['expectedVersion', 'id', 'title']::text[]
      or char_length(btrim(coalesce(p_input ->> 'title', ''))) not between 1 and 200 then
      raise exception using errcode = 'P0001', message = 'invalid_conversation_input';
    end if;
    update public.conversations set
      title = btrim(p_input ->> 'title'),
      version = version + 1,
      updated_at = clock_timestamp()
    where id = v_conversation.id returning * into v_conversation;
  elsif p_operation_id = 'conversation.status.v1' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) keys(key))
      is distinct from array['expectedVersion', 'id', 'status']::text[]
      or coalesce(p_input ->> 'status', '') not in ('active', 'archived') then
      raise exception using errcode = 'P0001', message = 'invalid_conversation_input';
    end if;
    update public.conversations set
      status = p_input ->> 'status',
      archived_at = case when p_input ->> 'status' = 'archived'
        then coalesce(archived_at, clock_timestamp()) else null end,
      version = version + 1,
      updated_at = clock_timestamp()
    where id = v_conversation.id returning * into v_conversation;
  else
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) keys(key))
      is distinct from array['confirmation', 'expectedVersion', 'id']::text[]
      or p_input ->> 'confirmation' <> 'DELETE CONVERSATION' then
      raise exception using errcode = 'P0001', message = 'confirmation_required';
    end if;
    delete from public.conversations where id = v_conversation.id;
    v_result := jsonb_build_object('id', v_conversation.id, 'deleted', true);
  end if;

  if p_operation_id <> 'conversation.delete.v1' then
    v_result := jsonb_build_object(
      'id', v_conversation.id,
      'workspaceId', v_conversation.workspace_id,
      'title', v_conversation.title,
      'status', v_conversation.status,
      'version', v_conversation.version,
      'updatedAt', v_conversation.updated_at,
      'archivedAt', v_conversation.archived_at
    );
    v_undo_payload := jsonb_build_object(
      'conversationBefore', to_jsonb(v_before),
      'conversationExpected', to_jsonb(v_conversation)
    );
  end if;
  v_actor_type := case when p_surface = 'chat' then 'assistant'
    when p_surface = 'mcp' then 'automation' else 'user' end;
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status,
    result_json, undo_payload_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id, v_actor_type, p_surface,
    p_idempotency_key, v_risk, 'conversation', v_conversation_id, 'succeeded',
    v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, v_actor_type, p_surface, p_operation_id,
    'conversation', v_conversation_id, v_risk,
    case when v_risk = 'high' then 'explicit_confirmation' else 'not_required' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range
    or not_null_violation or check_violation then
    raise exception using errcode = 'P0001', message = 'invalid_conversation_input';
end;
$$;

alter function public.dispatch_trusted_operation(text, jsonb, text, text)
rename to dispatch_trusted_operation_conversation_base;

create or replace function public.dispatch_trusted_operation(
  p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_operation_id like 'conversation.%' then
    return public.execute_conversation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.dispatch_trusted_operation_conversation_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
end;
$$;

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_conversation_base;

create or replace function public.execute_operation_undo(
  p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_original public.operation_receipts%rowtype;
  v_conversation public.conversations%rowtype;
  v_before jsonb;
  v_expected jsonb;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if p_operation_id <> 'operation.undo.v1' then
    return public.execute_operation_undo_conversation_base(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  select workspace.id into v_workspace_id from public.workspaces workspace
  where workspace.owner_user_id = v_user_id;
  select receipt.* into v_original from public.operation_receipts receipt
  join public.operation_undo_support support on support.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.operation_id in ('conversation.rename.v1', 'conversation.status.v1')
    and receipt.status = 'succeeded' and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    return public.execute_operation_undo_conversation_base(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  if p_surface <> 'ui'
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200
    or v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select receipt.result_json into v_result from public.operation_receipts receipt
  where receipt.workspace_id = v_workspace_id and receipt.operation_id = p_operation_id
    and receipt.idempotency_key = p_idempotency_key and receipt.status = 'succeeded';
  if found then return v_result; end if;

  v_before := v_original.undo_payload_json -> 'conversationBefore';
  v_expected := v_original.undo_payload_json -> 'conversationExpected';
  select conversation.* into v_conversation from public.conversations conversation
  where conversation.id = v_original.target_id
    and conversation.workspace_id = v_workspace_id for update;
  if not found
    or v_conversation.version is distinct from (v_expected ->> 'version')::bigint
    or v_conversation.title is distinct from v_expected ->> 'title'
    or v_conversation.status is distinct from v_expected ->> 'status'
    or v_conversation.archived_at is distinct from
      nullif(v_expected ->> 'archived_at', '')::timestamptz then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;
  update public.conversations set
    title = v_before ->> 'title',
    status = v_before ->> 'status',
    archived_at = nullif(v_before ->> 'archived_at', '')::timestamptz,
    version = (v_before ->> 'version')::bigint,
    updated_at = clock_timestamp()
  where id = v_conversation.id;
  update public.operation_receipts set reversed_at = clock_timestamp()
  where id = v_original.id;
  v_undo_receipt_id := extensions.gen_random_uuid();
  v_result := jsonb_build_object(
    'originalReceiptId', v_original.id,
    'undoReceiptId', v_undo_receipt_id,
    'status', 'undone'
  );
  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_undo_receipt_id, v_workspace_id, p_operation_id, v_user_id, 'user', p_surface,
    p_idempotency_key, 'low', 'conversation', v_original.target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', p_surface, p_operation_id,
    'conversation', v_original.target_id, 'low', 'not_required', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

create or replace function public.search_conversations(
  p_query text default '',
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  status text,
  version bigint,
  updated_at timestamptz,
  archived_at timestamptz,
  message_count bigint,
  last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
  v_query text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if char_length(v_query) > 100 or p_status not in ('active', 'archived')
    and p_status is not null or p_limit not between 1 and 100
    or p_offset not between 0 and 10000 then
    raise exception using errcode = 'P0001', message = 'invalid_conversation_search';
  end if;
  select workspace.id into v_workspace_id from public.workspaces workspace
  where workspace.owner_user_id = auth.uid();
  return query
  select conversation.id, conversation.title, conversation.status,
    conversation.version, conversation.updated_at, conversation.archived_at,
    count(message.id)::bigint, max(message.created_at)
  from public.conversations conversation
  left join public.conversation_messages message
    on message.conversation_id = conversation.id
      and message.workspace_id = conversation.workspace_id
  where conversation.workspace_id = v_workspace_id
    and conversation.trashed_at is null
    and (p_status is null or conversation.status = p_status)
    and (v_query = '' or position(lower(v_query) in lower(conversation.title)) > 0
      or exists (
        select 1 from public.conversation_messages matched
        where matched.conversation_id = conversation.id
          and matched.workspace_id = conversation.workspace_id
          and position(lower(v_query) in lower(matched.content)) > 0
      ))
  group by conversation.id
  order by conversation.updated_at desc, conversation.id
  limit p_limit offset p_offset;
end;
$$;

alter function public.record_assistant_turn(uuid, text, text, text, jsonb, text, text, jsonb)
rename to record_assistant_turn_conversation_base;

create or replace function public.record_assistant_turn(
  p_conversation_id uuid, p_user_content text, p_assistant_content text,
  p_route text, p_proposal jsonb, p_model_id text, p_prompt_version text,
  p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_conversation_id is not null then
    perform 1 from public.conversations conversation
    join public.workspaces workspace on workspace.id = conversation.workspace_id
    where conversation.id = p_conversation_id
      and workspace.owner_user_id = auth.uid()
      and conversation.status = 'active' and conversation.trashed_at is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'conversation_not_active';
    end if;
  end if;
  return public.record_assistant_turn_conversation_base(
    p_conversation_id, p_user_content, p_assistant_content, p_route,
    p_proposal, p_model_id, p_prompt_version, p_sources
  );
end;
$$;

alter function public.execute_assistant_proposal(uuid)
rename to execute_assistant_proposal_conversation_base;

create or replace function public.execute_assistant_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_proposal public.ai_proposals%rowtype;
  v_result jsonb;
begin
  select proposal.* into v_proposal from public.ai_proposals proposal
  join public.workspaces workspace on workspace.id = proposal.workspace_id
  join public.conversations conversation on conversation.id = proposal.conversation_id
    and conversation.workspace_id = proposal.workspace_id
  where proposal.id = p_proposal_id and proposal.status = 'pending'
    and workspace.owner_user_id = auth.uid()
    and conversation.status = 'active' and conversation.trashed_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'proposal_not_found';
  end if;
  if v_proposal.operation_id <> 'conversation.delete.v1' then
    return public.execute_assistant_proposal_conversation_base(p_proposal_id);
  end if;
  v_result := public.dispatch_trusted_operation(
    v_proposal.operation_id, v_proposal.input_json,
    v_proposal.idempotency_key::text, 'chat'
  );
  return jsonb_build_object(
    'conversationId', v_proposal.conversation_id,
    'operationId', v_proposal.operation_id,
    'summary', v_proposal.summary,
    'result', v_result
  );
end;
$$;

alter function public.build_mcp_workspace_snapshot(uuid)
rename to build_mcp_workspace_snapshot_conversation_base;

create or replace function public.build_mcp_workspace_snapshot(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    public.build_mcp_workspace_snapshot_conversation_base(p_workspace_id),
    '{}'::jsonb
  ) || jsonb_build_object(
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id, 'title', item.title, 'status', item.status,
        'version', item.version, 'updatedAt', item.updated_at
      ) order by item.updated_at desc)
      from (
        select conversation.* from public.conversations conversation
        where conversation.workspace_id = p_workspace_id
          and conversation.trashed_at is null
        order by conversation.updated_at desc limit 50
      ) item
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.execute_conversation_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation_conversation_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_conversation_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.search_conversations(text, text, integer, integer)
from public, anon;
grant execute on function public.search_conversations(text, text, integer, integer)
to authenticated;
revoke all on function public.record_assistant_turn_conversation_base(
  uuid, text, text, text, jsonb, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.record_assistant_turn(
  uuid, text, text, text, jsonb, text, text, jsonb
) from public, anon;
grant execute on function public.record_assistant_turn(
  uuid, text, text, text, jsonb, text, text, jsonb
) to authenticated;
revoke all on function public.execute_assistant_proposal_conversation_base(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;
revoke all on function public.build_mcp_workspace_snapshot_conversation_base(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.build_mcp_workspace_snapshot(uuid)
from public, anon, authenticated, service_role;

commit;
