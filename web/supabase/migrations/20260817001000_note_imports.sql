begin;

create table public.note_import_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_name text not null check (char_length(source_name) between 1 and 255),
  source_type text not null check (source_type in ('notion', 'obsidian', 'generic')),
  status text not null default 'preview'
    check (status in ('preview', 'committing', 'completed', 'canceled')),
  total_count integer not null check (total_count between 1 and 500),
  create_count integer not null default 0 check (create_count between 0 and 500),
  duplicate_count integer not null default 0 check (duplicate_count between 0 and 500),
  unsupported_count integer not null default 0 check (unsupported_count between 0 and 500),
  committed_count integer not null default 0 check (committed_count between 0 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, workspace_id)
);
create index note_import_jobs_workspace_idx
on public.note_import_jobs (workspace_id, created_at desc);
create trigger note_import_jobs_set_updated_at before update on public.note_import_jobs
for each row execute function public.set_updated_at();

create table public.note_import_items (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  source_path text not null check (char_length(source_path) between 1 and 1000),
  parent_source_path text check (
    parent_source_path is null or char_length(parent_source_path) between 1 and 1000
  ),
  title text not null check (char_length(title) between 1 and 300),
  body_markdown text not null check (char_length(body_markdown) <= 50000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  disposition text not null check (
    disposition in ('create', 'skip_duplicate', 'unsupported')
  ),
  reason text check (reason is null or char_length(reason) <= 500),
  target_note_id uuid,
  sort_order integer not null check (sort_order between 1 and 500),
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, job_id, source_path),
  foreign key (job_id, workspace_id)
    references public.note_import_jobs(id, workspace_id) on delete cascade,
  foreign key (target_note_id, workspace_id)
    references public.notes(id, workspace_id) on delete set null (target_note_id)
);
create index note_import_items_job_idx
on public.note_import_items (workspace_id, job_id, sort_order);

