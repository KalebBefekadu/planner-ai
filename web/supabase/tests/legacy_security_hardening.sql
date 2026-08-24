begin;

select plan(4);

select ok(
  to_regprocedure('public.update_updated_at_column()') is null
    or coalesce((select 'search_path=pg_catalog' = any(coalesce(proconfig, array[]::text[]))
      from pg_proc where oid = to_regprocedure('public.update_updated_at_column()')), false),
  'legacy timestamp trigger is absent or has a fixed search path'
);

select ok(
  to_regprocedure('public.rls_auto_enable()') is null
    or coalesce((select 'search_path=pg_catalog' = any(coalesce(proconfig, array[]::text[]))
      from pg_proc where oid = to_regprocedure('public.rls_auto_enable()')), false),
  'RLS event-trigger helper is absent or has a fixed search path'
);

select ok(
  to_regprocedure('public.rls_auto_enable()') is null
    or not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute'),
  'anonymous callers cannot execute the RLS event-trigger helper'
);

select ok(
  to_regprocedure('public.rls_auto_enable()') is null
    or not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'),
  'authenticated callers cannot execute the RLS event-trigger helper'
);

select * from finish();
rollback;
