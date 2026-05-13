import { apiFetch } from "./apiFetch";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface UploadResult {
  fileKey: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Uploads a file to object storage via the presigned-URL flow used by the
 * `documents` table. Returns the canonical `fileKey` to send to
 * POST /api/documents (no more base64 in the request body).
 */
export async function uploadDocumentFile(file: File): Promise<UploadResult> {
  const reqRes = await apiFetch(`${BASE_URL}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!reqRes.ok) {
    const txt = await reqRes.text().catch(() => "");
    throw new Error(txt || "Failed to get upload URL");
  }
  const { uploadURL, objectPath } = await reqRes.json() as { uploadURL: string; objectPath: string };
  if (!uploadURL || !objectPath) throw new Error("Invalid upload URL response");

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!putRes.ok) {
    throw new Error(`Upload to storage failed (${putRes.status})`);
  }

  return { fileKey: objectPath, mimeType: file.type, sizeBytes: file.size };
}
