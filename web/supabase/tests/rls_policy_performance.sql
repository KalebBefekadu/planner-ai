begin;
select plan(1);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and regexp_replace(
        coalesce(qual, '') || ' ' || coalesce(with_check, ''),
        '[(][[:space:]]*select[[:space:]]+auth[.]uid[(][)][^)]*[)]',
        '',
        'gi'
      ) ~ 'auth[.]uid[(][)]'
  ),
  0,
  'RLS policies cache auth.uid() once per query'
);

select * from finish();
rollback;
