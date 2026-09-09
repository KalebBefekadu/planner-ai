-- A Note had no appearance of its own.
--
-- /preview showed every page with an icon and a cover band, and those were
-- fixture literals in preview-data.ts. Real Notes carried title, body, sort key
-- and an AI-exclusion flag and nothing else, so the accepted writing experience
-- could not be reproduced on the owner's actual pages: there was nowhere to put
-- the values.
--
-- Appearance is stored as three ordinary columns rather than a jsonb blob so
-- the database can state the rules itself. A cover is a key into a catalogue
-- the application bundles, never a URL, so no stored value can point a page at
-- a third-party origin. The vertical offset is a bounded percentage, which is
-- all /preview's hand-tuned per-cover background offsets ever were.
--
-- The write goes through its own versioned Operation. Folding it into
-- note.update.v1 would have changed a contract that chat and MCP already call,
-- and would have made every appearance change write a Note revision -- moving a
-- cover two percent is not an edit to the writing, and the history panel should
-- not fill up with them.

begin;

alter table public.notes
  add column icon_emoji text,
  add column cover_key text,
  add column cover_position smallint not null default 50;

-- Bounded at the storage layer, not only in TypeScript: MCP, chat and any
-- future writer reach the same table, and a check constraint is the only rule
-- all of them are forced through.
alter table public.notes
  add constraint notes_icon_emoji_length
    check (icon_emoji is null or char_length(icon_emoji) between 1 and 32),
  add constraint notes_cover_key_known
    check (cover_key is null or cover_key in ('focus', 'north', 'health', 'product')),
  add constraint notes_cover_position_bounded
    check (cover_position between 0 and 100);

-- Recorded as not reversible because operation.undo.v1 has no strategy for it:
-- there is no row in operation_undo_support, so nothing would replay the
-- snapshot. The undo payload is still written, because the receipt is the
-- record of what the appearance was before, and the document header offers a
-- direct "Reset appearance" control instead.
insert into public.operation_contracts (operation_id, risk_class, exposures, reversible)
values ('note.appearance.v1', 'low', array['ui'], false);

create or replace function public.execute_note_appearance_operation(
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
  v_expected_version bigint;
  v_receipt_id uuid;
  v_result jsonb;
  v_undo_payload jsonb;
  v_icon text;
  v_cover text;
  v_position smallint;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'note.appearance.v1' then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  -- How a page looks is a preference about the owner's own workspace, in the
  -- same family as workspace.preferences.v1, and it is reachable from the UI
  -- only. An agent asked to tidy up should not be able to restyle pages.
  if p_surface <> 'ui' then
    raise exception using errcode = 'P0001', message = 'surface_not_allowed';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
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

  v_target_id := (p_input ->> 'id')::uuid;
  v_expected_version := (p_input ->> 'expectedVersion')::bigint;
  v_icon := nullif(p_input ->> 'iconEmoji', '');
  v_cover := nullif(p_input ->> 'coverKey', '');
  -- An offset without a cover is a value nothing can render, and it would make
  -- two pages that look identical compare unequal. Clearing the cover returns
  -- the offset to centre here as well as in the client.
  v_position := case
    when v_cover is null then 50
    else greatest(0, least(100, coalesce((p_input ->> 'coverPosition')::numeric, 50)))::smallint
  end;

  if v_icon is not null and char_length(v_icon) > 32 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_cover is not null and v_cover not in ('focus', 'north', 'health', 'product') then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  select jsonb_build_object(
    'iconEmoji', icon_emoji,
    'coverKey', cover_key,
    'coverPosition', cover_position
  ) into v_undo_payload
  from public.notes
  where id = v_target_id and workspace_id = v_workspace_id
    and version = v_expected_version and trashed_at is null
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
  end if;

  update public.notes set
    icon_emoji = v_icon,
    cover_key = v_cover,
    cover_position = v_position,
    version = version + 1
  where id = v_target_id and workspace_id = v_workspace_id
  returning * into v_row;

  v_result := to_jsonb(v_row);
  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json,
    undo_payload_json
  ) values (
    v_receipt_id, v_workspace_id, p_operation_id, v_user_id, 'user',
    p_surface, p_idempotency_key, 'low', 'note', v_target_id, 'succeeded',
    v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', p_surface, p_operation_id,
    'note', v_target_id, 'low', 'succeeded'
  );

  return v_result;
end;
$$;

revoke all on function public.execute_note_appearance_operation(text, jsonb, text, text)
  from public, anon;
grant execute on function public.execute_note_appearance_operation(text, jsonb, text, text)
  to authenticated;

-- The established way to add an operation without rewriting the dispatcher:
-- rename the current one aside and delegate everything else straight to it,
-- exactly as the capture-proposal batch migration did.
alter function public.dispatch_trusted_operation(text, jsonb, text, text)
  rename to dispatch_trusted_operation_note_appearance_base;

create or replace function public.dispatch_trusted_operation(
  p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_operation_id = 'note.appearance.v1' then
    return public.execute_note_appearance_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.dispatch_trusted_operation_note_appearance_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
end;
$$;

commit;
