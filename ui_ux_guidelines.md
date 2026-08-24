# Planner AI Experience Guidelines

Status: **Approved first-release interaction standard.** These guidelines apply to desktop and mobile PWA surfaces.

## Product Character

Planner AI should feel calm, precise, private, and work-focused. It is a repeated-use personal tool, not a marketing site, chat demo, or decorative dashboard.

- The Workspace is always primary; chat is a collapsible second path.
- Use restrained color with more than one functional hue family for state and hierarchy.
- Favor clear structure, stable dimensions, and scanability over large cards or oversized headlines.
- Avoid glassmorphism, ornamental gradients, floating section cards, decorative blobs, and animation without meaning.
- Display real planning state, not mock success or aspirational metrics.

## Information Architecture

Primary navigation:

1. Today
2. Plan
3. Notes
4. Review

Secondary destinations live in predictable utility navigation:

- Capture Inbox
- Search
- Activity
- Notifications
- Settings

The assistant opens from a persistent, labeled control and docks on desktop. On narrow screens it uses a full-height sheet with an obvious close action and preserves the underlying route/selection.

## Layout

- Desktop uses a stable navigation rail, flexible main workspace, and optional assistant pane.
- Mobile uses bottom or compact top navigation for primary destinations; utility items use a menu.
- Do not put page sections inside decorative cards. Use full-width bands or unframed sections; reserve cards for repeated records, modals, and genuinely framed tools.
- Never nest cards.
- Keep Today and Review dense enough to scan but not crowded.
- Give boards, lists, toolbars, sidebars, counters, and editors stable responsive constraints so dynamic labels and loading states do not shift the layout.
- Every viewport must avoid overlapping navigation, dialogs, assistant panes, toasts, keyboard overlays, and recording controls.

## Typography And Content

- Use one readable interface family and one optional restrained display family only where the existing product benefits.
- Do not scale font size directly with viewport width.
- Letter spacing is zero.
- Reserve large display type for a true page-level moment; compact panels use compact headings.
- Use canonical product language from `CONTEXT.md`: Vision, Goal, Action, Planning Horizon, Capture, Proposal, Conversation, Memory, Review, Activity, and Trash.
- Do not call every record a goal, task, tier, node, or document.
- Interface text states the decision or result. Avoid feature tours, implementation explanations, and visible shortcut manuals inside normal screens.

## Controls

- Use icons from the selected icon library for familiar actions such as search, undo, archive, Trash, microphone, close, and navigation.
- Add tooltips for unfamiliar icon-only controls.
- Use segmented controls for modes, toggles/checkboxes for binary settings, selects/menus for option sets, and proper date/time inputs for schedules.
- Use text buttons only for clear commands. Consequential actions use explicit labels such as `Empty Trash` rather than vague `Continue`.
- Do not use a rounded text pill when a familiar symbol or standard control is clearer.
- Cards use at most an 8 px radius unless the final design system sets a smaller value.

## Core Workflow Behavior

### Today

- Keep the three highlighted priorities visually distinct from the rest of the Action list.
- Replacing a priority is deliberate but fast.
- Overdue state explains the next decision without shaming the user.

### Plan

- Show Vision, Goals, and Actions as distinct record types, not an infinitely nested tree.
- Present yearly/quarterly outcomes separately from monthly/weekly work.
- Relationship and time context remain visible during create/edit.
- Completion of an Action never visually implies automatic Goal achievement.

### Notes

- Use a stable hierarchy pane, focused editor, and contextual relationship panel without nesting them in a giant card.
- Autosave state is quiet but visible.
- AI Exclusion is clearly indicated without making the Note look broken.
- Internal links, backlinks, revisions, and attachments remain inspectable with keyboard and touch.

### Capture

- One control begins/stops recording; typed Capture always remains available.
- Show elapsed time, recording/transcribing/sync state, and what will happen to audio.
- Never clear typed or transcribed text after an error.
- Browser live captions are labeled as temporary until canonical transcription completes.
- Unsent local state is visible and retry does not duplicate.

### Review

- Present unfinished Actions with one decision at a time: reschedule, reduce, blocker, drop, or leave overdue.
- Preserve original scheduling history and avoid one-click silent rollover.
- Weekly commitments show the five-item focus limit and deliberate replacement.

### Assistant And Proposals

- Show which route, selection, or sources the assistant is using.
- Separate assistant prose from Operation previews and results.
- Reversible writes expose Undo immediately.
- Consequential Operations show exact records/effects and require explicit confirmation.
- Proposal review compares source, suggestion, evidence, edits, and exact resulting Operations.
- Labels `supported`, `inferred`, and `needs input` are plain status indicators, not decorative badges.
- Chat never replaces ordinary navigation or traps the user in a conversational workflow.

## States And Feedback

Every core view and command has:

- initial loading and refresh behavior;
- useful empty state with one next action;
- field validation near the field;
- recoverable error with preserved input;
- offline or queued state where applicable;
- explicit success only after durable commit;
- conflict state when optimistic concurrency fails;
- permission/AI Exclusion state;
- provider-degraded state that leaves core work usable.

Use skeletons only when dimensions are known. Do not show false data-shaped placeholders that users could mistake for saved records. Toasts support, but never replace, persistent error or status information needed to finish a workflow.

## Accessibility

WCAG 2.2 Level AA is the acceptance target.

- Complete all workflows with keyboard only and with touch without drag.
- Keep focus visible and unobscured by sticky UI, dialogs, toasts, or assistant panes.
- Use semantic headings, landmarks, lists, form labels, descriptions, and live regions.
- Screen readers receive useful names and state changes for recording, autosave, sync, Proposal execution, and errors.
- Support 200 percent zoom and responsive reflow without clipped controls.
- Respect reduced motion and never require motion, color, hover, voice, or pointer precision alone.
- Meet contrast and minimum target-size criteria.
- Authentication must not rely on cognitive tests or inaccessible copy/paste restrictions.
- Automated axe/Playwright checks supplement, not replace, manual keyboard and screen-reader tests.

## Responsive Verification

Before completing a user-facing ticket, verify at minimum:

- mobile portrait around 390 x 844;
- tablet around 768 x 1024;
- desktop around 1440 x 900;
- wide desktop with the assistant open;
- browser zoom at 200 percent;
- longest supported labels and realistic dense data;
- loading, empty, error, conflict, offline, approval, and success states.

Use Playwright screenshots for regressions and inspect them rather than relying only on DOM assertions.

## Design Definition Of Done

- The workflow works without chat.
- The same Operation works through the assistant where exposed.
- Text and controls fit at all required viewports.
- No incoherent overlap, nested card composition, or layout shift remains.
- Keyboard, screen reader, touch, and reduced-motion behavior pass.
- Loading, empty, error, offline, conflict, approval, undo, and success states are intentional.
- No interface reveals secrets, provider internals, raw prompts, or another user's data.
