---
name: SIT asset URL signing, zero-doc guard, already_exists doc gap
description: Why SIT create webhook silently produced students with no photo/documents, and the real limit on recovering docs for an existing Zoho student.
---

`fileKey` (object-storage key) is NOT a URL and must never be handed to an
external URL-fetching webhook as one; only a genuine absolute http(s) `fileUrl`
that is not one of our own session-gated routes (`/api/documents/:id/file`,
`/api/students/:id/photo`) is safe to send directly. Everything else — fileKey,
base64 fileData, or a self-referential fileUrl — must go through the signed
endpoint (`buildSignedDocumentPath`/`buildSignedStudentPhotoPath`). This was
the root cause of SIT creating students with zero photo/documents: the
create-webhook's server-side fetch got a 401/403 on an unsigned session route,
but the create itself still "succeeded" with empty attachments.

**Why:** an external n8n webhook has no session/cookies, so any URL it fetches
must be either truly public or explicitly signed; there is no way to tell from
inside the webhook that the fetch silently failed.

**How to apply:** shared signing-secret precedence lives in
`lib/portal-adapters/src/assetSigningSecret.ts` (`ASSET_URL_SIGNING_SECRET` →
`SESSION_SECRET` → `EMBED_TOKEN_SECRET`), consumed by both
`documentSigning.ts` and `studentPhotoSigning.ts`. `profile.ts`'s
`publicDocUrl`/`docFetchUrl` gate on `isSelfReferentialAssetPath` before
trusting any `fileUrl`. Adapters that build create payloads from URLs (SIT)
should also guard: never POST a create with zero fetchable assets (log +
skip) rather than create an empty record.

**Known gap:** SIT exposes only `createStudentViaWebhook` (create) and
`createApplicationViaWebhook` — no "update student" / "attach document"
webhook exists. When a student already exists in Zoho (dedup match) with
missing photo/documents, there is currently NO safe way to backfill them
without risking a duplicate create; this is a real limitation, not a bug to
silently paper over. Application creation for an existing student still
proceeds normally (separate, already-idempotent path).
