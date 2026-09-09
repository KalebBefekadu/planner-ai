-- An Action filed from a Capture kept no link back to it.
--
-- Filing a Capture as a Note records the connection in capture_note_links and
-- moves the Capture to 'reviewed'. Filing the same Capture as an Action
-- recorded nothing: the Action was created correctly, but the Capture stayed in
-- state 'new' as though nothing had happened, and there was no route from the
-- Action back to the words it came from.
--
-- Two things followed. The inbox never emptied honestly, so its state could not
-- be trusted; and the Action lost its origin, which is the whole reason a
-- Capture is preserved verbatim in the first place.
--
-- This mirrors the Notes path rather than inventing a second shape:
-- capture_action_links has the same ownership, RLS, Trash and export behaviour
-- as capture_note_links, and capture.file-to-action.v1 writes the link and the
-- state change in one transaction so a link can never be missing from an Action
-- that was filed. The undo payload is computed in the executor rather than
-- reconstructed from before-image triggers, because everything it needs -- the
-- prior state, whether this call created the link, and the exact set of links
-- afterwards -- is already in hand at the moment of the write.

begin;

create table public.capture_action_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  capture_id uuid not null,
  action_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, capture_id, action_id),
  foreign key (capture_id, workspace_id) references public.captures(id, workspace_id) on delete cascade,
  foreign key (action_id, workspace_id) references public.actions(id, workspace_id) on delete cascade
);

create index capture_action_links_action_idx
  on public.capture_action_links (workspace_id, action_id);

alter table public.capture_action_links enable row level security;
alter table public.capture_action_links force row level security;
create policy capture_action_links_select_owner on public.capture_action_links
  for select to authenticated
  using (
    workspace_id in (
      select id from public.workspaces where owner_user_id = (select auth.uid())
    )
  );
revoke all on public.capture_action_links from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.capture_action_links from authenticated;
grant select on public.capture_action_links to authenticated;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible)
values ('capture.file-to-action.v1', 'low', array['ui', 'chat', 'mcp'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = now();

insert into public.operation_undo_support (operation_id, strategy)
values ('capture.file-to-action.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.execute_capture_action_filing_operation(
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
  v_capture_id uuid;
  v_action_id uuid;
  v_prior_state text;
  v_created_link boolean;
  v_inserted_count integer;
  v_actor text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'capture.file-to-action.v1' then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200 then
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

  v_capture_id := (p_input ->> 'captureId')::uuid;
  v_action_id := (p_input ->> 'actionId')::uuid;
  if v_capture_id is null or v_action_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  -- The Capture row is the only copy of the recorded words that is guaranteed
  -- to be the one the person made, so the state it is in is read from it under
  -- lock rather than assumed to be 'new'.
  select state into v_prior_state from public.captures
  where id = v_capture_id and workspace_id = v_workspace_id
    and archived_at is null and trashed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'capture_not_found';
  end if;
  perform 1 from public.actions
  where id = v_action_id and workspace_id = v_workspace_id
    and archived_at is null and trashed_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'action_not_found';
  end if;

  insert into public.capture_action_links (workspace_id, capture_id, action_id)
  values (v_workspace_id, v_capture_id, v_action_id)
  on conflict (workspace_id, capture_id, action_id) do nothing;
  get diagnostics v_inserted_count = row_count;
  v_created_link := v_inserted_count > 0;
  update public.captures set state = 'reviewed'
  where id = v_capture_id and workspace_id = v_workspace_id;

  v_result := jsonb_build_object(
    'captureId', v_capture_id, 'actionId', v_action_id, 'state', 'reviewed'
  );
  v_actor := case
    when p_surface = 'chat' then 'assistant'
    when p_surface = 'mcp' then 'automation'
    else 'user'
  end;
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status,
    result_json, undo_payload_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id, v_actor, p_surface,
    p_idempotency_key, 'low', 'capture', v_capture_id, 'succeeded',
    v_result,
    jsonb_build_object(
      'priorState', v_prior_state,
      'createdLink', v_created_link,
      'expectedActionIds', coalesce((
        select jsonb_agg(action_id order by action_id)
        from public.capture_action_links
        where workspace_id = v_workspace_id and capture_id = v_capture_id
      ), '[]'::jsonb)
    )
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id, v_actor, p_surface, p_operation_id,
    'capture', v_capture_id, 'low', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.execute_capture_action_filing_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

alter function public.dispatch_trusted_operation(text, jsonb, text, text)
rename to dispatch_trusted_operation_capture_action_base;

create or replace function public.dispatch_trusted_operation(
  p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_operation_id = 'capture.file-to-action.v1' then
    -- The surface guard lives in the base dispatcher, so it is repeated here
    -- rather than skipped: an operation intercepted before that check would
    -- otherwise be reachable from a surface it was never exposed to.
    if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
      raise exception using errcode = 'P0001', message = 'invalid_operation_surface';
    end if;
    perform 1 from public.operation_contracts
    where operation_id = p_operation_id and p_surface = any(exposures);
    if not found then
      raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
    end if;
    return public.execute_capture_action_filing_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.dispatch_trusted_operation_capture_action_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
end;
$$;

create or replace function public.execute_capture_action_filing_undo(
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
  v_current_action_ids jsonb;
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
    and receipt.operation_id = 'capture.file-to-action.v1'
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  if v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

  perform 1 from public.captures
  where id = v_original.target_id and workspace_id = v_workspace_id
    and state = v_original.result_json ->> 'state'
    and trashed_at is null
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;
  -- Undoing a filing may not silently discard a link made after it. The set of
  -- links has to be exactly what this Operation left behind.
  select coalesce(jsonb_agg(action_id order by action_id), '[]'::jsonb)
  into v_current_action_ids
  from public.capture_action_links
  where workspace_id = v_workspace_id and capture_id = v_original.target_id;
  if v_current_action_ids is distinct from v_original.undo_payload_json -> 'expectedActionIds' then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  if (v_original.undo_payload_json ->> 'createdLink')::boolean then
    delete from public.capture_action_links
    where workspace_id = v_workspace_id
      and capture_id = v_original.target_id
      and action_id = (v_original.result_json ->> 'actionId')::uuid;
    if not found then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end if;
  update public.captures set state = v_original.undo_payload_json ->> 'priorState'
  where id = v_original.target_id and workspace_id = v_workspace_id;

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

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_capture_action_base;

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
  if v_original_operation_id = 'capture.file-to-action.v1' then
    return public.execute_capture_action_filing_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_capture_action_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.dispatch_trusted_operation_capture_action_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_capture_action_filing_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_capture_action_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
