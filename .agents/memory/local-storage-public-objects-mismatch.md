---
name: Local storage driver has no "public/" subfolder
description: Why outbound senders (e.g. Zernio) must resolve attachment keys via the same public-objects resolver used by the storage route, not by hand-parsing URLs.
---

With `STORAGE_DRIVER=local`, uploaded files are written flat as `localDir/<prefix>/<objectId>` — there is no `public/` subfolder anywhere in the upload path. `normalizeObjectEntityPath` returns a virtual `/objects/<relPath>` form intended only for the authenticated `/storage/objects/*` route, not for public delivery URLs.

**Why:** A caller that builds/derives a public-objects key by naively appending a URL path (or by copying the `/objects/...` virtual path) ends up with keys like `public-objects//objects/inbox/<uuid>` — double slashes and a stray `objects/` prefix — which don't match the real on-disk layout (`inbox/<uuid>`) and fail to resolve, silently breaking outbound delivery of attachments.

**How to apply:** Any code that needs to fetch a stored file by its public URL/key (outbound senders, integrations, etc.) must normalize the key (strip leading slashes, strip a leading `objects/` segment, collapse `//`) and then resolve it through the shared `searchPublicObject` resolver in `objectStorage.ts` (which tries the bare path first, with a legacy `public/`-prefixed fallback) — never hand-roll key parsing per caller.
