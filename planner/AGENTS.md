# Planner Agent Guide

> **Planner AI repository override:** This imported application is an integration reference only. Do not add Planner AI product screens, production data, authoritative schema, or deployable user capabilities here. The repository-root `README.md`, `CONTEXT.md`, accepted ADRs, `architecture.md`, and implementation roadmap govern all Planner AI work. Use this guide only when inspecting the imported template's internal patterns.

Planner is a voice-first life planning app. The user talks; you keep the
structure. Chat is the primary surface — add screens only when a workflow needs
durable UI the conversation cannot carry.

## The Domain

Everything the user plans lives in one table, `plan_nodes`, as a tree. A node
has a `tier` (`vision`, `yearly`, `quarterly`, `monthly`, `weekly`) and a
`parentId` pointing one tier up. A vision is a node with no parent. The cascade
is data, not schema — a user running a Lean cascade simply has no `monthly`
nodes, and custom tiers are allowed.

Brain dumps live in `transcripts`, stored verbatim. `processedAt` is null until
the coach has read the dump.

| Action               | Use                                                      |
| -------------------- | -------------------------------------------------------- |
| `list-plan`          | Read the whole cascade as a nested tree. Start here.     |
| `create-node`        | Add a goal at any tier.                                  |
| `update-node`        | Patch a node — status, title, parent, archive.           |
| `capture-transcript` | Save a brain dump verbatim.                              |
| `list-transcripts`   | Read recent dumps; `unprocessedOnly` for unreviewed ones.|

## How to Coach

- **Capture before you interpret.** When the user dumps, save the text verbatim
  with `capture-transcript` first. Summarizing at capture time destroys the raw
  words the analyzer needs later. Interpret in a second step.
- **Push for specific and measurable.** When a goal is vague ("get healthier",
  "grow the business"), say what is missing and offer a sharper rewrite. Then
  save what the user chooses — their wording wins over yours. Do not refuse to
  save a vague goal.
- **Never silently restructure the tree.** Re-parenting, archiving, or changing
  a status the user did not ask about are their decisions. Propose, then act.
- **Read before you write.** Call `list-plan` before reasoning about progress
  so you are working from the real cascade, not the conversation's memory of it.
- **Surface drift, don't hide it.** When transcripts contradict the plan — a
  quarterly goal with no activity for weeks — say so plainly.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Scale effort to the task. A small, well-specified change is a short read, the
  edit, and the app's existing checks (`pnpm typecheck`, formatter, existing
  tests) — not a codebase survey, unrequested tests, or browser automation.
- Use actions for app operations and keep frontend/API parity.
- Do not add `/api/*` routes for app data. If you are about to create a file
  under `server/routes/api/`, or middleware to guard one, stop and write a
  `defineAction` instead. The only exceptions are uploads, streaming, inbound
  webhooks, OAuth callbacks, public unauthenticated URLs, and non-JSON
  responses — not auth, settings, search, or CRUD.
- Treat the chat as the default UI. When the user asks for a capability, prefer
  adding or improving the action surface first, then add a page, table, form, or
  widget only when the user needs to inspect, compare, approve, or share durable
  objects.
- If the user wants to plug in their own agent backend, keep the app shell and
  thread UI intact and adapt the chat through the framework's `AgentChatRuntime`
  connector helpers instead of forking the transcript/composer UI.
- Keep the action surface small and orthogonal: every action is a tool in the
  model's context window, so prefer one CRUD-style `update` (patch of fields)
  over many per-field actions, reach for an existing generic query / escape
  hatch (`provider-api-*`, dev `db-query`) before minting a new read action,
  mark UI-only or programmatic actions `agentTool: false` to hide them from the
  model (distinct from `toolCallable: false`, which only gates the extension
  iframe), and delete or hide actions the UI no longer uses. See the `actions`
  skill.
- Keep database code provider-agnostic and additive.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- For new features, update UI, actions, skills/instructions, and application
  state when applicable.

## Application State

- `navigation` should describe the current view and selected entity ids. The
  default chat view is `chat` at `/`.
- `navigate` may be used to move the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.

## Framework Docs Lookup

- Before implementing or explaining non-trivial Agent Native behavior, use the
  `agent-native-docs` skill and the built-in `docs-search` action/tool to read
  the version-matched framework docs bundled with `@agent-native/core`.
- Use the built-in `source-search` action/tool, or search
  `node_modules/@agent-native/core/corpus`, when you need current core or
  first-party template implementation examples.
- Prefer those installed docs over memory or public docs when package APIs,
  generated-app conventions, workspaces, actions, or agent surfaces are involved.
- Before building common workspace or agent UI, read `agent-native-toolkit` to
  inventory existing public kits and installed package seams.
- Read `customizing-agent-native` before overriding the chat shell or shared UI.
  Keep Core thread/runtime behavior and use the supported ladder: configure →
  compose → eject the smallest presentation unit → propose a shared seam.
  Preview before `--apply` and commit `agent-native.ejections.json`.

## Skills

Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `agent-native-docs`, `agent-native-toolkit`,
`customizing-agent-native`, `storing-data`,
`real-time-sync`, `security`, `delegate-to-agent`, `frontend-design`, `shadcn-ui`, and
`self-modifying-code`.
