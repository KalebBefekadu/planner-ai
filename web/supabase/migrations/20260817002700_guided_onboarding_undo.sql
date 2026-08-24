begin;

insert into public.operation_undo_support (operation_id, strategy)
values ('workspace.onboarding-complete.v1', 'snapshot')
on conflict (operation_id) do update set strategy = excluded.strategy;

create or replace function public.capture_workspace_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), old.id, 'workspaces', old.id,
    jsonb_build_object(
      'timezone', old.timezone,
      'weekStartsOn', old.week_starts_on,
      'coachingIntensity', old.coaching_intensity,
      'aiEnabled', old.ai_enabled,
      'weeklyReviewDay', old.weekly_review_day,
      'softBudgetCents', old.ai_soft_budget_cents,
      'onboardingCompletedAt', old.onboarding_completed_at
    )
  );
  return new;
end;
$$;

create or replace function public.capture_vision_insert_for_onboarding()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.operation_before_images (
    transaction_id, workspace_id, target_type, target_id, payload_json
  ) values (
    txid_current(), new.workspace_id, 'vision_inserts', new.id,
    jsonb_build_object('mode', 'create')
  );
  return new;
end;
$$;

create trigger visions_capture_insert_for_onboarding
after insert on public.visions
for each row execute function public.capture_vision_insert_for_onboarding();

create or replace function public.claim_guided_onboarding_before_image()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_workspace record;
  v_prior_workspace jsonb;
  v_vision_id uuid;
  v_goal_id uuid;
  v_action_id uuid;
  v_capture_id uuid;
  v_vision_mode text := 'none';
  v_prior_vision jsonb;
  v_expected_vision jsonb;
  v_expected_goal jsonb;
  v_expected_action jsonb;
  v_expected_capture jsonb;
  v_horizons jsonb;
begin
  if new.undo_payload_json is not null
    or new.operation_id <> 'workspace.onboarding-complete.v1' then
    return new;
  end if;
  v_vision_id := nullif(new.result_json ->> 'visionId', '')::uuid;
  v_goal_id := nullif(new.result_json ->> 'goalId', '')::uuid;
  v_action_id := nullif(new.result_json ->> 'actionId', '')::uuid;
  v_capture_id := nullif(new.result_json ->> 'captureId', '')::uuid;

  select * into v_workspace from public.workspaces where id = new.workspace_id;
  select payload_json into v_prior_workspace
  from public.operation_before_images
  where transaction_id = txid_current() and workspace_id = new.workspace_id
    and target_type = 'workspaces' and target_id = new.workspace_id
  order by id desc limit 1;
  if v_workspace.id is null or v_prior_workspace is null then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;

  if v_vision_id is not null and exists (
    select 1 from public.operation_before_images
    where transaction_id = txid_current() and workspace_id = new.workspace_id
      and target_type = 'vision_inserts' and target_id = v_vision_id
  ) then
    v_vision_mode := 'create';
  elsif v_vision_id is not null then
    select payload_json into v_prior_vision
    from public.operation_before_images
    where transaction_id = txid_current() and workspace_id = new.workspace_id
      and target_type = 'visions' and target_id = v_vision_id
    order by id desc limit 1;
    if v_prior_vision is not null then v_vision_mode := 'update'; end if;
  end if;
  if v_vision_mode <> 'none' then
    select to_jsonb(vision) into v_expected_vision from public.visions vision
    where id = v_vision_id and workspace_id = new.workspace_id;
  end if;
  if v_goal_id is not null then
    select to_jsonb(goal) into v_expected_goal from public.goals goal
    where id = v_goal_id and workspace_id = new.workspace_id;
  end if;
  if v_action_id is not null then
    select to_jsonb(action) into v_expected_action from public.actions action
    where id = v_action_id and workspace_id = new.workspace_id;
  end if;
  if v_capture_id is not null then
    select to_jsonb(capture) into v_expected_capture from public.captures capture
    where id = v_capture_id and workspace_id = new.workspace_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', horizon.id,
    'mode', snapshot.payload_json ->> 'mode',
    'priorHorizon', snapshot.payload_json -> 'priorHorizon',
    'expectedHorizon', to_jsonb(horizon)
  ) order by horizon.id), '[]'::jsonb)
  into v_horizons
  from (
    select distinct on (target_id) target_id, payload_json
    from public.operation_before_images
    where transaction_id = txid_current() and workspace_id = new.workspace_id
      and target_type = 'planning_horizons'
    order by target_id, id desc
  ) snapshot
  join public.planning_horizons horizon
    on horizon.id = snapshot.target_id and horizon.workspace_id = new.workspace_id;

  if (v_vision_mode <> 'none' and v_expected_vision is null)
    or (v_goal_id is not null and v_expected_goal is null)
    or (v_action_id is not null and v_expected_action is null)
    or (v_capture_id is not null and v_expected_capture is null) then
    raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
  end if;
  new.undo_payload_json := jsonb_build_object(
    'priorWorkspace', v_prior_workspace,
    'expectedWorkspace', jsonb_build_object(
      'timezone', v_workspace.timezone,
      'weekStartsOn', v_workspace.week_starts_on,
      'coachingIntensity', v_workspace.coaching_intensity,
      'aiEnabled', v_workspace.ai_enabled,
      'weeklyReviewDay', v_workspace.weekly_review_day,
      'onboardingCompletedAt', v_workspace.onboarding_completed_at
    ),
    'vision', jsonb_build_object(
      'mode', v_vision_mode,
      'id', v_vision_id,
      'priorVision', v_prior_vision,
      'expectedVision', v_expected_vision
    ),
    'goal', jsonb_build_object('id', v_goal_id, 'expected', v_expected_goal),
    'action', jsonb_build_object('id', v_action_id, 'expected', v_expected_action),
    'capture', jsonb_build_object('id', v_capture_id, 'expected', v_expected_capture),
    'horizons', v_horizons
  );
  return new;
