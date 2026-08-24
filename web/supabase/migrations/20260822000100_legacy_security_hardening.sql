begin;

do $$
begin
  if to_regprocedure('public.update_updated_at_column()') is not null then
    alter function public.update_updated_at_column() set search_path = pg_catalog;
  end if;

  if to_regprocedure('public.rls_auto_enable()') is not null then
    alter function public.rls_auto_enable() set search_path = pg_catalog;
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

commit;
