begin;

create table public.capture_proposal_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_capture_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'dismissed', 'superseded', 'failed')),
  analysis_summary text not null check (char_length(analysis_summary) between 1 and 1000),
  insights_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(insights_json) = 'array' and jsonb_array_length(insights_json) <= 10),
  model_id text not null check (char_length(model_id) between 1 and 120),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz,
  unique (id, workspace_id),
  foreign key (source_capture_id, workspace_id)
    references public.captures(id, workspace_id) on delete cascade
);
create index capture_proposal_batches_workspace_status_idx
on public.capture_proposal_batches (workspace_id, status, updated_at desc);
create index capture_proposal_batches_capture_idx
on public.capture_proposal_batches (source_capture_id, created_at desc);

alter table public.ai_proposals
  add column batch_id uuid,
  add column sort_order smallint check (sort_order between 0 and 9),
  add column version bigint not null default 1 check (version > 0),
  drop constraint ai_proposals_source_capture_id_fkey,
  add constraint ai_proposals_source_capture_workspace_fkey
    foreign key (source_capture_id, workspace_id)
    references public.captures(id, workspace_id) on delete set null (source_capture_id),
  add constraint ai_proposals_batch_workspace_fkey
    foreign key (batch_id, workspace_id)
    references public.capture_proposal_batches(id, workspace_id) on delete cascade,
  add constraint ai_proposals_batch_sort_unique unique (batch_id, sort_order),
  add constraint ai_proposals_batch_shape check (
    (batch_id is null and sort_order is null)
    or (batch_id is not null and sort_order is not null and source_capture_id is not null)
  );

alter table public.capture_proposal_batches enable row level security;
alter table public.capture_proposal_batches force row level security;
create policy capture_proposal_batches_owner_select on public.capture_proposal_batches
for select to authenticated using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = capture_proposal_batches.workspace_id
      and workspace.owner_user_id = auth.uid()
  )
);
revoke all on public.capture_proposal_batches from public, anon, authenticated;
grant select on public.capture_proposal_batches to authenticated;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('capture-proposal.item-update.v1', 'low', array['ui'], true),
  ('capture-proposal.dismiss.v1', 'low', array['ui', 'chat'], true),
  ('capture-proposal.apply.v1', 'medium', array['ui', 'chat'], false)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

insert into public.operation_undo_support (operation_id, strategy) values
  ('capture-proposal.item-update.v1', 'snapshot'),
  ('capture-proposal.dismiss.v1', 'snapshot');

