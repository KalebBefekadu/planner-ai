begin;

create table public.trash_batch_focus_items (
  batch_id uuid not null references public.trash_batches(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  focus_on date not null,
  action_id uuid not null,
  sort_order smallint not null check (sort_order between 0 and 4),
  primary key (batch_id, focus_on, action_id),
  unique (batch_id, focus_on, sort_order),
  foreign key (action_id, workspace_id)
    references public.actions(id, workspace_id) on delete cascade
);
alter table public.trash_batch_focus_items enable row level security;
alter table public.trash_batch_focus_items force row level security;
revoke all on public.trash_batch_focus_items from public, anon, authenticated;

create or replace function public.capture_trash_batch_action_focus()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_batch_id uuid;
begin
  select item.batch_id into v_batch_id
  from public.trash_batch_items item
  join public.trash_batches batch on batch.id = item.batch_id
  where item.workspace_id = old.workspace_id
    and item.item_type = 'action' and item.item_id = old.id
    and batch.restored_at is null and batch.emptied_at is null
  order by batch.created_at desc
  limit 1;
  if v_batch_id is not null then
    insert into public.trash_batch_focus_items (
      batch_id, workspace_id, focus_on, action_id, sort_order
    )
    select v_batch_id, old.workspace_id, focus_on, old.id, sort_order
    from public.daily_focus_items
    where workspace_id = old.workspace_id and action_id = old.id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.restore_trash_batch_action_focus()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_batch_id uuid;
begin
  select item.batch_id into v_batch_id
  from public.trash_batch_items item
  join public.trash_batches batch on batch.id = item.batch_id
  where item.workspace_id = new.workspace_id
    and item.item_type = 'action' and item.item_id = new.id
    and batch.restored_at is null and batch.emptied_at is null
  order by batch.created_at desc
  limit 1;
  if v_batch_id is null then return new; end if;

  if exists (
    select 1 from public.trash_batch_focus_items saved
    join public.daily_focus_items current
      on current.workspace_id = saved.workspace_id
      and current.focus_on = saved.focus_on
      and current.sort_order = saved.sort_order
      and current.action_id <> saved.action_id
    where saved.batch_id = v_batch_id and saved.action_id = new.id
  ) then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;
  insert into public.daily_focus_items (workspace_id, focus_on, action_id, sort_order)
  select workspace_id, focus_on, action_id, sort_order
  from public.trash_batch_focus_items
  where batch_id = v_batch_id and action_id = new.id
  on conflict do nothing;
  return new;
end;
$$;

create trigger actions_capture_trash_focus
before update of trashed_at on public.actions
for each row when (old.trashed_at is null and new.trashed_at is not null)
execute function public.capture_trash_batch_action_focus();
create trigger actions_restore_trash_focus
after update of trashed_at on public.actions
for each row when (old.trashed_at is not null and new.trashed_at is null)
execute function public.restore_trash_batch_action_focus();

insert into public.operation_undo_support (operation_id, strategy)
values ('trash.restore.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.trash_item_snapshot(
  p_workspace_id uuid,
  p_item_type text,
  p_item_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot jsonb;
begin
  if p_item_type = 'goal' then
    select jsonb_build_object('itemType', p_item_type, 'row', to_jsonb(item))
    into v_snapshot from public.goals item
    where item.id = p_item_id and item.workspace_id = p_workspace_id;
  elsif p_item_type = 'action' then
    select jsonb_build_object(
      'itemType', p_item_type,
      'row', to_jsonb(item),
      'focusItems', coalesce((
        select jsonb_agg(
          jsonb_build_object('focusOn', focus_on, 'sortOrder', sort_order)
          order by focus_on, sort_order
        ) from public.daily_focus_items
        where workspace_id = p_workspace_id and action_id = p_item_id
      ), '[]'::jsonb)
    ) into v_snapshot from public.actions item
    where item.id = p_item_id and item.workspace_id = p_workspace_id;
  elsif p_item_type = 'note' then
    select jsonb_build_object('itemType', p_item_type, 'row', to_jsonb(item) - 'search_vector')
    into v_snapshot from public.notes item
    where item.id = p_item_id and item.workspace_id = p_workspace_id;
  elsif p_item_type = 'capture' then
    select jsonb_build_object('itemType', p_item_type, 'row', to_jsonb(item))
    into v_snapshot from public.captures item
    where item.id = p_item_id and item.workspace_id = p_workspace_id;
  elsif p_item_type = 'memory' then
    select jsonb_build_object('itemType', p_item_type, 'row', to_jsonb(item))
    into v_snapshot from public.memories item
    where item.id = p_item_id and item.workspace_id = p_workspace_id;
  elsif p_item_type = 'conversation' then
    select jsonb_build_object(
      'itemType', p_item_type,
      'row', to_jsonb(item),
      'messages', jsonb_build_object(
        'count', (select count(*) from public.conversation_messages message
                  where message.workspace_id = p_workspace_id and message.conversation_id = p_item_id),
        'latestAt', (select max(created_at) from public.conversation_messages message
                     where message.workspace_id = p_workspace_id and message.conversation_id = p_item_id)
      )
    ) into v_snapshot from public.conversations item
    where item.id = p_item_id and item.workspace_id = p_workspace_id;
  else
    raise exception using errcode = 'P0001', message = 'invalid_trash_type';
  end if;
  return v_snapshot;
end;
$$;

create or replace function public.capture_trash_restore_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_item_type text := case tg_table_name
    when 'goals' then 'goal'
    when 'actions' then 'action'
    when 'notes' then 'note'
    when 'captures' then 'capture'
    when 'memories' then 'memory'
    when 'conversations' then 'conversation'
  end;
begin
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), old.workspace_id, 'trash_restore_items', old.id,
    jsonb_build_object(
      'itemType', v_item_type,
      'priorTrashedAt', v_old -> 'trashed_at',
      'priorPurgeAfter', v_old -> 'purge_after'
    )
  );
  return new;
