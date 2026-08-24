begin;

create table public.conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  trashed_at timestamptz
);
create index conversations_workspace_updated_idx on public.conversations (workspace_id, updated_at desc);

create table public.conversation_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (char_length(content) between 1 and 4000),
  route text check (route is null or char_length(route) <= 200),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  created_at timestamptz not null default now()
);
create index conversation_messages_conversation_idx on public.conversation_messages (conversation_id, created_at);

create table public.ai_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  source_capture_id uuid references public.captures(id) on delete set null,
  operation_id text not null check (operation_id ~ '^[a-z][a-z0-9_.-]+\.v[0-9]+$'),
  input_json jsonb not null check (jsonb_typeof(input_json) = 'object'),
  summary text not null check (char_length(summary) between 1 and 300),
  risk_class text not null check (risk_class in ('low', 'medium', 'high')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed', 'superseded', 'failed')),
  idempotency_key uuid not null unique default extensions.gen_random_uuid(),
  model_id text not null check (char_length(model_id) between 1 and 120),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  result_json jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz
);
create index ai_proposals_workspace_status_idx on public.ai_proposals (workspace_id, status, created_at desc);

create table public.memories (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  statement text not null check (char_length(statement) between 1 and 2000),
  source_type text not null check (source_type in ('user', 'conversation', 'capture', 'note', 'review')),
  source_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trashed_at timestamptz
);
create index memories_workspace_updated_idx on public.memories (workspace_id, updated_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['conversations', 'conversation_messages', 'ai_proposals', 'memories'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (workspace_id in (select id from public.workspaces where owner_user_id = auth.uid()))',
      table_name || '_select_owner', table_name
    );
    execute format('revoke all on public.%I from anon', table_name);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

create or replace function public.execute_memory_operation(
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
  v_target_id uuid;
  v_expected_version integer;
  v_row public.memories%rowtype;
  v_result jsonb;
  v_risk text := case when p_operation_id = 'memory.trash.v1' then 'medium' else 'low' end;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  if p_operation_id not in ('memory.create.v1', 'memory.update.v1', 'memory.trash.v1') then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then raise exception using errcode = 'P0001', message = 'workspace_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0));
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  if p_operation_id = 'memory.create.v1' then
    if char_length(trim(coalesce(p_input ->> 'statement', ''))) not between 1 and 2000
      or coalesce(p_input ->> 'sourceType', '') not in ('user', 'conversation', 'capture', 'note', 'review') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    insert into public.memories (workspace_id, statement, source_type, source_id)
    values (
      v_workspace_id, trim(p_input ->> 'statement'), p_input ->> 'sourceType',
      nullif(p_input ->> 'sourceId', '')::uuid
    ) returning * into v_row;
  elsif p_operation_id = 'memory.update.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::integer;
    if char_length(trim(coalesce(p_input ->> 'statement', ''))) not between 1 and 2000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    update public.memories set
      statement = trim(p_input ->> 'statement'), version = version + 1, updated_at = clock_timestamp()
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    returning * into v_row;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;
  else
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::integer;
    update public.memories set
      trashed_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    returning * into v_row;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;
  end if;

  v_target_id := v_row.id;
  v_result := to_jsonb(v_row);
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' when p_surface in ('mcp', 'automation') then 'automation' else 'user' end,
    p_surface, p_idempotency_key, v_risk, 'memory', v_target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' when p_surface in ('mcp', 'automation') then 'automation' else 'user' end,
    p_surface, p_operation_id, 'memory', v_target_id, v_risk, 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.execute_memory_operation(text, jsonb, text, text) from public, anon;
grant execute on function public.execute_memory_operation(text, jsonb, text, text) to authenticated;

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
    'trash.move.v1', 'trash.restore.v1', 'trash.empty.v1'
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
    v_risk := case when v_operation_id in ('goal.archive.v1', 'action.archive.v1', 'note.archive.v1') then 'medium' else 'low' end;
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

  if v_proposal.operation_id like 'note.%' then
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
  set status = 'applied', result_json = v_result, decided_at = clock_timestamp(), applied_at = clock_timestamp()
  where id = p_proposal_id;
  insert into public.conversation_messages (workspace_id, conversation_id, role, content)
  values (v_proposal.workspace_id, v_proposal.conversation_id, 'assistant', 'Applied: ' || v_proposal.summary);
  return jsonb_build_object(
    'conversationId', v_proposal.conversation_id,
    'operationId', v_proposal.operation_id,
    'summary', v_proposal.summary,
    'result', v_result
  );
end;
$$;

create or replace function public.dismiss_assistant_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  update public.ai_proposals p
  set status = 'dismissed', decided_at = clock_timestamp()
  from public.workspaces w
  where p.id = p_proposal_id and p.workspace_id = w.id and w.owner_user_id = v_user_id and p.status = 'pending';
  if not found then raise exception using errcode = 'P0001', message = 'proposal_not_found'; end if;
end;
$$;

create or replace function public.manage_conversation(
  p_conversation_id uuid,
  p_action text,
  p_title text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_action = 'rename' and char_length(trim(coalesce(p_title, ''))) between 1 and 200 then
    update public.conversations c set title = trim(p_title), updated_at = clock_timestamp()
    from public.workspaces w where c.id = p_conversation_id and c.workspace_id = w.id and w.owner_user_id = v_user_id and c.trashed_at is null;
  elsif p_action = 'archive' then
    update public.conversations c set status = 'archived', archived_at = clock_timestamp(), updated_at = clock_timestamp()
    from public.workspaces w where c.id = p_conversation_id and c.workspace_id = w.id and w.owner_user_id = v_user_id and c.trashed_at is null;
  elsif p_action = 'trash' then
    update public.conversations c set trashed_at = clock_timestamp(), updated_at = clock_timestamp()
    from public.workspaces w where c.id = p_conversation_id and c.workspace_id = w.id and w.owner_user_id = v_user_id and c.trashed_at is null;
  else
    raise exception using errcode = 'P0001', message = 'invalid_conversation_action';
  end if;
  if not found then raise exception using errcode = 'P0001', message = 'conversation_not_found'; end if;
end;
$$;

revoke all on function public.record_assistant_turn(uuid, text, text, text, jsonb, text, text) from public, anon;
revoke all on function public.execute_assistant_proposal(uuid) from public, anon;
revoke all on function public.dismiss_assistant_proposal(uuid) from public, anon;
revoke all on function public.manage_conversation(uuid, text, text) from public, anon;
grant execute on function public.record_assistant_turn(uuid, text, text, text, jsonb, text, text) to authenticated;
grant execute on function public.execute_assistant_proposal(uuid) to authenticated;
grant execute on function public.dismiss_assistant_proposal(uuid) to authenticated;
grant execute on function public.manage_conversation(uuid, text, text) to authenticated;

commit;
