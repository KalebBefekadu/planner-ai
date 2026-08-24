begin;

insert into public.operation_undo_support (operation_id, strategy) values
  ('note.import-preview.v1', 'trash-create'),
  ('note.import-commit.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.capture_note_import_job_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), old.workspace_id, 'note_import_jobs', old.id,
    jsonb_build_object(
      'status', old.status,
      'createCount', old.create_count,
      'duplicateCount', old.duplicate_count,
      'unsupportedCount', old.unsupported_count,
      'committedCount', old.committed_count,
      'completedAt', old.completed_at,
      'updatedAt', old.updated_at
    )
  );
  return new;
end;
$$;

create or replace function public.capture_note_import_item_commit()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), old.workspace_id, 'note_import_item_commits', old.id,
    jsonb_build_object(
      'jobId', old.job_id,
      'priorTargetNoteId', old.target_note_id,
      'priorCommittedAt', old.committed_at,
      'expectedTargetNoteId', new.target_note_id,
      'expectedCommittedAt', new.committed_at
    )
  );
  return new;
end;
$$;

create trigger note_import_jobs_capture_before_image
before update on public.note_import_jobs
for each row execute function public.capture_note_import_job_before_image();
create trigger note_import_items_capture_commit
before update on public.note_import_items
for each row when (old.target_note_id is null and new.target_note_id is not null)
execute function public.capture_note_import_item_commit();

create or replace function public.claim_note_import_commit_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_job record;
  v_prior_job jsonb;
  v_items jsonb;
  v_notes jsonb;
begin
  if new.undo_payload_json is not null
    or new.operation_id <> 'note.import-commit.v1' then
    return new;
  end if;

  select * into v_job from public.note_import_jobs
  where id = new.target_id and workspace_id = new.workspace_id;
  select payload_json into v_prior_job
  from public.operation_before_images
  where transaction_id = txid_current()
    and workspace_id = new.workspace_id
    and target_type = 'note_import_jobs'
    and target_id = new.target_id
  order by id
  limit 1;
  if v_job.id is null or v_prior_job is null then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', item.id,
    'priorTargetNoteId', before_image.payload_json -> 'priorTargetNoteId',
    'priorCommittedAt', before_image.payload_json -> 'priorCommittedAt',
    'expectedTargetNoteId', item.target_note_id,
    'expectedCommittedAt', item.committed_at
  ) order by item.id), '[]'::jsonb)
  into v_items
  from public.operation_before_images before_image
  join public.note_import_items item
    on item.id = before_image.target_id and item.workspace_id = before_image.workspace_id
  where before_image.transaction_id = txid_current()
    and before_image.workspace_id = new.workspace_id
    and before_image.target_type = 'note_import_item_commits'
    and before_image.payload_json ->> 'jobId' = new.target_id::text;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', note.id,
    'parentNoteId', note.parent_note_id,
    'title', note.title,
    'bodyMarkdown', note.body_markdown,
    'sortKey', note.sort_key,
    'aiExcluded', note.ai_excluded,
    'version', note.version,
    'createdAt', note.created_at,
    'updatedAt', note.updated_at,
    'archivedAt', note.archived_at,
    'trashedAt', note.trashed_at,
    'purgeAfter', note.purge_after
  ) order by note.id), '[]'::jsonb)
  into v_notes
  from jsonb_to_recordset(v_items) as item("expectedTargetNoteId" uuid)
  join public.notes note
    on note.id = item."expectedTargetNoteId" and note.workspace_id = new.workspace_id;

  if jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_notes) <> jsonb_array_length(v_items) then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;

  new.undo_payload_json := jsonb_build_object(
    'priorJob', v_prior_job,
    'expectedJob', jsonb_build_object(
      'status', v_job.status,
      'createCount', v_job.create_count,
      'duplicateCount', v_job.duplicate_count,
      'unsupportedCount', v_job.unsupported_count,
      'committedCount', v_job.committed_count,
      'completedAt', v_job.completed_at,
      'updatedAt', v_job.updated_at
    ),
    'items', v_items,
    'createdNotes', v_notes
  );
  return new;
end;
$$;

create trigger operation_receipts_ac_claim_note_import
before insert on public.operation_receipts
for each row execute function public.claim_note_import_commit_before_image();

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_account_deletion_base;

