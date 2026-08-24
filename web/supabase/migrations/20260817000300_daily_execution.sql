begin;

create table public.daily_focus_items (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  focus_on date not null,
  action_id uuid not null,
  sort_order smallint not null check (sort_order between 0 and 4),
  created_at timestamptz not null default now(),
  primary key (workspace_id, focus_on, action_id),
  unique (workspace_id, focus_on, sort_order),
  foreign key (action_id, workspace_id) references public.actions(id, workspace_id) on delete cascade
);
create index daily_focus_action_idx
on public.daily_focus_items (workspace_id, action_id, focus_on desc);
alter table public.daily_focus_items enable row level security;
create policy daily_focus_owner_select on public.daily_focus_items for select to authenticated
using (
  workspace_id in (
    select id from public.workspaces where owner_user_id = auth.uid()
  )
);
create policy daily_focus_owner_delete on public.daily_focus_items for delete to authenticated
using (
  workspace_id in (
    select id from public.workspaces where owner_user_id = auth.uid()
  )
);
revoke all on public.daily_focus_items from anon, authenticated;
grant select on public.daily_focus_items to authenticated;

create or replace function public.cleanup_inactive_daily_focus()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status in ('done', 'dropped') or new.archived_at is not null or new.trashed_at is not null then
    delete from public.daily_focus_items
    where workspace_id = new.workspace_id and action_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.cleanup_inactive_daily_focus() from public, anon, authenticated;
