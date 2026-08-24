begin;

insert into public.operation_undo_support (operation_id, strategy)
values ('vision.upsert.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.capture_vision_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), old.workspace_id, 'visions', old.id,
    jsonb_build_object('mode', 'update', 'bodyMarkdown', old.body_markdown)
  );
  return new;
end;
$$;

create trigger visions_capture_operation_before_image
before update on public.visions
for each row execute function public.capture_vision_before_image();

create or replace function public.claim_operation_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.undo_payload_json is null and new.operation_id = 'vision.upsert.v1' then
    select payload_json into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = 'visions'
      and target_id = new.target_id
    order by id desc
    limit 1;
    new.undo_payload_json := coalesce(
      new.undo_payload_json,
      jsonb_build_object('mode', 'create')
    );
  elsif new.undo_payload_json is null and new.operation_id = 'daily-focus.set.v1' then
    select jsonb_build_object(
      'focusOn', new.result_json ->> 'focusOn',
      'items', coalesce(jsonb_agg(payload_json order by (payload_json ->> 'sortOrder')::smallint)
        filter (where payload_json is not null), '[]'::jsonb)
    ) into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = 'daily_focus'
      and payload_json ->> 'focusOn' = new.result_json ->> 'focusOn';
  elsif new.undo_payload_json is null and new.operation_id = 'note.tags.set.v1' then
    select jsonb_build_object(
      'tags', coalesce(jsonb_agg(payload_json ->> 'tag' order by payload_json ->> 'tag')
        filter (where payload_json is not null), '[]'::jsonb)
    ) into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = 'note_tags'
      and target_id = new.target_id;
  elsif new.undo_payload_json is null and new.operation_id in (
    'note.goal-unlink.v1', 'note.action-unlink.v1'
  ) then
    select payload_json into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = case new.operation_id
        when 'note.goal-unlink.v1' then 'note_goal_links'
        else 'note_action_links'
      end
      and target_id = new.target_id
    order by id desc
    limit 1;
    if new.undo_payload_json is null then
      raise exception using errcode = 'P0001', message = 'relation_not_found';
    end if;
  elsif new.undo_payload_json is null and new.operation_id in (
    'goal.update.v1', 'goal.status.v1',
    'action.update.v1', 'action.move.v1', 'action.status.v1',
    'memory.update.v1', 'workspace.preferences.v1', 'workspace.ai-budget.v1'
  ) then
    select payload_json into new.undo_payload_json
    from public.operation_before_images
    where transaction_id = txid_current()
      and workspace_id = new.workspace_id
      and target_type = case new.target_type
        when 'goal' then 'goals'
        when 'action' then 'actions'
        when 'memory' then 'memories'
        when 'workspace' then 'workspaces'
      end
      and target_id = new.target_id
    order by id desc
    limit 1;
  end if;
  delete from public.operation_before_images where transaction_id = txid_current();
  return new;
end;
$$;

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_metadata_base;

create or replace function public.execute_vision_undo(
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
  v_vision record;
  v_expected_version bigint;
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
    and receipt.operation_id = 'vision.upsert.v1'
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

  v_expected_version := (v_original.result_json ->> 'version')::bigint;
  select * into v_vision from public.visions
  where id = v_original.target_id and workspace_id = v_workspace_id
    and version = v_expected_version and trashed_at is null
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  if v_original.undo_payload_json ->> 'mode' = 'create' then
    if v_expected_version <> 1 or exists (
      select 1 from public.goals
      where workspace_id = v_workspace_id and vision_id = v_original.target_id
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    delete from public.visions
    where id = v_original.target_id and workspace_id = v_workspace_id;
  else
    update public.visions set
      body_markdown = v_original.undo_payload_json ->> 'bodyMarkdown',
      version = version + 1
    where id = v_original.target_id and workspace_id = v_workspace_id;
  end if;

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
  if v_original_operation_id = 'vision.upsert.v1' then
    return public.execute_vision_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_metadata_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.capture_vision_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_metadata_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_vision_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
