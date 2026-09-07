-- A version conflict was reported to the person as a timeout.
--
-- Optimistic concurrency raises 'version_conflict_or_not_found' with SQLSTATE
-- 40001. That code means serialization_failure: a transient clash that is safe
-- to retry. PostgREST reads it that way and answers 504 with its own text,
-- "The upstream server is timing out", discarding the message entirely. The
-- application never saw which failure it was, so every conflict fell through to
-- the generic "Planner AI could not save this change", and the editor kept
-- retrying a write that could never succeed.
--
-- These conflicts are decisions, not transient clashes. Someone else changed
-- the record, an undo no longer matches what it would undo, an import job moved
-- on. Retrying cannot help; the person has to see what happened. They are
-- re-raised as P0001 so the message survives to the client. A genuine
-- serialization failure is left alone, because that one really is worth
-- retrying and must stay distinguishable.

begin;

create or replace function public.execute_ui_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
  v_existing_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  if p_operation_id = 'capture.create.v1' then
    select id into v_workspace_id
    from public.workspaces
    where owner_user_id = auth.uid();

    if v_workspace_id is not null then
      select result_json into v_existing_result
      from public.operation_receipts
      where workspace_id = v_workspace_id
        and operation_id = p_operation_id
        and idempotency_key = p_idempotency_key
        and status = 'succeeded';

      if found and (
        v_existing_result ->> 'raw_text' is distinct from p_input ->> 'rawText'
        or v_existing_result ->> 'source' is distinct from p_input ->> 'source'
      ) then
        raise exception using errcode = 'P0001', message = 'idempotency_payload_mismatch';
      end if;
    end if;
  end if;

  return public.dispatch_trusted_operation(
    p_operation_id,
    p_input,
    p_idempotency_key,
    'ui'
  );
exception
  when serialization_failure then
    if sqlerrm in (
      'version_conflict_or_not_found',
      'undo_conflict',
      'undo_not_available',
      'import_job_not_available',
      'review_action_set_changed'
    ) then
      raise exception using errcode = 'P0001', message = sqlerrm;
    end if;
    raise;
end;
$$;

commit;
