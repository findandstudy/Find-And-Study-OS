import {
  agentApplicationsTable,
  agentsTable,
  db,
  signedContractsTable,
  signingSessionsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * Reconcile the public signing result into the agency application. It is safe
 * to call repeatedly; only the session linked to the application may mark it
 * signed. Account activation remains a separate manager approval step.
 */
export async function reconcileAgentApplicationSignature(applicationId: number): Promise<void> {
  await db.transaction(async (tx) => {
    // Approval and review lock this same row. Read authority only after taking
    // that lock: a stale status read must never downgrade an approved account.
    await tx.execute(sql`SELECT id FROM agent_applications WHERE id = ${applicationId} FOR UPDATE`);
    const [application] = await tx.select().from(agentApplicationsTable)
      .where(eq(agentApplicationsTable.id, applicationId));
    if (!application?.signingSessionId || application.approvedAgentId) return;
    if (["approved", "rejected", "changes_requested"].includes(application.status)) return;
    const [session] = await tx.select().from(signingSessionsTable)
      .where(eq(signingSessionsTable.id, application.signingSessionId));
    if (!session || session.status !== "signed" || !session.signedAt) return;
    if (session.subjectType !== "agent_application" || session.subjectId !== application.id) return;
    if (session.templateId !== application.contractTemplateId) return;
    if ((session.verifiedEmail || "").trim().toLowerCase() !== application.email.trim().toLowerCase()) return;
    const intake = session.intakeData && typeof session.intakeData === "object" ? session.intakeData as Record<string, unknown> : {};
    if (intake.agentApplicationContractHash !== application.contractDataHash) return;

    const [signed] = await tx.select({ id: signedContractsTable.id }).from(signedContractsTable)
      .where(eq(signedContractsTable.signingSessionId, session.id));
    const signedContractId = signed?.id;
    if (!signedContractId) return;

    const now = new Date();
    await tx.update(agentApplicationsTable).set({
      status: "signed",
      signedContractId,
      signedAt: session.signedAt,
      portalAccessStatus: "signed_pending_approval",
      submittedAt: application.submittedAt || now,
      changeRequestMessage: null,
      accessRestrictedAt: null,
      accessRestrictionReason: null,
      updatedAt: now,
    }).where(and(
      eq(agentApplicationsTable.id, application.id),
      eq(agentApplicationsTable.signingSessionId, session.id),
    ));
    if (application.provisionalAgentId) {
      await tx.update(agentsTable).set({
        status: "provisional",
        accessTier: "provisional",
        updatedAt: now,
      }).where(eq(agentsTable.id, application.provisionalAgentId));
    }
  });
}

export async function markAgentApplicationContractSigned(params: {
  subjectType: string | null;
  subjectId: number | null;
}): Promise<void> {
  if (params.subjectType !== "agent_application" || !params.subjectId) return;
  await reconcileAgentApplicationSignature(params.subjectId);
}

/** Enforce provisional application deadlines without racing final approval or signing. */
export async function reconcileAgentApplicationRestriction(applicationId: number, agentId: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM agent_applications WHERE id = ${applicationId} FOR UPDATE`);
    const [application] = await tx.select().from(agentApplicationsTable).where(eq(agentApplicationsTable.id, applicationId));
    const [agent] = await tx.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!application || !agent || (application.provisionalAgentId !== agentId && application.approvedAgentId !== agentId)) return null;
    const [session] = application.signingSessionId
      ? await tx.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, application.signingSessionId))
      : [];
    // Approval is a separate authority decision. A read-time deadline check
    // must never undo it, even if this request started while still provisional.
    if (application.approvedAgentId || application.status === "approved" || agent.accessTier === "full") return { application, agent, session };
    const [signed] = await tx.select({ id: signedContractsTable.id }).from(signedContractsTable)
      .innerJoin(signingSessionsTable, eq(signedContractsTable.signingSessionId, signingSessionsTable.id))
      .where(and(eq(signedContractsTable.agentId, agentId), eq(signingSessionsTable.status, "signed"))).limit(1);
    const contractSigned = !!signed || session?.status === "signed";
    const rejected = application.status === "rejected";
    const expired = !contractSigned && (session?.status === "expired"
      || (!!application.contractDeadlineAt && application.contractDeadlineAt.getTime() < Date.now()));
    if (!rejected && !expired && agent.accessTier !== "restricted") return { application, agent, session };
    const now = new Date();
    const reason = rejected ? "application_rejected" : application.accessRestrictionReason || "contract_expired";
    const applicationPatch = { portalAccessStatus: "restricted", accessRestrictedAt: application.accessRestrictedAt ?? now, accessRestrictionReason: reason, updatedAt: now };
    const agentPatch = { accessTier: "restricted", status: "provisional", updatedAt: now };
    if (application.portalAccessStatus !== "restricted" || agent.accessTier !== "restricted") {
      await tx.update(agentApplicationsTable).set(applicationPatch).where(eq(agentApplicationsTable.id, application.id));
      await tx.update(agentsTable).set(agentPatch).where(eq(agentsTable.id, agent.id));
    }
    return { application: { ...application, ...applicationPatch }, agent: { ...agent, ...agentPatch }, session };
  });
}
