---
name: Photo doc filter & PDF avatar
description: How to correctly detect and display photo-type documents (including PDFs) as student avatar.
---

## Rule
`photoDoc` frontend filter must be `(d.fileKey || d.fileUrl)` — NOT `(d.fileKey || d.fileData)`.

**Why:** `fileData` is a legacy internal column not present in the Document API spec; it is always `undefined` on the client. `fileUrl` is a valid storage path used by some older documents. Both missing → filter silently discards valid photo docs → initials shown.

## How to apply
- `GET /api/documents` returns `fileKey` and `fileUrl` (but not `fileData`).
- Backend `/students/:id/photo` must query `fileUrl` too and 302-redirect when only `fileUrl` is present (SSRF guard: allow http/https only, reject data:/file: → 422).
- For `mimeType === "application/pdf"`, use `React.lazy(() => import("@/components/PdfPhotoAvatar"))` wrapped in `<Suspense>` — `pdfjs-dist` renders page 1 to a canvas. Never use `<img>` for PDF content.
- `pdfjs-dist` worker configured with `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` (Vite-native, no CDN).
- `page.render(...)` type must be cast via `(page.render as (p: {...}) => {...})` — pdfjs-dist RenderParameters typing is strict/version-sensitive.
