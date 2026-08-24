begin;

create table public.reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  horizon_id uuid not null,
  kind text not null check (kind in ('daily', 'weekly', 'monthly', 'quarterly')),
  status text not null check (status in ('draft', 'completed')),
  reflection_markdown text not null default '' check (char_length(reflection_markdown) <= 50000),
  version bigint not null default 1 check (version > 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (horizon_id, workspace_id) references public.planning_horizons(id, workspace_id),
  check ((status = 'completed' and completed_at is not null) or status = 'draft')
);
create unique index reviews_one_completed_kind_horizon_idx
on public.reviews (workspace_id, horizon_id, kind) where status = 'completed';
create index reviews_workspace_idx on public.reviews (workspace_id, created_at desc);
create trigger reviews_set_updated_at before update on public.reviews
for each row execute function public.set_updated_at();

create table public.review_action_items (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null,
  action_id uuid not null,
  action_title_snapshot text not null,
  action_status_snapshot text not null,
  action_version_snapshot bigint not null,
  resolution text not null check (
    resolution in ('done', 'next_week', 'blocked', 'dropped', 'left_overdue')
  ),
  reason text check (reason is null or char_length(reason) <= 500),
  priority boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, review_id, action_id),
  foreign key (review_id, workspace_id) references public.reviews(id, workspace_id) on delete cascade,
  foreign key (action_id, workspace_id) references public.actions(id, workspace_id)
);
create index review_action_items_review_idx on public.review_action_items (workspace_id, review_id);