end;
$$;

create trigger operation_receipts_af_claim_guided_onboarding
before insert on public.operation_receipts
for each row execute function public.claim_guided_onboarding_before_image();

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_trash_restore_base;

create or replace function public.execute_guided_onboarding_undo(
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
  v_original record;
  v_workspace record;
  v_vision record;
  v_goal record;
  v_action record;
  v_capture record;
  v_horizon record;
  v_horizon_snapshot jsonb;
  v_vision_id uuid;
  v_goal_id uuid;
  v_action_id uuid;
  v_capture_id uuid;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'operation.undo.v1'
    or p_surface <> 'ui'
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
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

  select receipt.* into v_original
  from public.operation_receipts receipt
  join public.operation_undo_support support on support.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.operation_id = 'workspace.onboarding-complete.v1'
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  if v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

  v_vision_id := nullif(v_original.undo_payload_json #>> '{vision,id}', '')::uuid;
  v_goal_id := nullif(v_original.undo_payload_json #>> '{goal,id}', '')::uuid;
  v_action_id := nullif(v_original.undo_payload_json #>> '{action,id}', '')::uuid;
  v_capture_id := nullif(v_original.undo_payload_json #>> '{capture,id}', '')::uuid;

  select * into v_workspace from public.workspaces where id = v_workspace_id for update;
  if v_workspace.timezone is distinct from v_original.undo_payload_json #>> '{expectedWorkspace,timezone}'
    or v_workspace.week_starts_on is distinct from (v_original.undo_payload_json #>> '{expectedWorkspace,weekStartsOn}')::smallint
    or v_workspace.coaching_intensity is distinct from v_original.undo_payload_json #>> '{expectedWorkspace,coachingIntensity}'
    or v_workspace.ai_enabled is distinct from (v_original.undo_payload_json #>> '{expectedWorkspace,aiEnabled}')::boolean
    or v_workspace.weekly_review_day is distinct from (v_original.undo_payload_json #>> '{expectedWorkspace,weeklyReviewDay}')::smallint
    or v_workspace.onboarding_completed_at is distinct from
      (v_original.undo_payload_json #>> '{expectedWorkspace,onboardingCompletedAt}')::timestamptz then
    raise exception using errcode = '40001', message = 'undo_conflict';
  end if;

  if v_action_id is not null then
    select * into v_action from public.actions
    where id = v_action_id and workspace_id = v_workspace_id for update;
    if not found or to_jsonb(v_action) is distinct from v_original.undo_payload_json #> '{action,expected}'
      or exists (select 1 from public.actions where workspace_id = v_workspace_id and parent_action_id = v_action_id)
      or exists (select 1 from public.note_action_links where workspace_id = v_workspace_id and action_id = v_action_id)
      or exists (select 1 from public.daily_focus_items where workspace_id = v_workspace_id and action_id = v_action_id)
      or exists (select 1 from public.review_action_items where workspace_id = v_workspace_id and action_id = v_action_id)
      or exists (select 1 from public.action_schedule_history where workspace_id = v_workspace_id and action_id = v_action_id) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end if;
  if v_goal_id is not null then
    select * into v_goal from public.goals
    where id = v_goal_id and workspace_id = v_workspace_id for update;
    if not found or to_jsonb(v_goal) is distinct from v_original.undo_payload_json #> '{goal,expected}'
      or exists (select 1 from public.goals where workspace_id = v_workspace_id and parent_goal_id = v_goal_id)
      or exists (select 1 from public.actions where workspace_id = v_workspace_id and goal_id = v_goal_id and id is distinct from v_action_id)
      or exists (select 1 from public.note_goal_links where workspace_id = v_workspace_id and goal_id = v_goal_id) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end if;
  if v_capture_id is not null then
    select * into v_capture from public.captures
    where id = v_capture_id and workspace_id = v_workspace_id for update;
    if not found or to_jsonb(v_capture) is distinct from v_original.undo_payload_json #> '{capture,expected}'
      or exists (select 1 from public.capture_note_links where workspace_id = v_workspace_id and capture_id = v_capture_id)
      or exists (select 1 from public.ai_proposals where workspace_id = v_workspace_id and source_capture_id = v_capture_id)
      or exists (
        select 1 from public.memories where workspace_id = v_workspace_id
          and source_type = 'capture' and source_id = v_capture_id
      ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end if;
  if v_vision_id is not null and v_original.undo_payload_json #>> '{vision,mode}' <> 'none' then
    select * into v_vision from public.visions
    where id = v_vision_id and workspace_id = v_workspace_id for update;
    if not found or to_jsonb(v_vision) is distinct from v_original.undo_payload_json #> '{vision,expectedVision}' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    if v_original.undo_payload_json #>> '{vision,mode}' = 'create' and exists (
      select 1 from public.goals where workspace_id = v_workspace_id
        and vision_id = v_vision_id and id is distinct from v_goal_id
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end if;

  for v_horizon_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'horizons')
  loop
    select * into v_horizon from public.planning_horizons
    where id = (v_horizon_snapshot ->> 'id')::uuid and workspace_id = v_workspace_id
    for update;
    if not found or to_jsonb(v_horizon) is distinct from v_horizon_snapshot -> 'expectedHorizon' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
  end loop;

  if v_capture_id is not null then
    delete from public.captures where id = v_capture_id and workspace_id = v_workspace_id;
  end if;
  if v_action_id is not null then
    delete from public.actions where id = v_action_id and workspace_id = v_workspace_id;
  end if;
  if v_goal_id is not null then
    delete from public.goals where id = v_goal_id and workspace_id = v_workspace_id;
  end if;
  if v_original.undo_payload_json #>> '{vision,mode}' = 'create' then
    delete from public.visions where id = v_vision_id and workspace_id = v_workspace_id;
  elsif v_original.undo_payload_json #>> '{vision,mode}' = 'update' then
    update public.visions set
      body_markdown = v_original.undo_payload_json #>> '{vision,priorVision,bodyMarkdown}',
      version = version + 1
    where id = v_vision_id and workspace_id = v_workspace_id;
  end if;

  for v_horizon_snapshot in
    select value from jsonb_array_elements(v_original.undo_payload_json -> 'horizons')
  loop
    if v_horizon_snapshot ->> 'mode' = 'update' then
      update public.planning_horizons set
        kind = v_horizon_snapshot #>> '{priorHorizon,kind}',
        starts_on = (v_horizon_snapshot #>> '{priorHorizon,startsOn}')::date,
        ends_on = (v_horizon_snapshot #>> '{priorHorizon,endsOn}')::date,
        timezone_snapshot = v_horizon_snapshot #>> '{priorHorizon,timezoneSnapshot}'
      where id = (v_horizon_snapshot ->> 'id')::uuid and workspace_id = v_workspace_id;
    elsif v_horizon_snapshot ->> 'mode' = 'create' then
      delete from public.planning_horizons horizon
      where horizon.id = (v_horizon_snapshot ->> 'id')::uuid
        and horizon.workspace_id = v_workspace_id
        and not exists (select 1 from public.reviews where workspace_id = v_workspace_id and horizon_id = horizon.id)
        and not exists (select 1 from public.goals where workspace_id = v_workspace_id and horizon_id = horizon.id)
        and not exists (select 1 from public.actions where workspace_id = v_workspace_id and horizon_id = horizon.id)
        and not exists (
          select 1 from public.action_schedule_history
          where workspace_id = v_workspace_id
            and (previous_horizon_id = horizon.id or new_horizon_id = horizon.id)
        );
    else
      raise exception using errcode = 'P0001', message = 'undo_snapshot_missing';
    end if;
  end loop;

  update public.workspaces set
    timezone = v_original.undo_payload_json #>> '{priorWorkspace,timezone}',
    week_starts_on = (v_original.undo_payload_json #>> '{priorWorkspace,weekStartsOn}')::smallint,
    coaching_intensity = v_original.undo_payload_json #>> '{priorWorkspace,coachingIntensity}',
    ai_enabled = (v_original.undo_payload_json #>> '{priorWorkspace,aiEnabled}')::boolean,
    weekly_review_day = (v_original.undo_payload_json #>> '{priorWorkspace,weeklyReviewDay}')::smallint,
    onboarding_completed_at = nullif(v_original.undo_payload_json #>> '{priorWorkspace,onboardingCompletedAt}', '')::timestamptz
  where id = v_workspace_id;

  v_undo_receipt_id := extensions.gen_random_uuid();
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
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

create or replace function public.execute_operation_undo(
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
  v_original_operation_id text;
begin
  select receipt.operation_id into v_original_operation_id
  from public.operation_receipts receipt
  join public.workspaces workspace on workspace.id = receipt.workspace_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and workspace.owner_user_id = auth.uid();
  if v_original_operation_id = 'workspace.onboarding-complete.v1' then
    return public.execute_guided_onboarding_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.execute_operation_undo_trash_restore_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.capture_vision_insert_for_onboarding()
from public, anon, authenticated, service_role;
revoke all on function public.claim_guided_onboarding_before_image()
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_trash_restore_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_guided_onboarding_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
