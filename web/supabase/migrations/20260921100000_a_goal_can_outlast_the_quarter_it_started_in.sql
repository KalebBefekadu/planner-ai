-- A Goal can outlast the quarter it started in.
--
-- Every Goal carried a `horizon_id`, and `horizon_id` was not null. A horizon
-- is one dated period, so an outcome that runs from October into March could
-- not be recorded as one thing: it was a Q4 Goal and a Q1 Goal, two rows, two
-- histories, and a person reconciling them by hand. The same column forced a
-- standing initiative -- a concern with no end -- to be anchored to a year it
-- has nothing to do with, which the migration that introduced `kind` said out
-- loud and could not fix without this one.
--
-- A Goal now says when it starts and when it is meant to be done, and a period
-- view asks which Goals overlap it. `starts_on` is new; `due_on` already meant
-- the target date. `horizon_id` stays, nullable, on every row that had one,
-- because those links are how an old review is still readable. Nothing is
-- rewritten to the new shape: `goal.create.v1` keeps writing horizons and
-- keeps meaning exactly what it meant.
--
-- `vision_id` becomes nullable with it. Requiring a Vision before a Goal made
-- the emptiest possible workspace -- someone's first five minutes -- the one
-- place the product refused to take work, and the pressure that creates is to
-- write a fake Vision, which is worse than none. `goal.create.v1` still
-- requires one, because that is its contract and an old client relies on the
-- failure; `goal.create.v2` does not.

begin;

alter table public.goals alter column horizon_id drop not null;
alter table public.goals alter column vision_id drop not null;
alter table public.goals add column starts_on date;

-- A span that ends before it begins is not a span.
alter table public.goals
  drop constraint if exists goals_span_ordered;
alter table public.goals
  add constraint goals_span_ordered check (
    starts_on is null or due_on is null or due_on >= starts_on
  );

-- An initiative is never finished, so it has no span either. The deadline half
-- of that rule already exists; this is the other half.
alter table public.goals
  drop constraint if exists goals_initiative_has_no_start;
alter table public.goals
  add constraint goals_initiative_has_no_start check (
    kind <> 'initiative' or starts_on is null
  );

-- Existing outcomes keep the dates they already had: the horizon they were
-- filed under said when they ran, and now the Goal says it itself. Initiatives
-- are left alone -- their year anchor was bookkeeping, and copying it onto the
-- Goal would turn a standing concern into work that looks scheduled.
update public.goals g
set starts_on = h.starts_on
from public.planning_horizons h
where h.id = g.horizon_id
  and h.workspace_id = g.workspace_id
  and g.starts_on is null
  and g.kind = 'outcome';

create index goals_workspace_span_idx
  on public.goals (workspace_id, starts_on, due_on);

-- Which Goals belong to a period.
--
-- Two ways in, deliberately: the horizon a Goal was filed under overlaps the
-- period, or the Goal's own dates do. The first keeps every Goal written
-- before this migration exactly where it was; the second is how a Goal that
-- runs October to March appears in Q4 and in Q1 without being copied.
--
-- Undated work is not here. A Goal with no dates and no horizon is not "in
-- every period" -- it is unscheduled, and the screen says so in its own group.
-- Filing a Goal under a part of life does not schedule it either.
create or replace function public.goals_in_period(
  p_workspace_id uuid,
  p_starts_on date,
  p_ends_on date
)
returns setof public.goals
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select goal.*
  from public.goals goal
  left join public.planning_horizons horizon
    on horizon.id = goal.horizon_id and horizon.workspace_id = goal.workspace_id
  where goal.workspace_id = p_workspace_id
    and goal.archived_at is null
    and goal.trashed_at is null
    and (
      (horizon.starts_on <= p_ends_on and horizon.ends_on >= p_starts_on)
      or (
        coalesce(goal.starts_on, goal.due_on) <= p_ends_on
        and coalesce(goal.due_on, goal.starts_on) >= p_starts_on
      )
    );
$$;

grant execute on function public.goals_in_period(uuid, date, date) to authenticated;

-- UI only, for now, and the reason is a measurement rather than a policy: the
-- assistant's system prompt carries a schema for every chat-exposed Operation
-- and is held under a byte budget, which these two schemas pushed past. The
-- assistant has no goal-planning intent to spend them on yet. When it gets one
-- the budget is the thing to solve, not the test.
insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('goal.create.v2', 'low', array['ui'], true),
  ('goal.schedule.v1', 'low', array['ui'], true);

insert into public.operation_undo_support (operation_id, strategy) values
  ('goal.create.v2', 'trash-create'),
  ('goal.schedule.v1', 'snapshot');

