# M0 Spike: Semantic Operation Rejection And Rebase

Status: Integration evidence in progress  
Owner: Planner AI engineering  
Started: 2026-08-25

## Decision Being Tested

Planner AI should use one semantic Operation journal as the sole business mutation queue. A transport or sync SDK may mirror an entry one-to-one, but it must not invent or apply a second business mutation.

## Current Baseline

The production prototype already has:

- a versioned Operation catalog shared by UI, governed chat, and MCP;
- server-derived identity and workspace authorization through Supabase RPCs;
- idempotency keys and durable server receipts;
- optimistic version checks and conflict-safe undo for supported Operations.

The initial flagged integration now has:

- encrypted Operation journal metadata beside the existing encrypted Capture queue;
- a stable device identity and monotonic client sequence;
- explicit local commit, queue, send, authoritative receipt acceptance, and retryable rejection states;
- a low-risk `capture.create.v1` path behind `PLANNER_OPERATION_JOURNAL_CAPTURE`;
- backward compatibility with captures written by the existing offline page.

Real dispatcher pgTAP evidence now proves that duplicate delivery returns the original Capture and creates exactly one Capture, receipt, and activity event. The trusted UI gateway rejects same-key retries whose exact Capture text or source differs. The client independently compares the encrypted journal payload with the queued source and acknowledged result; any mismatch becomes a visible private recovery copy and automatic retry stops. Stable policy and schema failure codes now survive the shared Operation adapter. The spike does not yet cover out-of-order delivery, a live permission revocation, real conflicts, obsolete-client execution, or a third-party sync adapter.

## Executable Contract

`web/src/lib/operations/journal.ts` defines the framework-neutral lifecycle:

`draft -> locally_committed -> queued -> sent -> accepted`

It also models duplicate acceptance, retryable rejection, conflict rejection, policy rejection with a private recovery copy, and obsolete-schema upgrade blocking. Unknown failures remain retryable so a client never destroys source data based on an unrecognized server response.

`web/tests/unit/operation-journal.test.ts` is the first reproducible scenario corpus. It covers:

- successful acknowledgement;
- duplicate delivery;
- transport retry;
- conflict rebase and manual recovery;
- permission revocation;
- schema obsolescence;
- illegal transitions;
- disjoint and overlapping field changes;
- remote deletion without accidental resurrection.

## Pass Criteria

- Every allowed transition is deterministic.
- Terminal acceptance cannot be replayed through the client state machine.
- Network and unknown failures preserve the local request.
- Policy rejection cannot be blindly retried.
- Overlapping or deleted-target conflicts require visible user resolution.
- Disjoint field changes can be rebased without changing the semantic Operation ID.
- A future sync adapter can map one transport entry to one journal entry without owning domain behavior.

## Work Still Required Before ADR Acceptance

1. Exercise crash/restart and out-of-order delivery against the real Supabase dispatcher.
2. Define server response envelopes with stable rejection codes and authoritative revisions.
3. Test permission revocation, tombstone expiry, conflict, and schema upgrade against local Supabase.
4. Add an inspectable recovery UI for non-retryable states before expanding beyond Capture.
5. Compare PowerSync and Electric using this exact semantic corpus; reject any adapter that creates a second business queue.

The Operation journal remains a proposed architecture decision until these integration cases pass. The flagged Capture path reuses the existing offline queue and does not alter the production database or claim general offline support.
