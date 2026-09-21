-- A project is work that can be finished.
--
-- The schema has outcomes and it has initiatives. An outcome is a result you
-- want; an initiative is a concern that never ends -- staying healthy, keeping
-- the house in order. Neither is the thing most people mean by "project":
-- repaint the kitchen, run the December launch, move house. That is a bounded
-- body of work with a state of being done, and calling it an initiative means
-- it can never be completed, only abandoned or left open forever.
--
-- So `projects` is a third thing rather than a fourth flag on `goals`. The
-- column that makes it a project is `finish_condition`, and it is not
-- nullable: a project whose finish condition nobody could state is an
-- initiative wearing a different label, and the whole point of the table is to
-- refuse that. Saying what done looks like is the price of the word.
--
-- Nothing existing is converted. Every initiative stays an initiative and
-- every monthly Action stays an Action, because reinterpreting a record a
-- person created is a claim about their intent that no migration is entitled
-- to make.
--
-- Dates are free of the horizon chain. `starts_on` and `target_on` are plain
-- dates, so a project can run from November into February without being cloned
-- into two years, which is the same fix cross-period Goals already got.
--
-- Completion is reversible and explicit. `project.status.v1` carries a record
-- back to active and clears the completion time, so reopening is a decision a
-- person makes rather than a state they get stuck outside of.

begin;

create table public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Which part of life this belongs to, and what it supports. All optional:
  -- a project can exist before it has been filed anywhere.
  primary_area_id uuid,
  goal_id uuid,
  note_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description_markdown text
    check (description_markdown is null or char_length(description_markdown) <= 50000),
  -- Not nullable, and this is the whole argument of the table.
  finish_condition text not null
    check (char_length(btrim(finish_condition)) between 1 and 1000),
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'abandoned')),
  starts_on date,
  target_on date,
  completed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  trashed_at timestamptz,
  purge_after timestamptz,
  unique (id, workspace_id),
  foreign key (primary_area_id, workspace_id)
    references public.life_areas(id, workspace_id),
  foreign key (goal_id, workspace_id)
    references public.goals(id, workspace_id),
  foreign key (note_id, workspace_id)
    references public.notes(id, workspace_id),
  -- A span that ends before it starts is a typo, not a plan.
  check (starts_on is null or target_on is null or target_on >= starts_on),
  check (starts_on is null or starts_on between date '2020-01-01' and date '2100-12-31'),
  check (target_on is null or target_on between date '2020-01-01' and date '2100-12-31'),
  -- Finishing is a state and a time, and they agree or the record is lying.
  check ((status = 'completed') = (completed_at is not null))
);

-- The two reads that exist: a workspace's open projects, and one area's.
create index projects_workspace_status_idx
  on public.projects (workspace_id, status, target_on)
  where archived_at is null and trashed_at is null;
create index projects_area_idx
  on public.projects (workspace_id, primary_area_id)
  where primary_area_id is not null and archived_at is null and trashed_at is null;

alter table public.projects enable row level security;
alter table public.projects force row level security;
create policy projects_select_owner on public.projects
  for select to authenticated
  using (
    workspace_id in (
      select id from public.workspaces where owner_user_id = (select auth.uid())
    )
  );
revoke all on public.projects from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.projects from authenticated;
grant select on public.projects to authenticated;

-- A task can belong to a project. Nullable, because most tasks do not, and a
-- task never needs a project to exist -- invariant 6 is not being weakened.
alter table public.actions add column project_id uuid;
alter table public.actions
  add constraint actions_project_id_workspace_id_fkey
  foreign key (project_id, workspace_id)
  references public.projects(id, workspace_id) on delete set null;
create index actions_project_idx
  on public.actions (workspace_id, project_id)
  where project_id is not null;

-- UI only for now. No assistant intent writes a project yet, and the chat
-- catalog is already at the provider prompt budget: advertising a capability
-- nothing uses would shrink the schemas every other Operation gets to show.
insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('project.create.v1', 'low', array['ui'], true),
  ('project.update.v1', 'low', array['ui'], true),
  ('project.status.v1', 'low', array['ui'], true);

