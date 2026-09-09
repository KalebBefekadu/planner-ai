begin;
select plan(8);

-- A monthly recurrence anchored at month end used to skip a month. Adding
-- "day-of-month minus one" days to the first of the next month walks off the
-- end of a short month: from 31 January it landed on 3 March, so February
-- never happened at all.

select has_function(
  'public', 'next_monthly_occurrence', array['date'],
  'the monthly advance is named rather than inlined'
);
select function_privs_are(
  'public', 'next_monthly_occurrence', array['date'],
  'authenticated', array[]::text[], 'the advance helper stays private'
);

select is(
  public.next_monthly_occurrence('2026-01-31'), '2026-02-28'::date,
  'a recurrence on the 31st keeps February instead of skipping it'
);
select is(
  public.next_monthly_occurrence('2026-03-31'), '2026-04-30'::date,
  'a 31-day month followed by a 30-day month clamps rather than overshoots'
);
select is(
  public.next_monthly_occurrence('2024-01-31'), '2024-02-29'::date,
  'a leap February keeps its extra day'
);
select is(
  public.next_monthly_occurrence('2026-01-15'), '2026-02-15'::date,
  'a mid-month recurrence is untouched'
);
select is(
  public.next_monthly_occurrence('2023-12-31'), '2024-01-31'::date,
  'the series crosses a year boundary on the same day'
);

-- The template records only its next occurrence, so a clamped date becomes
-- the anchor for the one after it and the series settles on the shorter day.
-- This is recorded rather than hidden: it is the remaining half of the
-- problem, and fixing it needs an anchor day the template does not store.
select is(
  public.next_monthly_occurrence(public.next_monthly_occurrence('2026-01-31')),
  '2026-03-28'::date,
  'a clamped occurrence anchors the next one, so the series drifts to the shorter day'
);

select * from finish();
rollback;
