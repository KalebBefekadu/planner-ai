begin;

alter table public.ai_request_windows drop constraint if exists ai_request_windows_operation_check;
alter table public.ai_request_windows add constraint ai_request_windows_operation_check
check (operation in ('smart_goal', 'socratic', 'transcribe', 'assistant'));

create or replace function public.consume_ai_quota(p_operation text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer;
  v_window_seconds integer := 60;
  v_window_start timestamptz;
  v_count integer;
begin
  if v_user_id is null then return false; end if;
  v_limit := case p_operation
    when 'smart_goal' then 20
    when 'socratic' then 10
    when 'transcribe' then 8
    when 'assistant' then 30
    else 0
  end;
  if v_limit = 0 then return false; end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );
  insert into public.ai_request_windows (
    user_id, operation, window_started_at, request_count, updated_at
  ) values (
    v_user_id, p_operation, v_window_start, 1, clock_timestamp()
  )
  on conflict (user_id, operation, window_started_at)
  do update set request_count = public.ai_request_windows.request_count + 1,
    updated_at = clock_timestamp()
  where public.ai_request_windows.request_count < v_limit
  returning request_count into v_count;
  return v_count is not null;
end;
$$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;

commit;
