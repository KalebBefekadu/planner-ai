begin;

do $$
begin
  if to_regclass('public.visions') is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'visions' and column_name = 'workspace_id'
    ) then
    alter table public.visions rename to legacy_visions;
  end if;
  if to_regclass('public.yearly_goals') is not null then
    alter table public.yearly_goals rename to legacy_yearly_goals;
  end if;
  if to_regclass('public.quarterly_goals') is not null then
    alter table public.quarterly_goals rename to legacy_quarterly_goals;
  end if;
  if to_regclass('public.monthly_tasks') is not null then
    alter table public.monthly_tasks rename to legacy_monthly_tasks;
  end if;
  if to_regclass('public.weekly_actions') is not null then
    alter table public.weekly_actions rename to legacy_weekly_actions;
  end if;
  if to_regclass('public.transcripts') is not null then
    alter table public.transcripts rename to legacy_transcripts;
  end if;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create table public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Workspace' check (char_length(name) between 1 and 120),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 80),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  coaching_intensity text not null default 'calm' check (coaching_intensity in ('calm', 'direct', 'strict')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id),
  unique (id, owner_user_id)
);

create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();

create table public.planning_horizons (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('year', 'quarter', 'month', 'week')),
  starts_on date not null,
  ends_on date not null,
  timezone_snapshot text not null check (char_length(timezone_snapshot) between 1 and 80),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (workspace_id, kind, starts_on),
  unique (id, workspace_id)
);
create index planning_horizons_workspace_idx on public.planning_horizons (workspace_id, starts_on desc);

create table public.visions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  body_markdown text not null check (char_length(body_markdown) between 3 and 50000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  trashed_at timestamptz,
  purge_after timestamptz,
  unique (id, workspace_id),
  check ((trashed_at is null and purge_after is null) or (trashed_at is not null and purge_after is not null))
);
create unique index visions_one_active_per_workspace_idx on public.visions (workspace_id)
where archived_at is null and trashed_at is null;
create index visions_workspace_idx on public.visions (workspace_id, updated_at desc);
create trigger visions_set_updated_at before update on public.visions
for each row execute function public.set_updated_at();

create table public.goals (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vision_id uuid not null,
  horizon_id uuid not null,
  parent_goal_id uuid,
  title text not null check (char_length(title) between 3 and 1000),
  description_markdown text,
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'achieved', 'abandoned')),
  target_value numeric,
  current_value numeric,
  unit text,
  due_on date,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  trashed_at timestamptz,
  purge_after timestamptz,
  unique (id, workspace_id),
  foreign key (vision_id, workspace_id) references public.visions(id, workspace_id),
  foreign key (horizon_id, workspace_id) references public.planning_horizons(id, workspace_id),
  foreign key (parent_goal_id, workspace_id) references public.goals(id, workspace_id),
  check ((trashed_at is null and purge_after is null) or (trashed_at is not null and purge_after is not null))
);
create index goals_workspace_idx on public.goals (workspace_id, status, updated_at desc);
create index goals_parent_idx on public.goals (workspace_id, parent_goal_id);
create trigger goals_set_updated_at before update on public.goals
for each row execute function public.set_updated_at();

create table public.actions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  goal_id uuid,
  parent_action_id uuid,
  horizon_id uuid not null,
  source_note_id uuid,
  recurrence_template_id uuid,
  title text not null check (char_length(title) between 3 and 1000),
  description_markdown text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'done', 'dropped')),
  scheduled_on date,
  completed_at timestamptz,
  blocker_text text,
  drop_reason text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  trashed_at timestamptz,
  purge_after timestamptz,
  unique (id, workspace_id),
  foreign key (goal_id, workspace_id) references public.goals(id, workspace_id),
  foreign key (parent_action_id, workspace_id) references public.actions(id, workspace_id),
  foreign key (horizon_id, workspace_id) references public.planning_horizons(id, workspace_id),
  check ((status = 'done' and completed_at is not null) or (status <> 'done')),
  check ((trashed_at is null and purge_after is null) or (trashed_at is not null and purge_after is not null))
);
create index actions_workspace_idx on public.actions (workspace_id, status, scheduled_on);
create index actions_goal_idx on public.actions (workspace_id, goal_id);
create index actions_parent_idx on public.actions (workspace_id, parent_action_id);
create trigger actions_set_updated_at before update on public.actions
for each row execute function public.set_updated_at();

