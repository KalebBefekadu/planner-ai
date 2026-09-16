-- Keeping open work is free.
--
-- The Weekly Review has always required an explicit decision on every
-- unfinished Action, and the reasoning was sound while the week was the only
-- container: an Action that rolled over unremarked left no trace anywhere, so
-- the forced decision was the only thing between the owner and an invisible
-- backlog.
--
-- The Review now shows how long each open Action has sat -- counted as
-- completed Weekly Reviews outlived, in the loader. Rolling over is therefore
-- no longer silent, and the per-item tax can go. What stays is the part that
-- earns it: anything that has outlived three checkpoints must still be
-- answered, and the week will not close while one is undecided.
--
-- Two further reasons this had to ship together with that relaxation rather
-- than after it:
--
--   * review_week_eligible_actions includes week-horizon work from every past
--     week, forever, and the operation rejects more than 100 decisions. Making
--     keeping free removes the weekly pressure that kept that set small, and
--     an owner at 101 carried Actions could no longer close a week at all.
--     Bounding what MUST be decided bounds the payload with it.
--   * review_action_items, which carries the priority flag, is written once
--     per submitted decision. An item that needs no decision could otherwise
--     never be named as one of next week's five. 'keep' is the channel: it
--     means "I looked at this and it stays", changes nothing about the Action,
--     and may carry a priority.
--
-- This is deliberately not review.complete-weekly.v2. Both changes are
-- widenings -- a relaxed requirement and an extended enum -- so every payload
-- that was valid before is still valid and still produces the same result. A
-- new operation id would have bought no compatibility and would have required
-- three edits inside the weekly-review undo machinery, which is the last place
-- in this schema worth touching without a reason.

begin;

-- One definition of the threshold, in the database as well as in
-- src/lib/reviews/checkpoints.ts. Three is the first number at which "still
-- doing it" stops being credible without saying why.
create or replace function public.review_stalled_after_checkpoints()
returns integer
language sql
immutable
parallel safe
as $$ select 3 $$;

-- A checkpoint is one completed Weekly Review. How many an Action has outlived
-- is deliberately not read from action_schedule_history: those rows are written
-- per submitted decision, so the moment this function starts excusing items
-- from a decision they would stop accruing and the count would go quietly to
-- zero. Counting reviews makes it a property of the week instead, correct for
-- Actions that already exist and unchanged by what anyone clicked.
create or replace function public.review_week_required_actions(
  p_workspace_id uuid,
  p_starts_on date,
  p_ends_on date
) returns table (action_id uuid)
language sql
stable
set search_path = pg_catalog, public
as $$
  select eligible.action_id
  from public.review_week_eligible_actions(p_workspace_id, p_starts_on, p_ends_on) eligible
  join public.actions action
    on action.id = eligible.action_id and action.workspace_id = p_workspace_id
  where (
    select count(*)
    from public.reviews review
    where review.workspace_id = p_workspace_id
      and review.kind = 'weekly'
      and review.status = 'completed'
      and review.completed_at > action.created_at
  ) >= public.review_stalled_after_checkpoints();
$$;

-- Reachable only from execute_review_operation, which is security definer.
-- review_week_eligible_actions is locked down the same way and this composes
-- with it, so granting this one to authenticated would produce a function that
-- fails on its first statement rather than a useful capability.
revoke all on function public.review_stalled_after_checkpoints() from public, anon, authenticated;
revoke all on function public.review_week_required_actions(uuid, date, date)
  from public, anon, authenticated;

-- 'keep' is a recorded decision that changes nothing, which is exactly what
-- "this stays open and I know it" should cost.
alter table public.review_action_items
  drop constraint if exists review_action_items_resolution_check;
alter table public.review_action_items
  add constraint review_action_items_resolution_check check (
    resolution in ('done', 'next_week', 'keep', 'blocked', 'dropped', 'left_overdue')
  );

-- 'undo' belongs to the reversal path (20260817002200) and has nothing to do
-- with this change. It is listed because rebuilding a check constraint replaces
-- it outright: dropping a value a later migration added is a silent data-loss
-- bug that only surfaces the next time that path runs.
alter table public.action_schedule_history
  drop constraint if exists action_schedule_history_reason_check;