create table public.action_schedule_history (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_id uuid not null,
  review_id uuid,
  previous_horizon_id uuid,
  new_horizon_id uuid,
  previous_scheduled_on date,
  new_scheduled_on date,
  reason text not null check (
    reason in ('completed', 'rescheduled', 'blocked', 'dropped', 'left_overdue')
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (action_id, workspace_id) references public.actions(id, workspace_id),
  foreign key (review_id, workspace_id) references public.reviews(id, workspace_id)
    on delete set null (review_id),
  foreign key (previous_horizon_id, workspace_id) references public.planning_horizons(id, workspace_id),
  foreign key (new_horizon_id, workspace_id) references public.planning_horizons(id, workspace_id)
);
create index action_schedule_history_action_idx
on public.action_schedule_history (workspace_id, action_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['reviews', 'review_action_items', 'action_schedule_history'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (workspace_id in (select id from public.workspaces where owner_user_id = auth.uid()))',
      table_name || '_select_owner', table_name
    );
    execute format('revoke all on public.%I from anon', table_name);
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated',
      table_name
    );
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end;
$$;

create or replace function public.execute_review_operation(
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
  v_timezone text;
  v_starts_on date;
  v_ends_on date;
  v_horizon_id uuid;
  v_next_horizon_id uuid;
  v_review_id uuid;
  v_resolved_count integer;
  v_priority_count integer;
  v_result jsonb;
  v_decision record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'review.complete-weekly.v1' then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'automation', 'system')
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200
    or jsonb_typeof(p_input -> 'decisions') <> 'array'
    or jsonb_array_length(p_input -> 'decisions') > 100
    or char_length(coalesce(p_input ->> 'reflectionMarkdown', '')) > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  v_starts_on := (p_input ->> 'startsOn')::date;
  v_ends_on := (p_input ->> 'endsOn')::date;
  if v_ends_on <> v_starts_on + 6 then
    raise exception using errcode = 'P0001', message = 'invalid_review_range';
  end if;

  select id, timezone into v_workspace_id, v_timezone
  from public.workspaces where owner_user_id = v_user_id;
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

  if exists (
    select 1
    from jsonb_to_recordset(p_input -> 'decisions') as decision(
      "actionId" text, "expectedVersion" bigint, resolution text, reason text, priority boolean
    )
    where decision."actionId" is null
      or decision."expectedVersion" is null or decision."expectedVersion" < 1
      or decision.resolution not in ('done', 'next_week', 'blocked', 'dropped', 'left_overdue')
      or char_length(coalesce(decision.reason, '')) > 500
      or (decision.resolution in ('blocked', 'dropped') and char_length(trim(coalesce(decision.reason, ''))) < 1)
      or (coalesce(decision.priority, false) and decision.resolution in ('done', 'dropped'))
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_review_decision';
  end if;
  select count(*) filter (where coalesce(priority, false))
  into v_priority_count
  from jsonb_to_recordset(p_input -> 'decisions') as decision(priority boolean);
  if v_priority_count > 5 then
    raise exception using errcode = 'P0001', message = 'too_many_weekly_priorities';
  end if;
  if (
    select count(distinct "actionId")
    from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" text)
  ) <> jsonb_array_length(p_input -> 'decisions') then
    raise exception using errcode = 'P0001', message = 'duplicate_review_action';
  end if;

  if exists (
    select 1 from public.actions action
    join public.planning_horizons horizon
      on horizon.id = action.horizon_id and horizon.workspace_id = action.workspace_id
    where action.workspace_id = v_workspace_id and horizon.kind = 'week'
      and horizon.starts_on <= v_ends_on
      and action.status not in ('done', 'dropped')
      and action.archived_at is null and action.trashed_at is null
      and not exists (
        select 1
        from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" uuid)
        where decision."actionId" = action.id
      )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" uuid)
    left join public.actions action
      on action.id = decision."actionId" and action.workspace_id = v_workspace_id
      and action.status not in ('done', 'dropped')
      and action.archived_at is null and action.trashed_at is null
    left join public.planning_horizons horizon
      on horizon.id = action.horizon_id and horizon.workspace_id = action.workspace_id
    where action.id is null or horizon.kind <> 'week' or horizon.starts_on > v_ends_on
  ) then
    raise exception using errcode = '40001', message = 'review_action_set_changed';
  end if;

  insert into public.planning_horizons (
    workspace_id, kind, starts_on, ends_on, timezone_snapshot
  ) values (
    v_workspace_id, 'week', v_starts_on, v_ends_on, v_timezone
  )
  on conflict (workspace_id, kind, starts_on)
  do update set timezone_snapshot = excluded.timezone_snapshot
  returning id into v_horizon_id;
  if exists (
    select 1 from jsonb_to_recordset(p_input -> 'decisions') as decision(resolution text)
    where resolution = 'next_week'
  ) then
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    ) values (
      v_workspace_id, 'week', v_starts_on + 7, v_ends_on + 7, v_timezone
    )
    on conflict (workspace_id, kind, starts_on)
    do update set timezone_snapshot = excluded.timezone_snapshot
    returning id into v_next_horizon_id;
  end if;

  insert into public.reviews (
    workspace_id, horizon_id, kind, status, reflection_markdown, completed_at
  ) values (
    v_workspace_id, v_horizon_id, 'weekly', 'completed',
    coalesce(p_input ->> 'reflectionMarkdown', ''), clock_timestamp()
  ) returning id into v_review_id;

  for v_decision in
    select action.*, decision."expectedVersion" as expected_version,
      decision.resolution, decision.reason, coalesce(decision.priority, false) as priority
    from jsonb_to_recordset(p_input -> 'decisions') as decision(
      "actionId" uuid, "expectedVersion" bigint, resolution text, reason text, priority boolean
    )
    join public.actions action
      on action.id = decision."actionId" and action.workspace_id = v_workspace_id
    order by action.id
    for update of action
  loop
    if v_decision.version <> v_decision.expected_version then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    insert into public.review_action_items (
      workspace_id, review_id, action_id, action_title_snapshot, action_status_snapshot,
      action_version_snapshot, resolution, reason, priority
    ) values (
      v_workspace_id, v_review_id, v_decision.id, v_decision.title, v_decision.status,
      v_decision.version, v_decision.resolution, nullif(trim(v_decision.reason), ''), v_decision.priority
    );
    insert into public.action_schedule_history (
      workspace_id, action_id, review_id, previous_horizon_id, new_horizon_id,
      previous_scheduled_on, new_scheduled_on, reason, actor_user_id
    ) values (
      v_workspace_id, v_decision.id, v_review_id, v_decision.horizon_id,
      case when v_decision.resolution = 'next_week' then v_next_horizon_id else v_decision.horizon_id end,
      v_decision.scheduled_on,
      case when v_decision.resolution = 'next_week' then v_starts_on + 7 else v_decision.scheduled_on end,
      case v_decision.resolution
        when 'done' then 'completed'
        when 'next_week' then 'rescheduled'
        else v_decision.resolution
      end,
      v_user_id
    );
    if v_decision.resolution = 'done' then
      update public.actions set status = 'done', completed_at = clock_timestamp(),
        blocker_text = null, drop_reason = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    elsif v_decision.resolution = 'next_week' then
      update public.actions set status = 'open', horizon_id = v_next_horizon_id,
        scheduled_on = v_starts_on + 7, completed_at = null, blocker_text = null,
        drop_reason = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    elsif v_decision.resolution = 'blocked' then
      update public.actions set status = 'blocked', blocker_text = trim(v_decision.reason),
        completed_at = null, drop_reason = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    elsif v_decision.resolution = 'dropped' then
      update public.actions set status = 'dropped', drop_reason = trim(v_decision.reason),
        completed_at = null, blocker_text = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    end if;
  end loop;

  v_resolved_count := jsonb_array_length(p_input -> 'decisions');
  v_result := jsonb_build_object(
    'reviewId', v_review_id,
    'status', 'completed',
    'resolvedCount', v_resolved_count,
    'priorityCount', v_priority_count
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'medium', 'review', v_review_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'review', v_review_id, 'medium',
    case when p_surface = 'chat' then 'approved' else 'explicit_ui_commit' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range
    or not_null_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.execute_review_operation(text, jsonb, text, text) from public, anon;
grant execute on function public.execute_review_operation(text, jsonb, text, text) to authenticated;

commit;
