---
status: accepted
---

# Use versioned atomic Capture Proposal batches

Structured Capture analysis creates a versioned Proposal batch linked to one immutable Capture. A batch records model and prompt provenance, a concise analysis summary, bounded blocker/reflection insights, and zero to ten ordered Proposal items. Each item names one existing shared Operation and stores only its validated input and user-facing effect summary.

The raw Capture is never rewritten by analysis, editing, dismissal, approval, failure, or reprocessing. Reprocessing persists a complete replacement batch before superseding the prior pending batch. Users may edit pending item inputs through a version-checked Operation, dismiss a batch, or approve the exact current batch. Approval executes every item through the existing trusted dispatcher in one database transaction; one failure rolls back every item and leaves the batch pending.

## Consequences

- A useful zero-item analysis is durable and reviewable without inventing a write.
- The review UI compares source text, insights, exact proposed effects, risk, and provenance.
- Batch and item versions prevent approval of a stale edit or reprocessing result.
- Applied item Operations retain their own receipts, Activity, idempotency, and Undo behavior.
- Batch approval is not exposed through MCP in v1 because it is a bounded bulk action requiring in-product review.
- Dismissal and item editing are reversible; applying a batch is not itself reversible, although individually reversible item receipts remain available in Activity.
- Provider output is schema-validated in the API and revalidated by each Operation executor at approval time.
