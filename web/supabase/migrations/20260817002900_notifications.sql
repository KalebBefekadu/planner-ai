begin;

alter table public.workspaces
  add column in_app_notifications_enabled boolean not null default true,
  add column email_reminders_enabled boolean not null default false,
  add column reminder_email_hour smallint not null default 9
    check (reminder_email_hour between 0 and 23),
  add column quiet_hours_start time not null default time '22:00',
  add column quiet_hours_end time not null default time '07:00';

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('overdue_actions', 'weekly_review', 'recurring_actions', 'system')),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 500),
  href text not null check (href like '/%' and char_length(href) <= 300),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  visible_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key),
  unique (id, workspace_id)
);
create index notifications_workspace_active_idx
on public.notifications (workspace_id, visible_at desc)
where dismissed_at is null;
create trigger notifications_set_updated_at before update on public.notifications
for each row execute function public.set_updated_at();

create table public.notification_email_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  delivery_on date not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  notification_count integer not null check (notification_count > 0),
  provider_message_id text,
  error_code text,
  claimed_at timestamptz not null default now(),
  attempt_count integer not null default 1 check (attempt_count between 1 and 5),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, delivery_on)
);
create index notification_email_deliveries_status_idx
on public.notification_email_deliveries (status, next_attempt_at);
create trigger notification_email_deliveries_set_updated_at
before update on public.notification_email_deliveries
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
create policy notifications_owner_select on public.notifications
for select using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = notifications.workspace_id
      and workspace.owner_user_id = auth.uid()
  )
);
alter table public.notification_email_deliveries enable row level security;
alter table public.notification_email_deliveries force row level security;
create policy notification_email_deliveries_owner_select
on public.notification_email_deliveries
for select using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = notification_email_deliveries.workspace_id
      and workspace.owner_user_id = auth.uid()
  )
);
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
revoke all on public.notification_email_deliveries from public, anon, authenticated;
grant select (
  id, workspace_id, delivery_on, status, notification_count, error_code,
  claimed_at, attempt_count, next_attempt_at, sent_at, created_at, updated_at
) on public.notification_email_deliveries to authenticated;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('notification.refresh.v1', 'low', array['ui', 'chat', 'mcp', 'automation'], true),
  ('notification.read.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('notification.dismiss.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('notification.preferences.v1', 'low', array['ui', 'chat', 'mcp'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

insert into public.operation_undo_support (operation_id, strategy) values
  ('notification.refresh.v1', 'trash-create'),
  ('notification.read.v1', 'snapshot'),
  ('notification.dismiss.v1', 'snapshot'),
  ('notification.preferences.v1', 'snapshot');

create or replace function public.generate_workspace_notifications(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace public.workspaces%rowtype;
  v_today date;
  v_week_start date;
  v_count integer;
  v_inserted integer;
  v_created integer := 0;
begin
  select workspace.* into v_workspace from public.workspaces workspace
  where workspace.id = p_workspace_id;
  if not found then return 0; end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace.id::text || ':notifications', 0)
  );
  select workspace.* into v_workspace from public.workspaces workspace
  where workspace.id = p_workspace_id;
  if not (
    v_workspace.in_app_notifications_enabled or v_workspace.email_reminders_enabled
  ) then
    return 0;
  end if;
  v_today := (clock_timestamp() at time zone v_workspace.timezone)::date;
  v_week_start := v_today -
    ((extract(dow from v_today)::integer - v_workspace.week_starts_on + 7) % 7);

  select count(*)::integer into v_count from public.actions action
  where action.workspace_id = p_workspace_id
    and action.status in ('open', 'in_progress', 'blocked')
    and action.scheduled_on < v_today
    and action.archived_at is null and action.trashed_at is null;
  if v_count > 0 then
    insert into public.notifications (
      workspace_id, kind, title, body, href, dedupe_key
    ) values (
      p_workspace_id, 'overdue_actions', 'Overdue Actions need a decision',
      v_count || case when v_count = 1 then ' Action is overdue.' else ' Actions are overdue.' end,
      '/', 'overdue-actions:' || v_week_start
    ) on conflict (workspace_id, dedupe_key) do nothing;
    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end if;

  select count(*)::integer into v_count from public.action_templates template
  where template.workspace_id = p_workspace_id and template.status = 'active'
    and template.next_occurrence_on <= v_today and template.archived_at is null;
  if v_count > 0 then
    insert into public.notifications (
      workspace_id, kind, title, body, href, dedupe_key
    ) values (
      p_workspace_id, 'recurring_actions', 'Recurring Actions are due',
      v_count || case when v_count = 1 then ' template has a due occurrence.'
        else ' templates have due occurrences.' end,
      '/goals', 'recurring-actions:' || v_week_start
    ) on conflict (workspace_id, dedupe_key) do nothing;
    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end if;

  if extract(dow from v_today)::integer = v_workspace.weekly_review_day
    and not exists (
      select 1 from public.reviews review
      join public.planning_horizons horizon
        on horizon.id = review.horizon_id and horizon.workspace_id = review.workspace_id
      where review.workspace_id = p_workspace_id and review.kind = 'weekly'
        and review.status = 'completed'
        and horizon.starts_on <= v_today and horizon.ends_on >= v_today
    ) then
    insert into public.notifications (
      workspace_id, kind, title, body, href, dedupe_key
    ) values (
      p_workspace_id, 'weekly_review', 'Weekly Review is ready',
      'Resolve unfinished Actions and choose the next priorities.',
      '/review', 'weekly-review:' || v_week_start
    ) on conflict (workspace_id, dedupe_key) do nothing;
    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end if;
  return v_created;
end;
$$;

create or replace function public.execute_notification_operation(
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
  v_workspace public.workspaces%rowtype;
  v_notification public.notifications%rowtype;
  v_before_notification public.notifications%rowtype;
  v_notification_id uuid;
  v_expected_version bigint;
  v_existing_notification_ids uuid[] := array[]::uuid[];
  v_created_count integer := 0;
  v_active_count integer := 0;
  v_created_expected jsonb := '[]'::jsonb;
  v_result jsonb;
  v_undo_payload jsonb;
  v_actor_type text;
  v_in_app_enabled boolean;
  v_email_enabled boolean;
  v_email_hour smallint;
  v_quiet_start time;
  v_quiet_end time;
  v_before_preferences jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'notification.refresh.v1', 'notification.read.v1',
    'notification.dismiss.v1', 'notification.preferences.v1'
  ) or p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200
    or jsonb_typeof(p_input) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  perform 1 from public.operation_contracts contract
  where contract.operation_id = p_operation_id and p_surface = any(contract.exposures);
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;
  select workspace.* into v_workspace from public.workspaces workspace
  where workspace.owner_user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace.id::text || p_operation_id || p_idempotency_key, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace.id::text || ':notifications', 0)
  );
  select workspace.* into v_workspace from public.workspaces workspace
  where workspace.id = v_workspace.id;
  select receipt.result_json into v_result from public.operation_receipts receipt
  where receipt.workspace_id = v_workspace.id
    and receipt.operation_id = p_operation_id
    and receipt.idempotency_key = p_idempotency_key
    and receipt.status = 'succeeded';
  if found then return v_result; end if;
  v_actor_type := case
    when p_surface = 'chat' then 'assistant'
    when p_surface in ('mcp', 'automation') then 'automation'
    else 'user'
  end;

  if p_operation_id = 'notification.refresh.v1' then
    if p_input <> '{}'::jsonb then
      raise exception using errcode = 'P0001', message = 'invalid_notification_input';
    end if;
    select coalesce(array_agg(notification.id), array[]::uuid[])
    into v_existing_notification_ids
    from public.notifications notification
    where notification.workspace_id = v_workspace.id;
    v_created_count := public.generate_workspace_notifications(v_workspace.id);
    select coalesce(jsonb_agg(to_jsonb(notification) order by notification.created_at), '[]'::jsonb)
    into v_created_expected from public.notifications notification
    where notification.workspace_id = v_workspace.id
      and not (notification.id = any(v_existing_notification_ids));
    select count(*)::integer into v_active_count from public.notifications notification
    where notification.workspace_id = v_workspace.id and notification.dismissed_at is null
      and notification.visible_at <= clock_timestamp();
    v_result := jsonb_build_object(
      'createdCount', v_created_count, 'activeCount', v_active_count
    );
    v_undo_payload := jsonb_build_object(
      'kind', 'refresh', 'notificationsExpected', v_created_expected
    );

  elsif p_operation_id in ('notification.read.v1', 'notification.dismiss.v1') then
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) as keys(key))
      is distinct from array['expectedVersion', 'id']::text[] then
      raise exception using errcode = 'P0001', message = 'invalid_notification_input';
    end if;
    v_notification_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    select notification.* into v_notification from public.notifications notification
    where notification.id = v_notification_id
      and notification.workspace_id = v_workspace.id for update;
    if not found or v_notification.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    v_before_notification := v_notification;
    if p_operation_id = 'notification.read.v1' then
      update public.notifications set
        read_at = coalesce(read_at, clock_timestamp()), version = version + 1
      where id = v_notification.id returning * into v_notification;
    else
      update public.notifications set
        dismissed_at = clock_timestamp(), version = version + 1
      where id = v_notification.id returning * into v_notification;
    end if;
    v_result := jsonb_build_object(
      'id', v_notification.id, 'workspaceId', v_notification.workspace_id,
      'kind', v_notification.kind, 'title', v_notification.title,
      'body', v_notification.body, 'href', v_notification.href,
      'readAt', v_notification.read_at, 'dismissedAt', v_notification.dismissed_at,
      'version', v_notification.version
    );
    v_undo_payload := jsonb_build_object(
      'kind', 'notification-snapshot',
      'notificationBefore', to_jsonb(v_before_notification),
      'notificationExpected', to_jsonb(v_notification)
    );

  else
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) as keys(key))
      is distinct from array[
        'emailEnabled', 'emailHour', 'inAppEnabled', 'quietHoursEnd', 'quietHoursStart'
      ]::text[] then
      raise exception using errcode = 'P0001', message = 'invalid_notification_input';
    end if;
    v_in_app_enabled := (p_input ->> 'inAppEnabled')::boolean;
    v_email_enabled := (p_input ->> 'emailEnabled')::boolean;
    v_email_hour := (p_input ->> 'emailHour')::smallint;
    v_quiet_start := (p_input ->> 'quietHoursStart')::time;
    v_quiet_end := (p_input ->> 'quietHoursEnd')::time;
    if jsonb_typeof(p_input -> 'inAppEnabled') <> 'boolean'
      or jsonb_typeof(p_input -> 'emailEnabled') <> 'boolean'
      or v_email_hour not between 0 and 23
      or v_quiet_start = v_quiet_end then
      raise exception using errcode = 'P0001', message = 'invalid_notification_input';
    end if;
    v_before_preferences := jsonb_build_object(
      'inAppEnabled', v_workspace.in_app_notifications_enabled,
      'emailEnabled', v_workspace.email_reminders_enabled,
      'emailHour', v_workspace.reminder_email_hour,
      'quietHoursStart', to_char(v_workspace.quiet_hours_start, 'HH24:MI'),
      'quietHoursEnd', to_char(v_workspace.quiet_hours_end, 'HH24:MI')
    );
    update public.workspaces set
      in_app_notifications_enabled = v_in_app_enabled,
      email_reminders_enabled = v_email_enabled,
      reminder_email_hour = v_email_hour,
      quiet_hours_start = v_quiet_start,
      quiet_hours_end = v_quiet_end
    where id = v_workspace.id returning * into v_workspace;
    v_result := jsonb_build_object(
      'workspaceId', v_workspace.id,
      'inAppEnabled', v_workspace.in_app_notifications_enabled,
      'emailEnabled', v_workspace.email_reminders_enabled,
      'emailHour', v_workspace.reminder_email_hour,
      'quietHoursStart', to_char(v_workspace.quiet_hours_start, 'HH24:MI'),
      'quietHoursEnd', to_char(v_workspace.quiet_hours_end, 'HH24:MI')
    );
    v_undo_payload := jsonb_build_object(
      'kind', 'preferences',
      'before', v_before_preferences,
      'expected', v_result
    );
  end if;

  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status,
    result_json, undo_payload_json
  ) values (
    v_workspace.id, p_operation_id, v_user_id, v_actor_type, p_surface,
    p_idempotency_key, 'low',
    case when p_operation_id = 'notification.preferences.v1' then 'workspace'
      when p_operation_id = 'notification.refresh.v1' then 'notification_feed'
      else 'notification' end,
    case when p_operation_id in ('notification.read.v1', 'notification.dismiss.v1')
      then v_notification.id else v_workspace.id end,
    'succeeded', v_result, v_undo_payload
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace.id, v_user_id, v_actor_type, p_surface, p_operation_id,
    case when p_operation_id = 'notification.preferences.v1' then 'workspace'
      when p_operation_id = 'notification.refresh.v1' then 'notification_feed'
      else 'notification' end,
    case when p_operation_id in ('notification.read.v1', 'notification.dismiss.v1')
      then v_notification.id else v_workspace.id end,
    'low', 'not_required', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or check_violation or foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'invalid_notification_input';
end;
$$;

alter function public.dispatch_trusted_operation(text, jsonb, text, text)
rename to dispatch_trusted_operation_notification_base;

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
begin
  if p_operation_id like 'notification.%' then
    return public.execute_notification_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  return public.dispatch_trusted_operation_notification_base(
    p_operation_id, p_input, p_idempotency_key, p_surface
  );
end;
$$;

create or replace function public.refresh_all_workspace_notifications()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
  v_created integer := 0;
begin
  for v_workspace_id in
    select workspace.id from public.workspaces workspace
    where workspace.in_app_notifications_enabled or workspace.email_reminders_enabled
  loop
    v_created := v_created + public.generate_workspace_notifications(v_workspace_id);
  end loop;
  return v_created;
end;
$$;

create or replace function public.claim_notification_email_batch(p_limit integer default 50)
returns table (
  delivery_id uuid,
  workspace_id uuid,
  user_id uuid,
  email text,
  notification_count integer,
  delivery_on date,
  timezone text
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_row record;
  v_local_timestamp timestamp;
  v_local_time time;
  v_local_date date;
  v_count integer;
  v_delivery_id uuid;
  v_quiet boolean;
  v_returned integer := 0;
begin
  if p_limit not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_email_batch_limit';
  end if;
  perform public.refresh_all_workspace_notifications();
  for v_row in
    select workspace.*, user_record.email
    from public.workspaces workspace
    join auth.users user_record on user_record.id = workspace.owner_user_id
    where workspace.email_reminders_enabled and user_record.email is not null
    order by workspace.id
  loop
    exit when v_returned >= p_limit;
    v_local_timestamp := clock_timestamp() at time zone v_row.timezone;
    v_local_time := v_local_timestamp::time;
    v_local_date := v_local_timestamp::date;
    v_quiet := case
      when v_row.quiet_hours_start < v_row.quiet_hours_end then
        v_local_time >= v_row.quiet_hours_start and v_local_time < v_row.quiet_hours_end
      else v_local_time >= v_row.quiet_hours_start or v_local_time < v_row.quiet_hours_end
    end;
    if v_quiet or extract(hour from v_local_timestamp)::integer < v_row.reminder_email_hour then
      continue;
    end if;
    select count(*)::integer into v_count from public.notifications notification
    where notification.workspace_id = v_row.id and notification.dismissed_at is null
      and notification.read_at is null and notification.visible_at <= clock_timestamp();
    if v_count = 0 then continue; end if;
    v_delivery_id := null;
    insert into public.notification_email_deliveries (
      workspace_id, delivery_on, status, notification_count
    ) values (v_row.id, v_local_date, 'sending', v_count)
    on conflict on constraint notification_email_deliveries_workspace_id_delivery_on_key do update set
      status = 'sending',
      notification_count = excluded.notification_count,
      error_code = null,
      claimed_at = clock_timestamp(),
      attempt_count = notification_email_deliveries.attempt_count + 1,
      next_attempt_at = clock_timestamp()
    where (
      notification_email_deliveries.status = 'failed'
      and notification_email_deliveries.attempt_count < 5
      and notification_email_deliveries.next_attempt_at <= clock_timestamp()
    ) or (
      notification_email_deliveries.status = 'sending'
      and notification_email_deliveries.attempt_count < 5
      and notification_email_deliveries.claimed_at <= clock_timestamp() - interval '15 minutes'
    )
    returning id into v_delivery_id;
    if v_delivery_id is not null then
      delivery_id := v_delivery_id;
      workspace_id := v_row.id;
      user_id := v_row.owner_user_id;
      email := v_row.email;
      notification_count := v_count;
      delivery_on := v_local_date;
      timezone := v_row.timezone;
      return next;
      v_returned := v_returned + 1;
    end if;
  end loop;
end;
$$;

alter function public.build_mcp_workspace_snapshot(uuid)
rename to build_mcp_workspace_snapshot_notification_base;

create or replace function public.build_mcp_workspace_snapshot(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    public.build_mcp_workspace_snapshot_notification_base(p_workspace_id),
    '{}'::jsonb
  ) || jsonb_build_object(
    'notifications', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', notification.id,
          'kind', notification.kind,
          'title', notification.title,
          'href', notification.href,
          'readAt', notification.read_at,
          'version', notification.version
        ) order by notification.visible_at desc
      )
      from public.notifications notification
      where notification.workspace_id = p_workspace_id
        and notification.dismissed_at is null
        and notification.visible_at <= clock_timestamp()
    ), '[]'::jsonb)
  );
