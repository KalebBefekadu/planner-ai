-- RLS policies are evaluated for every visible row. Wrap auth.uid() in a
-- scalar subquery so Postgres initializes the authenticated identity once per
-- query without changing ownership semantics.
do $$
declare
  policy record;
  expression text;
begin
  for policy in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ~ 'auth[.]uid[(][)]'
        or coalesce(with_check, '') ~ 'auth[.]uid[(][)]'
      )
  loop
    if policy.qual is not null then
      expression := regexp_replace(
        policy.qual,
        'auth[.]uid[(][)]',
        '(select auth.uid())',
        'g'
      );
      execute format(
        'alter policy %I on %I.%I using (%s)',
        policy.policyname,
        policy.schemaname,
        policy.tablename,
        expression
      );
    end if;

    if policy.with_check is not null then
      expression := regexp_replace(
        policy.with_check,
        'auth[.]uid[(][)]',
        '(select auth.uid())',
        'g'
      );
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        policy.policyname,
        policy.schemaname,
        policy.tablename,
        expression
      );
    end if;
  end loop;
end;
$$;
