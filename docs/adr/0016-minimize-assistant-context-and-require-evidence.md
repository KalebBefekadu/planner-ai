---
status: accepted
---

# Minimize assistant context and require evidence

Each assistant turn begins with minimal structured context: route, selection, Workspace timezone, and explicitly attached items. Additional records are fetched only through authorized read Operations when required. Users may apply an AI Exclusion to a Note or temporarily scope a Conversation to selected records. The entire vault or visible screen text is never sent by default.

Conversations persist until the user deletes them but remain distinct from Notes, Captures, and Memory. AI Proposals, recommendations, and summaries cite exact Planner AI or external sources and label claims as supported, inferred, or needing input. They provide concise user-facing explanations without exposing hidden chain-of-thought or internal prompts.

## Consequences

- Context retrieval and source links are visible and testable.
- Conversation rename, archive, search, export, and deletion are product requirements.
- Deleting a Conversation removes content-bearing messages and tool results while content-free security audit records follow their own retention.
- Useful conversation content becomes a Note, Capture, or Memory only through an explicit Operation or Proposal.
