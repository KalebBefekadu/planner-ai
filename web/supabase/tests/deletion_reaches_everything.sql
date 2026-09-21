begin;
select plan(5);

/* Deleting an account deletes one row: the `auth.users` record. Everything
   else goes because it cascades, directly or through a parent that does.
   `account-deletions` calls `auth.admin.deleteUser` and nothing else, so the
   cascade graph is not an implementation detail of deletion -- it is the whole
   of it.

   Which means a table added without a cascading path to a workspace keeps its
   rows after the person who owns them has asked to be forgotten, and nothing
   anywhere says so. This file is the thing that says so.

   Exemptions are listed with their reason, the way the export scope and the
   bounded-read allowlists are, so that "nobody thought about it" cannot be
   mistaken for "someone decided". */

create temporary table deletion_exempt (table_name text primary key, reason text not null);
insert into deletion_exempt (table_name, reason) values
  (
    'account_deletion_requests',
    'The record of the deletion itself. It has to outlive the user it deletes, or nothing can report that the request completed; its user and workspace columns are set null instead.'
  ),
  (
    'lifecycle_job_runs',
    'The background job log. It is about this deployment, holds no workspace content, and has no foreign key to a person.'
  ),
  (
    'operation_contracts',
    'The Operation manifest, written by migrations rather than by a person. It describes the build, not the owner.'
  ),
  (
    'operation_undo_support',
    'Undo strategies per Operation, written by migrations. Same reason as operation_contracts, which it hangs off.'
  ),
  (
    'beta_invites',
    'Invite codes. No application code reads or writes this table today; if it is ever used, intended_email is third-party personal data and this exemption needs revisiting rather than renewing.'
  );

-- Every table reachable from a workspace or a user by cascading deletes,
-- following the chain rather than only the first hop: mcp_usage_windows goes
-- because mcp_access_tokens goes, and that is a real path.
create temporary view deletion_covered as
with recursive roots as (
  select c.oid
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'workspaces'
  union all
  select c.oid
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users'
),
reached as (
  select r.oid from roots r
  union
  select con.conrelid
  from pg_constraint con
  join reached p on p.oid = con.confrelid
  where con.contype = 'f' and con.confdeltype = 'c'
)
select c.relname::text as table_name, (c.oid in (select oid from reached)) as covered
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- The chain hangs off this one edge. If workspaces stopped cascading from the
-- user, every assertion below would still pass and delete nothing.
select is(
  (select con.confdeltype::text
   from pg_constraint con
   where con.conrelid = 'public.workspaces'::regclass
     and con.contype = 'f'
     and con.confrelid = 'auth.users'::regclass),
  'c',
  'a workspace goes when the person who owns it does'
);

-- Guards the recursion itself: a broken CTE would return nothing uncovered
-- and this file would quietly assert that everything is fine.
select cmp_ok(
  (select count(*)::integer from deletion_covered where covered),
  '>=', 45,
  'the cascade chain is actually being followed, not silently empty'
);

select is(
  (select coalesce(array_agg(table_name order by table_name), '{}')
   from deletion_covered
   where not covered
     and table_name not in (select table_name from deletion_exempt)),
  '{}'::text[],
  'every table is deleted with the account, or is recorded as deliberately not'
);

-- The other direction: an exemption for a table that now cascades anyway is a
-- decision about nothing, and reading it later would overstate what is kept.
select is(
  (select coalesce(array_agg(e.table_name order by e.table_name), '{}')
   from deletion_exempt e
   join deletion_covered d on d.table_name = e.table_name
   where d.covered),
  '{}'::text[],
  'no table is excused from deletion that the cascade already reaches'
);

select is(
  (select coalesce(array_agg(e.table_name order by e.table_name), '{}')
   from deletion_exempt e
   where not exists (select 1 from deletion_covered d where d.table_name = e.table_name)),
  '{}'::text[],
  'no exemption names a table the schema no longer has'
);

select * from finish();
rollback;