create table public.captures (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  raw_text text not null check (char_length(trim(raw_text)) between 3 and 60000),
  source text not null check (source in ('typed', 'voice', 'import')),
  state text not null default 'new' check (state in ('new', 'proposed', 'reviewed', 'archived')),
  audio_object_key text,
  transcription_status text check (transcription_status is null or transcription_status in ('pending', 'complete', 'failed')),
  failed_audio_expires_at timestamptz,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  trashed_at timestamptz,
  purge_after timestamptz,
  unique (id, workspace_id),
  check ((trashed_at is null and purge_after is null) or (trashed_at is not null and purge_after is not null))
);
create index captures_workspace_idx on public.captures (workspace_id, created_at desc);

create or replace function public.preserve_capture_source()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.raw_text is distinct from old.raw_text
    or new.source is distinct from old.source
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'capture_source_is_immutable';
  end if;
  return new;
end;
$$;
create trigger captures_preserve_source before update on public.captures
for each row execute function public.preserve_capture_source();

create table public.operation_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  operation_id text not null,
  operation_version integer not null default 1 check (operation_version > 0),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_type text not null default 'user' check (actor_type in ('user', 'assistant', 'automation', 'support', 'system')),
  surface text not null check (surface in ('ui', 'chat', 'mcp', 'automation', 'system')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  risk_class text not null check (risk_class in ('read', 'low', 'medium', 'high')),
  target_type text,
  target_id uuid,
  status text not null check (status in ('succeeded', 'failed', 'reversed')),
  stable_error_code text,
  result_json jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  unique (workspace_id, operation_id, idempotency_key)
);
create index operation_receipts_workspace_idx on public.operation_receipts (workspace_id, created_at desc);

create table public.activity_events (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null,
  surface text not null,
  operation_id text not null,
  target_type text,
  target_id uuid,
  risk_class text not null,
  approval_state text,
  outcome text not null,
  created_at timestamptz not null default now()
);
create index activity_events_workspace_idx on public.activity_events (workspace_id, created_at desc);

