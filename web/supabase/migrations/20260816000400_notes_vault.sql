begin;

create table public.notes (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_note_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  body_markdown text not null default '' check (char_length(body_markdown) <= 500000),
  sort_key numeric(24, 12) not null default 1000,
  ai_excluded boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  trashed_at timestamptz,
  purge_after timestamptz,
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body_markdown, '')), 'B')
  ) stored,
  unique (id, workspace_id),
  foreign key (parent_note_id, workspace_id) references public.notes(id, workspace_id),
  check (parent_note_id is null or parent_note_id <> id),
  check ((trashed_at is null and purge_after is null) or (trashed_at is not null and purge_after is not null))
);
create index notes_workspace_tree_idx on public.notes (workspace_id, parent_note_id, sort_key);
create index notes_search_idx on public.notes using gin (search_vector);
create trigger notes_set_updated_at before update on public.notes
for each row execute function public.set_updated_at();

create table public.note_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  title text not null,
  body_markdown text not null,
  source_version bigint not null,
  author_user_id uuid references auth.users(id) on delete set null,
  surface text not null,
  operation_receipt_id uuid references public.operation_receipts(id) on delete set null
    deferrable initially deferred,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (note_id, workspace_id) references public.notes(id, workspace_id) on delete cascade
);
create index note_revisions_note_idx on public.note_revisions (workspace_id, note_id, created_at desc);

create table public.tags (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  normalized_name text not null check (normalized_name = lower(trim(normalized_name))),
  created_at timestamptz not null default now(),
  unique (workspace_id, normalized_name),
  unique (id, workspace_id)
);

create table public.note_tags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, note_id, tag_id),
  foreign key (note_id, workspace_id) references public.notes(id, workspace_id) on delete cascade,
  foreign key (tag_id, workspace_id) references public.tags(id, workspace_id) on delete cascade
);

create table public.note_links (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_note_id uuid not null,
  target_note_id uuid not null,
  relation_type text not null default 'related' check (relation_type in ('related', 'supports', 'contradicts', 'continues')),
  created_at timestamptz not null default now(),
  foreign key (source_note_id, workspace_id) references public.notes(id, workspace_id) on delete cascade,
  foreign key (target_note_id, workspace_id) references public.notes(id, workspace_id) on delete cascade,
  unique (workspace_id, source_note_id, target_note_id, relation_type),
  check (source_note_id <> target_note_id)
);

create table public.note_goal_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  goal_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, note_id, goal_id),
  foreign key (note_id, workspace_id) references public.notes(id, workspace_id) on delete cascade,
  foreign key (goal_id, workspace_id) references public.goals(id, workspace_id) on delete cascade
);

create table public.note_action_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  action_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, note_id, action_id),
  foreign key (note_id, workspace_id) references public.notes(id, workspace_id) on delete cascade,
  foreign key (action_id, workspace_id) references public.actions(id, workspace_id) on delete cascade
);

create table public.capture_note_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  capture_id uuid not null,
  note_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, capture_id, note_id),
  foreign key (capture_id, workspace_id) references public.captures(id, workspace_id) on delete cascade,
  foreign key (note_id, workspace_id) references public.notes(id, workspace_id) on delete cascade
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'notes', 'note_revisions', 'tags', 'note_tags', 'note_links',
    'note_goal_links', 'note_action_links', 'capture_note_links'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (workspace_id in (select id from public.workspaces where owner_user_id = auth.uid()))',
      table_name || '_select_owner', table_name
    );
    execute format('revoke all on public.%I from anon', table_name);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end;
$$;

create or replace function public.execute_note_operation(
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
  v_target_id uuid;
  v_parent_id uuid;
  v_expected_version bigint;
  v_result jsonb;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'note.create.v1', 'note.update.v1', 'note.move.v1',
    'note.archive.v1', 'note.ai-exclusion.v1'
  ) then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;

  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0));

  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  if p_operation_id = 'note.create.v1' then
    v_parent_id := nullif(p_input ->> 'parentNoteId', '')::uuid;
    if char_length(p_input ->> 'title') not between 1 and 300
      or char_length(coalesce(p_input ->> 'bodyMarkdown', '')) > 500000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if v_parent_id is not null and not exists (
      select 1 from public.notes where id = v_parent_id and workspace_id = v_workspace_id
        and archived_at is null and trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'parent_not_found';
    end if;
    insert into public.notes (workspace_id, parent_note_id, title, body_markdown, sort_key)
    values (
      v_workspace_id, v_parent_id, p_input ->> 'title', coalesce(p_input ->> 'bodyMarkdown', ''),
      coalesce((select max(sort_key) + 1000 from public.notes where workspace_id = v_workspace_id and parent_note_id is not distinct from v_parent_id), 1000)
    ) returning * into v_row;

  elsif p_operation_id = 'note.update.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if char_length(p_input ->> 'title') not between 1 and 300
      or char_length(coalesce(p_input ->> 'bodyMarkdown', '')) > 500000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select * into v_row from public.notes where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if v_row.title is distinct from (p_input ->> 'title')
      or v_row.body_markdown is distinct from coalesce(p_input ->> 'bodyMarkdown', '') then
      insert into public.note_revisions (
        workspace_id, note_id, title, body_markdown, source_version, author_user_id, surface
      ) values (
        v_workspace_id, v_target_id, v_row.title, v_row.body_markdown,
        v_row.version, v_user_id, p_surface
      );
    end if;
    update public.notes set
      title = p_input ->> 'title', body_markdown = coalesce(p_input ->> 'bodyMarkdown', ''),
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;

  elsif p_operation_id = 'note.move.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_parent_id := nullif(p_input ->> 'parentNoteId', '')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if v_target_id = v_parent_id then
      raise exception using errcode = 'P0001', message = 'invalid_note_parent';
    end if;
    if v_parent_id is not null and exists (
      with recursive descendants as (
        select id from public.notes where id = v_target_id and workspace_id = v_workspace_id
        union all
        select n.id from public.notes n join descendants d on n.parent_note_id = d.id
        where n.workspace_id = v_workspace_id
      ) select 1 from descendants where id = v_parent_id
    ) then
      raise exception using errcode = 'P0001', message = 'note_cycle';
    end if;
    update public.notes set
      parent_note_id = v_parent_id, sort_key = (p_input ->> 'sortKey')::numeric,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    returning * into v_row;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;

  elsif p_operation_id = 'note.archive.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    update public.notes set archived_at = clock_timestamp(), version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    returning * into v_row;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;

  elsif p_operation_id = 'note.ai-exclusion.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    update public.notes set ai_excluded = (p_input ->> 'aiExcluded')::boolean, version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    returning * into v_row;
    if not found then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;
  end if;

  v_target_id := v_row.id;
  v_result := to_jsonb(v_row);
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key,
    case when p_operation_id = 'note.archive.v1' then 'medium' else 'low' end,
    'note', v_target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'note', v_target_id,
    case when p_operation_id = 'note.archive.v1' then 'medium' else 'low' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.execute_note_operation(text, jsonb, text, text) from public, anon;
grant execute on function public.execute_note_operation(text, jsonb, text, text) to authenticated;

commit;
