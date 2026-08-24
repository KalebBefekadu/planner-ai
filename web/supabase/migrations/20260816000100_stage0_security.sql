begin;

create extension if not exists pgcrypto with schema extensions;

create table public.beta_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  intended_email text,
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses between 1 and 100),
  uses integer not null default 0 check (uses between 0 and max_uses),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (intended_email is null or intended_email = lower(trim(intended_email)))
);

alter table public.beta_invites enable row level security;
alter table public.beta_invites force row level security;
revoke all on public.beta_invites from anon, authenticated;

create table public.ai_request_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('smart_goal', 'socratic', 'transcribe', 'assistant')),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, operation, window_started_at)
);

create index ai_request_windows_expiry_idx on public.ai_request_windows (window_started_at);
alter table public.ai_request_windows enable row level security;
alter table public.ai_request_windows force row level security;
revoke all on public.ai_request_windows from anon, authenticated;

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
  if v_user_id is null then
    return false;
  end if;

  v_limit := case p_operation
    when 'smart_goal' then 20
    when 'socratic' then 10
    when 'transcribe' then 8
    when 'assistant' then 30
    else 0
  end;
  if v_limit = 0 then
    return false;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.ai_request_windows (
    user_id, operation, window_started_at, request_count, updated_at
  ) values (
    v_user_id, p_operation, v_window_start, 1, clock_timestamp()
  )
  on conflict (user_id, operation, window_started_at)
  do update set
    request_count = public.ai_request_windows.request_count + 1,
    updated_at = clock_timestamp()
  where public.ai_request_windows.request_count < v_limit
  returning request_count into v_count;

  return v_count is not null;
end;
$$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;

create or replace function public.claim_beta_invite(p_email text, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invite_id uuid;
begin
  update public.beta_invites
  set uses = uses + 1
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > clock_timestamp()
    and uses < max_uses
    and (intended_email is null or intended_email = lower(trim(p_email)))
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;

create or replace function public.release_beta_invite(p_invite_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.beta_invites
  set uses = greatest(uses - 1, 0)
  where id = p_invite_id;
$$;

revoke all on function public.claim_beta_invite(text, text) from public, anon, authenticated;
revoke all on function public.release_beta_invite(uuid) from public, anon, authenticated;
grant execute on function public.claim_beta_invite(text, text) to service_role;
grant execute on function public.release_beta_invite(uuid) to service_role;

commit;
