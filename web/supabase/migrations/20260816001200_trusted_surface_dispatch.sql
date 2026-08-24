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
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  perform 1 from public.operation_contracts
  where operation_id = p_operation_id and 'ui' = any(exposures);
  if not found then
    raise exception using errcode = '42501', message = 'ui_operation_not_allowed';
  end if;

  if p_operation_id like 'review.%' then
    v_result := public.execute_review_operation(p_operation_id, p_input, p_idempotency_key, 'ui');
  elsif p_operation_id in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ) then
    v_result := public.execute_knowledge_operation(p_operation_id, p_input, p_idempotency_key, 'ui');
  elsif p_operation_id like 'note.%' then
    v_result := public.execute_note_operation(p_operation_id, p_input, p_idempotency_key, 'ui');
  elsif p_operation_id like 'memory.%' then
    v_result := public.execute_memory_operation(p_operation_id, p_input, p_idempotency_key, 'ui');
  elsif p_operation_id like 'trash.%' then
    v_result := public.execute_trash_operation(p_operation_id, p_input, p_idempotency_key, 'ui');
  else
    v_result := public.execute_planner_operation(p_operation_id, p_input, p_idempotency_key, 'ui');
  end if;
  return v_result;
end;
$$;

revoke all on function public.execute_ui_operation(text, jsonb, text) from public, anon;
grant execute on function public.execute_ui_operation(text, jsonb, text) to authenticated;

revoke execute on function public.execute_planner_operation(text, jsonb, text, text) from authenticated;
revoke execute on function public.execute_note_operation(text, jsonb, text, text) from authenticated;
revoke execute on function public.execute_memory_operation(text, jsonb, text, text) from authenticated;
revoke execute on function public.execute_trash_operation(text, jsonb, text, text) from authenticated;
revoke execute on function public.execute_knowledge_operation(text, jsonb, text, text) from authenticated;
revoke execute on function public.execute_review_operation(text, jsonb, text, text) from authenticated;

commit;
