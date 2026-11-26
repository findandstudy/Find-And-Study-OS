import type { ContractDeliverySummary } from "./contractDeliveryStatus";
/** A read-only projection; PDF generation does not determine whether a contract is signed. */
export function agentSignedContractSummary(agentId: number, row: {
  signed: { agentId: number | null; signingSessionId: number; signedAt: Date | string; pdfObjectKey: string | null };
  session: { id: number; status: string };
} | null, emailDelivery?: ContractDeliverySummary) {
  if (!row || row.signed.agentId !== agentId || row.signed.signingSessionId !== row.session.id || row.session.status !== "signed") return null;
  const pdfReady = !!row.signed.pdfObjectKey;
  return {
    status: "signed" as const,
    ...(emailDelivery ? { emailDelivery } : {}),
    signedAt: row.signed.signedAt,
    pdfStatus: pdfReady ? "ready" as const : "pending" as const,
    // The authenticated endpoint resolves ownership again on every download.
    downloadUrl: pdfReady ? "/api/contracts/me/pdf" : null,
  };
}
