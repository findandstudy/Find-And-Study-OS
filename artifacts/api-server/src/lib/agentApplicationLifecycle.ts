import {
  agentApplicationsTable,
  db,
  signedContractsTable,
  signingSessionsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * Reconcile the public signing result into the agency application. It is safe
 * to call repeatedly; only the session linked to the application may mark it
 * signed. Account activation remains a separate manager approval step.
 */
export async function reconcileAgentApplicationSignature(applicationId: number): Promise<void> {
  const [application] = await db.select().from(agentApplicationsTable)
    .where(eq(agentApplicationsTable.id, applicationId));
  if (!application?.signingSessionId || application.approvedAgentId) return;
  const [session] = await db.select().from(signingSessionsTable)
    .where(eq(signingSessionsTable.id, application.signingSessionId));
  if (!session || session.status !== "signed" || !session.signedAt) return;
  if (session.subjectType !== "agent_application" || session.subjectId !== application.id) return;
  if (session.templateId !== application.contractTemplateId) return;
  if ((session.verifiedEmail || "").trim().toLowerCase() !== application.email.trim().toLowerCase()) return;
  const intake = session.intakeData && typeof session.intakeData === "object" ? session.intakeData as Record<string, unknown> : {};
  if (intake.agentApplicationContractHash !== application.contractDataHash) return;

  const [signed] = await db.select({ id: signedContractsTable.id }).from(signedContractsTable)
    .where(eq(signedContractsTable.signingSessionId, session.id));
  const signedContractId = signed?.id;
  if (!signedContractId) return;

  const now = new Date();
  await db.update(agentApplicationsTable).set({
    status: "signed",
    signedContractId,
    signedAt: session.signedAt,
    submittedAt: application.submittedAt || now,
    changeRequestMessage: null,
    updatedAt: now,
  }).where(and(
    eq(agentApplicationsTable.id, application.id),
    eq(agentApplicationsTable.signingSessionId, session.id),
  ));
}

export async function markAgentApplicationContractSigned(params: {
  subjectType: string | null;
  subjectId: number | null;
}): Promise<void> {
  if (params.subjectType !== "agent_application" || !params.subjectId) return;
  await reconcileAgentApplicationSignature(params.subjectId);
}