$$;

alter function public.execute_operation_undo(text, jsonb, text, text)
rename to execute_operation_undo_notification_base;

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
  v_user_id uuid := auth.uid();
  v_workspace public.workspaces%rowtype;
  v_original public.operation_receipts%rowtype;
  v_notification public.notifications%rowtype;
  v_expected_notification jsonb;
  v_before jsonb;
  v_expected jsonb;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if p_operation_id <> 'operation.undo.v1' then
    return public.execute_operation_undo_notification_base(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  select workspace.* into v_workspace from public.workspaces workspace
  where workspace.owner_user_id = v_user_id;
  select receipt.* into v_original
  from public.operation_receipts receipt
  join public.operation_undo_support support on support.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace.id
    and receipt.operation_id like 'notification.%'
    and receipt.status = 'succeeded' and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
  for update of receipt;
  if not found then
    return public.execute_operation_undo_notification_base(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  end if;
  if p_surface <> 'ui' or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200
    or v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace.id::text || p_operation_id || p_idempotency_key, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace.id::text || ':notifications', 0)
  );
  select workspace.* into v_workspace from public.workspaces workspace
  where workspace.id = v_workspace.id;
  select receipt.result_json into v_result from public.operation_receipts receipt
  where receipt.workspace_id = v_workspace.id and receipt.operation_id = p_operation_id
    and receipt.idempotency_key = p_idempotency_key and receipt.status = 'succeeded';
  if found then return v_result; end if;

  if v_original.undo_payload_json ->> 'kind' = 'refresh' then
    if exists (
      select 1 from public.notification_email_deliveries delivery
      where delivery.workspace_id = v_workspace.id
        and delivery.created_at >= v_original.created_at
    ) then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    for v_expected_notification in
      select value from jsonb_array_elements(
        v_original.undo_payload_json -> 'notificationsExpected'
      )
    loop
      select notification.* into v_notification from public.notifications notification
      where notification.id = (v_expected_notification ->> 'id')::uuid
        and notification.workspace_id = v_workspace.id for update;
      if not found or to_jsonb(v_notification) is distinct from v_expected_notification then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
    end loop;
    delete from public.notifications notification
    where notification.workspace_id = v_workspace.id and notification.id in (
      select (value ->> 'id')::uuid from jsonb_array_elements(
        v_original.undo_payload_json -> 'notificationsExpected'
      )
    );

  elsif v_original.undo_payload_json ->> 'kind' = 'notification-snapshot' then
    v_expected := v_original.undo_payload_json -> 'notificationExpected';
    select notification.* into v_notification from public.notifications notification
    where notification.id = v_original.target_id
      and notification.workspace_id = v_workspace.id for update;
    if not found or to_jsonb(v_notification) is distinct from v_expected then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_before := v_original.undo_payload_json -> 'notificationBefore';
    update public.notifications set
      read_at = nullif(v_before ->> 'read_at', '')::timestamptz,
      dismissed_at = nullif(v_before ->> 'dismissed_at', '')::timestamptz,
      version = (v_before ->> 'version')::bigint
    where id = v_notification.id and workspace_id = v_workspace.id;

  else
    v_expected := v_original.undo_payload_json -> 'expected';
    if v_workspace.in_app_notifications_enabled is distinct from
        (v_expected ->> 'inAppEnabled')::boolean
      or v_workspace.email_reminders_enabled is distinct from
        (v_expected ->> 'emailEnabled')::boolean
      or v_workspace.reminder_email_hour is distinct from
        (v_expected ->> 'emailHour')::smallint
      or to_char(v_workspace.quiet_hours_start, 'HH24:MI') is distinct from
        v_expected ->> 'quietHoursStart'
      or to_char(v_workspace.quiet_hours_end, 'HH24:MI') is distinct from
        v_expected ->> 'quietHoursEnd' then
      raise exception using errcode = '40001', message = 'undo_conflict';
    end if;
    v_before := v_original.undo_payload_json -> 'before';
    update public.workspaces set
      in_app_notifications_enabled = (v_before ->> 'inAppEnabled')::boolean,
      email_reminders_enabled = (v_before ->> 'emailEnabled')::boolean,
      reminder_email_hour = (v_before ->> 'emailHour')::smallint,
      quiet_hours_start = (v_before ->> 'quietHoursStart')::time,
      quiet_hours_end = (v_before ->> 'quietHoursEnd')::time
    where id = v_workspace.id;
  end if;

  update public.operation_receipts set reversed_at = clock_timestamp()
  where id = v_original.id;
  v_undo_receipt_id := extensions.gen_random_uuid();
  v_result := jsonb_build_object(
    'originalReceiptId', v_original.id,
    'undoReceiptId', v_undo_receipt_id,
    'status', 'undone'
  );
  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_undo_receipt_id, v_workspace.id, p_operation_id, v_user_id, 'user', p_surface,
    p_idempotency_key, 'low', v_original.target_type, v_original.target_id,
    'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace.id, v_user_id, 'user', p_surface, p_operation_id,
    v_original.target_type, v_original.target_id, 'low', 'not_required', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$$;

revoke all on function public.generate_workspace_notifications(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.execute_notification_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation_notification_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.refresh_all_workspace_notifications()
from public, anon, authenticated;
grant execute on function public.refresh_all_workspace_notifications() to service_role;
revoke all on function public.claim_notification_email_batch(integer)
from public, anon, authenticated;
grant execute on function public.claim_notification_email_batch(integer) to service_role;
revoke all on function public.build_mcp_workspace_snapshot_notification_base(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.build_mcp_workspace_snapshot(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo_notification_base(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.execute_operation_undo(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