end;
$$;

create trigger goals_capture_trash_restore
before update of trashed_at on public.goals
for each row when (old.trashed_at is not null and new.trashed_at is null)
execute function public.capture_trash_restore_before_image();
create trigger actions_capture_trash_restore
before update of trashed_at on public.actions
for each row when (old.trashed_at is not null and new.trashed_at is null)
execute function public.capture_trash_restore_before_image();
create trigger notes_capture_trash_restore
before update of trashed_at on public.notes
for each row when (old.trashed_at is not null and new.trashed_at is null)
execute function public.capture_trash_restore_before_image();
create trigger captures_capture_trash_restore
before update of trashed_at on public.captures
for each row when (old.trashed_at is not null and new.trashed_at is null)
execute function public.capture_trash_restore_before_image();
create trigger memories_capture_trash_restore
before update of trashed_at on public.memories
for each row when (old.trashed_at is not null and new.trashed_at is null)
execute function public.capture_trash_restore_before_image();
create trigger conversations_capture_trash_restore
before update of trashed_at on public.conversations
for each row when (old.trashed_at is not null and new.trashed_at is null)
execute function public.capture_trash_restore_before_image();

create or replace function public.claim_trash_restore_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_batch record;
  v_items jsonb;
  v_expected_batch_items jsonb;
begin
  if new.undo_payload_json is not null or new.operation_id <> 'trash.restore.v1' then
    return new;
  end if;
  select * into v_batch from public.trash_batches
  where id = new.target_id and workspace_id = new.workspace_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemType', before_image.payload_json ->> 'itemType',
    'itemId', before_image.target_id,
    'priorTrashedAt', before_image.payload_json -> 'priorTrashedAt',
    'priorPurgeAfter', before_image.payload_json -> 'priorPurgeAfter',
    'expected', public.trash_item_snapshot(
      new.workspace_id, before_image.payload_json ->> 'itemType', before_image.target_id
    )
  ) order by before_image.payload_json ->> 'itemType', before_image.target_id), '[]'::jsonb)
  into v_items
  from public.operation_before_images before_image
  join public.trash_batch_items batch_item
    on batch_item.batch_id = new.target_id
    and batch_item.workspace_id = before_image.workspace_id
    and batch_item.item_type = before_image.payload_json ->> 'itemType'
    and batch_item.item_id = before_image.target_id
  where before_image.transaction_id = txid_current()
    and before_image.workspace_id = new.workspace_id
    and before_image.target_type = 'trash_restore_items';
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemType', item_type, 'itemId', item_id
  ) order by item_type, item_id), '[]'::jsonb)
  into v_expected_batch_items
  from public.trash_batch_items
  where batch_id = new.target_id and workspace_id = new.workspace_id;
  if v_batch.id is null
    or jsonb_array_length(v_items) <> jsonb_array_length(v_expected_batch_items)
    or jsonb_array_length(v_items) < 1 then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;
  new.undo_payload_json := jsonb_build_object(
    'expectedBatch', jsonb_build_object(
      'restoredAt', v_batch.restored_at,
      'emptiedAt', v_batch.emptied_at
    ),
    'expectedBatchItems', v_expected_batch_items,
    'items', v_items
  );
  return new;
end;
$$;

create trigger operation_receipts_ad_claim_trash_restore
before insert on public.operation_receipts
for each row execute function public.claim_trash_restore_before_image();

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_note_import_base;

