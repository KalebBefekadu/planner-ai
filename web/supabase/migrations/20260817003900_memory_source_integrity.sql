begin;

alter table public.memories
add constraint memories_source_shape_check check (
  (source_type = 'user' and source_id is null)
  or (source_type <> 'user' and source_id is not null)
) not valid;

create or replace function public.validate_memory_source()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.source_type = 'user' then
    if new.source_id is not null then
      raise exception using errcode = 'P0001', message = 'invalid_memory_source';
    end if;
    return new;
  end if;
  if new.source_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_memory_source';
  end if;

  if new.source_type = 'conversation' and not exists (
    select 1 from public.conversations
    where id = new.source_id and workspace_id = new.workspace_id and trashed_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_memory_source';
  elsif new.source_type = 'capture' and not exists (
    select 1 from public.captures
    where id = new.source_id and workspace_id = new.workspace_id and trashed_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_memory_source';
  elsif new.source_type = 'note' and not exists (
    select 1 from public.notes
    where id = new.source_id and workspace_id = new.workspace_id
      and ai_excluded = false and archived_at is null and trashed_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_memory_source';
  elsif new.source_type = 'review' and not exists (
    select 1 from public.reviews
    where id = new.source_id and workspace_id = new.workspace_id
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_memory_source';
  elsif new.source_type not in ('conversation', 'capture', 'note', 'review') then
    raise exception using errcode = 'P0001', message = 'invalid_memory_source';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_memory_source() from public, anon, authenticated;
create trigger memories_validate_source
before insert or update of workspace_id, source_type, source_id on public.memories
for each row execute function public.validate_memory_source();

do $$
begin
  if exists (
    select 1 from public.memories memory
    where (memory.source_type = 'user' and memory.source_id is not null)
       or (memory.source_type <> 'user' and memory.source_id is null)
       or (memory.source_type = 'conversation' and not exists (
         select 1 from public.conversations source
         where source.id = memory.source_id and source.workspace_id = memory.workspace_id
       ))
       or (memory.source_type = 'capture' and not exists (
         select 1 from public.captures source
         where source.id = memory.source_id and source.workspace_id = memory.workspace_id
       ))
       or (memory.source_type = 'note' and not exists (
         select 1 from public.notes source
         where source.id = memory.source_id and source.workspace_id = memory.workspace_id
       ))
       or (memory.source_type = 'review' and not exists (
         select 1 from public.reviews source
         where source.id = memory.source_id and source.workspace_id = memory.workspace_id
       ))
  ) then
    raise exception using errcode = 'P0001', message = 'existing_invalid_memory_source';
  end if;
end;
$$;

alter table public.memories validate constraint memories_source_shape_check;

commit;
