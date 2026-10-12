---
name: google-calendar
description: Inspect the connected Google Calendar account with Local Studio's read-only tools.
---

# Google Calendar

Use `list_calendars` to resolve calendar IDs, `list_events` for time ranges, `get_event` for exact details, and `suggest_time` for read-only availability analysis.

Use explicit RFC3339 bounds and preserve the event's reported time zone. Never imply that read-only tools created, changed, accepted, declined, or deleted an event.
