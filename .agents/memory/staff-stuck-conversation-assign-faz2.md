---
name: Stuck-conversation auto-assign (Faz 2)
description: assignStuckConversation sweep — tiering logic, settings gate, in-app-only notification, round-robin persistence
---

`runStuckConversationSweep()` in `artifacts/api-server/src/lib/stuckConversationAssigner.ts` is a periodic (5 min interval, 45s initial delay) job gated by `settings.autoAssignStuckConversationsEnabled` (default false).

**Stuck definition:** `needsHuman=true AND assignedToId IS NULL AND status='open' AND channel != 'internal' AND updatedAt <= now - 10min`. Matches the portal-automation stuck-threshold convention (10 min) rather than inventing a new constant.

**Tiering (each tier narrows only if non-empty, else falls back to the wider pool):** eligible pool (active users, role in `STAFF_ROLES`) → working-hours match (per-user `timezone` + `staff_work_schedules`, using the same `tzOffsetMinutes`/`tzWeekday` DST-safe Intl-based helpers as `staffCards.ts` activity report, duplicated locally rather than exported) → country match (via Faz 1's `getStaffCountriesForUsers`, conversation country resolved through `externalContactsTable.leadId → leadsTable.interestedCountry || country`) → round-robin (persisted cursor in `system_kv` key `stuck_conversation_rr_last_user_id`, picks next higher sorted user id, wraps to lowest).

**Why:** working-hours and country are soft preferences, not hard requirements — an empty intersection should never mean "nobody gets assigned," since the whole point is unsticking abandoned conversations.

**Notification is in_app-only by design:** `notification_rules` row for event `conversation.stuck_assigned` seeded with `channels=["in_app"]`, `recipient_type='specific'` (dispatchNotification's `ctx.recipientUserIds` overrides recipient resolution regardless of recipientType, so `specific` + empty `recipientRoles` is inert unless the caller passes explicit `recipientUserIds` — this pattern is safe for any future one-off per-user notification).

**Round-robin correctness gotcha:** the round-robin persists globally across ALL tiers/conversations (not per-tier-pool), so under sustained load different conversations naturally interleave across the same pool rather than always picking the same user when the country/working-hours pool is small.
