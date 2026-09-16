-- Completing a period that is already complete is refused by a unique index,
-- and the executor's exception handler turns every constraint violation into
-- `invalid_input`. A person who reloads a finished review and presses the
-- button again is told "check this change and try again", which describes
-- nothing they did and suggests nothing they can do.
--
-- The database is the only place that knows the difference between a
-- duplicate submission and genuinely invalid input, so it says so here rather
-- than leaving the interface to guess from a generic failure.

begin;

create or replace function public.raise_if_period_already_reviewed(
  p_workspace_id uuid,
  p_horizon_id uuid,
  p_kind text
) returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.reviews
    where workspace_id = p_workspace_id
      and horizon_id = p_horizon_id
      and kind = p_kind
      and status = 'completed'
  ) then
    raise exception using errcode = 'P0001', message = 'review_already_completed';
  end if;
end;
$$;

revoke all on function public.raise_if_period_already_reviewed(uuid, uuid, text)
from public, anon, authenticated, service_role;

commit;
