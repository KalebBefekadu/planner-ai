-- The prompt budget was never a reason to withhold from agents.
--
-- Five Operations are exposed to the UI and to nothing else, and the recorded
-- reason for each is the assistant's prompt budget: every chat-exposed
-- Operation puts its input schema into the system prompt, that prompt is held
-- under a byte ceiling, and these are the ones that crossed it.
--
-- That reason is true and it is about `chat`. It says nothing about `mcp`.
-- The two are separate flags. `assistantOperationCatalog` filters on `chat`
-- and is what spends the budget; the MCP catalog carries only an id, a summary
-- and a risk class, puts no schema anywhere, and has no ceiling to cross.
--
-- So withholding these from agents bought nothing. It cost the product's
-- stated north star -- whatever a human can do, an agent can do -- and it cost
-- it silently, in a way nobody would notice until they asked an agent to start
-- a project and were told it could not.
--
-- `ui` and `mcp`, then, and still not `chat`. That last part is not an
-- oversight: the in-app assistant gains capability through contextual intents
-- rather than through a catalog that taxes every other Operation to grow.

begin;

update public.operation_contracts
set exposures = array['ui', 'mcp']
where operation_id in (
  'goal.create.v2',
  'goal.schedule.v1',
  'project.create.v1',
  'project.update.v1',
  'project.status.v1'
);

-- None of the five may become chat-exposed by accident later: that is the flag
-- with the budget behind it, and a silent crossing is what this migration is
-- correcting in the first place.
do $$
begin
  if exists (
    select 1 from public.operation_contracts
    where operation_id in (
      'goal.create.v2', 'goal.schedule.v1',
      'project.create.v1', 'project.update.v1', 'project.status.v1'
    )
    and 'chat' = any(exposures)
  ) then
    raise exception using errcode = 'P0001', message = 'budget_bound_operation_is_chat_exposed';
  end if;
end;
$$;

commit;
