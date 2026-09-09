begin;
select plan(13);

-- A monthly recurrence anchored at month end used to skip a month, and then,
-- once clamping stopped the skip, to settle on the shorter day forever: from
-- 31 January the series ran 28 February, 28 March, 28 April. The day the
-- person chose has to survive a short month, so it is stored on the template
-- and passed in rather than read back out of the previous occurrence.

select has_function(
  'public', 'next_monthly_occurrence', array['date', 'integer'],
  'the monthly advance takes the chosen day of month, not just the last date'
);
select function_privs_are(
  'public', 'next_monthly_occurrence', array['date', 'integer'],
  'authenticated', array[]::text[], 'the advance helper stays private'
);
select has_column(
  'public', 'action_templates', 'monthly_anchor_day',
  'a monthly template remembers the day of month it was set for'
);

select is(
  public.next_monthly_occurrence('2026-01-31', 31), '2026-02-28'::date,
  'a recurrence on the 31st keeps February instead of skipping it'
);
select is(
  public.next_monthly_occurrence('2026-03-31', 31), '2026-04-30'::date,
  'a 31-day month followed by a 30-day month clamps rather than overshoots'
);
select is(
  public.next_monthly_occurrence('2024-01-31', 31), '2024-02-29'::date,
  'a leap February keeps its extra day'
);
select is(
  public.next_monthly_occurrence('2026-01-15', 15), '2026-02-15'::date,
  'a mid-month recurrence is untouched'
);
select is(
  public.next_monthly_occurrence('2023-12-31', 31), '2024-01-31'::date,
  'the series crosses a year boundary on the same day'
);

-- The point of the anchor: February shortens one occurrence and nothing more.
select is(
  public.next_monthly_occurrence(
    public.next_monthly_occurrence('2026-01-31', 31), 31),
  '2026-03-31'::date,
  'the occurrence after a clamped one returns to the chosen day'
);
select is(
  public.next_monthly_occurrence(
    public.next_monthly_occurrence(
      public.next_monthly_occurrence('2026-01-31', 31), 31), 31),
  '2026-04-30'::date,
  'a 30-day month clamps once without moving the series'
);
select is(
  public.next_monthly_occurrence(
    public.next_monthly_occurrence(
      public.next_monthly_occurrence(
        public.next_monthly_occurrence('2026-01-31', 31), 31), 31), 31),
  '2026-05-31'::date,
  'five months in, the last-day-of-month recurrence is still on the 31st'
);
select is(
  public.next_monthly_occurrence('2026-02-28', 28), '2026-03-28'::date,
  'someone who genuinely chose the 28th stays on the 28th'
);

-- Without an anchor the helper can only fall back to the date it is given,
-- which is exactly the drift this ticket removed; the fallback exists so a
-- weekly template's null anchor can never raise.
select is(
  public.next_monthly_occurrence('2026-02-28', null), '2026-03-28'::date,
  'a missing anchor falls back to the day of the occurrence rather than failing'
);

select * from finish();
rollback;
