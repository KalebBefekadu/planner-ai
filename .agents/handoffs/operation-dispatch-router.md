# Operation Dispatch Router Handoff

- **Task:** `.agents/tasks/operation-dispatch-router.md`
- **Branch:** `codex/operation-dispatch-router`
- **Base:** `codex/remove-preview` at `906cc55`

The large half of EH-04. Replaces the seven-function dispatch chain with one
router, **and closes an authorization gap the chain had created.**

## The gap, which is the reason this mattered

`dispatch_trusted_operation` had become seven functions. Each migration that
added a domain wrapped the previous dispatcher under a new `_base` name and put
its own condition in front:

```
dispatch_trusted_operation                     note.appearance.v1
  -> ..._note_appearance_base                  capture.file-to-action.v1
    -> ..._capture_action_base                 capture-proposal.%
      -> ..._capture_proposal_base             conversation.%
        -> ..._conversation_base               notification.%
          -> ..._notification_base             action-template.%
            -> ..._action_template_base        everything else
```

The surface validation and the `operation_contracts` exposure check live in the
**last** function. Every family matched on the way down returned before
reaching them.

Verified against the live database before changing anything. Dispatching each
Operation with the surface `'not-a-real-surface'`:

| Operation | Result |
| --- | --- |
| `goal.create.v1` | `invalid_operation_surface` — the check ran |
| `note.appearance.v1` | `authentication_required` — ran past it into the handler |
| `capture.file-to-action.v1` | `authentication_required` |
| `capture-proposal.dismiss.v1` | `authentication_required` |
| `conversation.rename.v1` | `authentication_required` |
| `notification.read.v1` | `authentication_required` |
| `action-template.create.v1` | `authentication_required` |

So for six families neither `invalid_operation_surface` nor
`operation_surface_not_allowed` was enforced. Concretely: `note.appearance.v1`
carries contract exposure `{ui}` and `capture-proposal.dismiss.v1` carries
`{ui,chat}`, and both could be dispatched with surface `mcp`.

**How reachable it was, stated honestly.** Reaching it needs an MCP token or
OAuth grant whose `allowed_operations` names one of those ids.
`mcp_access_tokens.allowed_operations` is constrained only by
`cardinality(...) <= 50` — nothing in the database requires a granted id to be
one the contract exposes to `mcp`. The catalog that builds the grant list does
filter on exposure, but it does so in TypeScript. So this was defence in depth
that was not there, rather than a hole open to anyone; the contract table simply
was not the authority it is meant to be.

## Behavior changed

Both checks now run first, once, for every Operation. The routing table is the
chain flattened in the same order, so **no Operation reaches a different
handler**: `note.appearance.v1` still precedes `note.%`, the knowledge links
still precede `note.%`, `review.complete-period.v1` still precedes `review.%`,
and `workspace.ai-budget.v1` still precedes `workspace.%`.

The six `_base` functions are dropped. Nothing outside the chain ever called
one — each existed only to be the tail of the next migration's wrapper.

The one real behaviour change is the fix itself: an Operation dispatched from a
surface its contract does not name is now refused. No legitimate caller does
that, which is what the unchanged test suites below demonstrate.

## Files changed

- `.agents/ACTIVE.md`, the task and this handoff
- `web/supabase/migrations/20260915200000_one_operation_router.sql`
- `web/supabase/tests/operation_router.sql` (new)
- `web/src/types/supabase.generated.ts` — the six dropped functions

## Verification

Run in `web/` with Node 24.21.0:

- `npm run agent:check` — passed.
- `npm test` — passed; 87 files, 1,006 tests, unchanged.
- `npm run test:db` — passed; 71 files, 1,299 assertions, up from 70 and 1,280.
  **The 1,280 that existed before all still pass**, which is the evidence that
  turning the check on breaks nothing legitimate.
- `npm run verify:db` — passed after regenerating types. It failed first,
  correctly, because the dropped functions were still in the generated types.
- `npx playwright test` across the notes, planner, today, review, capture and
  search journeys — **80 passed**. Every action in those journeys dispatches
  through the rewritten router.

## Risks and follow-up

- The router is one `elsif` ladder again, so the next domain will be tempted to
  add a branch rather than a wrapper. That is the intended shape, but it is
  still a list that must stay ordered: anything specific has to precede its
  family. The new pgTAP file pins the four cases where that matters.
- **`allowed_operations` is still unconstrained at the database level.** This
  branch makes the contract authoritative at dispatch, which is the important
  half, but a token can still be minted naming an id the contract does not
  expose to `mcp` — it will now simply fail when used. A foreign key or check
  against `operation_contracts` would refuse it at creation instead. That is a
  small, separate change and worth doing.
- EH-04's remaining bullets are unchanged: the assistant and MCP catalogs are
  still assembled by hand rather than derived from the manifest, and the
  manifest still does not carry undo strategy or owning domain.
