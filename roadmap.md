# Planner AI Roadmap

The canonical, dependency-checked ticket plan is [Planner AI Implementation Roadmap](planner_ai_implementation_roadmap.md).

This file intentionally contains no second phase list. Earlier versions described a fixed goal cascade, automatic AI task updates, custom tiers, and an immediate local-first/Tauri migration. Those directions were superseded by the accepted decisions in `planner_ai_decision_register.md`.

Implementation begins with current-prototype containment, schema/data backup, repeatable migrations, Operation architecture, CI, and a timeboxed Agent Native feasibility spike. That spike concluded with ADR-0024: adapt useful patterns into `web` and do not ship a sidecar in v1. Product expansion follows only after the remaining evidence gates pass.
