begin;

create table public.account_deletion_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'canceled', 'completed')),
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  canceled_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);
create unique index one_active_account_deletion_per_user
on public.account_deletion_requests (user_id)
where user_id is not null and status in ('scheduled', 'processing');
create index account_deletion_due_idx
on public.account_deletion_requests (scheduled_for)
where status = 'scheduled';
create trigger account_deletion_set_updated_at
before update on public.account_deletion_requests
for each row execute function public.set_updated_at();
alter table public.account_deletion_requests enable row level security;
create policy account_deletion_owner_select on public.account_deletion_requests
for select to authenticated using (user_id = auth.uid());
revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;
grant select, update on public.account_deletion_requests to service_role;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('account.deletion.schedule.v1', 'high', array['ui'], true),
  ('account.deletion.cancel.v1', 'low', array['ui'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_account_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text,
  p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_request public.account_deletion_requests%rowtype;
  v_result jsonb;
  v_risk text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('account.deletion.schedule.v1', 'account.deletion.cancel.v1')
    or p_surface <> 'ui'
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || 'account-deletion', 0));
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  if p_operation_id = 'account.deletion.schedule.v1' then
    if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
      raise exception using errcode = '42501', message = 'aal2_required';
    end if;
    if p_input ->> 'confirmation' <> 'DELETE MY ACCOUNT' then
      raise exception using errcode = 'P0001', message = 'confirmation_required';
    end if;
    select * into v_request from public.account_deletion_requests
    where user_id = v_user_id and status in ('scheduled', 'processing')
    order by requested_at desc limit 1;
    if not found then
      insert into public.account_deletion_requests (
        user_id, workspace_id, status, scheduled_for
      ) values (
        v_user_id, v_workspace_id, 'scheduled', clock_timestamp() + interval '7 days'
      ) returning * into v_request;
    end if;
    update public.mcp_access_tokens set revoked_at = coalesce(revoked_at, clock_timestamp())
    where owner_user_id = v_user_id and revoked_at is null;
    update public.mcp_oauth_grants set revoked_at = coalesce(revoked_at, clock_timestamp())
    where owner_user_id = v_user_id and revoked_at is null;
    v_risk := 'high';
  else
    update public.account_deletion_requests set
      status = 'canceled', canceled_at = clock_timestamp(), last_error_code = null
    where id = (p_input ->> 'requestId')::uuid and user_id = v_user_id
      and status = 'scheduled' and scheduled_for > clock_timestamp()
    returning * into v_request;
    if not found then
      raise exception using errcode = 'P0001', message = 'deletion_not_cancellable';
    end if;
    v_risk := 'low';
  end if;

  v_result := jsonb_build_object(
    'requestId', v_request.id,
    'status', v_request.status,
    'scheduledFor', case when v_request.status = 'scheduled' then v_request.scheduled_for else null end
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id, 'user', 'ui',
    p_idempotency_key, v_risk, 'account_deletion', v_request.id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', 'ui', p_operation_id,
    'account_deletion', v_request.id, v_risk, 'explicit_ui_commit', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

create or replace function public.dispatch_trusted_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text,
  p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
    raise exception using errcode = 'P0001', message = 'invalid_operation_surface';
  end if;
  perform 1 from public.operation_contracts
  where operation_id = p_operation_id and p_surface = any(exposures);
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;
  if p_operation_id like 'account.%' then
    v_result := public.execute_account_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id in ('action.update.v1', 'daily-focus.set.v1') then
    v_result := public.execute_daily_execution_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id like 'workspace.%' then
    v_result := public.execute_workspace_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id in (
    'note.goal-link.v1', 'note.goal-unlink.v1',
    'note.action-link.v1', 'note.action-unlink.v1'
  ) then
    v_result := public.execute_note_relation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id like 'review.%' then
    v_result := public.execute_review_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ) then
    v_result := public.execute_knowledge_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'note.%' then
    v_result := public.execute_note_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'memory.%' then
    v_result := public.execute_memory_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'trash.%' then
    v_result := public.execute_trash_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  else
    v_result := public.execute_planner_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;
  return v_result;
end;
$$;

revoke all on function public.execute_account_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
