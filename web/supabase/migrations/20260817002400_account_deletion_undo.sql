begin;

update public.operation_contracts set
  reversible = false,
  updated_at = clock_timestamp()
where operation_id = 'account.deletion.cancel.v1';

insert into public.operation_undo_support (operation_id, strategy)
values ('account.deletion.schedule.v1', 'inverse-operation')
on conflict (operation_id) do update set strategy = excluded.strategy;

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_planning_archive_base;

create or replace function public.execute_account_deletion_schedule_undo(
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
  v_request record;
  v_inverse_key text;
  v_inverse_receipt_id uuid;
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
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || 'account-deletion', 0));
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  select receipt.* into v_original
  from public.operation_receipts receipt
  join public.operation_undo_support support on support.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.operation_id = 'account.deletion.schedule.v1'
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;

  select * into v_request from public.account_deletion_requests
  where id = (v_original.result_json ->> 'requestId')::uuid
    and user_id = v_user_id and workspace_id = v_workspace_id
  for update;
  if not found
    or v_request.status <> 'scheduled'
    or v_request.scheduled_for <= clock_timestamp()
    or v_request.scheduled_for is distinct from
      (v_original.result_json ->> 'scheduledFor')::timestamptz then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  v_inverse_key := 'inverse:' || v_original.id::text;
  perform public.dispatch_trusted_operation(
    'account.deletion.cancel.v1',
    jsonb_build_object('requestId', v_request.id),
    v_inverse_key,
    'ui'
  );
  select id into v_inverse_receipt_id from public.operation_receipts
  where workspace_id = v_workspace_id
    and operation_id = 'account.deletion.cancel.v1'
    and idempotency_key = v_inverse_key and status = 'succeeded';
  if v_inverse_receipt_id is null then
    raise exception using errcode = 'P0001', message = 'undo_inverse_missing';
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
  if v_original_operation_id = 'account.deletion.schedule.v1' then
    return public.execute_account_deletion_schedule_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_planning_archive_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.execute_operation_undo_planning_archive_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_account_deletion_schedule_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
