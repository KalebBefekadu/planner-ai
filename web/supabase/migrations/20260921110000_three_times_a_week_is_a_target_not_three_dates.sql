-- "Three times a week" is a target, not three dates.
--
-- A recurring Action has a cadence and an anchor: weekly on a Tuesday, monthly
-- on the 12th. That is right for the things that really do happen on a day --
-- the standing call, the rent. It is wrong for most of what people actually
-- repeat. Running three times a week is not three appointments; putting it in
-- as Tuesday, Thursday and Saturday invents a commitment nobody made, and then
-- reports a failure on Thursday for a week that will finish with three runs in
-- it.
--
-- A template can now carry a target instead: `occurrences_per_period`, counted
-- against the period its cadence already names. Nothing is pre-dated. A
-- session is recorded on the day it happens, takes the next free slot in that
-- period, and the slot is what makes the count honest -- a retried request
-- cannot log a fourth run against a target of three, because the slot is
-- already taken and the unique index says so.
--
-- Templates without a target keep every behaviour they had. This adds a second
-- kind of routine; it does not convert the first.

begin;

alter table public.action_templates add column occurrences_per_period integer;
alter table public.action_templates
  drop constraint if exists action_templates_frequency_range;
alter table public.action_templates
  add constraint action_templates_frequency_range check (
    occurrences_per_period is null or occurrences_per_period between 1 and 28
  );

alter table public.actions add column occurrence_period_start date;
alter table public.actions add column occurrence_slot smallint;

-- A slot without its period cannot be counted, and a period without its slot
-- cannot be made unique. They arrive together or not at all.
alter table public.actions
  drop constraint if exists actions_occurrence_slot_paired;
alter table public.actions
  add constraint actions_occurrence_slot_paired check (
    (occurrence_slot is null) = (occurrence_period_start is null)
  );
alter table public.actions
  drop constraint if exists actions_occurrence_slot_range;
alter table public.actions
  add constraint actions_occurrence_slot_range check (
    occurrence_slot is null or occurrence_slot between 1 and 28
  );

-- The guarantee, in the one place that can hold it. Two requests racing to log
-- the third run of the week both compute slot 3; one of them loses here rather
-- than both succeeding and the week reporting four.
create unique index actions_occurrence_slot_idx
  on public.actions (workspace_id, recurrence_template_id, occurrence_period_start, occurrence_slot)
  where occurrence_slot is not null;

create index actions_routine_period_idx
  on public.actions (workspace_id, recurrence_template_id, occurrence_period_start)
  where recurrence_template_id is not null;

-- The first day of the period a date falls in, for one workspace's own week.
-- A preference change shapes the periods counted after it and does not re-key
-- the sessions already logged, because each one stored the period start it was
-- counted in.
create or replace function public.routine_period_start(
  p_workspace_id uuid,
  p_cadence text,
  p_on date
)
returns date
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select case
    when p_cadence = 'monthly' then date_trunc('month', p_on)::date
    else p_on - ((extract(dow from p_on)::integer - coalesce(w.week_starts_on, 1) + 7) % 7)
  end
  from public.workspaces w
  where w.id = p_workspace_id;
$$;

