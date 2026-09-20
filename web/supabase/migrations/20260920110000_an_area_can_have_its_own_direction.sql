-- An area can hold a direction, and work can say which area it belongs to.
--
-- Two constraints stood in the way, and both were real database constraints
-- rather than conventions the interface could route around.
--
-- `visions_one_active_per_workspace_idx` allowed exactly one active Vision per
-- workspace, so "what Health is for" had nowhere to live except inside the one
-- global Vision or, worse, as a second editable copy in the area's page. It
-- becomes two partial indexes: one overall Vision where `area_id is null`, and
-- one Vision per area. The global `vision.upsert.v1` keeps its exact meaning --
-- it now names the overall Vision explicitly instead of meaning it by accident
-- -- so an old client cannot reach in and overwrite an area's direction.
--
-- Nothing recorded which part of a life a Goal, an Action or a Note belonged
-- to. `primary_area_id` is that, nullable everywhere, because a task with no
-- area is still a task and invariant 6 says so.
--
-- One primary area, not a membership table. An item has one home; other
-- connections come later as typed links, and isolating the decision here is
-- what lets that arrive without reworking the tree or its screens. Related
-- links are deliberately not built yet: there is no surface for them, and a
-- relationship table with no UI is a guess about the shape of one.

begin;

alter table public.visions add column area_id uuid;
alter table public.visions add constraint visions_area_fk
  foreign key (area_id, workspace_id) references public.life_areas(id, workspace_id);

drop index public.visions_one_active_per_workspace_idx;
create unique index visions_one_active_overall_idx on public.visions (workspace_id)
  where area_id is null and archived_at is null and trashed_at is null;
create unique index visions_one_active_per_area_idx on public.visions (workspace_id, area_id)
  where area_id is not null and archived_at is null and trashed_at is null;

alter table public.goals add column primary_area_id uuid;
alter table public.goals add constraint goals_primary_area_fk
  foreign key (primary_area_id, workspace_id) references public.life_areas(id, workspace_id);
create index goals_primary_area_idx on public.goals (workspace_id, primary_area_id, status);

alter table public.actions add column primary_area_id uuid;
alter table public.actions add constraint actions_primary_area_fk
  foreign key (primary_area_id, workspace_id) references public.life_areas(id, workspace_id);
create index actions_primary_area_idx
  on public.actions (workspace_id, primary_area_id, status, scheduled_on);

alter table public.notes add column primary_area_id uuid;
alter table public.notes add constraint notes_primary_area_fk
  foreign key (primary_area_id, workspace_id) references public.life_areas(id, workspace_id);
