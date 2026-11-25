import { pool } from "@workspace/db";
import { deserializeEmailAttachments } from "./emailDeliveryPolicy";

export type ContractDeliverySummary = { state: "pending" | "sent" | "attention" | "unconfirmed"; acceptedAt: Date | string | null };

async function readStoredContractPdf(key: string): Promise<Buffer> {
  if (!/^\/objects\/signed-contracts\/[a-zA-Z0-9._-]+$/.test(key)) throw new Error("CONTRACT_PDF_KEY_INVALID");
  const { ObjectStorageService } = await import("./objectStorage");
  const { readBoundedDocumentStream } = await import("./documentByteLimits");
  const file = await new ObjectStorageService().getObjectEntityFile(key);
  return readBoundedDocumentStream(file.createReadStream(), { maxBytes: 10 * 1024 * 1024, readTimeoutMs: 10000 });
}

/** Caller first resolves the signing token or authenticated agency ownership. */
export async function readContractDeliveryStatus(sessionId: number, agentId?: number, readPdf = readStoredContractPdf): Promise<ContractDeliverySummary> {
  const unknown: ContractDeliverySummary = { state: "unconfirmed", acceptedAt: null };
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0
    || (agentId !== undefined && (!Number.isSafeInteger(agentId) || agentId <= 0))) return unknown;
  try {
    const result = await pool.query(`SELECT q.id,q.status,q.sent_at,q.provider_message_id,q.attachments,
      sc.pdf_object_key,sc.evidence_hash
      FROM signed_contracts sc JOIN signing_sessions ss ON ss.id=sc.signing_session_id
      JOIN email_queue q ON q.idempotency_key=('signed-contract:'||sc.id::text||':signer:v1')
        AND q.to_email=sc.signer_email
      WHERE ss.id=$1 AND ss.status='signed' AND ss.revoked_at IS NULL
        AND ($2::integer IS NULL OR sc.agent_id=$2) LIMIT 1`, [sessionId, agentId ?? null]);
    const row = result.rows[0];
    if (!row) return unknown;
    // Never infer mail delivery from legacy signed_contracts.emailed_at.
    // The existing queue binds one frozen attachment to this contract/recipient.
    const attachments = deserializeEmailAttachments(row.attachments);
    if (attachments?.length !== 1 || attachments[0].contentType !== "application/pdf"
      || attachments[0].content.subarray(0, 5).toString("ascii") !== "%PDF-"
      || !row.pdf_object_key || !row.evidence_hash) return unknown;
    if (row.status === "sent") {
      // evidence_hash identifies the rendered evidence, not the PDF file bytes.
      // A valid but different queue attachment is not this signed document.
      if (!attachments[0].content.equals(await readPdf(row.pdf_object_key))) return unknown;
      const acceptedAt = row.sent_at && new Date(row.sent_at);
      const messagePrefix = `<fas-email-${row.id}@`;
      return acceptedAt && Number.isFinite(acceptedAt.getTime()) && typeof row.provider_message_id === "string"
        && row.provider_message_id.startsWith(messagePrefix) && /^<[^<>\s]+@[^<>\s@]+>$/.test(row.provider_message_id)
        ? { state: "sent", acceptedAt } : unknown;
    }
    if (row.status === "pending" || row.status === "processing") return { state: "pending", acceptedAt: null };
    if (["unknown", "failed", "blocked"].includes(row.status)) return { state: "attention", acceptedAt: null };
    return unknown;
  } catch { return unknown; }
}
