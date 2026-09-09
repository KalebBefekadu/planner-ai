-- Notes had a hierarchy but no shortcut into it. The pages someone opens every
-- day were reached by walking the tree from the root each time, which is the
-- work the tree was supposed to save. Favourites give those pages a fixed place
-- at the top of the sidebar.
--
-- The flag is a timestamp rather than a boolean because the order of the
-- favourites list is itself something the owner builds: the order they starred
-- them in. A boolean would have left the list ordered by whatever the last
-- query happened to return, which reshuffles on every edit. Storing when it was
-- favourited makes that order durable across reload without a second column and
-- without a renumbering write.
--
-- The column lives on public.notes, which already has row level security forced
-- and only an owner-scoped select policy, so a favourite is unreadable outside
-- its own workspace for the same reason the Note is. Writes continue to go
-- through a security-definer Operation; authenticated has no direct update
-- grant on the table.

begin;

alter table public.notes add column favorited_at timestamptz;

-- Favourites are a small slice of a potentially large tree, and the sidebar
-- reads them on every Notes render. The partial index keeps that read bounded
-- by the number of favourites rather than the size of the vault.
create index notes_favorites_idx on public.notes (workspace_id, favorited_at)
  where favorited_at is not null;

-- Marking a favourite is deliberately not registered as undoable. Every other
-- entry in the undo registry restores something a person cannot easily rebuild
-- by hand; this one is a toggle whose inverse is the same control they just
-- pressed. Putting it in the undo history would bury the changes that genuinely
-- need it under a run of star clicks.
insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('note.favorite.v1', 'low', array['ui', 'chat', 'mcp'], false)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_note_favorite_operation(
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
  v_target_id uuid;
  v_expected_version bigint;
  v_favorited boolean;
  v_result jsonb;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'note.favorite.v1' then
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
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  v_target_id := (p_input ->> 'id')::uuid;
  v_expected_version := (p_input ->> 'expectedVersion')::bigint;
  if p_input ->> 'favorited' is null or v_target_id is null or v_expected_version is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  v_favorited := (p_input ->> 'favorited')::boolean;

  -- The workspace predicate is what keeps one owner's star off another owner's
  -- Note even though this function runs as definer: auth.uid() picks the
  -- workspace, and nothing outside it is reachable.
  select * into v_row from public.notes
  where id = v_target_id and workspace_id = v_workspace_id
    and version = v_expected_version and trashed_at is null
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
  end if;

  -- Re-favouriting an already favourited Note keeps its original timestamp, so
  -- a stray second click cannot silently move it to the end of the list.
  update public.notes set
    favorited_at = case
      when not v_favorited then null
      else coalesce(v_row.favorited_at, clock_timestamp())
    end,
    version = version + 1
  where id = v_target_id and workspace_id = v_workspace_id
  returning * into v_row;

  v_result := to_jsonb(v_row);
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low', 'note', v_target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'note', v_target_id, 'low', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

alter function public.dispatch_trusted_operation(text, jsonb, text, text)
rename to dispatch_trusted_operation_favorite_base;

create or replace function public.dispatch_trusted_operation(
  p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_operation_id = 'note.favorite.v1' then
    return public.execute_note_favorite_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.dispatch_trusted_operation_favorite_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
end;
$$;

revoke all on function public.execute_note_favorite_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation_favorite_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