create or replace function public.execute_trash_restore_undo(
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
  v_batch record;
  v_snapshot jsonb;
  v_current_batch_items jsonb;
  v_table_name text;
  v_locked_id uuid;
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
    and receipt.operation_id = 'trash.restore.v1'
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

  select * into v_batch from public.trash_batches
  where id = v_original.target_id and workspace_id = v_workspace_id
  for update;
  if not found
    or v_batch.restored_at is distinct from
      (v_original.undo_payload_json #>> '{expectedBatch,restoredAt}')::timestamptz
    or v_batch.emptied_at is distinct from
      nullif(v_original.undo_payload_json #>> '{expectedBatch,emptiedAt}', '')::timestamptz then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemType', item_type, 'itemId', item_id
  ) order by item_type, item_id), '[]'::jsonb)
  into v_current_batch_items
  from public.trash_batch_items
  where batch_id = v_batch.id and workspace_id = v_workspace_id;
  if v_current_batch_items is distinct from v_original.undo_payload_json -> 'expectedBatchItems' then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  for v_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'items')
    order by value ->> 'itemType', value ->> 'itemId'
  loop
    v_table_name := case v_snapshot ->> 'itemType'
      when 'goal' then 'goals'
      when 'action' then 'actions'
      when 'note' then 'notes'
      when 'capture' then 'captures'
      when 'memory' then 'memories'
      when 'conversation' then 'conversations'
      else null
    end;
    if v_table_name is null then
      raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
    end if;
    v_locked_id := null;
    execute format(
      'select id from public.%I where id = $1 and workspace_id = $2 for update',
      v_table_name
    ) into v_locked_id using (v_snapshot ->> 'itemId')::uuid, v_workspace_id;
    if v_locked_id is null or public.trash_item_snapshot(
      v_workspace_id, v_snapshot ->> 'itemType', (v_snapshot ->> 'itemId')::uuid
    ) is distinct from v_snapshot -> 'expected' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end loop;

  for v_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'items')
    order by value ->> 'itemType', value ->> 'itemId'
  loop
    if v_snapshot ->> 'itemType' = 'goal' then
      update public.goals set
        trashed_at = (v_snapshot ->> 'priorTrashedAt')::timestamptz,
        purge_after = (v_snapshot ->> 'priorPurgeAfter')::timestamptz,
        version = version + 1
      where id = (v_snapshot ->> 'itemId')::uuid and workspace_id = v_workspace_id;
    elsif v_snapshot ->> 'itemType' = 'action' then
      update public.actions set
        trashed_at = (v_snapshot ->> 'priorTrashedAt')::timestamptz,
        purge_after = (v_snapshot ->> 'priorPurgeAfter')::timestamptz,
        version = version + 1
      where id = (v_snapshot ->> 'itemId')::uuid and workspace_id = v_workspace_id;
    elsif v_snapshot ->> 'itemType' = 'note' then
      update public.notes set
        trashed_at = (v_snapshot ->> 'priorTrashedAt')::timestamptz,
        purge_after = (v_snapshot ->> 'priorPurgeAfter')::timestamptz,
        version = version + 1
      where id = (v_snapshot ->> 'itemId')::uuid and workspace_id = v_workspace_id;
    elsif v_snapshot ->> 'itemType' = 'capture' then
      update public.captures set
        trashed_at = (v_snapshot ->> 'priorTrashedAt')::timestamptz,
        purge_after = (v_snapshot ->> 'priorPurgeAfter')::timestamptz
      where id = (v_snapshot ->> 'itemId')::uuid and workspace_id = v_workspace_id;
    elsif v_snapshot ->> 'itemType' = 'memory' then
      update public.memories set
        trashed_at = (v_snapshot ->> 'priorTrashedAt')::timestamptz,
        version = version + 1,
        updated_at = clock_timestamp()
      where id = (v_snapshot ->> 'itemId')::uuid and workspace_id = v_workspace_id;
    else
      update public.conversations set
        trashed_at = (v_snapshot ->> 'priorTrashedAt')::timestamptz,
        updated_at = clock_timestamp()
      where id = (v_snapshot ->> 'itemId')::uuid and workspace_id = v_workspace_id;
    end if;
  end loop;
  update public.trash_batches set restored_at = null where id = v_batch.id;

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
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range or not_null_violation then
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
  if v_original_operation_id = 'trash.restore.v1' then
    return public.execute_trash_restore_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_note_import_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.capture_trash_batch_action_focus()
from public, anon, authenticated, service_role;
revoke all on function public.restore_trash_batch_action_focus()
from public, anon, authenticated, service_role;
revoke all on function public.trash_item_snapshot(uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.capture_trash_restore_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.claim_trash_restore_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_note_import_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_trash_restore_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
