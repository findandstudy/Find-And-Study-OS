import { db, applicationStageDocumentsTable, applicationsTable, studentsTable, usersTable, agentsTable, settingsTable } from "@workspace/db";
import { and, eq, isNotNull, isNull, inArray, sql } from "drizzle-orm";
import { dispatchNotification } from "./notificationDispatcher";

const CHECK_INTERVAL = 60 * 60 * 1000;
const OFFER_DOC_STAGES = ["offer_received", "acceptance_letter", "final_acceptance"];

const STAGE_LABELS: Record<string, string> = {
  offer_received: "Offer",
  acceptance_letter: "Acceptance Letter",
  final_acceptance: "Final Acceptance Letter",
};

function parseThresholds(csv: string | null | undefined): number[] {
  const raw = (csv || "30,14,7,1").split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
  return Array.from(new Set(raw)).sort((a, b) => b - a);
}

function daysBetween(future: Date, now: Date): number {
  return Math.ceil((future.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export async function checkOfferLetterExpiries(): Promise<void> {
  try {
    const [settings] = await db.select({ offerExpiryWarningDays: settingsTable.offerExpiryWarningDays }).from(settingsTable);
    const thresholds = parseThresholds(settings?.offerExpiryWarningDays);
    if (thresholds.length === 0) return;

    const now = new Date();
    const docs = await db.select({
      id: applicationStageDocumentsTable.id,
      applicationId: applicationStageDocumentsTable.applicationId,
      stage: applicationStageDocumentsTable.stage,
      fileName: applicationStageDocumentsTable.fileName,
      validUntil: applicationStageDocumentsTable.validUntil,
      expiryNotifiedThresholds: applicationStageDocumentsTable.expiryNotifiedThresholds,
    })
      .from(applicationStageDocumentsTable)
      .where(and(
        isNotNull(applicationStageDocumentsTable.validUntil),
        inArray(applicationStageDocumentsTable.stage, OFFER_DOC_STAGES),
      ));

    if (docs.length === 0) return;

    for (const doc of docs) {
      if (!doc.validUntil) continue;
      const validUntil = new Date(doc.validUntil);
      const daysLeft = daysBetween(validUntil, now);
      if (daysLeft <= 0) continue;

      // Pick the smallest threshold >= daysLeft (e.g. daysLeft=6 with [30,14,7,1] → 7).
      // This way each threshold fires exactly once as the deadline approaches.
      const ascending = [...thresholds].sort((a, b) => a - b);
      const matched = ascending.find(t => daysLeft <= t);
      if (!matched) continue;

      const alreadyNotified = (doc.expiryNotifiedThresholds || "")
        .split(",").map(s => s.trim()).filter(Boolean);
      if (alreadyNotified.includes(String(matched))) continue;

      const [app] = await db.select({
        id: applicationsTable.id,
        studentId: applicationsTable.studentId,
        agentId: applicationsTable.agentId,
        assignedToId: applicationsTable.assignedToId,
        universityName: applicationsTable.universityName,
        programName: applicationsTable.programName,
      }).from(applicationsTable).where(and(eq(applicationsTable.id, doc.applicationId), isNull(applicationsTable.deletedAt)));
      if (!app) continue;

      const [student] = await db.select({
        firstName: studentsTable.firstName,
        lastName: studentsTable.lastName,
        userId: studentsTable.userId,
      }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
      const studentName = student ? `${student.firstName || ""} ${student.lastName || ""}`.trim() : "";

      const recipientUserIds = new Set<number>();

      const adminUsers = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(
          inArray(usersTable.role, ["super_admin", "admin", "manager", "staff", "consultant"]),
          eq(usersTable.isActive, true),
        ));
      for (const u of adminUsers) recipientUserIds.add(u.id);

      if (app.assignedToId) recipientUserIds.add(app.assignedToId);

      if (app.agentId) {
        const [agentRec] = await db.select({ userId: agentsTable.userId, parentAgentId: agentsTable.parentAgentId })
          .from(agentsTable).where(eq(agentsTable.id, app.agentId));
        if (agentRec?.userId) recipientUserIds.add(agentRec.userId);
        if (agentRec?.parentAgentId) {
          const [parentAgent] = await db.select({ userId: agentsTable.userId })
            .from(agentsTable).where(eq(agentsTable.id, agentRec.parentAgentId));
          if (parentAgent?.userId) recipientUserIds.add(parentAgent.userId);
        }
      }

      if (student?.userId) recipientUserIds.add(student.userId);

      if (recipientUserIds.size === 0) continue;

      const stageLabel = STAGE_LABELS[doc.stage] || doc.stage;
      const validUntilStr = validUntil.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
      const title = `${stageLabel} ${daysLeft} gün içinde geçerliliğini yitiriyor`;
      const body = `${studentName ? studentName + " — " : ""}${app.universityName || ""}${app.programName ? " / " + app.programName : ""} için yüklenen ${stageLabel.toLowerCase()} belgesinin son geçerlilik tarihi: ${validUntilStr} (${daysLeft} gün kaldı).`;

      await dispatchNotification({
        event: "application.offer_letter_expiring",
        title,
        body,
        actionUrl: `/staff/applications/${app.id}`,
        icon: "AlertTriangle",
        recipientUserIds: Array.from(recipientUserIds),
        data: {
          applicationId: app.id,
          stage: doc.stage,
          documentId: doc.id,
          validUntil: validUntil.toISOString(),
          daysLeft,
        },
        templateVars: {
          studentName,
          universityName: app.universityName || "",
          programName: app.programName || "",
          validUntil: validUntilStr,
          daysLeft: String(daysLeft),
          stageLabel,
        },
      });

      const updated = [...alreadyNotified, String(matched)].join(",");
      await db.update(applicationStageDocumentsTable)
        .set({ expiryNotifiedThresholds: updated })
        .where(eq(applicationStageDocumentsTable.id, doc.id));

      console.log(`[OFFER-EXPIRY] Notified ${recipientUserIds.size} recipient(s) for doc ${doc.id} — ${daysLeft}d left, threshold ${matched}`);
    }
  } catch (err) {
    console.error("[OFFER-EXPIRY] Check error:", err);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startOfferExpiryChecker(): void {
  if (intervalHandle) return;
  console.log(`[OFFER-EXPIRY] Checker started, running every ${CHECK_INTERVAL / 60000} minute(s)`);
  setTimeout(() => { checkOfferLetterExpiries(); }, 15000);
  intervalHandle = setInterval(() => { checkOfferLetterExpiries(); }, CHECK_INTERVAL);
}
