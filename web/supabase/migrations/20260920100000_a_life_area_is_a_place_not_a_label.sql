-- A life area is a durable place to keep a part of life, not a word in a title.
--
-- Grouping work by area was possible before this only by typing the area into
-- the title or by putting the Notes under a common parent, which meant the
-- grouping was a convention nothing enforced and nothing could read. An area
-- with purpose, work and knowledge attached to it needs identity, and identity
-- needs a row.
--
-- Three decisions are built into the shape here.
--
-- Every area owns exactly one canonical Note, and a Note is the page of at most
-- one area. That is a unique constraint rather than a rule the application
-- remembers, so a retried create cannot leave two pages for one area and a
-- second area cannot quietly adopt the first one's page.
--
-- Archive is one row's `archived_at`, never written across descendants.
-- Visibility of a child is computed from its ancestors, so restoring a parent
-- restores the subtree while a child archived on its own stays archived. The
-- alternative -- marking every descendant -- cannot tell those two cases apart
-- afterwards.
--
-- There is no trash and no delete. Archive is organisation, not cancellation,
-- and an area that could be deleted would take the question of what happens to
-- its goals, tasks and page with it. `area.replace-note.v1` is the escape hatch
-- for the one dependency that would otherwise trap someone: a page they want to
-- throw away.

begin;

create table public.life_areas (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_area_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Presentation only, and bounded: an icon is a short label or emoji and a
  -- colour is the name of a token, never arbitrary content rendered into a page.
  icon text check (icon is null or char_length(icon) between 1 and 40),
  color text check (color is null or color ~ '^[a-z][a-z0-9-]{0,23}$'),
  sort_key numeric(24, 12) not null default 1000,
  canonical_note_id uuid not null,
  ai_excluded boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, workspace_id),
  -- One page, one area. Both halves of invariant 2 are this line.
  unique (canonical_note_id),
  foreign key (parent_area_id, workspace_id)
    references public.life_areas(id, workspace_id),
  foreign key (canonical_note_id, workspace_id)
    references public.notes(id, workspace_id) on delete cascade,
  check (parent_area_id is null or parent_area_id <> id)
);

-- Listing one area's children is the single hottest read in the tree, and the
-- index carries the sibling order so the list arrives sorted.
create index life_areas_children_idx
  on public.life_areas (workspace_id, parent_area_id, sort_key, id);
create index life_areas_active_idx
  on public.life_areas (workspace_id, archived_at);

create trigger life_areas_set_updated_at before update on public.life_areas
for each row execute function public.set_updated_at();

alter table public.life_areas enable row level security;
alter table public.life_areas force row level security;
create policy life_areas_select_owner on public.life_areas
  for select to authenticated
  using (
    workspace_id in (
      select id from public.workspaces where owner_user_id = (select auth.uid())
    )
  );
revoke all on public.life_areas from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.life_areas from authenticated;
grant select on public.life_areas to authenticated;

-- Trashing an area's page would leave the area pointing at a page in the bin,
-- and purging it thirty days later would take the area with it. Rather than let
-- that happen and then explain it, the dependency is refused where it is
-- attempted, whichever path attempts it. Replace the page first, which is what
-- `area.replace-note.v1` is for.
create function public.notes_guard_canonical_area_page()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.trashed_at is not null and old.trashed_at is null
    and exists (select 1 from public.life_areas where canonical_note_id = new.id) then
    raise exception using errcode = 'P0001', message = 'area_canonical_note_in_use';
  end if;
  return new;
end;
$$;

revoke all on function public.notes_guard_canonical_area_page() from public, anon, authenticated;