create or replace function public.persist_capture_proposal_analysis(
  p_owner_user_id uuid,
  p_capture_id uuid,
  p_analysis jsonb,
  p_model_id text,
  p_prompt_version text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
  v_capture public.captures%rowtype;
  v_batch_id uuid;
  v_item jsonb;
  v_operation_id text;
  v_risk text;
  v_sort smallint := 0;
begin
  select workspace.id into v_workspace_id from public.workspaces workspace
  where workspace.owner_user_id = p_owner_user_id;
  if not found or jsonb_typeof(p_analysis) <> 'object'
    or char_length(btrim(coalesce(p_analysis ->> 'summary', ''))) not between 1 and 1000
    or jsonb_typeof(p_analysis -> 'insights') <> 'array'
    or jsonb_array_length(p_analysis -> 'insights') > 10
    or jsonb_typeof(p_analysis -> 'proposals') <> 'array'
    or jsonb_array_length(p_analysis -> 'proposals') > 10
    or char_length(p_model_id) not between 1 and 120
    or char_length(p_prompt_version) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'invalid_capture_analysis';
  end if;
  select capture.* into v_capture from public.captures capture
  where capture.id = p_capture_id and capture.workspace_id = v_workspace_id
    and capture.archived_at is null and capture.trashed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'capture_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_capture.id::text || ':analysis', 0));

  update public.capture_proposal_batches set
    status = 'superseded', version = version + 1,
    decided_at = clock_timestamp(), updated_at = clock_timestamp()
  where source_capture_id = v_capture.id and workspace_id = v_workspace_id
    and status = 'pending';
  update public.ai_proposals set status = 'superseded', decided_at = clock_timestamp()
  where source_capture_id = v_capture.id and workspace_id = v_workspace_id
    and status = 'pending' and batch_id is not null;

  insert into public.capture_proposal_batches (
    workspace_id, source_capture_id, analysis_summary, insights_json,
    model_id, prompt_version
  ) values (
    v_workspace_id, v_capture.id, btrim(p_analysis ->> 'summary'),
    p_analysis -> 'insights', p_model_id, p_prompt_version
  ) returning id into v_batch_id;

  for v_item in select value from jsonb_array_elements(p_analysis -> 'proposals')
  loop
    v_operation_id := v_item ->> 'operationId';
    select contract.risk_class into v_risk from public.operation_contracts contract
    where contract.operation_id = v_operation_id and 'ui' = any(contract.exposures)
      and contract.risk_class in ('low', 'medium')
      and v_operation_id in (
        'action.create.v1', 'note.create.v1', 'note.update.v1',
        'note.tags.set.v1', 'note.goal-link.v1'
      );
    if not found or jsonb_typeof(v_item -> 'input') <> 'object'
      or char_length(btrim(coalesce(v_item ->> 'summary', ''))) not between 1 and 300 then
      raise exception using errcode = 'P0001', message = 'invalid_capture_analysis_item';
    end if;
    insert into public.ai_proposals (
      workspace_id, source_capture_id, batch_id, sort_order,
      operation_id, input_json, summary, risk_class,
      model_id, prompt_version
    ) values (
      v_workspace_id, v_capture.id, v_batch_id, v_sort,
      v_operation_id, v_item -> 'input', btrim(v_item ->> 'summary'), v_risk,
      p_model_id, p_prompt_version
    );
    v_sort := v_sort + 1;
  end loop;
  update public.captures set state = 'proposed' where id = v_capture.id;
  return v_batch_id;
end;
$$;

create or replace function public.capture_proposal_batch_json(p_batch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', batch.id,
    'captureId', batch.source_capture_id,
    'status', batch.status,
    'version', batch.version,
    'itemCount', (select count(*) from public.ai_proposals item where item.batch_id = batch.id),
    'updatedAt', batch.updated_at
  )
  from public.capture_proposal_batches batch where batch.id = p_batch_id;
$$;

create or replace function public.capture_proposal_item_json(p_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', item.id, 'batchId', item.batch_id,
    'operationId', item.operation_id, 'input', item.input_json,
    'summary', item.summary, 'risk', item.risk_class, 'version', item.version
  ) from public.ai_proposals item where item.id = p_item_id;
$$;

create or replace function public.execute_capture_proposal_operation(
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
  v_batch public.capture_proposal_batches%rowtype;
  v_before_batch public.capture_proposal_batches%rowtype;
  v_item public.ai_proposals%rowtype;
  v_before_item public.ai_proposals%rowtype;
  v_capture public.captures%rowtype;
  v_proposal public.ai_proposals%rowtype;
  v_expected_version bigint;
  v_result jsonb;
  v_item_result jsonb;
  v_receipt_id uuid;
  v_receipt_ids jsonb := '[]'::jsonb;
  v_undo_payload jsonb;
  v_actor_type text;
  v_risk text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'capture-proposal.item-update.v1', 'capture-proposal.dismiss.v1',
    'capture-proposal.apply.v1'
  ) or p_surface not in ('ui', 'chat')
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
  where receipt.workspace_id = v_workspace_id and receipt.operation_id = p_operation_id
    and receipt.idempotency_key = p_idempotency_key and receipt.status = 'succeeded';
  if found then return v_result; end if;

  if p_operation_id = 'capture-proposal.item-update.v1' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) keys(key))
      is distinct from array['batchId', 'expectedVersion', 'id', 'input', 'summary']::text[]
      or jsonb_typeof(p_input -> 'input') <> 'object'
      or char_length(btrim(coalesce(p_input ->> 'summary', ''))) not between 1 and 300 then
      raise exception using errcode = 'P0001', message = 'invalid_capture_proposal_input';
    end if;
    select batch.* into v_batch from public.capture_proposal_batches batch
    join public.captures capture on capture.id = batch.source_capture_id
      and capture.workspace_id = batch.workspace_id
    where batch.id = (p_input ->> 'batchId')::uuid
      and batch.workspace_id = v_workspace_id and batch.status = 'pending'
      and capture.archived_at is null and capture.trashed_at is null
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    select item.* into v_item from public.ai_proposals item
    where item.id = (p_input ->> 'id')::uuid and item.batch_id = v_batch.id
      and item.workspace_id = v_workspace_id and item.status = 'pending'
    for update;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if not found or v_item.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    v_before_batch := v_batch;
    v_before_item := v_item;
    update public.ai_proposals set input_json = p_input -> 'input',
      summary = btrim(p_input ->> 'summary'), version = version + 1
    where id = v_item.id returning * into v_item;
    update public.capture_proposal_batches set version = version + 1,
      updated_at = clock_timestamp()
    where id = v_batch.id returning * into v_batch;
    v_result := public.capture_proposal_item_json(v_item.id);
    v_undo_payload := jsonb_build_object(
      'kind', 'item', 'itemBefore', to_jsonb(v_before_item),
      'itemExpected', to_jsonb(v_item), 'batchBefore', to_jsonb(v_before_batch),
      'batchExpected', to_jsonb(v_batch)
    );
  else
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) keys(key))
      is distinct from array['expectedVersion', 'id']::text[] then
      raise exception using errcode = 'P0001', message = 'invalid_capture_proposal_input';
    end if;
    select batch.* into v_batch from public.capture_proposal_batches batch
    join public.captures source_capture on source_capture.id = batch.source_capture_id
      and source_capture.workspace_id = batch.workspace_id
    where batch.id = (p_input ->> 'id')::uuid and batch.workspace_id = v_workspace_id
      and batch.status = 'pending' and source_capture.archived_at is null
      and source_capture.trashed_at is null for update of batch;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if not found or v_batch.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    v_before_batch := v_batch;
    select capture.* into v_capture from public.captures capture
    where capture.id = v_batch.source_capture_id and capture.workspace_id = v_workspace_id
    for update;
    if p_operation_id = 'capture-proposal.dismiss.v1' then
      update public.capture_proposal_batches set status = 'dismissed',
        version = version + 1, decided_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = v_batch.id returning * into v_batch;
      update public.ai_proposals set status = 'dismissed', decided_at = clock_timestamp()
      where batch_id = v_batch.id and status = 'pending';
      update public.captures set state = 'reviewed' where id = v_capture.id;
      v_result := public.capture_proposal_batch_json(v_batch.id);
      v_undo_payload := jsonb_build_object(
        'kind', 'dismiss', 'batchBefore', to_jsonb(v_before_batch),
        'batchExpected', to_jsonb(v_batch)
      );
    else
      for v_proposal in
        select proposal.* from public.ai_proposals proposal
        where proposal.batch_id = v_batch.id and proposal.status = 'pending'
        order by proposal.sort_order for update
      loop
        v_item_result := public.dispatch_trusted_operation(
          v_proposal.operation_id, v_proposal.input_json,
          v_batch.id::text || ':' || v_proposal.id::text, p_surface
        );
        select receipt.id into v_receipt_id from public.operation_receipts receipt
        where receipt.workspace_id = v_workspace_id
          and receipt.operation_id = v_proposal.operation_id
          and receipt.idempotency_key = v_batch.id::text || ':' || v_proposal.id::text;
        v_receipt_ids := v_receipt_ids || jsonb_build_array(v_receipt_id);
        update public.ai_proposals set status = 'applied', result_json = v_item_result,
          decided_at = clock_timestamp(), applied_at = clock_timestamp()
        where id = v_proposal.id;
      end loop;
      update public.capture_proposal_batches set status = 'applied',
        version = version + 1, decided_at = clock_timestamp(),
        applied_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = v_batch.id returning * into v_batch;
      update public.captures set state = 'reviewed' where id = v_capture.id;
      v_result := public.capture_proposal_batch_json(v_batch.id)
        || jsonb_build_object('receiptIds', v_receipt_ids);
    end if;
  end if;

  v_actor_type := case when p_surface = 'chat' then 'assistant' else 'user' end;
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status,
    result_json, undo_payload_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id, v_actor_type, p_surface,
    p_idempotency_key, v_risk,
    case when p_operation_id = 'capture-proposal.item-update.v1'
      then 'capture_proposal_item' else 'capture_proposal_batch' end,
    case when p_operation_id = 'capture-proposal.item-update.v1'
      then v_item.id else v_batch.id end,
    'succeeded', v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, v_actor_type, p_surface, p_operation_id,
    case when p_operation_id = 'capture-proposal.item-update.v1'
      then 'capture_proposal_item' else 'capture_proposal_batch' end,
    case when p_operation_id = 'capture-proposal.item-update.v1'
      then v_item.id else v_batch.id end,
    v_risk, case when p_operation_id = 'capture-proposal.apply.v1' and p_surface = 'chat'
      then 'explicit_chat_approval'
      when p_operation_id = 'capture-proposal.apply.v1' then 'explicit_ui_commit'
      else 'not_required' end, 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range
    or not_null_violation or check_violation or foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'invalid_capture_proposal_input';