alter table public.note_import_jobs enable row level security;
alter table public.note_import_jobs force row level security;
alter table public.note_import_items enable row level security;
alter table public.note_import_items force row level security;
create policy note_import_jobs_select_owner on public.note_import_jobs
for select to authenticated using (
  workspace_id in (select id from public.workspaces where owner_user_id = auth.uid())
);
create policy note_import_items_select_owner on public.note_import_items
for select to authenticated using (
  workspace_id in (select id from public.workspaces where owner_user_id = auth.uid())
);
revoke all on public.note_import_jobs, public.note_import_items from anon;
revoke insert, update, delete, truncate, references, trigger
on public.note_import_jobs, public.note_import_items from authenticated;
grant select on public.note_import_jobs, public.note_import_items to authenticated;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('note.import-preview.v1', 'low', array['ui'], true),
  ('note.import-commit.v1', 'low', array['ui', 'chat'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_note_import_operation(
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
  v_job_id uuid;
  v_source_type text;
  v_total integer;
  v_create integer;
  v_duplicate integer;
  v_unsupported integer;
  v_committed integer;
  v_remaining integer;
  v_batch_size integer;
  v_parent_id uuid;
  v_target_id uuid;
  v_status text;
  v_result jsonb;
  v_item record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('note.import-preview.v1', 'note.import-commit.v1')
    or p_surface not in ('ui', 'chat')
    or (p_operation_id = 'note.import-preview.v1' and p_surface <> 'ui')
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

  if p_operation_id = 'note.import-preview.v1' then
    v_source_type := p_input ->> 'sourceType';
    if v_source_type not in ('notion', 'obsidian', 'generic')
      or char_length(trim(coalesce(p_input ->> 'sourceName', ''))) not between 1 and 255
      or jsonb_typeof(p_input -> 'items') <> 'array'
      or jsonb_array_length(p_input -> 'items') not between 1 and 500 then
      raise exception using errcode = 'P0001', message = 'invalid_import_preview';
    end if;
    if exists (
      select 1 from jsonb_to_recordset(p_input -> 'items') as item(
        "sourcePath" text, title text, "bodyMarkdown" text,
        "parentSourcePath" text, "unsupportedReason" text
      )
      where item."sourcePath" is null
        or item.title is null
        or item."bodyMarkdown" is null
        or char_length(item."sourcePath") not between 1 and 1000
        or char_length(trim(item.title)) not between 1 and 300
        or char_length(item."bodyMarkdown") > 50000
        or char_length(coalesce(item."parentSourcePath", '')) > 1000
        or char_length(coalesce(item."unsupportedReason", '')) > 500
    ) or (
      select count(distinct "sourcePath")
      from jsonb_to_recordset(p_input -> 'items') as item("sourcePath" text)
    ) <> jsonb_array_length(p_input -> 'items') or (
      select coalesce(sum(char_length(title) + char_length("bodyMarkdown")), 0)
      from jsonb_to_recordset(p_input -> 'items') as item(title text, "bodyMarkdown" text)
    ) > 5000000 or exists (
      select 1
      from jsonb_to_recordset(p_input -> 'items') as child(
        "sourcePath" text, "parentSourcePath" text
      )
      where child."parentSourcePath" is not null and (
        right(child."parentSourcePath", 1) <> '/'
        or left(child."sourcePath", char_length(child."parentSourcePath"))
          <> child."parentSourcePath"
        or not exists (
          select 1
          from jsonb_to_recordset(p_input -> 'items') as parent(
            "sourcePath" text, "unsupportedReason" text
          )
          where parent."sourcePath" = child."parentSourcePath"
            and parent."unsupportedReason" is null
        )
      )
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_import_items';
    end if;

    v_total := jsonb_array_length(p_input -> 'items');
    insert into public.note_import_jobs (
      workspace_id, source_name, source_type, total_count
    ) values (
      v_workspace_id, trim(p_input ->> 'sourceName'), v_source_type, v_total
    ) returning id into v_job_id;

    insert into public.note_import_items (
      workspace_id, job_id, source_path, parent_source_path, title, body_markdown,
      content_hash, disposition, reason, target_note_id, sort_order
    )
    select
      v_workspace_id, v_job_id, item."sourcePath", item."parentSourcePath",
      trim(item.title), item."bodyMarkdown",
      encode(extensions.digest(trim(item.title) || chr(31) || item."bodyMarkdown", 'sha256'), 'hex'),
      case
        when item."unsupportedReason" is not null then 'unsupported'
        when duplicate.id is not null then 'skip_duplicate'
        else 'create'
      end,
      case
        when item."unsupportedReason" is not null then item."unsupportedReason"
        when duplicate.id is not null then 'Exact title and Markdown already exist.'
        else null
      end,
      duplicate.id,
      row_number() over (
        order by array_length(string_to_array(item."sourcePath", '/'), 1), item."sourcePath"
      )::integer
    from jsonb_to_recordset(p_input -> 'items') as item(
      "sourcePath" text, title text, "bodyMarkdown" text,
      "parentSourcePath" text, "unsupportedReason" text
    )
    left join lateral (
      select note.id from public.notes note
      where note.workspace_id = v_workspace_id
        and note.title = trim(item.title) and note.body_markdown = item."bodyMarkdown"
        and note.archived_at is null and note.trashed_at is null
      order by note.created_at limit 1
    ) duplicate on true;
  else
    v_job_id := (p_input ->> 'jobId')::uuid;
    v_batch_size := (p_input ->> 'batchSize')::integer;
    if v_batch_size not between 1 and 50 then
      raise exception using errcode = 'P0001', message = 'invalid_import_batch';
    end if;
    select status into v_status from public.note_import_jobs
    where id = v_job_id and workspace_id = v_workspace_id
      and status in ('preview', 'committing')
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'import_job_not_available';
    end if;
    update public.note_import_jobs set status = 'committing' where id = v_job_id;
    for v_item in
      select item.* from public.note_import_items item
      where item.workspace_id = v_workspace_id and item.job_id = v_job_id
        and item.disposition = 'create' and item.target_note_id is null
      order by item.sort_order
      limit v_batch_size
      for update skip locked
    loop
      v_parent_id := null;
      if v_item.parent_source_path is not null then
        select target_note_id into v_parent_id from public.note_import_items
        where workspace_id = v_workspace_id and job_id = v_job_id
          and source_path = v_item.parent_source_path;
      end if;
      insert into public.notes (
        workspace_id, parent_note_id, title, body_markdown, sort_key
      ) values (
        v_workspace_id, v_parent_id, v_item.title, v_item.body_markdown,
        1000 + v_item.sort_order
      ) returning id into v_target_id;
      update public.note_import_items set
        target_note_id = v_target_id, committed_at = clock_timestamp()
      where id = v_item.id;
    end loop;
  end if;

  select
    count(*) filter (where disposition = 'create'),
    count(*) filter (where disposition = 'skip_duplicate'),
    count(*) filter (where disposition = 'unsupported'),
    count(*) filter (where disposition = 'create' and target_note_id is not null),
    count(*) filter (where disposition = 'create' and target_note_id is null)
  into v_create, v_duplicate, v_unsupported, v_committed, v_remaining
  from public.note_import_items
  where workspace_id = v_workspace_id and job_id = v_job_id;
  if v_remaining = 0 then
    v_status := 'completed';
    update public.note_import_jobs set
      status = 'completed', committed_count = v_committed,
      create_count = v_create, duplicate_count = v_duplicate,
      unsupported_count = v_unsupported, completed_at = coalesce(completed_at, clock_timestamp())
    where id = v_job_id;
  else
    v_status := case when p_operation_id = 'note.import-preview.v1' then 'preview' else 'committing' end;
    update public.note_import_jobs set
      status = v_status, committed_count = v_committed,
      create_count = v_create, duplicate_count = v_duplicate,
      unsupported_count = v_unsupported
    where id = v_job_id;
  end if;
  v_result := jsonb_build_object(
    'jobId', v_job_id, 'status', v_status, 'totalCount', v_total,
    'createCount', v_create, 'duplicateCount', v_duplicate,
    'unsupportedCount', v_unsupported, 'committedCount', v_committed,
    'remainingCount', v_remaining
  );
  if v_total is null then
    select total_count into v_total from public.note_import_jobs where id = v_job_id;
    v_result := jsonb_set(v_result, '{totalCount}', to_jsonb(v_total));
  end if;
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low', 'note_import', v_job_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'note_import', v_job_id, 'low',
    case when p_surface = 'chat' then 'approved' else 'explicit_ui_commit' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or check_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'invalid_import_input';
end;
$$;

create or replace function public.dispatch_trusted_operation(
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
  v_result jsonb;
begin
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
    raise exception using errcode = 'P0001', message = 'invalid_operation_surface';
  end if;
  perform 1 from public.operation_contracts
  where operation_id = p_operation_id and p_surface = any(exposures);
  if not found then raise exception using errcode = '42501', message = 'operation_surface_not_allowed'; end if;
  if p_operation_id in ('goal.update.v1', 'action.move.v1') then
    v_result := public.execute_plan_edit_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'account.%' then
    v_result := public.execute_account_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('action.update.v1', 'daily-focus.set.v1') then
    v_result := public.execute_daily_execution_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'workspace.ai-budget.v1' then
    v_result := public.execute_ai_budget_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'workspace.%' then
    v_result := public.execute_workspace_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('note.import-preview.v1', 'note.import-commit.v1') then
    v_result := public.execute_note_import_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.goal-link.v1', 'note.goal-unlink.v1', 'note.action-link.v1', 'note.action-unlink.v1'
  ) then
    v_result := public.execute_note_relation_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'review.complete-period.v1' then
    v_result := public.execute_period_review_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'review.%' then
    v_result := public.execute_review_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ) then
    v_result := public.execute_knowledge_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'note.%' then
    v_result := public.execute_note_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'memory.%' then
    v_result := public.execute_memory_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'trash.%' then
    v_result := public.execute_trash_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  else
    v_result := public.execute_planner_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;
  return v_result;
end;
$$;

revoke all on function public.execute_note_import_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
