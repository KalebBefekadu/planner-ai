begin;

create table public.trash_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  root_item_type text not null check (root_item_type in ('goal', 'action', 'note', 'capture', 'memory', 'conversation')),
  root_item_id uuid not null,
  root_label text not null check (char_length(root_label) between 1 and 300),
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  emptied_at timestamptz
);
create index trash_batches_workspace_idx on public.trash_batches (workspace_id, created_at desc);

create table public.trash_batch_items (
  batch_id uuid not null references public.trash_batches(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  item_type text not null check (item_type in ('goal', 'action', 'note', 'capture', 'memory', 'conversation')),
  item_id uuid not null,
  primary key (batch_id, item_type, item_id)
);

alter table public.trash_batches enable row level security;
alter table public.trash_batches force row level security;
alter table public.trash_batch_items enable row level security;
alter table public.trash_batch_items force row level security;
create policy trash_batches_select_owner on public.trash_batches for select to authenticated
using (workspace_id in (select id from public.workspaces where owner_user_id = auth.uid()));
create policy trash_batch_items_select_owner on public.trash_batch_items for select to authenticated
using (workspace_id in (select id from public.workspaces where owner_user_id = auth.uid()));
revoke all on public.trash_batches, public.trash_batch_items from anon;
revoke insert, update, delete, truncate, references, trigger on public.trash_batches, public.trash_batch_items from authenticated;
grant select on public.trash_batches, public.trash_batch_items to authenticated;

create or replace function public.execute_trash_operation(
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
  v_batch_id uuid;
  v_item_id uuid;
  v_item_type text;
  v_expected_version integer;
  v_label text;
  v_count integer := 0;
  v_step_count integer;
  v_result jsonb;
  v_risk text := case when p_operation_id = 'trash.empty.v1' then 'high' when p_operation_id = 'trash.move.v1' then 'medium' else 'low' end;
  v_cutoff timestamptz;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  if p_operation_id not in ('trash.move.v1', 'trash.restore.v1', 'trash.empty.v1')
    or p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then raise exception using errcode = 'P0001', message = 'workspace_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0));
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  if p_operation_id = 'trash.move.v1' then
    v_item_type := p_input ->> 'itemType';
    v_item_id := (p_input ->> 'id')::uuid;
    v_expected_version := nullif(p_input ->> 'expectedVersion', '')::integer;
    if v_item_type = 'goal' then
      select title into v_label from public.goals where id = v_item_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null for update;
    elsif v_item_type = 'action' then
      select title into v_label from public.actions where id = v_item_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null for update;
    elsif v_item_type = 'note' then
      select title into v_label from public.notes where id = v_item_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null for update;
    elsif v_item_type = 'capture' then
      select left(raw_text, 300) into v_label from public.captures where id = v_item_id and workspace_id = v_workspace_id
        and trashed_at is null for update;
    elsif v_item_type = 'memory' then
      select left(statement, 300) into v_label from public.memories where id = v_item_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null for update;
    elsif v_item_type = 'conversation' then
      select title into v_label from public.conversations where id = v_item_id and workspace_id = v_workspace_id
        and trashed_at is null for update;
    else
      raise exception using errcode = 'P0001', message = 'invalid_trash_type';
    end if;
    if v_label is null then raise exception using errcode = '40001', message = 'version_conflict_or_not_found'; end if;
    insert into public.trash_batches (workspace_id, root_item_type, root_item_id, root_label)
    values (v_workspace_id, v_item_type, v_item_id, v_label) returning id into v_batch_id;

    if v_item_type = 'goal' then
      with recursive descendants as (
        select id from public.goals where id = v_item_id and workspace_id = v_workspace_id and trashed_at is null
        union all
        select g.id from public.goals g join descendants d on g.parent_goal_id = d.id
        where g.workspace_id = v_workspace_id and g.trashed_at is null
      )
      insert into public.trash_batch_items (batch_id, workspace_id, item_type, item_id)
      select v_batch_id, v_workspace_id, 'goal', id from descendants;
      insert into public.trash_batch_items (batch_id, workspace_id, item_type, item_id)
      select v_batch_id, v_workspace_id, 'action', a.id from public.actions a
      where a.workspace_id = v_workspace_id and a.trashed_at is null
        and a.goal_id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'goal');
    elsif v_item_type = 'note' then
      with recursive descendants as (
        select id from public.notes where id = v_item_id and workspace_id = v_workspace_id and trashed_at is null
        union all
        select n.id from public.notes n join descendants d on n.parent_note_id = d.id
        where n.workspace_id = v_workspace_id and n.trashed_at is null
      )
      insert into public.trash_batch_items (batch_id, workspace_id, item_type, item_id)
      select v_batch_id, v_workspace_id, 'note', id from descendants;
    else
      insert into public.trash_batch_items (batch_id, workspace_id, item_type, item_id)
      values (v_batch_id, v_workspace_id, v_item_type, v_item_id);
    end if;

    update public.goals set
      trashed_at = clock_timestamp(), purge_after = clock_timestamp() + interval '30 days', version = version + 1
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'goal');
    update public.actions set
      trashed_at = clock_timestamp(), purge_after = clock_timestamp() + interval '30 days', version = version + 1
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'action');
    update public.notes set
      trashed_at = clock_timestamp(), purge_after = clock_timestamp() + interval '30 days', version = version + 1
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'note');
    update public.captures set
      trashed_at = clock_timestamp(), purge_after = clock_timestamp() + interval '30 days'
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'capture');
    update public.memories set trashed_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'memory');
    update public.conversations set trashed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'conversation');
    select count(*)::integer into v_count from public.trash_batch_items where batch_id = v_batch_id;
    v_result := jsonb_build_object('batchId', v_batch_id, 'affectedCount', v_count, 'status', 'trashed');

  elsif p_operation_id = 'trash.restore.v1' then
    v_batch_id := (p_input ->> 'batchId')::uuid;
    perform 1 from public.trash_batches where id = v_batch_id and workspace_id = v_workspace_id
      and restored_at is null and emptied_at is null for update;
    if not found then raise exception using errcode = 'P0001', message = 'trash_batch_not_found'; end if;
    update public.goals set trashed_at = null, purge_after = null, version = version + 1
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'goal');
    update public.actions set trashed_at = null, purge_after = null, version = version + 1
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'action');
    update public.notes set trashed_at = null, purge_after = null, version = version + 1
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'note');
    update public.captures set trashed_at = null, purge_after = null
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'capture');
    update public.memories set trashed_at = null, version = version + 1, updated_at = clock_timestamp()
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'memory');
    update public.conversations set trashed_at = null, updated_at = clock_timestamp()
    where id in (select item_id from public.trash_batch_items where batch_id = v_batch_id and item_type = 'conversation');
    update public.trash_batches set restored_at = clock_timestamp() where id = v_batch_id;
    select count(*)::integer into v_count from public.trash_batch_items where batch_id = v_batch_id;
    v_result := jsonb_build_object('batchId', v_batch_id, 'affectedCount', v_count, 'status', 'restored');

  else
    if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
      or p_input ->> 'confirmation' <> 'EMPTY TRASH'
      or (p_input ->> 'retentionDays')::integer <> 30 then
      raise exception using errcode = '42501', message = 'aal2_and_confirmation_required';
    end if;
    v_cutoff := clock_timestamp() - interval '30 days';
    delete from public.conversations where workspace_id = v_workspace_id and trashed_at <= v_cutoff;
    get diagnostics v_step_count = row_count; v_count := v_count + v_step_count;
    delete from public.memories where workspace_id = v_workspace_id and trashed_at <= v_cutoff;
    get diagnostics v_step_count = row_count; v_count := v_count + v_step_count;
    delete from public.notes where workspace_id = v_workspace_id and trashed_at <= v_cutoff;
    get diagnostics v_step_count = row_count; v_count := v_count + v_step_count;
    delete from public.captures where workspace_id = v_workspace_id and trashed_at <= v_cutoff;
    get diagnostics v_step_count = row_count; v_count := v_count + v_step_count;
    delete from public.actions where workspace_id = v_workspace_id and trashed_at <= v_cutoff;
    get diagnostics v_step_count = row_count; v_count := v_count + v_step_count;
    delete from public.goals where workspace_id = v_workspace_id and trashed_at <= v_cutoff;
    get diagnostics v_step_count = row_count; v_count := v_count + v_step_count;
    update public.trash_batches set emptied_at = clock_timestamp()
    where workspace_id = v_workspace_id and restored_at is null and emptied_at is null and created_at <= v_cutoff;
    v_result := jsonb_build_object('batchId', null, 'affectedCount', v_count, 'status', 'emptied');
  end if;

  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' when p_surface in ('mcp', 'automation') then 'automation' else 'user' end,
    p_surface, p_idempotency_key, v_risk, 'trash_batch', v_batch_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' when p_surface in ('mcp', 'automation') then 'automation' else 'user' end,
    p_surface, p_operation_id, 'trash_batch', v_batch_id, v_risk,
    case when v_risk in ('medium', 'high') then 'approved' else null end, 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.execute_trash_operation(text, jsonb, text, text) from public, anon;
grant execute on function public.execute_trash_operation(text, jsonb, text, text) to authenticated;

commit;