create trigger notes_guard_canonical_area_page
before update of trashed_at on public.notes
for each row execute function public.notes_guard_canonical_area_page();

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('area.create.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('area.update.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('area.move.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('area.archive.v1', 'medium', array['ui', 'chat', 'mcp'], true),
  ('area.restore.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('area.replace-note.v1', 'medium', array['ui'], true),
  ('area.ai-exclusion.v1', 'low', array['ui', 'chat', 'mcp'], true);

insert into public.operation_undo_support (operation_id, strategy) values
  ('area.create.v1', 'trash-create'),
  ('area.update.v1', 'snapshot'),
  ('area.move.v1', 'snapshot'),
  ('area.archive.v1', 'snapshot'),
  ('area.restore.v1', 'snapshot'),
  ('area.replace-note.v1', 'snapshot'),
  ('area.ai-exclusion.v1', 'snapshot');

create function public.execute_life_area_operation(
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
  v_note_id uuid;
  v_expected_version bigint;
  v_receipt_id uuid;
  v_result jsonb;
  v_undo_payload jsonb;
  v_row public.life_areas;
  v_note public.notes;
  v_name text;
  v_created_note boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'area.create.v1', 'area.update.v1', 'area.move.v1', 'area.archive.v1',
    'area.restore.v1', 'area.replace-note.v1', 'area.ai-exclusion.v1'
  ) then
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

  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;
  v_receipt_id := extensions.gen_random_uuid();

  -- Every mutation that can change the shape of the tree serialises on the
  -- workspace's tree, in that order, before it reads an ancestor. An
  -- application-level cycle check without this lock passes for both of two
  -- concurrent moves that together make a cycle.
  if p_operation_id in ('area.create.v1', 'area.move.v1') then
    perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':life_areas', 0));
  end if;

  if p_operation_id = 'area.create.v1' then
    v_name := btrim(p_input ->> 'name');
    v_parent_id := nullif(p_input ->> 'parentAreaId', '')::uuid;
    v_note_id := nullif(p_input ->> 'existingNoteId', '')::uuid;
    if char_length(v_name) not between 1 and 120 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if v_parent_id is not null and not exists (
      select 1 from public.life_areas
      where id = v_parent_id and workspace_id = v_workspace_id and archived_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'parent_not_found';
    end if;

    if v_note_id is null then
      -- A new page starts at the Notes root. There is one Note tree, and the
      -- area tree is not a second physical place to keep pages.
      insert into public.notes (workspace_id, parent_note_id, title, body_markdown, sort_key)
      values (
        v_workspace_id, null, v_name, '',
        coalesce(
          (select max(sort_key) + 1000 from public.notes
            where workspace_id = v_workspace_id and parent_note_id is null),
          1000
        )
      ) returning * into v_note;
      v_note_id := v_note.id;
      v_created_note := true;
    else
      select * into v_note from public.notes
      where id = v_note_id and workspace_id = v_workspace_id and trashed_at is null;
      if not found then
        raise exception using errcode = 'P0001', message = 'note_not_found';
      end if;
      if exists (select 1 from public.life_areas where canonical_note_id = v_note_id) then
        raise exception using errcode = 'P0001', message = 'note_already_canonical';
      end if;
    end if;

    insert into public.life_areas (
      workspace_id, parent_area_id, name, icon, color, sort_key, canonical_note_id
    ) values (
      v_workspace_id, v_parent_id, v_name,
      nullif(p_input ->> 'icon', ''), nullif(p_input ->> 'color', ''),
      coalesce(
        (select max(sort_key) + 1000 from public.life_areas
          where workspace_id = v_workspace_id
            and parent_area_id is not distinct from v_parent_id),
        1000
      ),
      v_note_id
    ) returning * into v_row;

    -- Undo needs to know which of the two cases it is looking at, because it
    -- may never bin a page that already existed before the area did.
    v_undo_payload := jsonb_build_object(
      'createdNoteId', case when v_created_note then v_note_id else null end
    );

  elsif p_operation_id = 'area.update.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    v_name := btrim(p_input ->> 'name');
    if char_length(v_name) not between 1 and 120 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select * into v_row from public.life_areas
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;

    v_undo_payload := jsonb_build_object(
      'name', v_row.name, 'icon', v_row.icon, 'color', v_row.color, 'noteTitle', null
    );

    -- Renaming the page is offered, never assumed. A page whose title someone
    -- has already made their own keeps it, and the rename is still recorded as
    -- an ordinary revision so the previous title is recoverable.
    if coalesce((p_input ->> 'renameCanonicalNote')::boolean, false) then
      select * into v_note from public.notes
      where id = v_row.canonical_note_id and workspace_id = v_workspace_id and trashed_at is null
      for update;
      if found and v_note.title is distinct from v_name then
        insert into public.note_revisions (
          workspace_id, note_id, title, body_markdown, source_version,
          author_user_id, surface, operation_receipt_id
        ) values (
          v_workspace_id, v_note.id, v_note.title, v_note.body_markdown,
          v_note.version, v_user_id, p_surface, v_receipt_id
        );
        v_undo_payload := jsonb_set(
          v_undo_payload, '{noteTitle}', to_jsonb(v_note.title)
        );
        update public.notes set title = v_name, version = version + 1
        where id = v_note.id and workspace_id = v_workspace_id;
      end if;
    end if;

    update public.life_areas set
      name = v_name,
      icon = nullif(p_input ->> 'icon', ''),
      color = nullif(p_input ->> 'color', ''),
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;

  elsif p_operation_id = 'area.move.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_parent_id := nullif(p_input ->> 'parentAreaId', '')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if v_target_id = v_parent_id then
      raise exception using errcode = 'P0001', message = 'area_cycle';
    end if;
    -- Re-read under the tree lock: the ancestors may have moved since the
    -- caller decided this was safe.
    if v_parent_id is not null then
      if not exists (
        select 1 from public.life_areas where id = v_parent_id and workspace_id = v_workspace_id
      ) then
        raise exception using errcode = 'P0001', message = 'parent_not_found';
      end if;
      if exists (
        with recursive descendants as (
          select id from public.life_areas
          where id = v_target_id and workspace_id = v_workspace_id
          union all
          select a.id from public.life_areas a
          join descendants d on a.parent_area_id = d.id
          where a.workspace_id = v_workspace_id
        ) select 1 from descendants where id = v_parent_id
      ) then
        raise exception using errcode = 'P0001', message = 'area_cycle';
      end if;
    end if;
    select jsonb_build_object('parentAreaId', parent_area_id, 'sortKey', sort_key)
    into v_undo_payload
    from public.life_areas
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    update public.life_areas set
      parent_area_id = v_parent_id,
      sort_key = (p_input ->> 'sortKey')::numeric,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;

  elsif p_operation_id in ('area.archive.v1', 'area.restore.v1') then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select jsonb_build_object('archivedAt', archived_at) into v_undo_payload
    from public.life_areas
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    update public.life_areas set
      archived_at = case when p_operation_id = 'area.archive.v1' then clock_timestamp() end,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;

  elsif p_operation_id = 'area.replace-note.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_note_id := (p_input ->> 'noteId')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if not exists (
      select 1 from public.notes
      where id = v_note_id and workspace_id = v_workspace_id and trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'note_not_found';
    end if;
    if exists (
      select 1 from public.life_areas
      where canonical_note_id = v_note_id and id <> v_target_id
    ) then
      raise exception using errcode = 'P0001', message = 'note_already_canonical';
    end if;
    select jsonb_build_object('canonicalNoteId', canonical_note_id) into v_undo_payload
    from public.life_areas
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    -- The page being replaced is left exactly where it is. Losing writing is
    -- not a side effect anyone asked for by choosing a different page.
    update public.life_areas set canonical_note_id = v_note_id, version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;

  elsif p_operation_id = 'area.ai-exclusion.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select jsonb_build_object('aiExcluded', ai_excluded) into v_undo_payload
    from public.life_areas
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    update public.life_areas set
      ai_excluded = (p_input ->> 'aiExcluded')::boolean, version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id returning * into v_row;
  end if;

  v_target_id := v_row.id;
  select * into v_note from public.notes where id = v_row.canonical_note_id;
  v_result := to_jsonb(v_row) || jsonb_build_object(
    'note_title', v_note.title,
    'note_version', v_note.version,
    'note_created', v_created_note
  );

  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json,
    undo_payload_json
  ) values (
    v_receipt_id, v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key,
    case
      when p_operation_id in ('area.archive.v1', 'area.replace-note.v1') then 'medium'
      else 'low'
    end,
    'life_area', v_target_id, 'succeeded', v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'life_area', v_target_id,
    case
      when p_operation_id in ('area.archive.v1', 'area.replace-note.v1') then 'medium'
      else 'low'
    end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'note_already_canonical';
end;
$$;

revoke all on function public.execute_life_area_operation(text, jsonb, text, text)
from public, anon, authenticated;

-- Undo, as one more link in the chain rather than a rewrite of the base. The
-- interesting case is undoing a create: the area row goes, but its page stays
-- unless this same operation made it and nothing has happened to it since.
alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_life_area_base;

create function public.execute_operation_undo(
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
  v_original public.operation_receipts;
  v_area public.life_areas;
  v_note public.notes;
  v_created_note_id uuid;
  v_target_id uuid;
  v_expected_version bigint;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if p_operation_id <> 'operation.undo.v1' then
    return public.execute_operation_undo_life_area_base(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    return public.execute_operation_undo_life_area_base(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;

  select receipt.* into v_original from public.operation_receipts receipt
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id;
  if not found or v_original.operation_id not like 'area.%' then
    return public.execute_operation_undo_life_area_base(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;

  if p_surface <> 'ui' or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  select receipt.* into v_original from public.operation_receipts receipt
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  if v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

  v_target_id := v_original.target_id;
  v_expected_version := nullif(v_original.result_json ->> 'version', '')::bigint;
  v_undo_receipt_id := extensions.gen_random_uuid();
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':life_areas', 0));

  select * into v_area from public.life_areas
  where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  if v_original.operation_id = 'area.create.v1' then
    -- An area that has since become somebody's parent, or that work now points
    -- at, is not an accidental keystroke any more.
    if exists (
      select 1 from public.life_areas
      where workspace_id = v_workspace_id and parent_area_id = v_target_id
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_created_note_id := nullif(v_original.undo_payload_json ->> 'createdNoteId', '')::uuid;
    delete from public.life_areas where id = v_target_id and workspace_id = v_workspace_id;

    -- The page goes only if this operation created it and it is still the empty
    -- page it created. A page someone has written in, moved, or given children
    -- survives its area.
    if v_created_note_id is not null then
      select * into v_note from public.notes
      where id = v_created_note_id and workspace_id = v_workspace_id and trashed_at is null
      for update;
      if found and v_note.version = 1 and v_note.body_markdown = ''
        and not exists (
          select 1 from public.notes
          where workspace_id = v_workspace_id and parent_note_id = v_created_note_id
        )
        and not exists (
          select 1 from public.note_links where workspace_id = v_workspace_id
            and (source_note_id = v_created_note_id or target_note_id = v_created_note_id)
        )
      then
        update public.notes set
          trashed_at = clock_timestamp(),
          purge_after = clock_timestamp() + interval '30 days',
          version = version + 1
        where id = v_created_note_id and workspace_id = v_workspace_id;
      end if;
    end if;

  elsif v_original.operation_id = 'area.update.v1' then
    if v_original.undo_payload_json ->> 'noteTitle' is not null then
      select * into v_note from public.notes
      where id = v_area.canonical_note_id and workspace_id = v_workspace_id
        and trashed_at is null
      for update;
      if found then
        insert into public.note_revisions (
          workspace_id, note_id, title, body_markdown, source_version,
          author_user_id, surface, operation_receipt_id
        ) values (
          v_workspace_id, v_note.id, v_note.title, v_note.body_markdown,
          v_note.version, v_user_id, p_surface, v_undo_receipt_id
        );
        update public.notes set
          title = v_original.undo_payload_json ->> 'noteTitle', version = version + 1
        where id = v_note.id and workspace_id = v_workspace_id;
      end if;
    end if;
    update public.life_areas set
      name = v_original.undo_payload_json ->> 'name',
      icon = nullif(v_original.undo_payload_json ->> 'icon', ''),
      color = nullif(v_original.undo_payload_json ->> 'color', ''),
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id;

  elsif v_original.operation_id = 'area.move.v1' then
    if nullif(v_original.undo_payload_json ->> 'parentAreaId', '')::uuid is not null
      and exists (
        with recursive descendants as (
          select id from public.life_areas
          where id = v_target_id and workspace_id = v_workspace_id
          union all
          select a.id from public.life_areas a join descendants d on a.parent_area_id = d.id
          where a.workspace_id = v_workspace_id
        )
        select 1 from descendants
        where id = nullif(v_original.undo_payload_json ->> 'parentAreaId', '')::uuid
      ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    update public.life_areas set
      parent_area_id = nullif(v_original.undo_payload_json ->> 'parentAreaId', '')::uuid,
      sort_key = (v_original.undo_payload_json ->> 'sortKey')::numeric,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id;

  elsif v_original.operation_id in ('area.archive.v1', 'area.restore.v1') then
    update public.life_areas set
      archived_at = nullif(v_original.undo_payload_json ->> 'archivedAt', '')::timestamptz,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id;

  elsif v_original.operation_id = 'area.replace-note.v1' then
    update public.life_areas set
      canonical_note_id = (v_original.undo_payload_json ->> 'canonicalNoteId')::uuid,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id;

  elsif v_original.operation_id = 'area.ai-exclusion.v1' then
    update public.life_areas set
      ai_excluded = (v_original.undo_payload_json ->> 'aiExcluded')::boolean,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id;
  else
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

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
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

create or replace function public.operation_handler_for(p_operation_id text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  -- Specific ids before their family, in the order the router has always used.
  select case
    when p_operation_id = 'note.appearance.v1' then 'note_appearance'
    when p_operation_id = 'capture.file-to-action.v1' then 'capture_action_filing'
    when p_operation_id like 'capture-proposal.%' then 'capture_proposal'
    when p_operation_id like 'conversation.%' then 'conversation'
    when p_operation_id like 'notification.%' then 'notification'
    when p_operation_id like 'action-template.%' then 'action_template'
    when p_operation_id = 'operation.undo.v1' then 'operation_undo'
    when p_operation_id in ('goal.update.v1', 'action.move.v1') then 'plan_edit'
    when p_operation_id like 'area.%' then 'life_area'
    when p_operation_id like 'account.%' then 'account'
    when p_operation_id in ('action.update.v1', 'action.status.v1', 'daily-focus.set.v1')
      then 'daily_execution'
    when p_operation_id = 'workspace.onboarding-complete.v1' then 'guided_onboarding'
    when p_operation_id = 'workspace.ai-budget.v1' then 'ai_budget'
    when p_operation_id like 'workspace.%' then 'workspace'
    when p_operation_id in (
      'note.import-preview.v1', 'note.import-commit.v1', 'note.import-cancel.v1'
    ) then 'note_import'
    when p_operation_id in (
      'note.goal-link.v1', 'note.goal-unlink.v1', 'note.action-link.v1', 'note.action-unlink.v1'
    ) then 'note_relation'
    when p_operation_id = 'review.complete-period.v1' then 'period_review'
    when p_operation_id like 'review.%' then 'review'
    when p_operation_id in (
      'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
    ) then 'knowledge'
    when p_operation_id like 'note.%' then 'note'
    when p_operation_id like 'memory.%' then 'memory'
    when p_operation_id like 'trash.%' then 'trash'
    else 'planner'
  end;
$$;

update public.operation_contracts
set owning_domain = public.operation_handler_for(operation_id);

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
  v_domain text;
begin
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
    raise exception using errcode = 'P0001', message = 'invalid_operation_surface';
  end if;
  perform 1 from public.operation_contracts
  where operation_id = p_operation_id and p_surface = any(exposures);
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;

  v_domain := public.operation_handler_for(p_operation_id);

  if v_domain = 'note_appearance' then
    return public.execute_note_appearance_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'capture_action_filing' then
    return public.execute_capture_action_filing_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'capture_proposal' then
    return public.execute_capture_proposal_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'conversation' then
    return public.execute_conversation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'notification' then
    return public.execute_notification_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'action_template' then
    return public.execute_action_template_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'operation_undo' then
    return public.execute_operation_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'plan_edit' then
    return public.execute_plan_edit_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'life_area' then
    return public.execute_life_area_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'account' then
    return public.execute_account_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'daily_execution' then
    return public.execute_daily_execution_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'guided_onboarding' then
    return public.execute_guided_onboarding_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'ai_budget' then
    return public.execute_ai_budget_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'workspace' then
    return public.execute_workspace_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'note_import' then
    return public.execute_note_import_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'note_relation' then
    return public.execute_note_relation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'period_review' then
    return public.execute_period_review_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'review' then
    return public.execute_review_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'knowledge' then
    return public.execute_knowledge_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'note' then
    return public.execute_note_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'memory' then
    return public.execute_memory_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'trash' then
    return public.execute_trash_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;
  return public.execute_planner_operation(
    p_operation_id, p_input, p_idempotency_key, p_surface);
end;
$$;

revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated;

commit;
