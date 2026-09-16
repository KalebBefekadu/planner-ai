-- One Operation router, and the surface check in front of it.
--
-- `dispatch_trusted_operation` had become seven functions. Each migration that
-- added a domain wrapped the previous dispatcher under a new `_base` name and
-- put its own condition in front:
--
--   dispatch_trusted_operation                     note.appearance.v1
--     -> ..._note_appearance_base                  capture.file-to-action.v1
--       -> ..._capture_action_base                 capture-proposal.%
--         -> ..._capture_proposal_base             conversation.%
--           -> ..._conversation_base               notification.%
--             -> ..._notification_base             action-template.%
--               -> ..._action_template_base        everything else
--
-- Every database stack trace walked all seven, which is how this was noticed.
--
-- The fault is not the depth. It is that the surface validation and the
-- `operation_contracts` exposure check live in the *last* function, so the six
-- operation families matched on the way down returned before ever reaching
-- them. Dispatching `note.appearance.v1` -- contract exposure `{ui}` -- with
-- surface `mcp` did not raise `operation_surface_not_allowed`, and dispatching
-- any of the six with a surface that is not a surface at all did not raise
-- `invalid_operation_surface`. The contract table was simply not consulted for
-- them.
--
-- That was reachable rather than theoretical: `mcp_access_tokens.allowed_operations`
-- is constrained only by `cardinality(...) <= 50`, so nothing in the database
-- requires a granted id to be one the contract exposes to `mcp`. The catalog
-- that builds the grant list filters on exposure, but it does so in TypeScript.
--
-- Both checks now run first, once, for every Operation. The routing order below
-- is the order the chain produced, flattened -- `note.appearance.v1` still
-- precedes `note.%`, `review.complete-period.v1` still precedes `review.%`.
-- No Operation changes the handler it reaches.

begin;

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
begin
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
    raise exception using errcode = 'P0001', message = 'invalid_operation_surface';
  end if;
  perform 1 from public.operation_contracts
  where operation_id = p_operation_id and p_surface = any(exposures);
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;

  -- Specific ids before their family: note.appearance and the two note link
  -- groups are all `note.%`, and review.complete-period is `review.%`.
  if p_operation_id = 'note.appearance.v1' then
    return public.execute_note_appearance_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'capture.file-to-action.v1' then
    return public.execute_capture_action_filing_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'capture-proposal.%' then
    return public.execute_capture_proposal_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'conversation.%' then
    return public.execute_conversation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'notification.%' then
    return public.execute_notification_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'action-template.%' then
    return public.execute_action_template_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'operation.undo.v1' then
    return public.execute_operation_undo(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('goal.update.v1', 'action.move.v1') then
    return public.execute_plan_edit_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'account.%' then
    return public.execute_account_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in ('action.update.v1', 'action.status.v1', 'daily-focus.set.v1') then
    return public.execute_daily_execution_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'workspace.onboarding-complete.v1' then
    return public.execute_guided_onboarding_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'workspace.ai-budget.v1' then
    return public.execute_ai_budget_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'workspace.%' then
    return public.execute_workspace_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.import-preview.v1', 'note.import-commit.v1', 'note.import-cancel.v1'
  ) then
    return public.execute_note_import_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.goal-link.v1', 'note.goal-unlink.v1', 'note.action-link.v1', 'note.action-unlink.v1'
  ) then
    return public.execute_note_relation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id = 'review.complete-period.v1' then
    return public.execute_period_review_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'review.%' then
    return public.execute_review_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ) then
    return public.execute_knowledge_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'note.%' then
    return public.execute_note_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'memory.%' then
    return public.execute_memory_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'trash.%' then
    return public.execute_trash_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;
  return public.execute_planner_operation(
    p_operation_id, p_input, p_idempotency_key, p_surface);
end;
$$;

-- The chain is gone. Nothing outside it ever called a `_base`: each was created
-- solely to be the tail of the next migration's wrapper.
drop function if exists public.dispatch_trusted_operation_note_appearance_base(text, jsonb, text, text);
drop function if exists public.dispatch_trusted_operation_capture_action_base(text, jsonb, text, text);
drop function if exists public.dispatch_trusted_operation_capture_proposal_base(text, jsonb, text, text);
drop function if exists public.dispatch_trusted_operation_conversation_base(text, jsonb, text, text);
drop function if exists public.dispatch_trusted_operation_notification_base(text, jsonb, text, text);
drop function if exists public.dispatch_trusted_operation_action_template_base(text, jsonb, text, text);

revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated;

commit;
