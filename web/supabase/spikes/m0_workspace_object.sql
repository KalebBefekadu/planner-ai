begin;

create schema planner_m0;

create table planner_m0.source_objects (
  id uuid not null,
  workspace_id uuid not null,
  kind text not null,
  parent_object_id uuid,
  created_by uuid not null,
  schema_version integer not null,
  revision bigint not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  source_table text not null
);

insert into planner_m0.source_objects (
  id, workspace_id, kind, parent_object_id, created_by, schema_version,
  revision, created_at, updated_at, deleted_at, source_table
)
select v.id, v.workspace_id, 'vision', null, w.owner_user_id, 1,
  v.version, v.created_at, v.updated_at, v.trashed_at, 'visions'
from public.visions v join public.workspaces w on w.id = v.workspace_id
union all
select g.id, g.workspace_id, 'goal', coalesce(g.parent_goal_id, g.vision_id), w.owner_user_id, 1,
  g.version, g.created_at, g.updated_at, g.trashed_at, 'goals'
from public.goals g join public.workspaces w on w.id = g.workspace_id
union all
select a.id, a.workspace_id, 'action', coalesce(a.parent_action_id, a.goal_id), w.owner_user_id, 1,
  a.version, a.created_at, a.updated_at, a.trashed_at, 'actions'
from public.actions a join public.workspaces w on w.id = a.workspace_id
union all
select c.id, c.workspace_id, 'capture', null, w.owner_user_id, 1,
  1, c.created_at, c.created_at, c.trashed_at, 'captures'
from public.captures c join public.workspaces w on w.id = c.workspace_id
union all
select n.id, n.workspace_id, 'note', n.parent_note_id, w.owner_user_id, 1,
  n.version, n.created_at, n.updated_at, n.trashed_at, 'notes'
from public.notes n join public.workspaces w on w.id = n.workspace_id
union all
select m.id, m.workspace_id, 'memory', null, w.owner_user_id, 1,
  m.version, m.created_at, m.updated_at, m.trashed_at, 'memories'
from public.memories m join public.workspaces w on w.id = m.workspace_id
union all
select c.id, c.workspace_id, 'conversation', null, w.owner_user_id, 1,
  1, c.created_at, c.updated_at, c.trashed_at, 'conversations'
from public.conversations c join public.workspaces w on w.id = c.workspace_id
union all
select r.id, r.workspace_id, 'review', null, w.owner_user_id, 1,
  r.version, r.created_at, r.updated_at, null, 'reviews'
from public.reviews r join public.workspaces w on w.id = r.workspace_id
union all
select h.id, h.workspace_id, 'planning_horizon', null, w.owner_user_id, 1,
  1, h.created_at, h.created_at, null, 'planning_horizons'
from public.planning_horizons h join public.workspaces w on w.id = h.workspace_id;

do $$
begin
  if exists (
    select id from planner_m0.source_objects group by id having count(*) > 1
  ) then
    raise exception using message = 'workspace_object_id_collision';
  end if;
end;
$$;

create table planner_m0.workspace_objects (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (
    kind in (
      'vision', 'goal', 'action', 'capture', 'note', 'memory',
      'conversation', 'review', 'planning_horizon'
    )
  ),
  parent_object_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  schema_version integer not null check (schema_version > 0),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  unique (id, workspace_id),
  foreign key (parent_object_id, workspace_id)
    references planner_m0.workspace_objects(id, workspace_id)
    deferrable initially deferred,
  check (parent_object_id is null or parent_object_id <> id)
);

insert into planner_m0.workspace_objects
select
  id, workspace_id, kind, parent_object_id, created_by, schema_version,
  revision, created_at, updated_at, deleted_at
from planner_m0.source_objects;

set constraints all immediate;

create table planner_m0.source_documents (
  object_id uuid primary key,
  workspace_id uuid not null,
  body_markdown text not null,
  source_table text not null
);

insert into planner_m0.source_documents (object_id, workspace_id, body_markdown, source_table)
select id, workspace_id, body_markdown, 'visions' from public.visions
union all
select id, workspace_id, coalesce(description_markdown, ''), 'goals' from public.goals
union all
select id, workspace_id, coalesce(description_markdown, ''), 'actions' from public.actions
union all
select id, workspace_id, body_markdown, 'notes' from public.notes
union all
select id, workspace_id, reflection_markdown, 'reviews' from public.reviews;

create table planner_m0.object_documents (
  object_id uuid primary key,
  workspace_id uuid not null,
  body_markdown text not null,
  semantic_format text not null default 'planner-markdown-v1'
    check (semantic_format = 'planner-markdown-v1'),
  foreign key (object_id, workspace_id)
    references planner_m0.workspace_objects(id, workspace_id) on delete cascade
);

insert into planner_m0.object_documents (object_id, workspace_id, body_markdown)
select object_id, workspace_id, body_markdown from planner_m0.source_documents;

do $$
declare
  source_count bigint;
  object_count bigint;
begin
  select count(*) into source_count from planner_m0.source_objects;
  select count(*) into object_count from planner_m0.workspace_objects;
  if source_count <> object_count then
    raise exception using message = 'workspace_object_count_mismatch';
  end if;

  if exists (
    select 1
    from planner_m0.workspace_objects child
    join planner_m0.workspace_objects parent on parent.id = child.parent_object_id
    where child.workspace_id <> parent.workspace_id
  ) then
    raise exception using message = 'cross_workspace_parent';
  end if;

  if exists (
    select 1
    from planner_m0.workspace_objects child
    join planner_m0.workspace_objects parent on parent.id = child.parent_object_id
    where (child.kind = 'note' and parent.kind <> 'note')
      or (child.kind = 'goal' and parent.kind not in ('goal', 'vision'))
      or (child.kind = 'action' and parent.kind not in ('action', 'goal'))
      or child.kind not in ('note', 'goal', 'action')
  ) then
    raise exception using message = 'invalid_containment_kind';
  end if;

  if exists (
    (select object_id, workspace_id, body_markdown from planner_m0.source_documents
     except
     select object_id, workspace_id, body_markdown from planner_m0.object_documents)
    union all
    (select object_id, workspace_id, body_markdown from planner_m0.object_documents
     except
     select object_id, workspace_id, body_markdown from planner_m0.source_documents)
  ) then
    raise exception using message = 'document_content_mismatch';
  end if;

  if exists (
    select 1
    from planner_m0.workspace_objects object
    join planner_m0.source_objects source using (id, workspace_id)
    where object.kind <> source.kind
      or object.revision <> source.revision
      or object.created_by <> source.created_by
      or object.deleted_at is distinct from source.deleted_at
  ) then
    raise exception using message = 'workspace_object_attribute_mismatch';
  end if;
end;
$$;

select jsonb_build_object(
  'status', 'passed',
  'workspace_objects', (select count(*) from planner_m0.workspace_objects),
  'object_documents', (select count(*) from planner_m0.object_documents),
  'kinds', (
    select jsonb_object_agg(kind, object_count order by kind)
    from (
      select kind, count(*) as object_count
      from planner_m0.workspace_objects
      group by kind
    ) counts
  )
) as m0_workspace_object_result;

rollback;

select to_regnamespace('planner_m0') is null as prototype_rolled_back;
