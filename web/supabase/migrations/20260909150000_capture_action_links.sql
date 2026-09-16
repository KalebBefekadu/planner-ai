-- Filing a Capture as an Action left no trace of where the work came from.
--
-- The Notes path already records the connection in capture_note_links and
-- moves the Capture to 'reviewed'. The Action path did neither: it called
-- action.create.v1 and stopped. Two consequences followed. The inbox went on
-- showing a Capture that had already become work as though nothing had been
-- done with it, so its state could not be trusted. And the Action had no route
-- back to the words that produced it, which is the whole reason a Capture is
-- kept verbatim in the first place.
--
-- The link and the Action are written by one Operation rather than two. The
-- Notes path creates the Note first and links it in a second Operation, which
-- is survivable there because a retry re-links an existing Note. An Action has
-- no such second chance: a create that succeeded and a link that failed would
-- leave exactly the unlinked Action this change exists to remove. So
-- capture.file-to-action.v1 creates the Action, records the link and marks the
-- Capture reviewed in a single transaction, or does none of it.

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

-- The same ownership shape as capture_note_links: readable by the owner,
-- writable only through an Operation running as definer.
alter table public.capture_action_links enable row level security;
alter table public.capture_action_links force row level security;
create policy capture_action_links_select_owner on public.capture_action_links
for select to authenticated
-- auth.uid() is wrapped in a scalar subquery so the planner evaluates it once
-- per query rather than once per row, which the RLS performance test enforces.
using (workspace_id in (
  select id from public.workspaces where owner_user_id = (select auth.uid())
));
revoke all on public.capture_action_links from anon;
revoke insert, update, delete, truncate, references, trigger
on public.capture_action_links from authenticated;
grant select on public.capture_action_links to authenticated;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible)
values ('capture.file-to-action.v1', 'low', array['ui', 'chat', 'mcp'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible;

insert into public.operation_undo_support (operation_id, strategy)
values ('capture.file-to-action.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.execute_capture_action_filing_operation(
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
  v_capture_id uuid;
  v_action_id uuid;
  v_action_version bigint;
  v_horizon_id uuid;
  v_starts_on date;
  v_ends_on date;
  v_title text;
  v_description text;
  v_prior_state text;
  v_actor_type text;
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
  -- A retry replays the first attempt's receipt. Filing is one click on a page
  -- a person may reload or double-tap, and a second Action carrying the same
  -- thought is worse than no Action at all.
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  v_capture_id := (p_input ->> 'captureId')::uuid;
  v_title := p_input ->> 'title';
  v_starts_on := (p_input ->> 'startsOn')::date;
  v_ends_on := (p_input ->> 'endsOn')::date;
  v_description := nullif(p_input ->> 'descriptionMarkdown', '');
  if char_length(coalesce(v_title, '')) not between 3 and 1000
    or v_starts_on is null or v_ends_on is null or v_ends_on < v_starts_on
    or char_length(coalesce(v_description, '')) > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  select state into v_prior_state from public.captures
  where id = v_capture_id and workspace_id = v_workspace_id
    and archived_at is null and trashed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'capture_not_found';
  end if;

  insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
  select v_workspace_id, 'week', v_starts_on, v_ends_on, timezone
  from public.workspaces where id = v_workspace_id
  on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
  returning id into v_horizon_id;

  -- Unscheduled beyond the week it lands in, with no Goal and no parent:
  -- deciding the day and the reason is planning work, and guessing at it here
  -- would put words in the person's mouth.
  insert into public.actions (
    workspace_id, goal_id, parent_action_id, horizon_id,
    title, description_markdown, status, scheduled_on
  ) values (
    v_workspace_id, null, null, v_horizon_id,
    v_title, v_description, 'open', v_starts_on
  ) returning id, version into v_action_id, v_action_version;

  insert into public.capture_action_links (workspace_id, capture_id, action_id)
  values (v_workspace_id, v_capture_id, v_action_id);

  update public.captures set state = 'reviewed'
  where id = v_capture_id and workspace_id = v_workspace_id;

  v_result := jsonb_build_object(
    'captureId', v_capture_id, 'actionId', v_action_id, 'state', 'reviewed'
  );
  v_actor_type := case
    when p_surface = 'chat' then 'assistant'
    when p_surface = 'mcp' then 'automation'
    else 'user'
  end;
  -- The undo snapshot is written here rather than reconstructed from before
  -- images, because everything it needs is already known at this point: what
  -- the Capture's state was, which Action this Operation made, and the exact
  -- set of links the Capture carries once the write lands.
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status,
    result_json, undo_payload_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id, v_actor_type, p_surface,
    p_idempotency_key, 'low', 'capture', v_capture_id, 'succeeded',
    v_result,
    jsonb_build_object(
      'priorState', v_prior_state,
      'actionId', v_action_id,
      'actionVersion', v_action_version,
      'expectedActionIds', (
        select coalesce(jsonb_agg(action_id order by action_id), '[]'::jsonb)
        from public.capture_action_links
        where workspace_id = v_workspace_id and capture_id = v_capture_id
      )
    )
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id, v_actor_type, p_surface, p_operation_id,
    'capture', v_capture_id, 'low', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

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
  v_original public.operation_receipts%rowtype;
  v_action public.actions%rowtype;
  v_action_id uuid;
  v_current_action_ids jsonb;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_surface <> 'ui' or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
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
  -- Undo removes exactly what this filing added and nothing else. If the
  -- Capture has since been filed into another Action, the link set no longer
  -- matches what was recorded and the person is told rather than silently
  -- losing the newer connection.
  select coalesce(jsonb_agg(action_id order by action_id), '[]'::jsonb)
  into v_current_action_ids
  from public.capture_action_links
  where workspace_id = v_workspace_id and capture_id = v_original.target_id;
  if v_current_action_ids is distinct from v_original.undo_payload_json -> 'expectedActionIds' then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  v_action_id := (v_original.undo_payload_json ->> 'actionId')::uuid;
  select * into v_action from public.actions
  where id = v_action_id and workspace_id = v_workspace_id for update;
  -- The Action is deleted, so it may only be deleted while it is still the
  -- untouched thing this Operation made. Any edit, any scheduling decision,
  -- any Note or focus list that now points at it means someone has done real
  -- work on it, and that work outranks the convenience of undo.
  if not found
    or v_action.version <> (v_original.undo_payload_json ->> 'actionVersion')::bigint
    or v_action.trashed_at is not null
    or v_action.archived_at is not null
    or exists (
      select 1 from public.actions child
      where child.workspace_id = v_workspace_id and child.parent_action_id = v_action_id
    )
    or exists (
      select 1 from public.note_action_links relation
      where relation.workspace_id = v_workspace_id and relation.action_id = v_action_id
    )
    or exists (
      select 1 from public.daily_focus_items focus
      where focus.workspace_id = v_workspace_id and focus.action_id = v_action_id
    )
    or exists (
      select 1 from public.review_action_items item
      where item.workspace_id = v_workspace_id and item.action_id = v_action_id
    )
    or exists (
      select 1 from public.action_schedule_history history
      where history.workspace_id = v_workspace_id and history.action_id = v_action_id
    ) then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  delete from public.capture_action_links
  where workspace_id = v_workspace_id
    and capture_id = v_original.target_id
    and action_id = v_action_id;
  delete from public.actions where id = v_action_id and workspace_id = v_workspace_id;
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
  p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_original_operation_id text;
begin
  if p_operation_id = 'operation.undo.v1' then
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
  end if;
  return public.execute_operation_undo_capture_action_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.execute_capture_action_filing_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_capture_action_filing_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation_capture_action_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_capture_action_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
