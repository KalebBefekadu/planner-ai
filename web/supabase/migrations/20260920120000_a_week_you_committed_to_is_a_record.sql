-- The week you committed to is a record, not a query re-run later.
--
-- Closing a week could say what finished, because `reviews` and
-- `review_action_items` record that. It could not say what you had *planned*,
-- because nothing stored the selection: the weekly list was a query over
-- whatever happened to be scheduled at the moment you asked. So "planned tasks
-- completed" had a numerator and no denominator, and any answer computed from
-- the live rows would move every time a task was added, moved or renamed --
-- including long after the week was over.
--
-- `weekly_plans` is the selection, `weekly_plan_items` its membership, and
-- `weekly_plan_snapshots` the frozen result. Three states, in one direction:
--
--   Draft -> Committed -> Reviewed
--
-- Committing stamps the baseline onto the items that are in the plan and not
-- already finished. Work completed before you committed is excluded from the
-- denominator, because a week's plan is a claim about what is still ahead of
-- you. After that the plan stays editable -- work is added, moved, dropped --
-- and none of it touches the baseline. A baseline item that does not finish
-- records a disposition: kept, moved, paused or dropped. That is a decision
-- about the work, not an erasure of the commitment.
--
-- Closing writes the snapshot: the counted ids, their titles and area labels
-- as they read at that moment, the outcome of each, the denominator, and the
-- late additions. Everything a person can later ask of a closed week is
-- answered from that row, so reopening a task, renaming it, or finishing it
-- next Tuesday cannot rewrite what the week said. Where the snapshot has no
-- answer, the screen says "Unavailable" -- reconstructed certainty is worse
-- than an admission.

begin;

create table public.weekly_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  horizon_id uuid not null,
  state text not null default 'draft' check (state in ('draft', 'committed', 'reviewed')),
  intention text check (intention is null or char_length(intention) <= 2000),
  -- Optional, and unknown stays unknown: a capacity nobody stated is null, not
  -- a default the screen then reasons from.
  capacity_hours numeric check (capacity_hours is null or capacity_hours between 0 and 168),
  committed_at timestamptz,
  reviewed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- One plan per week. A second plan for the same seven days is not a second
  -- opinion, it is a bug with two denominators.
  unique (workspace_id, horizon_id),
  foreign key (horizon_id, workspace_id)
    references public.planning_horizons(id, workspace_id),
  check ((state = 'draft') = (committed_at is null)),
  check ((state = 'reviewed') = (reviewed_at is null) is false or state <> 'reviewed')
);

create index weekly_plans_workspace_idx on public.weekly_plans (workspace_id, state);

create trigger weekly_plans_set_updated_at before update on public.weekly_plans
for each row execute function public.set_updated_at();

create table public.weekly_plan_items (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null,
  action_id uuid not null,
  selected_at timestamptz not null default now(),
  sort_key numeric(24, 12) not null default 1000,
  /* Stamped at commit, never recomputed. This column is the denominator. */
  in_baseline boolean not null default false,
  disposition text check (
    disposition is null or disposition in ('kept', 'moved', 'paused', 'dropped')
  ),
  disposition_note text check (
    disposition_note is null or char_length(disposition_note) <= 2000
  ),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- One membership per Action per plan, so a retried selection is one row.
  unique (plan_id, action_id),
  foreign key (plan_id, workspace_id)
    references public.weekly_plans(id, workspace_id) on delete cascade,
  foreign key (action_id, workspace_id)
    references public.actions(id, workspace_id) on delete cascade
);

create index weekly_plan_items_plan_idx
  on public.weekly_plan_items (workspace_id, plan_id, sort_key, id);
create index weekly_plan_items_action_idx on public.weekly_plan_items (workspace_id, action_id);