create or replace function public.execute_note_import_undo(
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
  v_job record;
  v_current_items jsonb;
  v_current_notes jsonb;
  v_prior_job jsonb;
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
    and receipt.operation_id in ('note.import-preview.v1', 'note.import-commit.v1')
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;

  select * into v_job from public.note_import_jobs
  where id = v_original.target_id and workspace_id = v_workspace_id
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  if v_original.operation_id = 'note.import-preview.v1' then
    if v_job.status is distinct from v_original.result_json ->> 'status'
      or v_job.total_count is distinct from (v_original.result_json ->> 'totalCount')::integer
      or v_job.create_count is distinct from (v_original.result_json ->> 'createCount')::integer
      or v_job.duplicate_count is distinct from (v_original.result_json ->> 'duplicateCount')::integer
      or v_job.unsupported_count is distinct from (v_original.result_json ->> 'unsupportedCount')::integer
      or v_job.committed_count <> 0
      or exists (
        select 1 from public.note_import_items
        where workspace_id = v_workspace_id and job_id = v_job.id
          and disposition = 'create' and target_note_id is not null
      )
      or exists (
        select 1 from public.operation_receipts
        where workspace_id = v_workspace_id and target_id = v_job.id
          and operation_id = 'note.import-commit.v1' and status = 'succeeded'
          and reversed_at is null
      ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    delete from public.note_import_jobs
    where id = v_job.id and workspace_id = v_workspace_id;
  else
    if v_original.undo_payload_json is null then
      raise exception using errcode = 'P0001', message = 'undo_not_supported';
    end if;
    v_prior_job := v_original.undo_payload_json -> 'priorJob';
    if v_job.status is distinct from v_original.undo_payload_json #>> '{expectedJob,status}'
      or v_job.create_count is distinct from (v_original.undo_payload_json #>> '{expectedJob,createCount}')::integer
      or v_job.duplicate_count is distinct from (v_original.undo_payload_json #>> '{expectedJob,duplicateCount}')::integer
      or v_job.unsupported_count is distinct from (v_original.undo_payload_json #>> '{expectedJob,unsupportedCount}')::integer
      or v_job.committed_count is distinct from (v_original.undo_payload_json #>> '{expectedJob,committedCount}')::integer
      or v_job.completed_at is distinct from nullif(v_original.undo_payload_json #>> '{expectedJob,completedAt}', '')::timestamptz then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

    perform 1 from public.notes note
    join jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as expected(id uuid)
      on expected.id = note.id
    where note.workspace_id = v_workspace_id
    order by note.id
    for update of note;
    select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', item.id,
      'priorTargetNoteId', snapshot."priorTargetNoteId",
      'priorCommittedAt', snapshot."priorCommittedAt",
      'expectedTargetNoteId', item.target_note_id,
      'expectedCommittedAt', item.committed_at
    ) order by item.id), '[]'::jsonb)
    into v_current_items
    from jsonb_to_recordset(v_original.undo_payload_json -> 'items') as snapshot(
      "itemId" uuid, "priorTargetNoteId" jsonb, "priorCommittedAt" jsonb,
      "expectedTargetNoteId" uuid, "expectedCommittedAt" timestamptz
    )
    join public.note_import_items item
      on item.id = snapshot."itemId" and item.workspace_id = v_workspace_id;
    if v_current_items is distinct from v_original.undo_payload_json -> 'items' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', note.id,
      'parentNoteId', note.parent_note_id,
      'title', note.title,
      'bodyMarkdown', note.body_markdown,
      'sortKey', note.sort_key,
      'aiExcluded', note.ai_excluded,
      'version', note.version,
      'createdAt', note.created_at,
      'updatedAt', note.updated_at,
      'archivedAt', note.archived_at,
      'trashedAt', note.trashed_at,
      'purgeAfter', note.purge_after
    ) order by note.id), '[]'::jsonb)
    into v_current_notes
    from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as expected(id uuid)
    join public.notes note on note.id = expected.id and note.workspace_id = v_workspace_id;
    if v_current_notes is distinct from v_original.undo_payload_json -> 'createdNotes' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

    if exists (
      select 1 from public.notes child
      where child.workspace_id = v_workspace_id
        and child.parent_note_id in (
          select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
        )
        and child.id not in (
          select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
        )
    ) or exists (
      select 1 from public.note_links link
      where link.workspace_id = v_workspace_id and (
        link.source_note_id in (
          select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
        ) or link.target_note_id in (
          select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
        )
      )
    ) or exists (
      select 1 from public.note_tags relation
      where relation.workspace_id = v_workspace_id and relation.note_id in (
        select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
      )
    ) or exists (
      select 1 from public.note_goal_links relation
      where relation.workspace_id = v_workspace_id and relation.note_id in (
        select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
      )
    ) or exists (
      select 1 from public.note_action_links relation
      where relation.workspace_id = v_workspace_id and relation.note_id in (
        select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
      )
    ) or exists (
      select 1 from public.capture_note_links relation
      where relation.workspace_id = v_workspace_id and relation.note_id in (
        select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
      )
    ) or exists (
      select 1 from public.note_import_items item
      where item.workspace_id = v_workspace_id
        and item.id not in (
          select "itemId" from jsonb_to_recordset(v_original.undo_payload_json -> 'items')
            as expected("itemId" uuid)
        )
        and item.target_note_id in (
          select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as note(id uuid)
        )
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

    update public.note_import_items item set
      target_note_id = null,
      committed_at = null
    from jsonb_to_recordset(v_original.undo_payload_json -> 'items') as snapshot("itemId" uuid)
    where item.id = snapshot."itemId" and item.workspace_id = v_workspace_id;
    delete from public.notes note
    where note.workspace_id = v_workspace_id and note.id in (
      select id from jsonb_to_recordset(v_original.undo_payload_json -> 'createdNotes') as expected(id uuid)
    );
    update public.note_import_jobs set
      status = v_prior_job ->> 'status',
      create_count = (v_prior_job ->> 'createCount')::integer,
      duplicate_count = (v_prior_job ->> 'duplicateCount')::integer,
      unsupported_count = (v_prior_job ->> 'unsupportedCount')::integer,
      committed_count = (v_prior_job ->> 'committedCount')::integer,
      completed_at = nullif(v_prior_job ->> 'completedAt', '')::timestamptz
    where id = v_job.id and workspace_id = v_workspace_id;
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
  if v_original_operation_id in ('note.import-preview.v1', 'note.import-commit.v1') then
    return public.execute_note_import_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_account_deletion_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.capture_note_import_job_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.capture_note_import_item_commit()
from public, anon, authenticated, service_role;
revoke all on function public.claim_note_import_commit_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_account_deletion_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_note_import_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
