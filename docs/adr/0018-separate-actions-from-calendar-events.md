---
status: accepted
---

# Separate Actions from Calendar Events

An Action represents work to complete. A Calendar Event represents reserved external time. An Action may have a planning date or link to an Event, but it never becomes an Event automatically.

After the invite-only beta is stable, Google Calendar launches first with user-selected calendars and read-only event or availability context. Confirmed event creation and updates follow only after read behavior is trusted. Outlook Calendar and email-inbox access remain deferred.

## Consequences

- Calendar writes are consequential Operations with exact previews.
- Linked records preserve external event ID, source calendar, and synchronization state.
- Bulk scheduling and silent conversion of Actions into Events are prohibited.