grant execute on function public.routine_period_start(uuid, text, date) to authenticated;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('action-template.frequency.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('action-template.log-occurrence.v1', 'low', array['ui', 'chat', 'mcp'], true);

insert into public.operation_undo_support (operation_id, strategy) values
  ('action-template.frequency.v1', 'snapshot'),
  ('action-template.log-occurrence.v1', 'trash-create');

create function public.execute_routine_frequency_operation(
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
  v_template public.action_templates;
  v_action public.actions;
  v_expected_version bigint;
  v_target integer;
  v_on date;
  v_period_start date;
  v_period_end date;
  v_slot smallint;
  v_horizon_id uuid;
  v_result jsonb;
  v_undo_payload jsonb;
  v_target_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('action-template.frequency.v1', 'action-template.log-occurrence.v1') then
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

  if p_operation_id = 'action-template.frequency.v1' then
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    v_target := nullif(p_input ->> 'occurrencesPerPeriod', '')::integer;
    if v_target is not null and v_target not between 1 and 28 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select * into v_template from public.action_templates
    where id = nullif(p_input ->> 'id', '')::uuid
      and workspace_id = v_workspace_id
      and version = v_expected_version
      and archived_at is null
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    v_undo_payload := jsonb_build_object('occurrencesPerPeriod', v_template.occurrences_per_period);
    -- Changing the target shapes the periods counted after it. Sessions
    -- already logged keep their slots, so last week still reports what last
    -- week actually was.
    update public.action_templates
    set occurrences_per_period = v_target, version = version + 1
    where id = v_template.id returning * into v_template;
    v_target_id := v_template.id;
    v_result := jsonb_build_object(
      'id', v_template.id,
      'workspaceId', v_template.workspace_id,
      'title', v_template.title,
      'cadence', v_template.cadence,
      'status', v_template.status,
      'nextOccurrenceOn', v_template.next_occurrence_on,
      'occurrencesPerPeriod', v_template.occurrences_per_period,
      'version', v_template.version,
      'createdActionIds', '[]'::jsonb
    );

  else
    v_on := nullif(p_input ->> 'on', '')::date;
    if v_on is null or v_on not between date '2020-01-01' and date '2100-12-31' then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select * into v_template from public.action_templates
    where id = nullif(p_input ->> 'id', '')::uuid
      and workspace_id = v_workspace_id
      and archived_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'template_not_found';
    end if;
    if v_template.occurrences_per_period is null then
      raise exception using errcode = 'P0001', message = 'not_a_frequency_target';
    end if;
    -- Pausing stops new sessions being counted and deletes none of the ones
    -- already logged, which is the whole difference between pausing and
    -- archiving.
    if v_template.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'template_not_active';
    end if;

    -- One session a day, which is the rule `actions_recurrence_occurrence_idx`
    -- has always enforced for this table. Said here so the refusal reads as
    -- the rule it is rather than as a version conflict, which is what a raw
    -- unique violation would have been translated into.
    if exists (
      select 1 from public.actions existing
      where existing.workspace_id = v_workspace_id
        and existing.recurrence_template_id = v_template.id
        and existing.scheduled_on = v_on
        and existing.occurrence_slot is not null
        and existing.trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'occurrence_already_recorded';
    end if;

    v_period_start := public.routine_period_start(v_workspace_id, v_template.cadence, v_on);
    v_period_end := case
      when v_template.cadence = 'monthly'
        then (v_period_start + interval '1 month - 1 day')::date
      else v_period_start + 6
    end;

    -- The lowest free slot, so a session logged after one is undone fills the
    -- gap rather than counting as a fourth.
    select min(slot)::smallint into v_slot
    from generate_series(1, v_template.occurrences_per_period) as slot
    where not exists (
      select 1 from public.actions taken
      where taken.workspace_id = v_workspace_id
        and taken.recurrence_template_id = v_template.id
        and taken.occurrence_period_start = v_period_start
        and taken.occurrence_slot = slot
        and taken.trashed_at is null
    );
    if v_slot is null then
      raise exception using errcode = 'P0001', message = 'frequency_target_met';
    end if;

    -- A dated occurrence already sitting on that day is the session, not a
    -- rival to it. Routines created before a target was set keep making these,
    -- and inserting a second row beside one would both break the day's
    -- uniqueness and report two runs where a person did one. It is counted
    -- rather than duplicated.
    update public.actions
    set occurrence_period_start = v_period_start, occurrence_slot = v_slot
    where workspace_id = v_workspace_id
      and recurrence_template_id = v_template.id
      and scheduled_on = v_on
      and occurrence_slot is null
      and trashed_at is null
    returning * into v_action;

    if not found then
      insert into public.planning_horizons (
        workspace_id, kind, starts_on, ends_on, timezone_snapshot
      )
      select v_workspace_id,
             case when v_template.cadence = 'monthly' then 'month' else 'week' end,
             v_period_start, v_period_end, timezone
      from public.workspaces where id = v_workspace_id
      on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
      returning id into v_horizon_id;

      insert into public.actions (
        workspace_id, goal_id, horizon_id, recurrence_template_id, primary_area_id,
        title, status, scheduled_on, occurrence_period_start, occurrence_slot
      ) values (
        v_workspace_id, v_template.goal_id, v_horizon_id, v_template.id,
        (select primary_area_id from public.goals
         where id = v_template.goal_id and workspace_id = v_workspace_id),
        v_template.title, 'open', v_on, v_period_start, v_slot
      ) returning * into v_action;
    end if;
    v_target_id := v_action.id;
    v_undo_payload := null;
    v_result := to_jsonb(v_action) || jsonb_build_object(
      'occurrences_done', (
        select count(*) from public.actions counted
        where counted.workspace_id = v_workspace_id
          and counted.recurrence_template_id = v_template.id
          and counted.occurrence_period_start = v_period_start
          and counted.trashed_at is null
      ),
      'occurrences_target', v_template.occurrences_per_period
    );
  end if;

  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json,
    undo_payload_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low',
    case when p_operation_id = 'action-template.frequency.v1' then 'action_template' else 'action' end,
    v_target_id, 'succeeded', v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id,
    case when p_operation_id = 'action-template.frequency.v1' then 'action_template' else 'action' end,
    v_target_id, 'low', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or check_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  when unique_violation then
    raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
end;
$$;

revoke all on function public.execute_routine_frequency_operation(text, jsonb, text, text)
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
    when p_operation_id = 'operation.undo.v1' then 'operation_undo'
    when p_operation_id in (
      'action-template.frequency.v1', 'action-template.log-occurrence.v1'
    ) then 'routine_frequency'
    when p_operation_id like 'action-template.%' then 'action_template'
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
  elsif v_domain = 'routine_frequency' then
    return public.execute_routine_frequency_operation(
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


commit;
