begin;

insert into public.operation_undo_support (operation_id, strategy)
values ('review.complete-period.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.capture_period_review_horizon_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), new.workspace_id, 'planning_horizons', new.id,
    case when tg_op = 'INSERT' then
      jsonb_build_object('mode', 'create')
    else
      jsonb_build_object(
        'mode', 'update',
        'priorHorizon', jsonb_build_object(
          'kind', old.kind,
          'startsOn', old.starts_on,
          'endsOn', old.ends_on,
          'timezoneSnapshot', old.timezone_snapshot
        )
      )
    end
  );
  return new;
end;
$$;

create trigger planning_horizons_capture_period_review_insert
after insert on public.planning_horizons
for each row execute function public.capture_period_review_horizon_before_image();
create trigger planning_horizons_capture_period_review_update
before update on public.planning_horizons
for each row execute function public.capture_period_review_horizon_before_image();

create or replace function public.claim_period_review_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_review record;
  v_horizon record;
  v_horizon_snapshot jsonb;
begin
  if new.undo_payload_json is not null
    or new.operation_id <> 'review.complete-period.v1' then
    return new;
  end if;

  select * into v_review from public.reviews
  where id = new.target_id and workspace_id = new.workspace_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;
  select * into v_horizon from public.planning_horizons
  where id = v_review.horizon_id and workspace_id = new.workspace_id;
  select payload_json into v_horizon_snapshot
  from public.operation_before_images
  where transaction_id = txid_current()
    and workspace_id = new.workspace_id
    and target_type = 'planning_horizons'
    and target_id = v_review.horizon_id
  order by id desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;

  new.undo_payload_json := jsonb_build_object(
    'horizonMode', v_horizon_snapshot ->> 'mode',
    'priorHorizon', v_horizon_snapshot -> 'priorHorizon',
    'expectedHorizon', jsonb_build_object(
      'id', v_horizon.id,
      'kind', v_horizon.kind,
      'startsOn', v_horizon.starts_on,
      'endsOn', v_horizon.ends_on,
      'timezoneSnapshot', v_horizon.timezone_snapshot
    ),
    'expectedReview', jsonb_build_object(
      'kind', v_review.kind,
      'status', v_review.status,
      'reflectionMarkdown', v_review.reflection_markdown,
      'version', v_review.version,
      'completedAt', v_review.completed_at
    )
  );
  return new;
end;
$$;

-- Same-kind triggers run by name, so this claim precedes the general trigger
-- that clears the transaction's transient before images.
create trigger operation_receipts_a_claim_period_review
before insert on public.operation_receipts
for each row execute function public.claim_period_review_before_image();

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_trash_base;

create or replace function public.execute_period_review_undo(
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
  v_review record;
  v_horizon record;
  v_expected_review jsonb;
  v_expected_horizon jsonb;
  v_prior_horizon jsonb;
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
    and receipt.operation_id = 'review.complete-period.v1'
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

  v_expected_review := v_original.undo_payload_json -> 'expectedReview';
  v_expected_horizon := v_original.undo_payload_json -> 'expectedHorizon';
  v_prior_horizon := v_original.undo_payload_json -> 'priorHorizon';

  select * into v_review from public.reviews
  where id = v_original.target_id and workspace_id = v_workspace_id
  for update;
  if not found
    or v_review.kind is distinct from v_expected_review ->> 'kind'
    or v_review.status is distinct from v_expected_review ->> 'status'
    or v_review.reflection_markdown is distinct from v_expected_review ->> 'reflectionMarkdown'
    or v_review.version is distinct from (v_expected_review ->> 'version')::bigint
    or v_review.completed_at is distinct from (v_expected_review ->> 'completedAt')::timestamptz then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  select * into v_horizon from public.planning_horizons
  where id = (v_expected_horizon ->> 'id')::uuid and workspace_id = v_workspace_id
  for update;
  if not found
    or v_horizon.id <> v_review.horizon_id
    or v_horizon.kind is distinct from v_expected_horizon ->> 'kind'
    or v_horizon.starts_on is distinct from (v_expected_horizon ->> 'startsOn')::date
    or v_horizon.ends_on is distinct from (v_expected_horizon ->> 'endsOn')::date
    or v_horizon.timezone_snapshot is distinct from v_expected_horizon ->> 'timezoneSnapshot' then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  if v_original.undo_payload_json ->> 'horizonMode' = 'create' and (
    exists (select 1 from public.reviews where horizon_id = v_horizon.id and workspace_id = v_workspace_id and id <> v_review.id)
    or exists (select 1 from public.goals where horizon_id = v_horizon.id and workspace_id = v_workspace_id)
    or exists (select 1 from public.actions where horizon_id = v_horizon.id and workspace_id = v_workspace_id)
    or exists (
      select 1 from public.action_schedule_history
      where workspace_id = v_workspace_id
        and (previous_horizon_id = v_horizon.id or new_horizon_id = v_horizon.id)
    )
  ) then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  delete from public.reviews where id = v_review.id and workspace_id = v_workspace_id;
  if v_original.undo_payload_json ->> 'horizonMode' = 'create' then
    delete from public.planning_horizons
    where id = v_horizon.id and workspace_id = v_workspace_id;
  elsif v_original.undo_payload_json ->> 'horizonMode' = 'update'
    and v_prior_horizon is not null then
    update public.planning_horizons set
      kind = v_prior_horizon ->> 'kind',
      starts_on = (v_prior_horizon ->> 'startsOn')::date,
      ends_on = (v_prior_horizon ->> 'endsOn')::date,
      timezone_snapshot = v_prior_horizon ->> 'timezoneSnapshot'
    where id = v_horizon.id and workspace_id = v_workspace_id;
  else
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
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
  if v_original_operation_id = 'review.complete-period.v1' then
    return public.execute_period_review_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_trash_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.capture_period_review_horizon_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.claim_period_review_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_trash_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_period_review_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
