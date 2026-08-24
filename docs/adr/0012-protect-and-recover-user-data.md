---
status: accepted
---

# Protect and recover user data

First-release content is protected in transit and at rest but is not end-to-end encrypted. Authorized Planner AI servers and explicitly selected AI providers may process the minimum plaintext needed for product behavior. Records enter a recoverable 30-day Trash; account deletion has a seven-day cancellation window before active data, attachments, grants, and agent state are permanently removed.

Before external beta, production will use paid daily Supabase backups plus encrypted off-site logical database exports and a separately verified backup of private Storage objects. Initial targets are a 24-hour recovery point and four-hour recovery time, proven by a pre-beta restore drill and quarterly exercises. Note attachments use private, owner-scoped Storage, a narrow file allowlist, a 25 MB limit, malware quarantine, and the same export, Trash, deletion, and backup lifecycle as Notes.

## Consequences

- Planner AI must state its encryption and AI-processing boundary plainly and must not claim end-to-end encryption.
- Provider tokens and similar secrets receive application-level encryption and least-privilege access.
- Empty Trash, full export, and account deletion are consequential Operations with preview and confirmation.
- Disaster-recovery backups age out under documented retention and are not used for selective record restoration.
