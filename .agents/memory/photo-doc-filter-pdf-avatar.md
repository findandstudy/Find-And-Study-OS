---
name: Photo doc filter & PDF avatar
description: How to correctly detect and display photo-type documents (including PDFs) as student avatar.
---

## Rule
`photoDoc` frontend filter must be `(d.fileKey || d.fileUrl)` — NOT `(d.fileKey || d.fileData)`.

**Why:** `fileData` is a legacy internal column not present in the Document API spec; it is always `undefined` on the client. `fileUrl` is a valid storage path used by some older documents. Both missing → filter silently discards valid photo docs → initials shown.

## ⚠️ Legacy fileData-only photos — Student Detail special case
Some older student photos were stored with `fileData` only (no `fileKey`, no `fileUrl`). The Document API does NOT expose `fileData`, so the frontend receives `fileKey=null, fileUrl=null` for these records. The plain `d.fileKey || d.fileUrl` filter excludes them → `photoDoc = null` → initials shown even though the photo exists.

**Fix:** Use `student.hasPhoto` (denormalized flag on students row, always accurate) as the primary existence check. If `hasPhoto=true`, activate the display block and use `/api/students/:id/photo` for the src — that endpoint queries `fileData` directly from the DB. Keep the documents-list lookup only for `mimeType` (PDF vs image); if no matching doc found, fall back to sentinel `{ mimeType: "image/jpeg" }`.

```ts
const photoDoc = useMemo(() => {
  if (student?.hasPhoto) {
    const photoDocs = documents.filter((d: any) => d.type === "photo" || d.type === "photograph");
    const best = photoDocs.sort(...)[0];
    return best ?? { mimeType: "image/jpeg", fileKey: null, fileUrl: null }; // sentinel
  }
  // normal path for new uploads
  const photoDocs = documents.filter((d: any) => (d.type === "photo" || d.type === "photograph") && (d.fileKey || d.fileUrl));
  ...
}, [documents, student?.hasPhoto]);
```

## How to apply
- `GET /api/documents` returns `fileKey` and `fileUrl` (but not `fileData`).
- Backend `/students/:id/photo` must query `fileUrl` too and 302-redirect when only `fileUrl` is present (SSRF guard: allow http/https only, reject data:/file: → 422).
- For `mimeType === "application/pdf"`, use `React.lazy(() => import("@/components/PdfPhotoAvatar"))` wrapped in `<Suspense>` — `pdfjs-dist` renders page 1 to a canvas. Never use `<img>` for PDF content.
- `pdfjs-dist` worker configured with `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` (Vite-native, no CDN).
- `page.render(...)` type must be cast via `(page.render as (p: {...}) => {...})` — pdfjs-dist RenderParameters typing is strict/version-sensitive.
- **SharedStudentPhotoAvatar component** (`src/components/StudentPhotoAvatar.tsx`): fetches mime type via GET + body cancel, renders img or PdfPhotoAvatar. Used on Lead Detail and Application Detail where `student.hasPhoto` is not directly available. StudentDetail keeps its own upload-overlay logic.
