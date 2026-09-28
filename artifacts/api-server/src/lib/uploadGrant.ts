import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { canonicalizeKey } from "./objectAuthz";

export const UPLOAD_GRANT_TTL_MS = 15 * 60 * 1000;

function normalizedContentType(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

export async function issueUploadGrant(input: {
  objectPath: string;
  uploadedBy: number;
  expectedSize: number;
  expectedContentType: string;
  now?: Date;
}): Promise<boolean> {
  const objectKey = canonicalizeKey(input.objectPath);
  const contentType = normalizedContentType(input.expectedContentType);
  if (!objectKey || !Number.isSafeInteger(input.expectedSize) || input.expectedSize <= 0
    || input.expectedSize > 25 * 1024 * 1024 || contentType.length < 3 || contentType.length > 200) {
    return false;
  }
  const now = input.now ?? new Date();
  try {
    const result = await pool.query(
      `INSERT INTO object_upload_grants
        (object_key, uploaded_by, expected_size, expected_content_type, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (object_key) DO NOTHING
       RETURNING object_key`,
      [objectKey, input.uploadedBy, input.expectedSize, contentType,
        new Date(now.getTime() + UPLOAD_GRANT_TTL_MS)],
    );
    return result.rowCount === 1;
  } catch (error) {
    console.error("[uploadGrant] issuance failed", error);
    return false;
  }
}

export type UploadGrantFinalizeResult =
  | { ok: true; replayed: boolean; sha256: string }
  | { ok: false; reason: "invalid" | "not_found" | "expired" | "metadata_mismatch" | "conflict" };

export async function finalizeUploadGrant(input: {
  objectPath: string;
  uploadedBy: number;
  declaredSize: number;
  declaredContentType: string;
  bytes: Buffer;
  contentType: string;
  now?: Date;
}): Promise<UploadGrantFinalizeResult> {
  const objectKey = canonicalizeKey(input.objectPath);
  const contentType = normalizedContentType(input.contentType);
  const declaredContentType = normalizedContentType(input.declaredContentType);
  if (!objectKey || input.bytes.length <= 0 || input.bytes.length > 25 * 1024 * 1024 || !contentType) {
    return { ok: false, reason: "invalid" };
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const now = input.now ?? new Date();
  const updated = await pool.query(
    `UPDATE object_upload_grants
     SET status = 'FINALIZED', final_size = $4, final_content_type = $5,
         content_sha256 = $6, finalized_at = $7
     WHERE object_key = $1 AND uploaded_by = $2 AND status = 'ISSUED'
       AND expires_at >= $7 AND expected_size = $3
       AND expected_content_type = $8
     RETURNING object_key`,
    [objectKey, input.uploadedBy, input.declaredSize, input.bytes.length,
      contentType, sha256, now, declaredContentType],
  );
  if (updated.rowCount === 1) {
    return { ok: true, replayed: false, sha256 };
  }

  const selected = await pool.query<{
      uploaded_by: number; expected_size: number; expected_content_type: string;
      status: string; expires_at: Date; final_size: number | null;
      final_content_type: string | null; content_sha256: string | null;
    }>(
      `SELECT uploaded_by, expected_size, expected_content_type, status, expires_at,
              final_size, final_content_type, content_sha256
       FROM object_upload_grants WHERE object_key = $1`,
      [objectKey],
    );
  const grant = selected.rows[0];
  if (!grant || grant.uploaded_by !== input.uploadedBy) {
    return { ok: false, reason: "not_found" };
  }
  if (grant.status !== "ISSUED") {
    const replayed = grant.status === "FINALIZED"
      && grant.final_size === input.bytes.length
      && grant.final_content_type === contentType
      && grant.content_sha256 === sha256;
    return replayed ? { ok: true, replayed: true, sha256 } : { ok: false, reason: "conflict" };
  }
  if (grant.expires_at.getTime() < now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (grant.expected_size !== input.declaredSize || grant.expected_content_type !== declaredContentType) {
    return { ok: false, reason: "metadata_mismatch" };
  }
  return { ok: false, reason: "conflict" };
}
