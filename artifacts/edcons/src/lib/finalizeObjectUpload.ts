import { apiFetch } from "./apiFetch";

const BASE_URL = import.meta.env?.BASE_URL?.replace(/\/$/, "") || "";

export async function finalizeObjectUpload(objectPath: string): Promise<void> {
  const response = await apiFetch(`${BASE_URL}/api/storage/uploads/finalize`, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectPath }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Upload finalization failed (${response.status})`);
  }
}

export async function uploadAndFinalizeObject(
  uploadURL: string,
  objectPath: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(uploadURL, { ...init, method: "PUT" });
  if (response.ok) await finalizeObjectUpload(objectPath);
  return response;
}