create table public.weekly_plan_snapshots (
  plan_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  /* The shape of `snapshot_json`. A reader that does not know this number
     reports the record as unreadable rather than guessing at its fields. */
  schema_version integer not null default 1,
  closed_at timestamptz not null default now(),
  baseline_count integer not null check (baseline_count >= 0),
  completed_count integer not null check (completed_count >= 0),
  late_addition_count integer not null check (late_addition_count >= 0),
  snapshot_json jsonb not null,
  check (completed_count <= baseline_count),
  foreign key (plan_id, workspace_id)
    references public.weekly_plans(id, workspace_id) on delete cascade
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'weekly_plans', 'weekly_plan_items', 'weekly_plan_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (workspace_id in (select id from public.workspaces where owner_user_id = (select auth.uid())))',
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

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('week.plan.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('week.select.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('week.commit.v1', 'medium', array['ui'], true),
  ('week.disposition.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('week.close.v1', 'medium', array['ui'], false);

insert into public.operation_undo_support (operation_id, strategy) values
  ('week.plan.v1', 'snapshot'),
  ('week.select.v1', 'snapshot'),
  ('week.commit.v1', 'snapshot'),
  ('week.disposition.v1', 'snapshot');

create or replace function public.operation_handler_for(p_operation_id text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
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
    when p_operation_id like 'week.%' then 'weekly_plan'
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

create function public.execute_weekly_plan_operation(
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
  v_plan public.weekly_plans;
  v_item public.weekly_plan_items;
  v_horizon_id uuid;
  v_action_id uuid;
  v_starts_on date;
  v_ends_on date;
  v_expected_version bigint;
  v_receipt_id uuid;
  v_result jsonb;
  v_undo_payload jsonb;
  v_snapshot jsonb;
  v_baseline integer;
  v_completed integer;
  v_late integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'week.plan.v1', 'week.select.v1', 'week.commit.v1',
    'week.disposition.v1', 'week.close.v1'
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

  if p_operation_id = 'week.plan.v1' then
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    if v_ends_on < v_starts_on then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    -- The horizon carries the workspace's timezone and week start as they were
    -- when the week was first planned. A later preference change shapes new
    -- weeks and does not re-key this one.
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    )
    select v_workspace_id, 'week', v_starts_on, v_ends_on, timezone
    from public.workspaces where id = v_workspace_id
    on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
    returning id into v_horizon_id;

    select * into v_plan from public.weekly_plans
    where workspace_id = v_workspace_id and horizon_id = v_horizon_id for update;
    if found then
      v_undo_payload := jsonb_build_object(
        'intention', v_plan.intention, 'capacityHours', v_plan.capacity_hours, 'created', false
      );
      update public.weekly_plans set
        intention = nullif(btrim(coalesce(p_input ->> 'intention', '')), ''),
        capacity_hours = nullif(p_input ->> 'capacityHours', '')::numeric,
        version = version + 1
      where id = v_plan.id returning * into v_plan;
    else
      v_undo_payload := jsonb_build_object('created', true);
      insert into public.weekly_plans (workspace_id, horizon_id, intention, capacity_hours)
      values (
        v_workspace_id, v_horizon_id,
        nullif(btrim(coalesce(p_input ->> 'intention', '')), ''),
        nullif(p_input ->> 'capacityHours', '')::numeric
      ) returning * into v_plan;
    end if;

  elsif p_operation_id = 'week.select.v1' then
    v_action_id := (p_input ->> 'actionId')::uuid;
    select * into v_plan from public.weekly_plans
    where id = (p_input ->> 'planId')::uuid and workspace_id = v_workspace_id for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'weekly_plan_not_found';
    end if;
    if v_plan.state = 'reviewed' then
      raise exception using errcode = 'P0001', message = 'weekly_plan_closed';
    end if;
    if not exists (
      select 1 from public.actions
      where id = v_action_id and workspace_id = v_workspace_id and trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'action_not_found';
    end if;

    if (p_input ->> 'selected')::boolean then
      select * into v_item from public.weekly_plan_items
      where plan_id = v_plan.id and action_id = v_action_id;
      if found then
        v_undo_payload := jsonb_build_object('wasSelected', true);
      else
        v_undo_payload := jsonb_build_object('wasSelected', false);
        insert into public.weekly_plan_items (
          workspace_id, plan_id, action_id, sort_key, in_baseline
        ) values (
          v_workspace_id, v_plan.id, v_action_id,
          coalesce(
            (select max(sort_key) + 1000 from public.weekly_plan_items where plan_id = v_plan.id),
            1000
          ),
          -- Added after the commitment, so it is a late addition and not part
          -- of what was promised. The baseline is stamped once and never grows.
          false
        );
      end if;
    else
      select * into v_item from public.weekly_plan_items
      where plan_id = v_plan.id and action_id = v_action_id;
      if not found then
        v_undo_payload := jsonb_build_object('wasSelected', false);
      else
        v_undo_payload := jsonb_build_object(
          'wasSelected', true, 'inBaseline', v_item.in_baseline, 'sortKey', v_item.sort_key
        );
        -- Removing work from the week does not remove it from the baseline it
        -- was part of. That is what the disposition is for.
        if v_item.in_baseline then
          raise exception using errcode = 'P0001', message = 'baseline_item_needs_disposition';
        end if;
        delete from public.weekly_plan_items where id = v_item.id;
      end if;
    end if;
    update public.weekly_plans set version = version + 1
    where id = v_plan.id returning * into v_plan;

  elsif p_operation_id = 'week.commit.v1' then
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select * into v_plan from public.weekly_plans
    where id = (p_input ->> 'planId')::uuid and workspace_id = v_workspace_id
      and version = v_expected_version for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if v_plan.state <> 'draft' then
      raise exception using errcode = 'P0001', message = 'weekly_plan_already_committed';
    end if;
    v_undo_payload := jsonb_build_object('state', v_plan.state);
    -- Work already finished before the plan was committed is not part of what
    -- the week promised, so it is outside the denominator rather than a free
    -- point in it.
    update public.weekly_plan_items item set in_baseline = true
    from public.actions action
    where item.plan_id = v_plan.id
      and action.id = item.action_id
      and action.workspace_id = v_workspace_id
      and action.status not in ('done', 'dropped');
    update public.weekly_plans set
      state = 'committed', committed_at = clock_timestamp(), version = version + 1
    where id = v_plan.id returning * into v_plan;

  elsif p_operation_id = 'week.disposition.v1' then
    select * into v_plan from public.weekly_plans
    where id = (p_input ->> 'planId')::uuid and workspace_id = v_workspace_id for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'weekly_plan_not_found';
    end if;
    if v_plan.state = 'reviewed' then
      raise exception using errcode = 'P0001', message = 'weekly_plan_closed';
    end if;
    select * into v_item from public.weekly_plan_items
    where plan_id = v_plan.id and action_id = (p_input ->> 'actionId')::uuid for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'weekly_plan_item_not_found';
    end if;
    if (p_input ->> 'disposition') not in ('kept', 'moved', 'paused', 'dropped') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    v_undo_payload := jsonb_build_object(
      'disposition', v_item.disposition, 'note', v_item.disposition_note
    );
    update public.weekly_plan_items set
      disposition = p_input ->> 'disposition',
      disposition_note = nullif(btrim(coalesce(p_input ->> 'note', '')), '')
    where id = v_item.id;
    update public.weekly_plans set version = version + 1
    where id = v_plan.id returning * into v_plan;

  elsif p_operation_id = 'week.close.v1' then
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select * into v_plan from public.weekly_plans
    where id = (p_input ->> 'planId')::uuid and workspace_id = v_workspace_id
      and version = v_expected_version for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if v_plan.state = 'draft' then
      raise exception using errcode = 'P0001', message = 'weekly_plan_not_committed';
    end if;
    if v_plan.state = 'reviewed' then
      -- Already closed, and the snapshot is the answer. Returning it makes a
      -- duplicate submission a no-op rather than a second, different record.
      select jsonb_build_object(
        'planId', plan_id, 'baselineCount', baseline_count,
        'completedCount', completed_count, 'lateAdditionCount', late_addition_count,
        'closedAt', closed_at, 'snapshot', snapshot_json
      ) into v_result
      from public.weekly_plan_snapshots where plan_id = v_plan.id;
      return v_result;
    end if;

    /* Counted by period end, not by now. A review written on Tuesday must not
       count Tuesday's work as last week's performance, and the horizon's own
       end date is what decides. */
    select
      jsonb_agg(
        jsonb_build_object(
          'actionId', action.id,
          'title', action.title,
          'areaId', action.primary_area_id,
          'areaName', area.name,
          'inBaseline', item.in_baseline,
          'status', action.status,
          'completedByPeriodEnd', (
            action.status = 'done'
            and action.completed_at is not null
            and action.completed_at < (horizon.ends_on + 1)::timestamptz
          ),
          'disposition', item.disposition,
          'dispositionNote', item.disposition_note
        )
        order by item.sort_key, item.id
      ),
      count(*) filter (where item.in_baseline),
      count(*) filter (
        where item.in_baseline
          and action.status = 'done'
          and action.completed_at is not null
          and action.completed_at < (horizon.ends_on + 1)::timestamptz
      ),
      count(*) filter (where not item.in_baseline)
    into v_snapshot, v_baseline, v_completed, v_late
    from public.weekly_plan_items item
    join public.actions action
      on action.id = item.action_id and action.workspace_id = item.workspace_id
    join public.weekly_plans plan
      on plan.id = item.plan_id and plan.workspace_id = item.workspace_id
    join public.planning_horizons horizon
      on horizon.id = plan.horizon_id and horizon.workspace_id = plan.workspace_id
    left join public.life_areas area
      on area.id = action.primary_area_id and area.workspace_id = action.workspace_id
    where item.plan_id = v_plan.id;

    insert into public.weekly_plan_snapshots (
      plan_id, workspace_id, baseline_count, completed_count, late_addition_count, snapshot_json
    ) values (
      v_plan.id, v_workspace_id,
      coalesce(v_baseline, 0), coalesce(v_completed, 0), coalesce(v_late, 0),
      jsonb_build_object(
        'intention', v_plan.intention,
        'capacityHours', v_plan.capacity_hours,
        'items', coalesce(v_snapshot, '[]'::jsonb)
      )
    );
    update public.weekly_plans set
      state = 'reviewed', reviewed_at = clock_timestamp(), version = version + 1
    where id = v_plan.id returning * into v_plan;
    v_undo_payload := null;
  end if;

  v_result := to_jsonb(v_plan);
  if p_operation_id = 'week.close.v1' then
    v_result := v_result || jsonb_build_object(
      'baseline_count', coalesce(v_baseline, 0),
      'completed_count', coalesce(v_completed, 0),
      'late_addition_count', coalesce(v_late, 0)
    );
  end if;

  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json,
    undo_payload_json
  ) values (
    v_receipt_id, v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key,
    case when p_operation_id in ('week.commit.v1', 'week.close.v1') then 'medium' else 'low' end,
    'weekly_plan', v_plan.id, 'succeeded', v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'weekly_plan', v_plan.id,
    case when p_operation_id in ('week.commit.v1', 'week.close.v1') then 'medium' else 'low' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  when unique_violation then
    raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
end;
$$;

revoke all on function public.execute_weekly_plan_operation(text, jsonb, text, text)
from public, anon, authenticated;

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
  elsif v_domain = 'weekly_plan' then
    return public.execute_weekly_plan_operation(
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
