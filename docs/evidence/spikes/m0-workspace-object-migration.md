# M0 Spike: Canonical Workspace Object Migration

Status: In progress  
Owner: Planner AI engineering  
Started: 2026-08-25

## Decision Being Tested

Planner AI should add a narrow `workspace_object` identity root for addressable objects while keeping type-specific data and invariants in relational subtype tables. The root must not become a universal JSON property bag.

## Reversible Prototype

`web/supabase/spikes/m0_workspace_object.sql` runs entirely inside a transaction and creates an isolated `planner_m0` schema. It migrates representative current rows for:

- Vision;
- Goal;
- Action;
- Capture;
- Note;
- Memory;
- Conversation;
- Review;
- planning horizon.

The prototype preserves existing UUIDs, workspace locality, owner-derived creator identity, revision, lifecycle timestamps, and typed containment. It separately projects narrative Markdown into `object_documents`; current subtype tables remain the source and keep their domain fields.

The script fails on:

- UUID collisions between existing entity tables;
- missing or cross-workspace parents;
- invalid containment kinds;
- source/object count differences;
- revision, creator, kind, or deletion mismatch;
- any Markdown content difference.

It emits bounded counts, rolls back, and verifies that the experimental schema no longer exists.

## Important Findings

- Existing UUIDs can become stable object IDs if the collision preflight remains clean.
- Single-owner history does not contain an original `created_by` on every entity. The prototype derives it from `workspaces.owner_user_id`; a production migration must document that provenance rather than presenting it as exact historical authorship.
- Goal containment can use its parent Goal or Vision. Action containment can use its parent Action or Goal. Note containment remains Note-to-Note.
- Capture source remains a typed immutable field, not a document body.
- `planning_horizon` can be addressable without becoming a Page.

## Work Still Required Before ADR Acceptance

1. Run the prototype against representative stress fixtures and a sanitized production snapshot.
2. Add remaining addressable types only when their containment and lifecycle semantics are explicit.
3. Design expand/backfill/verify/contract production migrations with dual-read rollback.
4. Define RLS and grants before placing any root table in an exposed schema.
5. Index every foreign key and measured RLS predicate.
6. Prove existing Operations can write subtype and root rows atomically.
7. Generate and review Supabase types after the production schema is accepted.

This file is not a migration and does not change production schema history.
