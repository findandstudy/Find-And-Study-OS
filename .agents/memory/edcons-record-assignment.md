---
name: edcons record assignment (lead vs student)
description: How to assign a staff member to a lead vs a student via the API, including the field-name difference.
---

# Assigning staff to leads vs students (edcons)

Both leads and students support a single staff assignee (`assigned_to_id` column). The detail-page UI (an "Assigned To" Select) lives in `LeadDetail.tsx` and `StudentDetail.tsx`, loads staff from `/api/users` (admin-gated), filters to roles `super_admin/admin/manager/staff/consultant`, and is permission-gated by `canChangeAssigned` (`isAdmin || hasPermission("records.change_assigned")`).

## Field-name difference in the PATCH body (gotcha)
- Lead: `PATCH /api/leads/:id` expects `{ assignedTo: <id|null> }` — the route maps `assignedTo` → `assignedToId`.
- Student: `PATCH /api/students/:id` expects `{ assignedToId: <id|null> }` directly (it is in STUDENT_PATCH_FIELDS).
**Why:** the two routes were built with different body contracts; sending `assignedTo` to the student route silently does nothing.
**How to apply:** when wiring student assignment, send `assignedToId`; for leads send `assignedTo`. GET responses for both expose `assignedToId`.
