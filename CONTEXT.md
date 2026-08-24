# Planner AI

Planner AI is a personal planning workspace that connects long-term direction to concrete work and reflection. This glossary defines the product language independently of any interface or storage design.

## Language

**Vision**:
A long-form statement of the life direction a person wants to move toward. It provides context for goals but is not itself a goal.
_Avoid_: Vision goal, root goal

**Goal**:
A specific outcome a person intends to achieve over a yearly or quarterly horizon. A goal describes a result, not a piece of work.
_Avoid_: Task, action, plan node

**Action**:
A concrete, completable piece of work that advances a goal and is scheduled into a monthly or weekly horizon.
_Avoid_: Task, weekly goal, monthly goal

**Calendar Event**:
A reserved period of time from an external calendar. It may be linked to an Action but does not represent completion of that Action.
_Avoid_: Scheduled Action, calendar task, Planning Horizon

**Planning Horizon**:
A named period used to organize goals or actions: year, quarter, month, or week. A horizon is a time boundary, not a type of content.
_Avoid_: Tier, goal level, cascade level

**Plan**:
The connected view of a person's Vision, Goals, Actions, and their Planning Horizons.
_Avoid_: Goal hierarchy, cascade

**Workspace**:
A private collection of one person's Planner AI data, including their Vision, Goals, Actions, Notes, Captures, and Reviews. A first-release Workspace has exactly one owner.
_Avoid_: Team, organization, shared workspace

**Operation**:
A named Planner AI capability that reads or changes Workspace state consistently regardless of whether the person uses the interface, assistant, automation, or an external client.
_Avoid_: Planning Action, UI event, database query, unrestricted tool

**Note**:
A durable Markdown page written or organized by the person and optionally connected to Goals, Actions, Captures, or other Notes.
_Avoid_: Document block, agent resource, memory

**Attachment**:
A private file associated with a Note and governed by the same ownership, export, Trash, deletion, and recovery expectations as that Note.
_Avoid_: Public asset, external file link, embedded database

**Capture**:
Raw text preserved from something the person typed or said before any AI interpretation. Audio is temporary transcription input, not the durable Capture.
_Avoid_: Summary, memory, processed note

**Goal Progress**:
Evidence of movement toward a Goal's intended outcome, represented by its measurable result or an explicit user assessment. It is not the percentage of related Actions completed.
_Avoid_: Task completion, activity count

**Memory**:
An explicit, user-editable preference, constraint, or recurring fact that the assistant may use across conversations.
_Avoid_: Chat history, Note, Capture, automatic profile

**Conversation**:
A durable thread of messages and assistant activity. It records an interaction but does not automatically become a Note, Capture, or Memory.
_Avoid_: Memory, Note, permanent knowledge

**AI Exclusion**:
A user-controlled boundary that prevents the assistant from reading or processing a Note unless the person explicitly includes it for a specific interaction.
_Avoid_: Archive, deletion, access permission

**Assistant Profile**:
The person's explicit choices for assistant tone, coaching intensity, and interaction preferences. It shapes behavior but does not contain inferred facts about the person.
_Avoid_: Memory, system prompt, custom agent code

**Proposal**:
A reviewable set of AI-suggested changes derived from source material such as a Capture or Review. It is separate from both the source and any changes eventually applied.
_Avoid_: Automatic update, processed Capture, AI result

**Review**:
A deliberate reflection on outcomes, unfinished Actions, blockers, and the next Planning Horizon. Weekly Review is the primary cadence; monthly and quarterly Reviews are optional strategic summaries.
_Avoid_: Report, dashboard, automatic rollover

**Trash**:
A temporary, recoverable state for deleted Planner AI records before permanent deletion. Trash is not an archive or a completed-work view.
_Avoid_: Archive, backup, permanent deletion

**Activity**:
A user-visible history of important reads and durable changes, including who or what acted, where the action came from, and its outcome without duplicating private content.
_Avoid_: Analytics, raw logs, Conversation, Note history
