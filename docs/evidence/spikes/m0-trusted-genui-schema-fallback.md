# M0 Spike: Trusted GenUI Schema And Fallback

Status: Read-only integration evidence in progress  
Owner: Planner AI engineering  
Started: 2026-08-25

## Decision Being Tested

Planner AI may generate task-specific visual surfaces only by selecting from a versioned, trusted component catalog. Models never generate executable React, HTML, CSS, SQL, or arbitrary browser behavior.

## Implemented Boundary

`web/src/lib/genui/schema.ts` defines schema version `1.0` with five bounded components:

- text;
- metric group;
- record list with internal links only;
- notice;
- Operation proposal.

The complete payload is limited to 48 KB and 12 flat components. Every field is strict and bounded. Operation proposals are checked against the production Operation catalog, assistant exposure rules, the registered risk class, and the Operation's real Zod input schema.

`web/src/components/genui-renderer.tsx` renders only parsed specifications. Invalid or unknown output becomes an accessible status surface containing bounded fallback text and an explicit assurance that no change was made. Operation proposals can only request review; the renderer cannot execute them.

`web/src/lib/genui/assistant.ts` deterministically converts already-resolved assistant evidence into a read-only record list. `web/src/app/api/assistant/route.ts` returns that result only for canonical, proposal-free answers when `PLANNER_GENUI_READ_ONLY` is enabled. The client parses the payload again before rendering. The model does not choose components in this first integration.

## Threats Covered By The Executable Corpus

`web/tests/unit/genui-schema.test.ts` verifies:

- unknown component rejection;
- arbitrary HTML rejection;
- external-link rejection;
- payload-size limits;
- unknown Operation rejection;
- assistant exposure enforcement;
- risk downgrade prevention;
- real Operation input validation;
- accessible, source-preserving fallback behavior;
- proposal parsing without execution.

## Pass Criteria

- Unknown components and schema versions never reach the renderer.
- The model cannot introduce code or external navigation.
- The model cannot widen Operation authority or lower risk.
- A parsed proposal still requires the existing governed approval path.
- Invalid output has a deterministic, accessible fallback.
- The schema can be version-negotiated without changing Planner AI's Operation model.

## Work Still Required Before ADR Acceptance

1. Add renderer fixtures for desktop, mobile, 200 percent zoom, keyboard, and screen reader flows.
2. Add component-count, data-density, update-frequency, and streaming patch tests.
3. Route Operation proposal interaction into the existing proposal record and approval gateway.
4. Add structured provenance and evidence references to every data-bearing component.
5. Add authenticated live-provider and degraded-provider browser fixtures.
6. Compare the internal schema with A2UI and MCP Apps adapters without making either protocol authoritative.

The feature remains disabled by default. The first flagged integration renders deterministic, validated evidence records; it does not enable arbitrary model-generated interfaces.