create or replace function public.create_workspace_for_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.workspaces (owner_user_id)
  values (new.id)
  on conflict (owner_user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_workspace_for_user() from public, anon, authenticated;

drop trigger if exists planner_create_workspace on auth.users;
create trigger planner_create_workspace after insert on auth.users
for each row execute function public.create_workspace_for_user();

insert into public.workspaces (owner_user_id)
select id from auth.users
on conflict (owner_user_id) do nothing;

do $$
begin
  if to_regclass('public.legacy_visions') is not null then
    insert into public.visions (id, workspace_id, body_markdown, created_at, updated_at, archived_at)
    select lv.id, w.id, lv.content, lv.created_at, lv.updated_at, lv.deleted_at
    from public.legacy_visions lv
    join public.workspaces w on w.owner_user_id = lv.user_id
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.legacy_yearly_goals') is not null then
    insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
    select distinct w.id, 'year', date_trunc('year', g.created_at at time zone 'UTC')::date,
      (date_trunc('year', g.created_at at time zone 'UTC') + interval '1 year - 1 day')::date, w.timezone
    from public.legacy_yearly_goals g join public.workspaces w on w.owner_user_id = g.user_id
    on conflict (workspace_id, kind, starts_on) do nothing;

    insert into public.goals (id, workspace_id, vision_id, horizon_id, title, status, created_at, updated_at, archived_at)
    select g.id, w.id, g.vision_id, h.id, g.content,
      case g.status::text when 'completed' then 'achieved' when 'in_progress' then 'active' else 'draft' end,
      g.created_at, g.updated_at, g.deleted_at
    from public.legacy_yearly_goals g
    join public.workspaces w on w.owner_user_id = g.user_id
    join public.planning_horizons h on h.workspace_id = w.id and h.kind = 'year'
      and h.starts_on = date_trunc('year', g.created_at at time zone 'UTC')::date
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.legacy_quarterly_goals') is not null then
    insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
    select distinct w.id, 'quarter', date_trunc('quarter', g.created_at at time zone 'UTC')::date,
      (date_trunc('quarter', g.created_at at time zone 'UTC') + interval '3 months - 1 day')::date, w.timezone
    from public.legacy_quarterly_goals g join public.workspaces w on w.owner_user_id = g.user_id
    on conflict (workspace_id, kind, starts_on) do nothing;

    insert into public.goals (id, workspace_id, vision_id, horizon_id, parent_goal_id, title, status, created_at, updated_at, archived_at)
    select g.id, w.id, parent.vision_id, h.id, g.yearly_id, g.content,
      case g.status::text when 'completed' then 'achieved' when 'in_progress' then 'active' else 'draft' end,
      g.created_at, g.updated_at, g.deleted_at
    from public.legacy_quarterly_goals g
    join public.workspaces w on w.owner_user_id = g.user_id
    join public.goals parent on parent.id = g.yearly_id and parent.workspace_id = w.id
    join public.planning_horizons h on h.workspace_id = w.id and h.kind = 'quarter'
      and h.starts_on = date_trunc('quarter', g.created_at at time zone 'UTC')::date
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.legacy_monthly_tasks') is not null then
    insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
    select distinct w.id, 'month', date_trunc('month', a.created_at at time zone 'UTC')::date,
      (date_trunc('month', a.created_at at time zone 'UTC') + interval '1 month - 1 day')::date, w.timezone
    from public.legacy_monthly_tasks a join public.workspaces w on w.owner_user_id = a.user_id
    on conflict (workspace_id, kind, starts_on) do nothing;

    insert into public.actions (id, workspace_id, goal_id, horizon_id, title, status, completed_at, created_at, updated_at, archived_at)
    select a.id, w.id, a.quarterly_id, h.id, a.content,
      case a.status::text when 'completed' then 'done' when 'in_progress' then 'in_progress' else 'open' end,
      case when a.status::text = 'completed' then a.updated_at else null end,
      a.created_at, a.updated_at, a.deleted_at
    from public.legacy_monthly_tasks a
    join public.workspaces w on w.owner_user_id = a.user_id
    join public.goals g on g.id = a.quarterly_id and g.workspace_id = w.id
    join public.planning_horizons h on h.workspace_id = w.id and h.kind = 'month'
      and h.starts_on = date_trunc('month', a.created_at at time zone 'UTC')::date
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.legacy_weekly_actions') is not null then
    insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
    select distinct w.id, 'week', date_trunc('week', a.created_at at time zone 'UTC')::date,
      (date_trunc('week', a.created_at at time zone 'UTC') + interval '6 days')::date, w.timezone
    from public.legacy_weekly_actions a join public.workspaces w on w.owner_user_id = a.user_id
    on conflict (workspace_id, kind, starts_on) do nothing;

    insert into public.actions (id, workspace_id, goal_id, parent_action_id, horizon_id, title, status, completed_at, created_at, updated_at, archived_at)
    select a.id, w.id, monthly.goal_id, monthly.id, h.id, a.content,
      case a.status::text when 'completed' then 'done' when 'in_progress' then 'in_progress' else 'open' end,
      case when a.status::text = 'completed' then a.updated_at else null end,
      a.created_at, a.updated_at, a.deleted_at
    from public.legacy_weekly_actions a
    join public.workspaces w on w.owner_user_id = a.user_id
    join public.actions monthly on monthly.id = a.monthly_id and monthly.workspace_id = w.id
    join public.planning_horizons h on h.workspace_id = w.id and h.kind = 'week'
      and h.starts_on = date_trunc('week', a.created_at at time zone 'UTC')::date
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.legacy_transcripts') is not null then
    insert into public.captures (id, workspace_id, raw_text, source, created_at, archived_at)
    select t.id, w.id, t.raw_text, 'typed', t.created_at, t.deleted_at
    from public.legacy_transcripts t join public.workspaces w on w.owner_user_id = t.user_id
    on conflict (id) do nothing;
  end if;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
create policy workspaces_select_owner on public.workspaces for select to authenticated
using (owner_user_id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'planning_horizons', 'visions', 'goals', 'actions', 'captures',
    'operation_receipts', 'activity_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (workspace_id in (select id from public.workspaces where owner_user_id = auth.uid()))',
      table_name || '_select_owner', table_name
    );
  end loop;
end;
$$;

revoke all on public.workspaces, public.planning_horizons, public.visions, public.goals,
  public.actions, public.captures, public.operation_receipts, public.activity_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.workspaces,
  public.planning_horizons, public.visions, public.goals, public.actions, public.captures,
  public.operation_receipts, public.activity_events from authenticated;
grant select on public.workspaces, public.planning_horizons, public.visions, public.goals,
  public.actions, public.captures, public.operation_receipts, public.activity_events to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'legacy_visions', 'legacy_yearly_goals', 'legacy_quarterly_goals',
    'legacy_monthly_tasks', 'legacy_weekly_actions', 'legacy_transcripts'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('revoke all on public.%I from anon, authenticated', table_name);
    end if;
  end loop;
end;
$$;

commit;
