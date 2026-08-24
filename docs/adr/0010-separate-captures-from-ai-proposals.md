---
status: accepted
---

# Separate immutable Captures from AI Proposals

Planner AI will preserve each raw Capture independently from any AI interpretation. Processing creates a separate Proposal that can suggest multiple Actions, Note changes, Goal links, tags, blockers, or reflections; applying it records the exact resulting changes, while dismissal or reprocessing never rewrites the original Capture.

## Consequences

- Capture lifecycle states are `new`, `proposed`, `reviewed`, and `archived`.
- Proposals are versioned, attributable to a model/prompt version, and independently editable or dismissible.
- One Capture may produce zero, one, or many suggested changes.
- Applied Proposal changes flow through ordinary risk-classified Planner AI Operations.