alter table public.action_schedule_history
  add constraint action_schedule_history_reason_check check (
    reason in ('completed', 'rescheduled', 'kept', 'blocked', 'dropped', 'left_overdue', 'undo')
  );

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
      or decision.resolution not in ('done', 'next_week', 'keep', 'blocked', 'dropped', 'left_overdue')
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

  -- The two halves of the decision set are no longer the same set, and that
  -- asymmetry is the point.
  --
  -- What may be decided is still exactly what the week is allowed to ask
  -- about: week-horizon work carried into or planned for these seven days,
  -- plus longer-horizon work committed to a day inside them.
  --
  -- What MUST be decided is now only the part that has stopped being
  -- credible -- work that has outlived review_stalled_after_checkpoints()
  -- completed Weekly Reviews. Everything else may be left out and simply
  -- stays open.
  --
  -- This is a relaxation, so every payload that satisfied the old rule still
  -- satisfies this one, and the operation keeps its version. It is also not a
  -- return to silent rollover: the screen shows how long each item has sat,
  -- and that age is what the deterrent now rests on rather than a decision
  -- extracted for every row every week.
  if exists (
    select 1 from public.review_week_required_actions(v_workspace_id, v_starts_on, v_ends_on) required
    where not exists (
      select 1
      from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" uuid)
      where decision."actionId" = required.action_id
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" uuid)
    where not exists (
      select 1
      from public.review_week_eligible_actions(v_workspace_id, v_starts_on, v_ends_on) eligible
      where eligible.action_id = decision."actionId"
    )
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
  -- Only week-horizon work moves into next week's horizon, so the horizon is
  -- created only when something will actually live in it.
  if exists (
    select 1
    from jsonb_to_recordset(p_input -> 'decisions') as decision("actionId" uuid, resolution text)
    join public.review_week_eligible_actions(v_workspace_id, v_starts_on, v_ends_on) eligible
      on eligible.action_id = decision."actionId"
    where decision.resolution = 'next_week' and eligible.horizon_kind = 'week'
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

  perform public.raise_if_period_already_reviewed(v_workspace_id, v_horizon_id, 'weekly');

  insert into public.reviews (
    workspace_id, horizon_id, kind, status, reflection_markdown, completed_at
  ) values (
    v_workspace_id, v_horizon_id, 'weekly', 'completed',
    coalesce(p_input ->> 'reflectionMarkdown', ''), clock_timestamp()
  ) returning id into v_review_id;

  for v_decision in
    select action.*, eligible.horizon_kind, decision."expectedVersion" as expected_version,
      decision.resolution, decision.reason, coalesce(decision.priority, false) as priority
    from jsonb_to_recordset(p_input -> 'decisions') as decision(
      "actionId" uuid, "expectedVersion" bigint, resolution text, reason text, priority boolean
    )
    join public.actions action
      on action.id = decision."actionId" and action.workspace_id = v_workspace_id
    join public.review_week_eligible_actions(v_workspace_id, v_starts_on, v_ends_on) eligible
      on eligible.action_id = action.id
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
      case when v_decision.resolution = 'next_week' and v_decision.horizon_kind = 'week'
        then v_next_horizon_id else v_decision.horizon_id end,
      v_decision.scheduled_on,
      case when v_decision.resolution = 'next_week' then v_starts_on + 7 else v_decision.scheduled_on end,
      case v_decision.resolution
        when 'done' then 'completed'
        when 'next_week' then 'rescheduled'
        when 'keep' then 'kept'
        else v_decision.resolution
      end,
      v_user_id
    );
    if v_decision.resolution = 'done' then
      update public.actions set status = 'done', completed_at = clock_timestamp(),
        blocker_text = null, drop_reason = null, version = version + 1
      where id = v_decision.id and workspace_id = v_workspace_id;
    elsif v_decision.resolution = 'next_week' then
      -- Moving a weekly Action to next week means next week's horizon. Moving
      -- a monthly one means next week's date: it is still monthly work, and
      -- rewriting its horizon would silently reclassify the plan rather than
      -- reschedule the work.
      update public.actions set status = 'open',
        horizon_id = case when v_decision.horizon_kind = 'week'
          then v_next_horizon_id else v_decision.horizon_id end,
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