insert into public.operation_undo_support (operation_id, strategy) values
  ('project.create.v1', 'trash-create'),
  ('project.update.v1', 'snapshot'),
  ('project.status.v1', 'snapshot');

create function public.execute_project_operation(
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
  v_project public.projects;
  v_expected_version bigint;
  v_status text;
  v_area_id uuid;
  v_goal_id uuid;
  v_note_id uuid;
  v_result jsonb;
  v_undo_payload jsonb;
  v_target_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('project.create.v1', 'project.update.v1', 'project.status.v1') then
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

  -- Every reference is resolved against this workspace before it is stored, so
  -- another owner's area, Goal or page cannot be named into a project here.
  v_area_id := nullif(p_input ->> 'areaId', '')::uuid;
  v_goal_id := nullif(p_input ->> 'goalId', '')::uuid;
  v_note_id := nullif(p_input ->> 'noteId', '')::uuid;
  if v_area_id is not null and not exists (
    select 1 from public.life_areas
    where id = v_area_id and workspace_id = v_workspace_id and archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'area_not_found';
  end if;
  if v_goal_id is not null and not exists (
    select 1 from public.goals where id = v_goal_id and workspace_id = v_workspace_id
      and archived_at is null and trashed_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'goal_not_found';
  end if;
  if v_note_id is not null and not exists (
    select 1 from public.notes where id = v_note_id and workspace_id = v_workspace_id
      and archived_at is null and trashed_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'note_not_found';
  end if;

  if p_operation_id = 'project.create.v1' then
    if char_length(btrim(coalesce(p_input ->> 'title', ''))) not between 1 and 200
      or char_length(btrim(coalesce(p_input ->> 'finishCondition', ''))) not between 1 and 1000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    insert into public.projects (
      workspace_id, primary_area_id, goal_id, note_id, title, description_markdown,
      finish_condition, starts_on, target_on
    ) values (
      v_workspace_id, v_area_id, v_goal_id, v_note_id,
      btrim(p_input ->> 'title'),
      nullif(p_input ->> 'descriptionMarkdown', ''),
      btrim(p_input ->> 'finishCondition'),
      nullif(p_input ->> 'startsOn', '')::date,
      nullif(p_input ->> 'targetOn', '')::date
    ) returning * into v_project;
    -- Non-null so undo is offered at all: the payload for a creation is the
    -- fact that it was one, and undoing it moves the row to Trash rather than
    -- deleting work someone may have already filed tasks under.
    v_undo_payload := jsonb_build_object('created', true);

  elsif p_operation_id = 'project.update.v1' then
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if char_length(btrim(coalesce(p_input ->> 'title', ''))) not between 1 and 200
      or char_length(btrim(coalesce(p_input ->> 'finishCondition', ''))) not between 1 and 1000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select * into v_project from public.projects
    where id = nullif(p_input ->> 'id', '')::uuid
      and workspace_id = v_workspace_id
      and version = v_expected_version
      and trashed_at is null
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    v_undo_payload := jsonb_build_object(
      'title', v_project.title,
      'descriptionMarkdown', v_project.description_markdown,
      'finishCondition', v_project.finish_condition,
      'startsOn', v_project.starts_on,
      'targetOn', v_project.target_on,
      'areaId', v_project.primary_area_id,
      'goalId', v_project.goal_id,
      'noteId', v_project.note_id
    );
    update public.projects set
      title = btrim(p_input ->> 'title'),
      description_markdown = nullif(p_input ->> 'descriptionMarkdown', ''),
      finish_condition = btrim(p_input ->> 'finishCondition'),
      starts_on = nullif(p_input ->> 'startsOn', '')::date,
      target_on = nullif(p_input ->> 'targetOn', '')::date,
      primary_area_id = v_area_id,
      goal_id = v_goal_id,
      note_id = v_note_id,
      updated_at = now(),
      version = version + 1
    where id = v_project.id returning * into v_project;

  else
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    v_status := p_input ->> 'status';
    if v_status not in ('active', 'paused', 'completed', 'abandoned') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    select * into v_project from public.projects
    where id = nullif(p_input ->> 'id', '')::uuid
      and workspace_id = v_workspace_id
      and version = v_expected_version
      and trashed_at is null
    for update;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    v_undo_payload := jsonb_build_object(
      'status', v_project.status,
      'completedAt', v_project.completed_at
    );
    -- Reopening is the reason this is not a one-way door: moving off
    -- 'completed' clears the completion time, so a project that was finished
    -- early and then turned out not to be does not keep a date claiming it was.
    update public.projects set
      status = v_status,
      completed_at = case when v_status = 'completed' then coalesce(completed_at, now()) else null end,
      updated_at = now(),
      version = version + 1
    where id = v_project.id returning * into v_project;
  end if;

  v_target_id := v_project.id;
  v_result := to_jsonb(v_project);

  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json,
    undo_payload_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low', 'project',
    v_target_id, 'succeeded', v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'project',
    v_target_id, 'low',
    case when p_surface = 'ui' then 'explicit_ui_commit' else 'approved' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or check_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

revoke all on function public.execute_project_operation(text, jsonb, text, text)
from public, anon, authenticated;

-- Projects join the Operation router.
CREATE OR REPLACE FUNCTION public.operation_handler_for(p_operation_id text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    when p_operation_id like 'project.%' then 'project'
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
$function$;

update public.operation_contracts
set owning_domain = public.operation_handler_for(operation_id);

CREATE OR REPLACE FUNCTION public.dispatch_trusted_operation(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  if v_domain = 'project' then
    return public.execute_project_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif v_domain = 'note_appearance' then
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
$function$;

revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated;

-- Undo gains a project layer in front of the existing chain, the same way each
-- earlier domain did: anything that is not a project falls straight through to
-- what already handled it.
alter function public.execute_operation_undo(text, jsonb, text, text)
  rename to execute_operation_undo_project_base;

create function public.execute_operation_undo(
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
  v_original public.operation_receipts;
  v_target_id uuid;
  v_expected_version bigint;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if p_operation_id <> 'operation.undo.v1' then
    return public.execute_operation_undo_project_base(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    return public.execute_operation_undo_project_base(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;

  select receipt.* into v_original from public.operation_receipts receipt
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id;
  if not found or v_original.operation_id not like 'project.%' then
    return public.execute_operation_undo_project_base(
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

  -- The project has to be the one the receipt described. Undoing an edit on
  -- top of a later edit would discard the later one without saying so.
  if not exists (
    select 1 from public.projects
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    for update
  ) then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  if v_original.operation_id = 'project.create.v1' then
    update public.projects set
      trashed_at = clock_timestamp(),
      purge_after = clock_timestamp() + interval '30 days',
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id;

  elsif v_original.operation_id = 'project.update.v1' then
    update public.projects set
      title = v_original.undo_payload_json ->> 'title',
      description_markdown = nullif(v_original.undo_payload_json ->> 'descriptionMarkdown', ''),
      finish_condition = v_original.undo_payload_json ->> 'finishCondition',
      starts_on = nullif(v_original.undo_payload_json ->> 'startsOn', '')::date,
      target_on = nullif(v_original.undo_payload_json ->> 'targetOn', '')::date,
      primary_area_id = nullif(v_original.undo_payload_json ->> 'areaId', '')::uuid,
      goal_id = nullif(v_original.undo_payload_json ->> 'goalId', '')::uuid,
      note_id = nullif(v_original.undo_payload_json ->> 'noteId', '')::uuid,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id;

  elsif v_original.operation_id = 'project.status.v1' then
    update public.projects set
      status = v_original.undo_payload_json ->> 'status',
      completed_at = nullif(v_original.undo_payload_json ->> 'completedAt', '')::timestamptz,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id;
  else
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
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
from public, anon, authenticated;

commit;
