---
status: accepted
---

# Use explicit retention for voice and agent memory

Planner AI will preserve raw transcripts but delete temporary audio immediately after successful transcription; failed audio may remain encrypted for seven days for retry. Durable agent memory is a separate, visible, user-editable record: the assistant may propose memory updates but may not silently turn all Notes, Captures, or chat summaries into permanent memory.

## Consequences

- Audio retention state and expiry are visible and enforceable by cleanup jobs.
- Memory changes are reversible and appear in Settings and the audit trail.
- Deleting a Capture, memory record, or account includes its associated retained data.
