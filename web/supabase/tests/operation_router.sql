begin;
select plan(28);

-- The Operation router was seven functions, each migration wrapping the last
-- and putting its own condition in front. The surface validation and the
-- contract exposure check sat in the final one, so the six families matched on
-- the way down returned before reaching either. These assertions are the ones
-- that would have caught that.

select is(
  (select count(*)::integer from pg_proc proc
   join pg_namespace space on space.oid = proc.pronamespace
   where space.nspname = 'public' and proc.proname like 'dispatch_trusted_operation%'),
  1, 'there is one router, not a chain'
);
select ok(
  (select proc.prosecdef
     and 'search_path=pg_catalog, public' = any(coalesce(proc.proconfig, array[]::text[]))
   from pg_proc proc
   join pg_namespace space on space.oid = proc.pronamespace
   where space.nspname = 'public' and proc.proname = 'dispatch_trusted_operation'),
  'the router is security definer with a fixed search path'
);
select function_privs_are(
  'public', 'dispatch_trusted_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the router is not callable by a person directly'
);
select function_privs_are(
  'public', 'dispatch_trusted_operation', array['text', 'jsonb', 'text', 'text'],
  'anon', array[]::text[], 'the router is not callable anonymously'
);

/* A surface that is not a surface must be refused for every Operation, not
   only for the ones that reached the seventh function. Each of the six below
   was routed by a wrapper and returned `authentication_required` instead --
   proof it had run past the check and into its handler. */
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'goal.create.v1', '{}'::jsonb, 'router-probe-0001', 'not-a-real-surface')$$,
  'P0001', 'invalid_operation_surface',
  'an unknown surface is refused for an Operation the old chain did check'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'note.appearance.v1', '{}'::jsonb, 'router-probe-0002', 'not-a-real-surface')$$,
  'P0001', 'invalid_operation_surface',
  'an unknown surface is refused for note.appearance.v1'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'capture.file-to-action.v1', '{}'::jsonb, 'router-probe-0003', 'not-a-real-surface')$$,
  'P0001', 'invalid_operation_surface',
  'an unknown surface is refused for capture.file-to-action.v1'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'capture-proposal.dismiss.v1', '{}'::jsonb, 'router-probe-0004', 'not-a-real-surface')$$,
  'P0001', 'invalid_operation_surface',
  'an unknown surface is refused for a capture-proposal Operation'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'conversation.rename.v1', '{}'::jsonb, 'router-probe-0005', 'not-a-real-surface')$$,
  'P0001', 'invalid_operation_surface',
  'an unknown surface is refused for a conversation Operation'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'notification.read.v1', '{}'::jsonb, 'router-probe-0006', 'not-a-real-surface')$$,
  'P0001', 'invalid_operation_surface',
  'an unknown surface is refused for a notification Operation'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'action-template.create.v1', '{}'::jsonb, 'router-probe-0007', 'not-a-real-surface')$$,
  'P0001', 'invalid_operation_surface',
  'an unknown surface is refused for an action-template Operation'
);

/* The contract table is the authority on where an Operation may be reached
   from. `note.appearance.v1` is exposed to `ui` alone and
   `capture-proposal.dismiss.v1` to `ui` and `chat`; both were reachable as
   `mcp` because the check was never run for them. */
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'note.appearance.v1', '{}'::jsonb, 'router-probe-0008', 'mcp')$$,
  '42501', 'operation_surface_not_allowed',
  'a ui-only Operation cannot be dispatched over mcp'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'capture-proposal.dismiss.v1', '{}'::jsonb, 'router-probe-0009', 'mcp')$$,
  '42501', 'operation_surface_not_allowed',
  'an Operation the contract withholds from mcp cannot be dispatched over mcp'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'note.appearance.v1', '{}'::jsonb, 'router-probe-0010', 'automation')$$,
  '42501', 'operation_surface_not_allowed',
  'the same holds for automation, which no ui-only Operation admits'
);

/* An id that is in no contract has no exposures to match, so it is refused
   before any handler sees it. This is what keeps a typo from falling through
   to the planner handler as the `else` branch. */
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'not.an.operation.v1', '{}'::jsonb, 'router-probe-0011', 'ui')$$,
  '42501', 'operation_surface_not_allowed',
  'an Operation with no contract row is refused'
);

/* Routing order. Each of these shares a prefix with a later branch, so a
   flattened table gets them wrong if the specific case is not first. Reaching
   the handler is what is being asserted -- every one then fails on
   authentication, which is the handler talking, not the router. */
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'note.appearance.v1', '{}'::jsonb, 'router-probe-0012', 'ui')$$,
  '28000', 'authentication_required',
  'note.appearance.v1 still routes ahead of the note family'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'note.link.v1', '{}'::jsonb, 'router-probe-0013', 'ui')$$,
  '28000', 'authentication_required',
  'a knowledge link still routes ahead of the note family'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'review.complete-period.v1', '{}'::jsonb, 'router-probe-0014', 'ui')$$,
  '28000', 'authentication_required',
  'review.complete-period.v1 still routes ahead of the review family'
);
select throws_ok(
  $$select public.dispatch_trusted_operation(
    'workspace.ai-budget.v1', '{}'::jsonb, 'router-probe-0015', 'ui')$$,
  '28000', 'authentication_required',
  'workspace.ai-budget.v1 still routes ahead of the workspace family'
);

/* The owning domain, asked directly. Each of these shares a prefix with a
   later branch, so the ordering that used to be provable only by dispatching
   is now a select. */
select is(public.operation_handler_for('note.appearance.v1'), 'note_appearance',
  'note.appearance.v1 is answered before the note family');
select is(public.operation_handler_for('note.link.v1'), 'knowledge',
  'a knowledge link is answered before the note family');
select is(public.operation_handler_for('note.create.v1'), 'note',
  'an ordinary note Operation falls through to the note family');
select is(public.operation_handler_for('review.complete-period.v1'), 'period_review',
  'review.complete-period.v1 is answered before the review family');
select is(public.operation_handler_for('review.complete-weekly.v1'), 'review',
  'the rest of the review family follows it');
select is(public.operation_handler_for('workspace.ai-budget.v1'), 'ai_budget',
  'workspace.ai-budget.v1 is answered before the workspace family');
select is(public.operation_handler_for('goal.create.v1'), 'planner',
  'anything unclaimed belongs to the planner, which is the router fallback');

/* The column and the function cannot disagree, because a trigger writes it
   with that function. This is what the TypeScript comparison reads. */
select is(
  (select count(*)::integer from public.operation_contracts
   where owning_domain is distinct from public.operation_handler_for(operation_id)),
  0, 'every contract row carries the domain its own router would choose'
);
select is(
  (select count(*)::integer from public.operation_contracts where owning_domain is null),
  0, 'no contract row is missing a domain'
);

select * from finish();
rollback;
