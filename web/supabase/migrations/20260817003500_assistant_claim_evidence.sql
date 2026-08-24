begin;

alter table public.conversation_messages
add column claims jsonb not null default '[]'::jsonb
check (jsonb_typeof(claims) = 'array' and jsonb_array_length(claims) <= 8);

create or replace function public.record_assistant_turn(
  p_conversation_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_route text,
  p_proposal jsonb,
  p_model_id text,
  p_prompt_version text,
  p_sources jsonb,
  p_claims jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
  v_claim jsonb;
  v_reference jsonb;
  v_claim_seen text[];
  v_reference_key text;
  v_key_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_claims is null or jsonb_typeof(p_claims) <> 'array'
    or jsonb_array_length(p_claims) > 8 then
    raise exception using errcode = 'P0001', message = 'invalid_assistant_claims';
  end if;

  for v_claim in select value from jsonb_array_elements(p_claims)
  loop
    select count(*) into v_key_count from jsonb_object_keys(v_claim);
    if jsonb_typeof(v_claim) <> 'object' or v_key_count <> 3
      or not (v_claim ?& array['text', 'status', 'evidence'])
      or char_length(trim(coalesce(v_claim ->> 'text', ''))) not between 1 and 500
      or coalesce(v_claim ->> 'status', '') not in ('supported', 'inferred', 'needs_input')
      or jsonb_typeof(v_claim -> 'evidence') <> 'array'
      or jsonb_array_length(v_claim -> 'evidence') > 4
      or (v_claim ->> 'status' = 'supported' and jsonb_array_length(v_claim -> 'evidence') = 0)
      or (v_claim ->> 'status' = 'needs_input' and jsonb_array_length(v_claim -> 'evidence') <> 0) then
      raise exception using errcode = 'P0001', message = 'invalid_assistant_claims';
    end if;

    v_claim_seen := array[]::text[];
    for v_reference in select value from jsonb_array_elements(v_claim -> 'evidence')
    loop
      select count(*) into v_key_count from jsonb_object_keys(v_reference);
      v_reference_key := coalesce(v_reference ->> 'type', '') || ':' || coalesce(v_reference ->> 'id', '');
      if jsonb_typeof(v_reference) <> 'object' or v_key_count <> 2
        or not (v_reference ?& array['type', 'id'])
        or coalesce(v_reference ->> 'type', '') not in ('vision', 'goal', 'action', 'note', 'memory')
        or v_reference_key = any(v_claim_seen)
        or not exists (
          select 1 from jsonb_array_elements(p_sources) source
          where source ->> 'type' = v_reference ->> 'type'
            and source ->> 'id' = v_reference ->> 'id'
        ) then
        raise exception using errcode = 'P0001', message = 'invalid_assistant_claims';
      end if;
      v_claim_seen := array_append(v_claim_seen, v_reference_key);
    end loop;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':assistant-turn', 0));
  v_result := public.record_assistant_turn(
    p_conversation_id, p_user_content, p_assistant_content, p_route,
    p_proposal, p_model_id, p_prompt_version, p_sources
  );

  update public.conversation_messages message
  set claims = p_claims
  where message.id = (
    select candidate.id from public.conversation_messages candidate
    where candidate.conversation_id = (v_result ->> 'conversationId')::uuid
      and candidate.role = 'assistant'
    order by candidate.created_at desc, candidate.id desc
    limit 1
  );
  if not found then
    raise exception using errcode = 'P0001', message = 'assistant_message_not_found';
  end if;
  return v_result;
exception
  when data_exception then
    raise exception using errcode = 'P0001', message = 'invalid_assistant_claims';
end;
$$;

revoke all on function public.record_assistant_turn(
  uuid, text, text, text, jsonb, text, text, jsonb, jsonb
) from public, anon;
grant execute on function public.record_assistant_turn(
  uuid, text, text, text, jsonb, text, text, jsonb, jsonb
) to authenticated;

commit;