create index notes_primary_area_idx on public.notes (workspace_id, primary_area_id);

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('area.assign.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('area.vision.v1', 'low', array['ui', 'chat', 'mcp'], true);

insert into public.operation_undo_support (operation_id, strategy) values
  ('area.assign.v1', 'snapshot'),
  ('area.vision.v1', 'snapshot');

-- The two new Operations join the life area handler rather than the planner's,
-- because both are about an area: which one a record belongs to, and what one
-- is for. `area.%` already routes here.
create or replace function public.execute_life_area_operation(
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
  v_area_id uuid;
  v_item_type text;
  v_expected_version bigint;
  v_receipt_id uuid;
  v_result jsonb;
  v_undo_payload jsonb;
  v_row public.life_areas;
  v_note public.notes;
  v_vision public.visions;
  v_name text;
  v_body text;
  v_created_note boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'area.create.v1', 'area.update.v1', 'area.move.v1', 'area.archive.v1',
    'area.restore.v1', 'area.replace-note.v1', 'area.ai-exclusion.v1',
    'area.assign.v1', 'area.vision.v1'
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

  -- Assigning work to an area and writing an area's direction both return
  -- something other than an area row, so they answer and return early.
  if p_operation_id = 'area.assign.v1' then
    v_item_type := p_input ->> 'itemType';
    v_target_id := (p_input ->> 'id')::uuid;
    v_area_id := nullif(p_input ->> 'areaId', '')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if v_item_type not in ('goal', 'action', 'note') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if v_area_id is not null and not exists (
      select 1 from public.life_areas where id = v_area_id and workspace_id = v_workspace_id
    ) then
      raise exception using errcode = 'P0001', message = 'area_not_found';
    end if;
    if v_item_type = 'goal' then
      select jsonb_build_object('primaryAreaId', primary_area_id) into v_undo_payload
      from public.goals where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null for update;
      if not found then
        raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
      end if;
      update public.goals set primary_area_id = v_area_id, version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
      returning to_jsonb(goals.*) into v_result;
    elsif v_item_type = 'action' then
      select jsonb_build_object('primaryAreaId', primary_area_id) into v_undo_payload
      from public.actions where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null for update;
      if not found then
        raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
      end if;
      -- Changing a parent's area leaves its children where they are. A person
      -- who reclassifies a project has not asked to reclassify every task
      -- under it, and doing it silently is how work disappears from the view
      -- someone was watching.
      update public.actions set primary_area_id = v_area_id, version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
      returning to_jsonb(actions.*) into v_result;
    else
      select jsonb_build_object('primaryAreaId', primary_area_id) into v_undo_payload
      from public.notes where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null for update;
      if not found then
        raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
      end if;
      update public.notes set primary_area_id = v_area_id, version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
      returning to_jsonb(notes.*) into v_result;
    end if;
    v_result := v_result || jsonb_build_object('item_type', v_item_type);

    insert into public.operation_receipts (
      id, workspace_id, operation_id, actor_user_id, actor_type, surface,
      idempotency_key, risk_class, target_type, target_id, status, result_json,
      undo_payload_json
    ) values (
      v_receipt_id, v_workspace_id, p_operation_id, v_user_id,
      case when p_surface = 'chat' then 'assistant' else 'user' end,
      p_surface, p_idempotency_key, 'low', v_item_type, v_target_id, 'succeeded',
      v_result, v_undo_payload
    );
    insert into public.activity_events (
      workspace_id, actor_user_id, actor_type, surface, operation_id,
      target_type, target_id, risk_class, outcome
    ) values (
      v_workspace_id, v_user_id,
      case when p_surface = 'chat' then 'assistant' else 'user' end,
      p_surface, p_operation_id, v_item_type, v_target_id, 'low', 'succeeded'
    );
    return v_result;
  end if;

  if p_operation_id = 'area.vision.v1' then
    v_area_id := (p_input ->> 'areaId')::uuid;
    v_body := p_input ->> 'bodyMarkdown';
    if char_length(coalesce(v_body, '')) not between 3 and 50000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if not exists (
      select 1 from public.life_areas where id = v_area_id and workspace_id = v_workspace_id
    ) then
      raise exception using errcode = 'P0001', message = 'area_not_found';
    end if;
    select * into v_vision from public.visions
    where workspace_id = v_workspace_id and area_id = v_area_id
      and archived_at is null and trashed_at is null for update;
    v_undo_payload := jsonb_build_object(
      'bodyMarkdown', case when found then v_vision.body_markdown end,
      'created', not found
    );
    insert into public.visions (workspace_id, area_id, body_markdown)
    values (v_workspace_id, v_area_id, v_body)
    on conflict (workspace_id, area_id)
      where area_id is not null and archived_at is null and trashed_at is null
    do update set body_markdown = excluded.body_markdown, version = public.visions.version + 1
    returning * into v_vision;
    v_result := to_jsonb(v_vision);

    insert into public.operation_receipts (
      id, workspace_id, operation_id, actor_user_id, actor_type, surface,
      idempotency_key, risk_class, target_type, target_id, status, result_json,
      undo_payload_json
    ) values (
      v_receipt_id, v_workspace_id, p_operation_id, v_user_id,
      case when p_surface = 'chat' then 'assistant' else 'user' end,
      p_surface, p_idempotency_key, 'low', 'vision', v_vision.id, 'succeeded',
      v_result, v_undo_payload
    );
    insert into public.activity_events (
      workspace_id, actor_user_id, actor_type, surface, operation_id,
      target_type, target_id, risk_class, outcome
    ) values (
      v_workspace_id, v_user_id,
      case when p_surface = 'chat' then 'assistant' else 'user' end,
      p_surface, p_operation_id, 'vision', v_vision.id, 'low', 'succeeded'
    );
    return v_result;
  end if;

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

    -- The page is the area's own, so it files itself there.
    update public.notes set primary_area_id = v_row.id
    where id = v_note_id and workspace_id = v_workspace_id;

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
        v_undo_payload := jsonb_set(v_undo_payload, '{noteTitle}', to_jsonb(v_note.title));
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

-- Undo learns the two new Operations, and learns that an area with work filed
-- under it is no longer an accidental keystroke.
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
  v_original public.operation_receipts;
  v_area public.life_areas;
  v_note public.notes;
  v_created_note_id uuid;
  v_target_id uuid;
  v_area_id uuid;
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

  if v_original.operation_id = 'area.assign.v1' then
    v_area_id := nullif(v_original.undo_payload_json ->> 'primaryAreaId', '')::uuid;
    if v_original.target_type = 'goal' then
      update public.goals set primary_area_id = v_area_id, version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null;
    elsif v_original.target_type = 'action' then
      update public.actions set primary_area_id = v_area_id, version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null;
    else
      update public.notes set primary_area_id = v_area_id, version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null;
    end if;
    if not found then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

  elsif v_original.operation_id = 'area.vision.v1' then
    if (v_original.undo_payload_json ->> 'created')::boolean then
      -- Nothing may be answering to a direction that is about to disappear.
      if exists (
        select 1 from public.goals
        where workspace_id = v_workspace_id and vision_id = v_target_id and trashed_at is null
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      delete from public.visions
      where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version;
    else
      update public.visions set
        body_markdown = v_original.undo_payload_json ->> 'bodyMarkdown',
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null;
    end if;
    if not found then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

  else
    perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':life_areas', 0));
    select * into v_area from public.life_areas
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;

    if v_original.operation_id = 'area.create.v1' then
      if exists (
        select 1 from public.life_areas
        where workspace_id = v_workspace_id and parent_area_id = v_target_id
      ) or exists (
        select 1 from public.goals
        where workspace_id = v_workspace_id and primary_area_id = v_target_id
      ) or exists (
        select 1 from public.actions
        where workspace_id = v_workspace_id and primary_area_id = v_target_id
      ) or exists (
        select 1 from public.visions
        where workspace_id = v_workspace_id and area_id = v_target_id
      ) or exists (
        select 1 from public.notes
        where workspace_id = v_workspace_id and primary_area_id = v_target_id
          and id <> v_area.canonical_note_id
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      v_created_note_id := nullif(v_original.undo_payload_json ->> 'createdNoteId', '')::uuid;
      update public.notes set primary_area_id = null
      where id = v_area.canonical_note_id and workspace_id = v_workspace_id;
      delete from public.life_areas where id = v_target_id and workspace_id = v_workspace_id;

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

-- The planner handler learns two things: the overall Vision is now named
-- rather than assumed, and work created inside an area is filed there as it is
-- created rather than by a second write that could fail on its own.
create or replace function public.execute_planner_operation(
  p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text default 'ui'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_vision_id uuid;
  v_horizon_id uuid;
  v_target_id uuid;
  v_parent_id uuid;
  v_action_parent_id uuid;
  v_area_id uuid;
  v_expected_version bigint;
  v_result jsonb;
  v_target_type text;
  v_risk_class text := 'low';
  v_kind text;
  v_goal_kind text;
  v_starts_on date;
  v_ends_on date;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'vision.upsert.v1', 'goal.create.v1', 'goal.status.v1', 'goal.archive.v1',
    'action.create.v1', 'action.status.v1', 'action.archive.v1', 'capture.create.v1'
  ) then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
    raise exception using errcode = 'P0001', message = 'invalid_surface';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_idempotency_key';
  end if;

  insert into public.workspaces (owner_user_id)
  values (v_user_id)
  on conflict (owner_user_id) do nothing;

  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0));

  select result_json into v_result
  from public.operation_receipts
  where workspace_id = v_workspace_id
    and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key
    and status = 'succeeded';
  if found then
    return v_result;
  end if;

  v_area_id := nullif(p_input ->> 'areaId', '')::uuid;
  if v_area_id is not null and p_operation_id in ('goal.create.v1', 'action.create.v1')
    and not exists (
      select 1 from public.life_areas where id = v_area_id and workspace_id = v_workspace_id
    ) then
    raise exception using errcode = 'P0001', message = 'area_not_found';
  end if;

  if p_operation_id = 'vision.upsert.v1' then
    if jsonb_typeof(p_input -> 'bodyMarkdown') <> 'string'
      or char_length(p_input ->> 'bodyMarkdown') not between 3 and 50000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;

    -- `area_id is null` is what this Operation has always meant. Saying it
    -- keeps an older client from reaching an area's direction by accident.
    insert into public.visions (workspace_id, area_id, body_markdown)
    values (v_workspace_id, null, p_input ->> 'bodyMarkdown')
    on conflict (workspace_id)
      where area_id is null and archived_at is null and trashed_at is null
    do update set
      body_markdown = excluded.body_markdown,
      version = public.visions.version + 1
    returning * into v_row;
    v_target_id := v_row.id;
    v_target_type := 'vision';
    v_result := to_jsonb(v_row);

  elsif p_operation_id = 'goal.create.v1' then
    v_kind := p_input ->> 'horizonKind';
    v_goal_kind := coalesce(p_input ->> 'kind', 'outcome');
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    if v_kind not in ('year', 'quarter') or v_ends_on < v_starts_on
      or v_goal_kind not in ('outcome', 'initiative')
      or char_length(p_input ->> 'title') not between 3 and 1000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if v_goal_kind = 'initiative' and v_kind <> 'year' then
      raise exception using errcode = 'P0001', message = 'initiative_is_not_a_period';
    end if;

    -- A Goal inside an area answers to that area's direction when the area has
    -- one, and to the overall Vision otherwise. Neither is invented: an empty
    -- workspace still has to write a Vision first.
    if v_area_id is not null then
      select id into v_vision_id from public.visions
      where workspace_id = v_workspace_id and area_id = v_area_id
        and archived_at is null and trashed_at is null;
    end if;
    if v_vision_id is null then
      select id into v_vision_id from public.visions
      where workspace_id = v_workspace_id and area_id is null
        and archived_at is null and trashed_at is null;
    end if;
    if v_vision_id is null then
      raise exception using errcode = 'P0001', message = 'vision_required';
    end if;

    v_parent_id := nullif(p_input ->> 'parentGoalId', '')::uuid;
    if (v_kind = 'year' and v_goal_kind = 'outcome' and v_parent_id is not null)
      or (v_kind = 'quarter' and v_parent_id is null) then
      raise exception using errcode = 'P0001', message = 'invalid_goal_parent';
    end if;
    if v_parent_id is not null and not exists (
      select 1 from public.goals g
      join public.planning_horizons h on h.id = g.horizon_id and h.workspace_id = g.workspace_id
      where g.id = v_parent_id and g.workspace_id = v_workspace_id
        and g.archived_at is null and g.trashed_at is null and h.kind = 'year'
    ) then
      raise exception using errcode = 'P0001', message = 'goal_parent_not_found';
    end if;

    insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
    select v_workspace_id, v_kind, v_starts_on, v_ends_on, timezone
    from public.workspaces where id = v_workspace_id
    on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
    returning id into v_horizon_id;

    insert into public.goals (
      workspace_id, vision_id, horizon_id, parent_goal_id, primary_area_id,
      title, status, kind, due_on
    ) values (
      v_workspace_id, v_vision_id, v_horizon_id, v_parent_id,
      -- A quarterly Goal with no area of its own inherits the area of the
      -- yearly Goal it sits under, which is what "create in context" means one
      -- level down.
      coalesce(v_area_id, (
        select primary_area_id from public.goals
        where id = v_parent_id and workspace_id = v_workspace_id
      )),
      p_input ->> 'title', 'active', v_goal_kind,
      case when v_goal_kind = 'initiative' then null else v_ends_on end
    ) returning * into v_row;
    v_target_id := v_row.id;
    v_target_type := 'goal';
    v_result := to_jsonb(v_row);

  elsif p_operation_id = 'action.create.v1' then
    v_kind := p_input ->> 'horizonKind';
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    v_parent_id := nullif(p_input ->> 'goalId', '')::uuid;
    v_action_parent_id := nullif(p_input ->> 'parentActionId', '')::uuid;
    if v_kind not in ('month', 'week') or v_ends_on < v_starts_on
      or char_length(p_input ->> 'title') not between 3 and 1000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if v_parent_id is not null and not exists (
      select 1 from public.goals where id = v_parent_id and workspace_id = v_workspace_id
        and archived_at is null and trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'goal_not_found';
    end if;
    if (v_kind = 'month' and v_action_parent_id is not null)
      or (v_kind = 'week' and v_action_parent_id is not null and not exists (
          select 1 from public.actions parent
          join public.planning_horizons horizon
            on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
          where parent.id = v_action_parent_id and parent.workspace_id = v_workspace_id
            and parent.goal_id is not distinct from v_parent_id
            and horizon.kind in ('month', 'week')
            and parent.archived_at is null and parent.trashed_at is null
        )) then
      raise exception using errcode = 'P0001', message = 'action_parent_not_found';
    end if;
    if v_action_parent_id is not null
      and public.action_ancestor_depth(v_workspace_id, v_action_parent_id) + 1
          > public.action_max_depth() - 1 then
      raise exception using errcode = 'P0001', message = 'action_nested_too_deep';
    end if;

    insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
    select v_workspace_id, v_kind, v_starts_on, v_ends_on, timezone
    from public.workspaces where id = v_workspace_id
    on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
    returning id into v_horizon_id;

    insert into public.actions (
      workspace_id, goal_id, parent_action_id, horizon_id, primary_area_id,
      title, status, scheduled_on
    ) values (
      v_workspace_id, v_parent_id, v_action_parent_id, v_horizon_id,
      -- Asked for, then the parent task's area, then the Goal's. A task typed
      -- into Movement lands in Movement; a subtask lands where its parent is.
      coalesce(
        v_area_id,
        (select primary_area_id from public.actions
          where id = v_action_parent_id and workspace_id = v_workspace_id),
        (select primary_area_id from public.goals
          where id = v_parent_id and workspace_id = v_workspace_id)
      ),
      p_input ->> 'title', 'open',
      coalesce(nullif(p_input ->> 'scheduledOn', '')::date, v_starts_on)
    ) returning * into v_row;
    v_target_id := v_row.id;
    v_target_type := 'action';
    v_result := to_jsonb(v_row);

  elsif p_operation_id in ('goal.status.v1', 'action.status.v1') then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if p_operation_id = 'goal.status.v1' then
      if (p_input ->> 'status') not in ('draft', 'active', 'paused', 'achieved', 'abandoned') then
        raise exception using errcode = 'P0001', message = 'invalid_input';
      end if;
      update public.goals set
        status = p_input ->> 'status', version = version + 1,
        achieved_at = case
          when (p_input ->> 'status') = 'achieved' then coalesce(achieved_at, clock_timestamp())
          else null
        end
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null
      returning * into v_row;
      v_target_type := 'goal';
    else
      if (p_input ->> 'status') not in ('open', 'in_progress', 'blocked', 'done', 'dropped') then
        raise exception using errcode = 'P0001', message = 'invalid_input';
      end if;
      update public.actions set
        status = p_input ->> 'status', version = version + 1,
        completed_at = case when (p_input ->> 'status') = 'done' then clock_timestamp() else null end
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null
      returning * into v_row;
      v_target_type := 'action';
    end if;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if p_operation_id = 'action.status.v1' and (p_input ->> 'status') in ('done', 'dropped') then
      delete from public.daily_focus_items
      where workspace_id = v_workspace_id and action_id = v_target_id;
    end if;
    v_result := to_jsonb(v_row);

  elsif p_operation_id in ('goal.archive.v1', 'action.archive.v1') then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if p_operation_id = 'goal.archive.v1' then
      if not exists (
        select 1 from public.goals where id = v_target_id and workspace_id = v_workspace_id
          and version = v_expected_version and trashed_at is null
      ) then
        raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
      end if;
      update public.actions set archived_at = clock_timestamp(), version = version + 1
      where workspace_id = v_workspace_id and trashed_at is null
        and goal_id in (
          select id from public.goals where workspace_id = v_workspace_id
            and (id = v_target_id or parent_goal_id = v_target_id)
        );
      delete from public.daily_focus_items focused
      using public.actions action
      where focused.workspace_id = action.workspace_id
        and focused.action_id = action.id
        and focused.workspace_id = v_workspace_id
        and action.archived_at is not null;
      update public.goals set archived_at = clock_timestamp(), version = version + 1
      where workspace_id = v_workspace_id and trashed_at is null
        and (id = v_target_id or parent_goal_id = v_target_id);
      select * into v_row from public.goals where id = v_target_id and workspace_id = v_workspace_id;
      v_target_type := 'goal';
    else
      update public.actions set archived_at = clock_timestamp(), version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null
      returning * into v_row;
      if not found then
        raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
      end if;
      with recursive descendants as (
        select action.id, 0 as depth
        from public.actions action
        where action.id = v_target_id and action.workspace_id = v_workspace_id
        union all
        select child.id, descendants.depth + 1
        from public.actions child
        join descendants on child.parent_action_id = descendants.id
        where child.workspace_id = v_workspace_id and descendants.depth < 32
      )
      update public.actions set archived_at = clock_timestamp(), version = version + 1
      where workspace_id = v_workspace_id and trashed_at is null and archived_at is null
        and id in (select id from descendants) and id <> v_target_id;
      delete from public.daily_focus_items focused
      using public.actions action
      where focused.workspace_id = action.workspace_id
        and focused.action_id = action.id
        and focused.workspace_id = v_workspace_id
        and action.archived_at is not null;
      v_target_type := 'action';
    end if;
    v_result := to_jsonb(v_row);

  elsif p_operation_id = 'capture.create.v1' then
    if jsonb_typeof(p_input -> 'rawText') <> 'string'
      or char_length(trim(p_input ->> 'rawText')) not between 3 and 60000
      or (p_input ->> 'source') not in ('typed', 'voice', 'import') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    insert into public.captures (workspace_id, raw_text, source)
    values (v_workspace_id, p_input ->> 'rawText', p_input ->> 'source')
    returning * into v_row;
    v_target_id := v_row.id;
    v_target_type := 'capture';
    v_result := to_jsonb(v_row);
  end if;

  insert into public.operation_receipts (
    workspace_id, operation_id, operation_version, actor_user_id, actor_type,
    surface, idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, 1, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, v_risk_class, v_target_type, v_target_id, 'succeeded', v_result
  );

  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, v_target_type, v_target_id, v_risk_class, 'succeeded'
  );

  return v_result;