end;
$$;

alter function public.dispatch_trusted_operation(text, jsonb, text, text)
rename to dispatch_trusted_operation_capture_proposal_base;

create or replace function public.dispatch_trusted_operation(
  p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_operation_id like 'capture-proposal.%' then
    return public.execute_capture_proposal_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.dispatch_trusted_operation_capture_proposal_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
end;
$$;

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_capture_proposal_base;

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
  v_batch public.capture_proposal_batches%rowtype;
  v_item public.ai_proposals%rowtype;
  v_before jsonb;
  v_expected jsonb;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if p_operation_id <> 'operation.undo.v1' then
    return public.execute_operation_undo_capture_proposal_base(
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
    and receipt.operation_id in (
      'capture-proposal.item-update.v1', 'capture-proposal.dismiss.v1'
    ) and receipt.status = 'succeeded' and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    return public.execute_operation_undo_capture_proposal_base(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  if p_surface <> 'ui' or v_original.undo_payload_json is null
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select receipt.result_json into v_result from public.operation_receipts receipt
  where receipt.workspace_id = v_workspace_id and receipt.operation_id = p_operation_id
    and receipt.idempotency_key = p_idempotency_key and receipt.status = 'succeeded';
  if found then return v_result; end if;

  v_before := v_original.undo_payload_json -> 'batchBefore';
  v_expected := v_original.undo_payload_json -> 'batchExpected';
  select batch.* into v_batch from public.capture_proposal_batches batch
  where batch.id = (v_expected ->> 'id')::uuid and batch.workspace_id = v_workspace_id
  for update;
  if not found or v_batch.version <> (v_expected ->> 'version')::bigint
    or v_batch.status <> v_expected ->> 'status' then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;
  if v_original.undo_payload_json ->> 'kind' = 'item' then
    select item.* into v_item from public.ai_proposals item
    where item.id = v_original.target_id and item.batch_id = v_batch.id for update;
    v_expected := v_original.undo_payload_json -> 'itemExpected';
    if not found or v_item.version <> (v_expected ->> 'version')::bigint
      or v_item.input_json is distinct from v_expected -> 'input_json'
      or v_item.summary <> v_expected ->> 'summary' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_before := v_original.undo_payload_json -> 'itemBefore';
    update public.ai_proposals set input_json = v_before -> 'input_json',
      summary = v_before ->> 'summary', version = (v_before ->> 'version')::bigint
    where id = v_item.id;
  else
    if exists (select 1 from public.ai_proposals item where item.batch_id = v_batch.id
      and item.status <> 'dismissed')
      or exists (select 1 from public.captures capture
        where capture.id = v_batch.source_capture_id
          and (capture.state <> 'reviewed' or capture.trashed_at is not null
            or capture.archived_at is not null)) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    update public.ai_proposals set status = 'pending', decided_at = null
    where batch_id = v_batch.id;
    update public.captures set state = 'proposed' where id = v_batch.source_capture_id;
  end if;
  v_before := v_original.undo_payload_json -> 'batchBefore';
  update public.capture_proposal_batches set
    status = v_before ->> 'status', version = (v_before ->> 'version')::bigint,
    decided_at = nullif(v_before ->> 'decided_at', '')::timestamptz,
    applied_at = nullif(v_before ->> 'applied_at', '')::timestamptz,
    updated_at = clock_timestamp()
  where id = v_batch.id;

  update public.operation_receipts set reversed_at = clock_timestamp()
  where id = v_original.id;
  v_undo_receipt_id := extensions.gen_random_uuid();
  v_result := jsonb_build_object(
    'originalReceiptId', v_original.id, 'undoReceiptId', v_undo_receipt_id,
    'status', 'undone'
  );
  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_undo_receipt_id, v_workspace_id, p_operation_id, v_user_id, 'user', p_surface,
    p_idempotency_key, 'low', v_original.target_type, v_original.target_id,
    'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', p_surface, p_operation_id,
    v_original.target_type, v_original.target_id, 'low', 'not_required', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.persist_capture_proposal_analysis(uuid, uuid, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.persist_capture_proposal_analysis(uuid, uuid, jsonb, text, text)
to service_role;
revoke all on function public.capture_proposal_batch_json(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.capture_proposal_item_json(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.execute_capture_proposal_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation_capture_proposal_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_capture_proposal_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
