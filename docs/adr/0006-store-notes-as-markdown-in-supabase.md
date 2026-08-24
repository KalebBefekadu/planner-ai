---
status: accepted
---

# Store Notes as canonical Markdown in Supabase

Planner AI will store normalized Markdown as the canonical Note body in Supabase. The rich editor may use Tiptap state while open, but first-release formatting must round-trip through the supported Markdown subset; local files are export or sync surfaces rather than another authoritative store.

## Consequences

- First-release Notes support headings, paragraphs, emphasis, lists, checklists, quotes, links, code blocks, dividers, tables, and internal Note links.
- Arbitrary MDX components, executable content, document databases, comments, publishing, and collaborative cursors are deferred.
- Note revisions and exports preserve Markdown plus typed metadata and relationships.
