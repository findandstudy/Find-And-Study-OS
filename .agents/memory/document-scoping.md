---
name: Document profile-vs-application scoping
description: How student documents are split between profile-level and application-scoped, and the auto-promotion rule on upload.
---

# Document scoping (profile vs application)

The `documents` table row is EITHER profile-level (`applicationId` null) OR
application-scoped (`applicationId` set) — never both. The student-detail
Documents UI shows profile-level docs in the main list/count/ZIP, and
application-scoped docs in a separate grouped "Application-Specific Documents"
card. ZIP export accepts `?profileOnly=true` to exclude application-scoped docs.

## Upload rules (POST /documents)
- "Replace previous version of this type" soft-delete is **scoped**: a
  profile upload only replaces prior profile-level docs; an application upload
  only replaces the prior doc for that same application. Do NOT revert to the
  old global studentId+type soft-delete — it wiped the profile doc whenever a
  doc was uploaded for an application.
- **Auto-promotion**: when a doc is uploaded for an application and the student
  has no active profile-level doc of that type, a second profile-level copy is
  inserted that reuses the same `fileKey` (no byte duplication). If a
  profile-level doc of that type already exists, it is left untouched.

**Why:** Application uploads must build up the student's reusable document
library, but must never overwrite a document the student already has on file.
**How to apply:** Any change to upload/delete/dedupe logic must preserve this
two-scope independence. Sharing `fileKey` across the two rows is safe only
because DELETE /documents/:id soft-deletes (sets `deletedAt`) and never removes
the stored object.

## Two separate intake paths — keep them in sync
Documents enter through TWO unrelated code paths; a rule added to one does NOT
apply to the other automatically:
- Staff/student/agent uploads → `POST /documents` (documents.ts), store via
  object-storage `fileKey`.
- Public widget/embed submissions → `POST /api/public/embed/:slug/apply`
  (embed.ts), store base64 inline in the `fileData` column, with the doc
  attached to the freshly created application (`applicationId` set).
The same auto-promotion rule is implemented in BOTH. In embed.ts the profile
mirror duplicates the base64 `fileData` (no shared key possible for inline
storage), so the two rows are independent copies — acceptable, but unlike the
staff path it is NOT byte-shared. Repeat/different embed applications for the
same student are matched by lower(email) → same studentId, so the "fill profile
only if empty for that type" check correctly leaves an existing profile doc
untouched on later submissions.
