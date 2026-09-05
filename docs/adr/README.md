# Architecture Decision Records

ADRs record accepted decisions that are consequential, difficult to reverse, and non-obvious. Their filenames are stable identifiers; later decisions supersede earlier ones explicitly rather than rewriting history.

## Active Themes

- `0001`, `0005`, `0021`: Supabase, single-owner Workspaces, and a relational domain with one Operation service.
- `0003`, `0004`, `0009`, `0020`, `0022`: narrow authority, risk-based approval, scoped OAuth, versioned contracts, and staged extensibility.
- `0006`, `0010`, `0025`: Markdown Notes, immutable Captures, and atomic versioned Proposals.
- `0007`, `0011`, `0012`, `0016`, `0017`, `0023`: retention, authentication, recovery, minimal evidence-linked context, provider governance, and support boundaries.
- `0013`, `0018`, `0019`: AI-independent core, separate Actions and Calendar Events, and PWA before native apps.
- `0024`: adapt Agent Native capability patterns without shipping its separate runtime in v1.

Read the [architecture](../engineering/architecture.md) for the resulting system shape and the [roadmap](../roadmap.md) for execution order.
