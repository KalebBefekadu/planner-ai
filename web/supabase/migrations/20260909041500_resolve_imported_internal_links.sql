-- An exported Notion or Obsidian workspace is a web of pages that reference
-- each other by relative file path. Imported as written, every one of those
-- hrefs names a file that does not exist inside Planner AI, so the structure
-- the owner built arrives as dead text -- the import kept the pages and lost
-- what connected them.
--
-- The target Note has no id while the import is being staged, so staging
-- rewrites a resolvable href to an opaque token: the SHA-256 of the target
-- item's source path. This function turns each token into the created Note's
-- URL. Resolution runs after every batch rather than only at the end, so a
-- link that points forward -- at a page committed in a later batch -- still
-- becomes a real URL without the whole import having to fit in one
-- transaction. Only Notes this job created are rewritten: an item that
-- resolved to a duplicate points at a Note the owner already had, and an
-- import must not edit that.
--
-- Nothing is dropped. A token whose target never produced a Note is written
-- back as the source path it named once the job finishes, so an unresolvable
-- link reads as the path the owner wrote rather than as an internal token.

begin;


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
  v_link record;
  v_source_path text;
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
        "parentSourcePath" text, "unsupportedReason" text, "aiExcluded" boolean,
        "sourceSortKey" numeric, "conversionNotice" text
      )
      where item."sourcePath" is null
        or item.title is null
        or item."bodyMarkdown" is null
        or char_length(item."sourcePath") not between 1 and 1000
        or char_length(trim(item.title)) not between 1 and 300
        or char_length(item."bodyMarkdown") > 50000
        or char_length(coalesce(item."parentSourcePath", '')) > 1000
        or char_length(coalesce(item."unsupportedReason", '')) > 500
        or char_length(coalesce(item."conversionNotice", '')) > 500
        -- NaN sorts above every number in Postgres, so this bound rejects it
        -- too and a corrupt manifest cannot reach notes.sort_key.
        or (
          item."sourceSortKey" is not null
          and item."sourceSortKey" not between -999999999999 and 999999999999
        )
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
        (
          right(child."parentSourcePath", 1) = '/'
          and left(child."sourcePath", char_length(child."parentSourcePath"))
            <> child."parentSourcePath"
        )
        or not exists (
          select 1
          from jsonb_to_recordset(p_input -> 'items') as parent(
            "sourcePath" text, "unsupportedReason" text
          )
          where parent."sourcePath" = child."parentSourcePath"
            and parent."unsupportedReason" is null
        )
      )
    ) or (
      with recursive reachable as (
        select root."sourcePath" as source_path
        from jsonb_to_recordset(p_input -> 'items') as root(
          "sourcePath" text, "parentSourcePath" text
        )
        where root."parentSourcePath" is null
        union all
        select child."sourcePath"
        from jsonb_to_recordset(p_input -> 'items') as child(
          "sourcePath" text, "parentSourcePath" text
        )
        join reachable on child."parentSourcePath" = reachable.source_path
      )
      select count(*) from reachable
    ) <> jsonb_array_length(p_input -> 'items') then
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
      content_hash, disposition, reason, target_note_id, sort_order, ai_excluded,
      source_sort_key
    )
    with recursive item as (
      select
        source."sourcePath" as source_path,
        source."parentSourcePath" as parent_source_path,
        trim(source.title) as title,
        source."bodyMarkdown" as body_markdown,
        source."unsupportedReason" as unsupported_reason,
        coalesce(source."aiExcluded", false) as ai_excluded,
        source."sourceSortKey" as source_sort_key,
        source."conversionNotice" as conversion_notice
      from jsonb_to_recordset(p_input -> 'items') as source(
        "sourcePath" text, title text, "bodyMarkdown" text,
        "parentSourcePath" text, "unsupportedReason" text, "aiExcluded" boolean,
        "sourceSortKey" numeric, "conversionNotice" text
      )
    ),
    -- Commit order must follow real parentage, not path shape. A vault records
    -- hierarchy by Note identity, so every path sits at the same segment depth
    -- and a child could otherwise be created before its parent exists and be
    -- silently reparented to the root.
    depth as (
      select source_path, 0 as depth from item where parent_source_path is null
      union all
      select child.source_path, parent.depth + 1
      from item child
      join depth parent on child.parent_source_path = parent.source_path
    )
    select
      v_workspace_id, v_job_id, item.source_path, item.parent_source_path,
      item.title, item.body_markdown,
      encode(extensions.digest(item.title || chr(31) || item.body_markdown, 'sha256'), 'hex'),
      case
        when item.unsupported_reason is not null then 'unsupported'
        when duplicate.id is not null then 'skip_duplicate'
        else 'create'
      end,
      case
        when item.unsupported_reason is not null then item.unsupported_reason
        when duplicate.id is not null then 'Exact title and Markdown already exist.'
        else item.conversion_notice
      end,
      duplicate.id,
      row_number() over (order by depth.depth, item.source_path)::integer,
      item.ai_excluded,
      item.source_sort_key
    from item
    join depth on depth.source_path = item.source_path
    left join lateral (
      select note.id from public.notes note
      where note.workspace_id = v_workspace_id
        and note.title = item.title and note.body_markdown = item.body_markdown
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
        workspace_id, parent_note_id, title, body_markdown, sort_key, ai_excluded
      ) values (
        v_workspace_id, v_parent_id, v_item.title, v_item.body_markdown,
        -- An exported vault records each Note's order within its parent. Other
        -- sources have none, so they keep the dependency-safe staging order.
        coalesce(v_item.source_sort_key, 1000 + v_item.sort_order), v_item.ai_excluded
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

  if p_operation_id = 'note.import-commit.v1' then
    for v_link in
      select distinct item.target_note_id as note_id, found.parts[1] as token
      from public.note_import_items item
      join public.notes note on note.id = item.target_note_id
      cross join lateral regexp_matches(
        note.body_markdown, 'planner-ai-import:([0-9a-f]{64})', 'g'
      ) as found(parts)
      where item.workspace_id = v_workspace_id and item.job_id = v_job_id
        and item.committed_at is not null
    loop
      select target.target_note_id, target.source_path
      into v_target_id, v_source_path
      from public.note_import_items target
      where target.workspace_id = v_workspace_id and target.job_id = v_job_id
        and encode(extensions.digest(target.source_path, 'sha256'), 'hex') = v_link.token;
      if v_target_id is not null then
        update public.notes set body_markdown = replace(
          body_markdown, 'planner-ai-import:' || v_link.token, '/notes?note=' || v_target_id
        ) where id = v_link.note_id and workspace_id = v_workspace_id;
      elsif v_remaining = 0 and v_source_path is not null then
        -- The job is finished and this target never became a Note. Restoring
        -- the path keeps the link readable instead of leaving a token behind.
        update public.notes set body_markdown = replace(
          body_markdown, 'planner-ai-import:' || v_link.token, v_source_path
        ) where id = v_link.note_id and workspace_id = v_workspace_id;
      end if;
    end loop;
  end if;

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

commit;
