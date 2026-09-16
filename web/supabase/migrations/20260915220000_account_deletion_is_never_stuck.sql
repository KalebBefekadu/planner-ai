-- A scheduled account deletion can no longer get stuck.
--
-- The worker claimed a request by flipping it to `processing`, then deleted the
-- Auth user, then wrote `completed`. Both the success path and the handled
-- failure path release the claim. Nothing released it if the process stopped
-- between them -- a timeout, a deploy, a function killed mid-execution, or
-- `deleteUser` throwing rather than returning an error.
--
-- The cron only ever selected `status = 'scheduled'`, so a row left in
-- `processing` was never looked at again. `processing_started_at` was recorded
-- and never read. Verified against the live database: a request stuck in
-- `processing` for six hours is invisible to the query the worker runs.
--
-- That is the worst job in the system to lose. Somebody asked to be deleted and
-- the request simply stops, with nothing failing and nothing saying so.
--
-- The model this needs already exists in this schema.
-- `notification_email_deliveries` has attempt counting, a `claimed_at`
-- visibility timeout and `next_attempt_at` backoff, and claims atomically in a
-- single statement. Rather than invent a second job model, this gives account
-- deletion the same one.
--
-- One deliberate difference: notifications stop after five attempts, which is
-- right for an email. **Attempts are not capped here.** Abandoning a deletion
-- request is a decision about what the product owes a person, not a technical
-- default, so this retries with a widening backoff and records `attempt_count`
-- so a stalled request is visible rather than silently dropped.

begin;

alter table public.account_deletion_requests
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column next_attempt_at timestamptz;

-- Claims due work, and reclaims anything a dead worker left behind. One
-- statement, so two overlapping runs cannot claim the same request;
-- `skip locked` lets the second run take other work instead of waiting.
create function public.claim_account_deletion_batch(p_limit integer)
returns table (deletion_request_id uuid, deletion_user_id uuid, deletion_attempt_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_deletion_batch_limit';
  end if;

  return query
  update public.account_deletion_requests request
  set status = 'processing',
    processing_started_at = clock_timestamp(),
    attempt_count = request.attempt_count + 1,
    updated_at = clock_timestamp()
  where request.id in (
    select candidate.id from public.account_deletion_requests candidate
    where candidate.user_id is not null
      and candidate.scheduled_for <= clock_timestamp()
      and (
        (candidate.status = 'scheduled' and (
          candidate.next_attempt_at is null
          or candidate.next_attempt_at <= clock_timestamp()
        ))
        -- The visibility timeout. A request still `processing` after fifteen
        -- minutes belongs to a worker that is not coming back.
        or (candidate.status = 'processing'
          and candidate.processing_started_at <= clock_timestamp() - interval '15 minutes')
      )
    order by candidate.scheduled_for
    limit p_limit
    for update skip locked
  )
  returning request.id, request.user_id, request.attempt_count;
end;
$$;

-- Hands a claim back after a failure the worker saw, with a backoff that widens
-- so a request that cannot succeed is not retried every minute forever.
create function public.release_account_deletion(p_request_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.account_deletion_requests request
  set status = 'scheduled',
    processing_started_at = null,
    last_error_code = p_error_code,
    -- 4 minutes, 16, 64, then hours, levelling off around seventeen.
    next_attempt_at = clock_timestamp()
      + (interval '1 minute' * power(4, least(request.attempt_count, 5))),
    updated_at = clock_timestamp()
  where request.id = p_request_id and request.status = 'processing';
end;
$$;

create function public.complete_account_deletion(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.account_deletion_requests request
  set status = 'completed',
    completed_at = clock_timestamp(),
    last_error_code = null,
    next_attempt_at = null,
    updated_at = clock_timestamp()
  where request.id = p_request_id and request.status = 'processing';
end;
$$;

revoke all on function public.claim_account_deletion_batch(integer)
from public, anon, authenticated;
grant execute on function public.claim_account_deletion_batch(integer) to service_role;

revoke all on function public.release_account_deletion(uuid, text)
from public, anon, authenticated;
grant execute on function public.release_account_deletion(uuid, text) to service_role;

revoke all on function public.complete_account_deletion(uuid)
from public, anon, authenticated;
grant execute on function public.complete_account_deletion(uuid) to service_role;

commit;
