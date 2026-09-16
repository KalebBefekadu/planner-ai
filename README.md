# Planner AI

Planner AI is a private, voice-first planning and knowledge workspace with a complete click-first interface, a contextual AI assistant, and a deliberately scoped MCP surface.

The core promise is simple: people can always work directly, and AI can perform the same authorized Operations without becoming a hidden source of truth or an uncontrolled administrator.

## Licensing

This repository is public but **not open source**. All rights are reserved, and
its visibility grants no licence to use it — see [LICENSE](LICENSE). It is
public so that continuous integration runs against it, not as an invitation to
reuse it. If you want to do something with this code, open an issue and ask.

## Repository

| Path         | Role                                                               |
| ------------ | ------------------------------------------------------------------ |
| `web/`       | The only product application and deployment target.                |
| `docs/`      | Product, architecture, roadmap, evidence, decisions, and runbooks. |
| `CONTEXT.md` | Canonical product glossary.                                        |

Start with the [documentation index](docs/README.md), then read the [status](docs/status.md) and [roadmap](docs/roadmap.md).

## Local Development

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Environment setup and verification commands are documented in [web/README.md](web/README.md).

## Quality Baseline

```bash
cd web
npm run lint
npm run typecheck
npm run format:check
npm test
npm run test:db
npm run build
```

Authenticated browser, live-provider, production preflight, backup, and release checks require their documented environments and are never implied by the local baseline.

## Current Direction

`web/` already contains the canonical schema, Operation layer, core workspace routes, governed assistant, and MCP foundations. The immediate work is to converge the refined `/preview` experience with the authenticated canonical product, complete production migration and recovery gates, and prove the end-to-end daily planning loop. Advanced databases, graph, canvas, true local-first sync, collaboration, and extensions remain staged north-star capabilities rather than current-release promises.