create function public.execute_goal_scope_operation(
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
  v_goal public.goals;
  v_area_id uuid;
  v_parent_id uuid;
  v_vision_id uuid;
  v_goal_kind text;
  v_starts_on date;
  v_due_on date;
  v_expected_version bigint;
  v_result jsonb;
  v_undo_payload jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('goal.create.v2', 'goal.schedule.v1') then
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

  v_starts_on := nullif(p_input ->> 'startsOn', '')::date;
  v_due_on := nullif(p_input ->> 'targetOn', '')::date;
  if v_starts_on is not null and v_due_on is not null and v_due_on < v_starts_on then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if p_operation_id = 'goal.create.v2' then
    v_goal_kind := coalesce(p_input ->> 'kind', 'outcome');
    v_area_id := nullif(p_input ->> 'areaId', '')::uuid;
    v_parent_id := nullif(p_input ->> 'parentGoalId', '')::uuid;
    if v_goal_kind not in ('outcome', 'initiative')
      or char_length(btrim(coalesce(p_input ->> 'title', ''))) not between 3 and 1000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if v_goal_kind = 'initiative' and (v_starts_on is not null or v_due_on is not null) then
      raise exception using errcode = 'P0001', message = 'initiative_is_not_a_period';
    end if;
    if v_area_id is not null and not exists (
      select 1 from public.life_areas
      where id = v_area_id and workspace_id = v_workspace_id
    ) then
      raise exception using errcode = 'P0001', message = 'area_not_found';
    end if;
    -- One level of nesting, the same shape the product has always had: a Goal
    -- may sit under a Goal that nothing else sits above.
    if v_parent_id is not null and not exists (
      select 1 from public.goals parent
      left join public.planning_horizons horizon
        on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
      where parent.id = v_parent_id and parent.workspace_id = v_workspace_id
        and parent.archived_at is null and parent.trashed_at is null
        and (horizon.kind = 'year'
             or (parent.horizon_id is null and parent.parent_goal_id is null))
    ) then
      raise exception using errcode = 'P0001', message = 'goal_parent_not_found';
    end if;

    -- A Vision is linked when there is one to link and left null when there is
    -- not. Never invented: a placeholder Vision would read as the owner's own
    -- words on the screen that shows it.
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

    insert into public.goals (
      workspace_id, vision_id, horizon_id, parent_goal_id, primary_area_id,
      title, status, kind, starts_on, due_on
    ) values (
      v_workspace_id, v_vision_id, null, v_parent_id,
      coalesce(v_area_id, (
        select primary_area_id from public.goals
        where id = v_parent_id and workspace_id = v_workspace_id
      )),
      btrim(p_input ->> 'title'), 'active', v_goal_kind, v_starts_on, v_due_on
    ) returning * into v_goal;
    v_undo_payload := null;

  else
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select * into v_goal from public.goals
    where id = nullif(p_input ->> 'id', '')::uuid
      and workspace_id = v_workspace_id
      and version = v_expected_version
      and archived_at is null and trashed_at is null
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if v_goal.kind = 'initiative' and (v_starts_on is not null or v_due_on is not null) then
      raise exception using errcode = 'P0001', message = 'initiative_is_not_a_period';
    end if;
    v_undo_payload := jsonb_build_object(
      'startsOn', v_goal.starts_on, 'targetOn', v_goal.due_on
    );
    update public.goals set
      starts_on = v_starts_on,
      due_on = v_due_on,
      version = version + 1,
      updated_at = clock_timestamp()
    where id = v_goal.id returning * into v_goal;
  end if;

  v_result := to_jsonb(v_goal);
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json,
    undo_payload_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low', 'goal', v_goal.id, 'succeeded',
    v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'goal', v_goal.id, 'low', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or check_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.execute_goal_scope_operation(text, jsonb, text, text)
from public, anon, authenticated;


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
    when p_operation_id in ('goal.create.v2', 'goal.schedule.v1') then 'goal_scope'
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
  elsif v_domain = 'goal_scope' then
    return public.execute_goal_scope_operation(
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

-- The two readers that identified a top-level Goal by its horizon. Both bodies
-- are otherwise exactly what the database already held.

CREATE OR REPLACE FUNCTION public.execute_planner_operation(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text DEFAULT 'ui'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    -- "A yearly Goal" was how a top-level Goal was identified while every Goal
    -- had a horizon. A Goal created by goal.create.v2 has dates instead, so the
    -- test is now what it always meant: a Goal nothing else sits above.
    if v_parent_id is not null and not exists (
      select 1 from public.goals g
      left join public.planning_horizons h
        on h.id = g.horizon_id and h.workspace_id = g.workspace_id
      where g.id = v_parent_id and g.workspace_id = v_workspace_id
        and g.archived_at is null and g.trashed_at is null
        and (h.kind = 'year' or (g.horizon_id is null and g.parent_goal_id is null))
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
$function$;
CREATE OR REPLACE FUNCTION public.execute_plan_edit_operation(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_target_id uuid;
  v_expected_version bigint;
  v_parent_id uuid;
  v_goal_id uuid;
  v_kind text;
  v_starts_on date;
  v_ends_on date;
  v_scheduled_on date;
  v_horizon_id uuid;
  v_previous_horizon_id uuid;
  v_previous_scheduled_on date;
  v_target_value numeric;
  v_current_value numeric;
  v_goal_kind text;
  v_result jsonb;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('goal.update.v1', 'action.move.v1')
    or p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
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
  if p_operation_id = 'goal.update.v1' then
    if not (p_input ?& array[
      'id', 'expectedVersion', 'title', 'descriptionMarkdown', 'parentGoalId',
      'targetValue', 'currentValue', 'unit', 'dueOn'
    ]) or char_length(trim(p_input ->> 'title')) not between 3 and 1000
      or char_length(coalesce(p_input ->> 'descriptionMarkdown', '')) > 50000
      or char_length(coalesce(p_input ->> 'unit', '')) > 80 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    v_parent_id := nullif(p_input ->> 'parentGoalId', '')::uuid;
    v_target_value := nullif(p_input ->> 'targetValue', '')::numeric;
    v_current_value := nullif(p_input ->> 'currentValue', '')::numeric;
    -- Left, not inner: a Goal with dates and no horizon is still a Goal, and
    -- an inner join here reported it as a version conflict -- the one failure
    -- message that tells a person their own edit was stale when it was not.
    select horizon.kind, goal.kind into v_kind, v_goal_kind
    from public.goals goal
    left join public.planning_horizons horizon
      on horizon.id = goal.horizon_id and horizon.workspace_id = goal.workspace_id
    where goal.id = v_target_id and goal.workspace_id = v_workspace_id
      and goal.version = v_expected_version
      and goal.archived_at is null and goal.trashed_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    -- An initiative is year-anchored, but the anchor is bookkeeping rather than
    -- a level: it may sit under a yearly Goal when the project exists to serve
    -- one. goal.create.v1 has allowed that since 20260915100000, and this path
    -- refusing it meant a parent could be set at creation and never edited.
    -- A dated Goal has no horizon kind, so the rule that forced a quarter to
    -- have a parent and a year not to have one cannot be asked of it. What
    -- survives for every Goal is the shape: a parent must be a Goal nothing
    -- else sits above, and never the Goal itself.
    if (v_kind = 'year' and v_goal_kind = 'outcome' and v_parent_id is not null)
      or (v_kind = 'quarter' and v_parent_id is null)
      or (v_parent_id is not null and (
        v_parent_id = v_target_id or not exists (
          select 1 from public.goals parent
          left join public.planning_horizons horizon
            on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
          where parent.id = v_parent_id and parent.workspace_id = v_workspace_id
            and parent.archived_at is null and parent.trashed_at is null
            and (horizon.kind = 'year'
                 or (parent.horizon_id is null and parent.parent_goal_id is null))
        )
      )) or ((v_target_value is null) <> (v_current_value is null))
      or ((v_target_value is null) <> ((p_input ->> 'unit') is null))
      or (v_target_value is not null and char_length(trim(coalesce(p_input ->> 'unit', ''))) not between 1 and 80)
      or v_target_value <= 0 or v_current_value < 0 then
      raise exception using errcode = 'P0001', message = 'invalid_goal_update';
    end if;
    -- Named, rather than letting goals_initiative_has_no_deadline surface as a
    -- generic constraint error. "Never finished" is the whole point of the
    -- kind, so an edit that contradicts it deserves to say which rule it hit.
    if v_goal_kind = 'initiative' and nullif(p_input ->> 'dueOn', '') is not null then
      raise exception using errcode = 'P0001', message = 'initiative_has_no_deadline';
    end if;
    if char_length(coalesce(p_input ->> 'definitionOfDone', '')) > 2000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    update public.goals set
      title = trim(p_input ->> 'title'),
      description_markdown = nullif(p_input ->> 'descriptionMarkdown', ''),
      parent_goal_id = v_parent_id,
      target_value = v_target_value,
      current_value = v_current_value,
      unit = nullif(trim(p_input ->> 'unit'), ''),
      due_on = nullif(p_input ->> 'dueOn', '')::date,
      -- Absent means "not my business", not "clear it". Every existing caller
      -- omits this key, and none of them intends to erase what good looks like.
      definition_of_done = case
        when p_input ? 'definitionOfDone'
          then nullif(trim(coalesce(p_input ->> 'definitionOfDone', '')), '')
        else definition_of_done
      end,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    returning * into v_row;
  else
    if not (p_input ?& array[
      'id', 'expectedVersion', 'goalId', 'parentActionId', 'horizonKind',
      'startsOn', 'endsOn', 'scheduledOn'
    ]) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    v_goal_id := nullif(p_input ->> 'goalId', '')::uuid;
    v_parent_id := nullif(p_input ->> 'parentActionId', '')::uuid;
    v_kind := p_input ->> 'horizonKind';
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    v_scheduled_on := (p_input ->> 'scheduledOn')::date;
    if v_kind not in ('month', 'week') or v_ends_on < v_starts_on
      or v_scheduled_on not between v_starts_on and v_ends_on
      or (v_goal_id is not null and not exists (
        select 1 from public.goals goal
        join public.planning_horizons horizon
          on horizon.id = goal.horizon_id and horizon.workspace_id = goal.workspace_id
        where goal.id = v_goal_id and goal.workspace_id = v_workspace_id
          and horizon.kind = 'quarter' and goal.archived_at is null and goal.trashed_at is null
      )) or (v_kind = 'month' and v_parent_id is not null)
      or (v_kind = 'week' and v_parent_id is not null and (
        not exists (
          select 1 from public.actions parent
          join public.planning_horizons horizon
            on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
          where parent.id = v_parent_id and parent.workspace_id = v_workspace_id
            and parent.goal_id is not distinct from v_goal_id
            and horizon.kind in ('month', 'week')
            and parent.archived_at is null and parent.trashed_at is null
        )
      )) then
      raise exception using errcode = 'P0001', message = 'invalid_action_move';
    end if;
    -- Notes have guarded against this since 20260816000400; Actions never did,
    -- because until now nothing could reparent one Action under another. An
    -- Action made its own ancestor would make every recursive cascade over
    -- parent_action_id -- archive, trash, undo -- fail to terminate.
    if v_parent_id is not null
      and public.action_has_descendant(v_workspace_id, v_target_id, v_parent_id) then
      raise exception using errcode = 'P0001', message = 'action_cannot_contain_itself';
    end if;
    -- The whole subtree moves, so the bound is on where its deepest leaf lands
    -- rather than on the Action being dragged.
    if v_parent_id is not null
      and public.action_ancestor_depth(v_workspace_id, v_parent_id) + 1
          + public.action_subtree_height(v_workspace_id, v_target_id)
          > public.action_max_depth() - 1 then
      raise exception using errcode = 'P0001', message = 'action_nested_too_deep';
    end if;
    select horizon_id, scheduled_on into v_previous_horizon_id, v_previous_scheduled_on
    from public.actions
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
      and archived_at is null and trashed_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    ) select v_workspace_id, v_kind, v_starts_on, v_ends_on, timezone
      from public.workspaces where id = v_workspace_id
    on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
    returning id into v_horizon_id;
    update public.actions set
      goal_id = v_goal_id,
      parent_action_id = v_parent_id,
      horizon_id = v_horizon_id,
      scheduled_on = v_scheduled_on,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    returning * into v_row;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    -- The subtree keeps the Goal its root now has. Both this operation and
    -- action.create.v1 require a child's Goal to match its parent's, so moving
    -- one Action to another Goal and leaving its children on the old one
    -- produces a tree the schema's own rules say cannot exist: the Review would
    -- group parent and child under different initiatives, and archiving the old
    -- Goal would take the children while leaving the parent active.
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
    update public.actions set goal_id = v_goal_id, version = version + 1
    where workspace_id = v_workspace_id and trashed_at is null
      and id in (select id from descendants) and id <> v_target_id
      and goal_id is distinct from v_goal_id;

    insert into public.action_schedule_history (
      workspace_id, action_id, previous_horizon_id, new_horizon_id,
      previous_scheduled_on, new_scheduled_on, reason, actor_user_id
    ) values (
      v_workspace_id, v_target_id, v_previous_horizon_id, v_horizon_id,
      v_previous_scheduled_on, v_scheduled_on, 'rescheduled', v_user_id
    );
  end if;
  if not found then
    raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
  end if;
  v_result := to_jsonb(v_row);
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low',
    case when p_operation_id = 'goal.update.v1' then 'goal' else 'action' end,
    v_target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_operation_id,
    case when p_operation_id = 'goal.update.v1' then 'goal' else 'action' end,
    v_target_id, 'low', case when p_surface = 'ui' then 'explicit_ui_commit' else 'approved' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$function$;

commit;