create trigger actions_cleanup_daily_focus
after update of status, archived_at, trashed_at on public.actions
for each row execute function public.cleanup_inactive_daily_focus();

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('action.update.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('daily-focus.set.v1', 'low', array['ui', 'chat', 'mcp'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_daily_execution_operation(
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
  v_focus_on date;
  v_action_ids uuid[];
  v_previous_scheduled_on date;
  v_previous_horizon_id uuid;
  v_result jsonb;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('action.update.v1', 'action.status.v1', 'daily-focus.set.v1') then
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

  if p_operation_id = 'action.update.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if not (p_input ?& array['id', 'expectedVersion', 'title', 'descriptionMarkdown', 'scheduledOn'])
      or char_length(trim(p_input ->> 'title')) not between 3 and 1000
      or char_length(coalesce(p_input ->> 'descriptionMarkdown', '')) > 50000
      or jsonb_typeof(p_input -> 'scheduledOn') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select scheduled_on, horizon_id into v_previous_scheduled_on, v_previous_horizon_id
    from public.actions
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and archived_at is null and trashed_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    update public.actions set
      title = trim(p_input ->> 'title'),
      description_markdown = nullif(p_input ->> 'descriptionMarkdown', ''),
      scheduled_on = nullif(p_input ->> 'scheduledOn', '')::date,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and archived_at is null and trashed_at is null
    returning * into v_row;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if v_previous_scheduled_on is distinct from v_row.scheduled_on then
      insert into public.action_schedule_history (
        workspace_id, action_id, previous_horizon_id, new_horizon_id,
        previous_scheduled_on, new_scheduled_on, reason, actor_user_id
      ) values (
        v_workspace_id, v_target_id, v_previous_horizon_id, v_row.horizon_id,
        v_previous_scheduled_on, v_row.scheduled_on, 'rescheduled', v_user_id
      );
    end if;
    v_result := to_jsonb(v_row);
  elsif p_operation_id = 'action.status.v1' then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if (p_input ->> 'status') not in ('open', 'in_progress', 'blocked', 'done', 'dropped') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    update public.actions set
      status = p_input ->> 'status',
      version = version + 1,
      completed_at = case when (p_input ->> 'status') = 'done' then clock_timestamp() else null end
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    returning * into v_row;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if (p_input ->> 'status') in ('done', 'dropped') then
      delete from public.daily_focus_items
      where workspace_id = v_workspace_id and action_id = v_target_id;
    end if;
    v_result := to_jsonb(v_row);
  else
    v_focus_on := (p_input ->> 'focusOn')::date;
    if not (p_input ?& array['focusOn', 'actionIds'])
      or jsonb_typeof(p_input -> 'actionIds') <> 'array'
      or jsonb_array_length(p_input -> 'actionIds') > 5
      or v_focus_on not between current_date - 31 and current_date + 31 then
      raise exception using errcode = 'P0001', message = 'invalid_daily_focus';
    end if;
    select coalesce(array_agg(value::uuid order by ordinality), array[]::uuid[])
    into v_action_ids
    from jsonb_array_elements_text(p_input -> 'actionIds')
      with ordinality as item(value, ordinality);
    if cardinality(v_action_ids) <> (
      select count(distinct action_id) from unnest(v_action_ids) as focused(action_id)
    ) or exists (
      select 1 from unnest(v_action_ids) as focused(action_id)
      left join public.actions action
        on action.id = action_id and action.workspace_id = v_workspace_id
        and action.status not in ('done', 'dropped')
        and action.archived_at is null and action.trashed_at is null
      where action.id is null
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_daily_focus';
    end if;
    delete from public.daily_focus_items
    where workspace_id = v_workspace_id and focus_on = v_focus_on;
    insert into public.daily_focus_items (workspace_id, focus_on, action_id, sort_order)
    select v_workspace_id, v_focus_on, action_id, (ordinality - 1)::smallint
    from unnest(v_action_ids) with ordinality as focused(action_id, ordinality);
    v_target_id := null;
    v_result := jsonb_build_object('focusOn', v_focus_on, 'actionIds', to_jsonb(v_action_ids));
  end if;

  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low',
    case when p_operation_id in ('action.update.v1', 'action.status.v1') then 'action' else 'daily_focus' end,
    v_target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_operation_id,
    case when p_operation_id in ('action.update.v1', 'action.status.v1') then 'action' else 'daily_focus' end,
    v_target_id, 'low',
    case when p_surface = 'ui' then 'explicit_ui_commit' else 'approved' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
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
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;
  if p_operation_id in ('action.update.v1', 'daily-focus.set.v1') then
    v_result := public.execute_daily_execution_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id like 'workspace.%' then
    v_result := public.execute_workspace_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id in (
    'note.goal-link.v1', 'note.goal-unlink.v1',
    'note.action-link.v1', 'note.action-unlink.v1'
  ) then
    v_result := public.execute_note_relation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
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

create or replace function public.build_mcp_workspace_snapshot(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'timezone', workspace.timezone,
    'coachingIntensity', workspace.coaching_intensity,
    'today', (clock_timestamp() at time zone workspace.timezone)::date,
    'vision', (
      select body_markdown from public.visions
      where workspace_id = workspace.id and archived_at is null and trashed_at is null
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
$$;

create or replace function public.read_mcp_workspace_snapshot(p_token_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token record;
  v_result jsonb;
begin
  select id as token_id, workspace_id, owner_user_id, allowed_operations
  into v_token
  from public.mcp_access_tokens
  where id = p_token_id and revoked_at is null and expires_at > clock_timestamp();
  if not found or not ('workspace.snapshot.read.v1' = any(v_token.allowed_operations)) then
    raise exception using errcode = '28000', message = 'invalid_or_limited_mcp_token';
  end if;
  v_result := public.build_mcp_workspace_snapshot(v_token.workspace_id);
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, risk_class, outcome
  ) values (
    v_token.workspace_id, v_token.owner_user_id, 'automation', 'mcp',
    'workspace.snapshot.read.v1', 'workspace', 'read', 'succeeded'
  );
  return v_result;
end;
$$;

create or replace function public.read_mcp_oauth_workspace_snapshot(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_id text := auth.jwt() ->> 'client_id';
  v_grant record;
  v_result jsonb;
begin
  select id, workspace_id, allowed_operations into v_grant
  from public.mcp_oauth_grants
  where id = p_grant_id and owner_user_id = v_user_id
    and oauth_client_id = v_client_id and revoked_at is null;
  if not found or not ('workspace.snapshot.read.v1' = any(v_grant.allowed_operations)) then
    raise exception using errcode = '42501', message = 'snapshot_not_granted';
  end if;
  v_result := public.build_mcp_workspace_snapshot(v_grant.workspace_id);
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, risk_class, outcome
  ) values (
    v_grant.workspace_id, v_user_id, 'automation', 'mcp',
    'workspace.snapshot.read.v1', 'workspace', 'read', 'succeeded'
  );
  return v_result;
end;
$$;

revoke all on function public.execute_daily_execution_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.build_mcp_workspace_snapshot(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.read_mcp_workspace_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.read_mcp_oauth_workspace_snapshot(uuid) from public, anon;
grant execute on function public.read_mcp_workspace_snapshot(uuid) to service_role;
grant execute on function public.read_mcp_oauth_workspace_snapshot(uuid) to authenticated;

commit;
