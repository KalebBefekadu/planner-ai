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
end;
$$;

commit;