exception
  when invalid_text_representation or datetime_field_overflow or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

-- Two more readers had "the workspace's Vision" written as a query that
-- happened to match one row. With an area able to hold a direction of its own
-- they match several, so each now names the overall Vision the way
-- `vision.upsert.v1` does. Onboarding would otherwise fail outright -- its
-- `on conflict (workspace_id)` no longer matches an index -- and the MCP
-- snapshot would fail on a subquery returning more than one row, which is the
-- worse of the two because it only happens once somebody writes their second
-- area vision.
--
-- Both bodies are otherwise exactly what the database already held.

CREATE OR REPLACE FUNCTION public.execute_guided_onboarding_operation(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_timezone text;
  v_week_starts_on smallint;
  v_coaching_intensity text;
  v_ai_enabled boolean;
  v_weekly_review_day smallint;
  v_today date;
  v_vision_text text;
  v_goal_title text;
  v_action_title text;
  v_capture_text text;
  v_year_start date;
  v_year_end date;
  v_month_start date;
  v_month_end date;
  v_horizon_id uuid;
  v_vision_id uuid;
  v_goal_id uuid;
  v_action_id uuid;
  v_capture_id uuid;
  v_completed_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'workspace.onboarding-complete.v1'
    or p_surface <> 'ui'
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;

  v_timezone := p_input ->> 'timezone';
  v_week_starts_on := (p_input ->> 'weekStartsOn')::smallint;
  v_coaching_intensity := p_input ->> 'coachingIntensity';
  v_ai_enabled := (p_input ->> 'aiEnabled')::boolean;
  v_weekly_review_day := (p_input ->> 'weeklyReviewDay')::smallint;
  v_today := (p_input ->> 'today')::date;
  v_vision_text := p_input ->> 'visionText';
  v_goal_title := p_input ->> 'goalTitle';
  v_action_title := p_input ->> 'actionTitle';
  v_capture_text := p_input ->> 'captureText';
  if not exists (select 1 from pg_timezone_names where name = v_timezone)
    or v_week_starts_on not between 0 and 6
    or v_coaching_intensity not in ('calm', 'direct', 'strict')
    or jsonb_typeof(p_input -> 'aiEnabled') <> 'boolean'
    or v_weekly_review_day not between 0 and 6
    or v_today not between date '2020-01-01' and date '2100-12-31'
    or (v_vision_text is not null and char_length(trim(v_vision_text)) not between 3 and 50000)
    or (v_goal_title is not null and char_length(trim(v_goal_title)) not between 3 and 1000)
    or (v_action_title is not null and char_length(trim(v_action_title)) not between 3 and 1000)
    or (v_capture_text is not null and char_length(trim(v_capture_text)) not between 3 and 60000) then
    raise exception using errcode = 'P0001', message = 'invalid_guided_onboarding';
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

  if v_vision_text is not null then
    insert into public.visions (workspace_id, area_id, body_markdown)
    values (v_workspace_id, null, trim(v_vision_text))
    on conflict (workspace_id)
      where area_id is null and archived_at is null and trashed_at is null
    do update set body_markdown = excluded.body_markdown, version = public.visions.version + 1
    returning id into v_vision_id;
  else
    select id into v_vision_id from public.visions
    where workspace_id = v_workspace_id and area_id is null
      and archived_at is null and trashed_at is null;
  end if;

  if v_goal_title is not null then
    if v_vision_id is null then
      raise exception using errcode = 'P0001', message = 'vision_required';
    end if;
    v_year_start := date_trunc('year', v_today)::date;
    v_year_end := (v_year_start + interval '1 year - 1 day')::date;
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    ) values (
      v_workspace_id, 'year', v_year_start, v_year_end, v_timezone
    ) on conflict (workspace_id, kind, starts_on)
      do update set ends_on = excluded.ends_on, timezone_snapshot = excluded.timezone_snapshot
    returning id into v_horizon_id;
    insert into public.goals (
      workspace_id, vision_id, horizon_id, title, status, due_on
    ) values (
      v_workspace_id, v_vision_id, v_horizon_id, trim(v_goal_title), 'active', v_year_end
    ) returning id into v_goal_id;
  end if;

  if v_action_title is not null then
    v_month_start := date_trunc('month', v_today)::date;
    v_month_end := (v_month_start + interval '1 month - 1 day')::date;
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    ) values (
      v_workspace_id, 'month', v_month_start, v_month_end, v_timezone
    ) on conflict (workspace_id, kind, starts_on)
      do update set ends_on = excluded.ends_on, timezone_snapshot = excluded.timezone_snapshot
    returning id into v_horizon_id;
    insert into public.actions (
      workspace_id, goal_id, horizon_id, title, status, scheduled_on
    ) values (
      v_workspace_id, v_goal_id, v_horizon_id, trim(v_action_title), 'open', v_today
    ) returning id into v_action_id;
  end if;

  if v_capture_text is not null then
    insert into public.captures (workspace_id, raw_text, source)
    values (v_workspace_id, v_capture_text, 'typed')
    returning id into v_capture_id;
  end if;

  update public.workspaces set
    timezone = v_timezone,
    week_starts_on = v_week_starts_on,
    coaching_intensity = v_coaching_intensity,
    ai_enabled = v_ai_enabled,
    weekly_review_day = v_weekly_review_day,
    onboarding_completed_at = coalesce(onboarding_completed_at, clock_timestamp())
  where id = v_workspace_id
  returning onboarding_completed_at into v_completed_at;

  v_result := jsonb_build_object(
    'workspaceId', v_workspace_id,
    'onboardingCompletedAt', v_completed_at,
    'visionId', v_vision_id,
    'goalId', v_goal_id,
    'actionId', v_action_id,
    'captureId', v_capture_id
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id, 'user', p_surface,
    p_idempotency_key, 'medium', 'workspace', v_workspace_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', p_surface, p_operation_id,
    'workspace', v_workspace_id, 'medium', 'explicit_ui_commit', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or check_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'invalid_guided_onboarding';
end;
$function$;

CREATE OR REPLACE FUNCTION public.build_mcp_workspace_snapshot_action_template_base(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'timezone', workspace.timezone,
    'coachingIntensity', workspace.coaching_intensity,
    'today', (clock_timestamp() at time zone workspace.timezone)::date,
    'vision', (
      select body_markdown from public.visions
      where workspace_id = workspace.id and area_id is null
        and archived_at is null and trashed_at is null
    ),
    'goals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id, 'title', title, 'status', status, 'dueOn', due_on, 'version', version
        ) order by due_on nulls last, created_at
      )
      from public.goals
      where workspace_id = workspace.id and archived_at is null and trashed_at is null
    ), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id, 'title', title, 'status', status,
          'scheduledOn', scheduled_on, 'version', version
        ) order by scheduled_on nulls last, created_at
      )
      from public.actions
      where workspace_id = workspace.id and archived_at is null and trashed_at is null
    ), '[]'::jsonb),
    'todayFocus', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', action.id, 'title', action.title, 'status', action.status,
          'scheduledOn', action.scheduled_on, 'version', action.version
        ) order by focused.sort_order
      )
      from public.daily_focus_items focused
      join public.actions action
        on action.id = focused.action_id and action.workspace_id = focused.workspace_id
      where focused.workspace_id = workspace.id
        and focused.focus_on = (clock_timestamp() at time zone workspace.timezone)::date
        and action.archived_at is null and action.trashed_at is null
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', id, 'title', title, 'version', version)
        order by updated_at desc
      )
      from public.notes
      where workspace_id = workspace.id and ai_excluded = false
        and archived_at is null and trashed_at is null
    ), '[]'::jsonb)
  )
  from public.workspaces workspace
  where workspace.id = p_workspace_id;
$function$;

commit;
