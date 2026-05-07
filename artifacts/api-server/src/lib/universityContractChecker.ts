import { db, universityContractsTable, universitiesTable, usersTable, rolesTable } from "@workspace/db";
import { and, eq, isNotNull, isNull, inArray, or, sql } from "drizzle-orm";
import { dispatchNotification } from "./notificationDispatcher";

const CHECK_INTERVAL = 60 * 60 * 1000;

const THRESHOLDS = [
  { days: 30, field: "lastWarning30SentAt" as const },
  { days: 14, field: "lastWarning14SentAt" as const },
  { days: 7, field: "lastWarning7SentAt" as const },
  { days: 1, field: "lastWarning1SentAt" as const },
];

function daysBetween(future: Date, now: Date): number {
  return Math.ceil((future.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// Recipients:
//   * All active admin-level users (super_admin, admin, manager).
//   * Any active user whose role (rolesTable) grants
//     `university_contracts.view`.
//   * Any active staff (agent_staff) whose individual
//     `agent_staff_permissions` JSON array contains
//     `university_contracts.view`.
// This covers admins + staff responsible for the module even when no
// per-university assignment table exists.
async function getRecipients(): Promise<number[]> {
  const PERM = "university_contracts.view";
  const ADMIN_ROLES = ["super_admin", "admin", "manager"];
  try {
    const roles = await db.select({ name: rolesTable.name, perms: rolesTable.permissions })
      .from(rolesTable);
    const customRoleNames = roles
      .filter(r => Array.isArray(r.perms) && (r.perms as string[]).includes(PERM))
      .map(r => r.name)
      .filter(n => !ADMIN_ROLES.includes(n));
    const targetRoles = [...ADMIN_ROLES, ...customRoleNames];

    const users = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.isActive, true),
        or(
          inArray(usersTable.role, targetRoles),
          sql`${usersTable.agentStaffPermissions}::jsonb ? ${PERM}`,
        ),
      ));
    return Array.from(new Set(users.map(u => u.id)));
  } catch (err) {
    console.error("[UNI-CONTRACT] getRecipients fallback:", err);
    const users = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.role, ADMIN_ROLES), eq(usersTable.isActive, true)));
    return users.map(u => u.id);
  }
}

function buildEmail(subject: string, body: string, actionUrl: string): { subject: string; html: string; text: string } {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:22px;">Find &amp; Study</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px;">University Contract Notification</p>
    </div>
    <div style="padding:28px;">
      <h2 style="margin:0 0 14px;color:#111827;font-size:18px;">${escape(subject)}</h2>
      <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;white-space:pre-line;">${escape(body)}</p>
      <div style="text-align:center;margin:0 0 20px;">
        <a href="${actionUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">Open contract</a>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Automated notification from Find &amp; Study.</p>
    </div>
  </div></body></html>`;
  return { subject, html, text: body };
}

export async function checkUniversityContractExpiries(): Promise<void> {
  try {
    const rows = await db.select({
      id: universityContractsTable.id,
      universityId: universityContractsTable.universityId,
      country: universityContractsTable.country,
      year: universityContractsTable.year,
      expiryDate: universityContractsTable.expiryDate,
      lastWarning30SentAt: universityContractsTable.lastWarning30SentAt,
      lastWarning14SentAt: universityContractsTable.lastWarning14SentAt,
      lastWarning7SentAt: universityContractsTable.lastWarning7SentAt,
      lastWarning1SentAt: universityContractsTable.lastWarning1SentAt,
      expiryNoticeSentAt: universityContractsTable.expiryNoticeSentAt,
      universityName: universitiesTable.name,
    })
      .from(universityContractsTable)
      .leftJoin(universitiesTable, eq(universitiesTable.id, universityContractsTable.universityId))
      .where(and(
        isNotNull(universityContractsTable.expiryDate),
        isNull(universityContractsTable.deletedAt),
      ));

    if (rows.length === 0) return;

    const recipientIds = await getRecipients();
    if (recipientIds.length === 0) return;

    const now = new Date();

    for (const row of rows) {
      if (!row.expiryDate) continue;
      const expiry = new Date(row.expiryDate);
      const daysLeft = daysBetween(expiry, now);
      const uniName = row.universityName || `Üniversite #${row.universityId}`;
      const expiryStr = expiry.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });

      const actionUrl = `/admin/university-contracts/${row.id}`;

      if (daysLeft <= 0) {
        if (row.expiryNoticeSentAt) continue;
        const claimed = await db.update(universityContractsTable)
          .set({ expiryNoticeSentAt: now })
          .where(and(eq(universityContractsTable.id, row.id), isNull(universityContractsTable.expiryNoticeSentAt)))
          .returning({ id: universityContractsTable.id });
        if (claimed.length === 0) continue;

        const subject = `[FindAndStudy] University contract expired: ${uniName} (${row.country})`;
        const body = `The agreement with ${uniName} (${row.country}) expired on ${expiryStr}.\n\nPlease renew the contract or upload an updated version in EduConsult OS.`;
        await dispatchNotification({
          event: "university_contract.expired",
          title: `Üniversite sözleşmesi sona erdi — ${uniName}`,
          body: `${uniName} (${row.country}) sözleşmesi ${expiryStr} tarihinde sona erdi. Lütfen yenileyin.`,
          actionUrl,
          icon: "AlertOctagon",
          recipientUserIds: recipientIds,
          data: { contractId: row.id, universityId: row.universityId, expiryDate: expiry.toISOString() },
          templateVars: { universityName: uniName, country: row.country, expiryDate: expiryStr },
          emailOverride: buildEmail(subject, body, actionUrl),
        });
        console.log(`[UNI-CONTRACT] Expiry notice sent for contract ${row.id} (${uniName})`);
        continue;
      }

      // Find smallest matching threshold (e.g. 6 days → 7).
      const ascending = [...THRESHOLDS].sort((a, b) => a.days - b.days);
      const matched = ascending.find(t => daysLeft <= t.days);
      if (!matched) continue;
      if (row[matched.field]) continue;

      const claimed = await db.update(universityContractsTable)
        .set({ [matched.field]: now })
        .where(and(eq(universityContractsTable.id, row.id), isNull(universityContractsTable[matched.field])))
        .returning({ id: universityContractsTable.id });
      if (claimed.length === 0) continue;

      const subject = `[FindAndStudy] University contract expiring in ${matched.days} days: ${uniName} (${row.country})`;
      const body = `The agreement with ${uniName} (${row.country}) is set to expire on ${expiryStr} (${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining).\n\nPlease prepare a renewal or contact the university to extend the contract.`;
      await dispatchNotification({
        event: "university_contract.expiring",
        title: `Üniversite sözleşmesi ${daysLeft} gün içinde sona eriyor — ${uniName}`,
        body: `${uniName} (${row.country}) sözleşmesi ${expiryStr} tarihinde sona eriyor (${daysLeft} gün kaldı).`,
        actionUrl,
        icon: "AlertTriangle",
        recipientUserIds: recipientIds,
        data: { contractId: row.id, universityId: row.universityId, expiryDate: expiry.toISOString(), daysLeft, threshold: matched.days },
        templateVars: { universityName: uniName, country: row.country, expiryDate: expiryStr, daysLeft: String(daysLeft), threshold: String(matched.days) },
        emailOverride: buildEmail(subject, body, actionUrl),
      });
      console.log(`[UNI-CONTRACT] Notified ${recipientIds.length} for contract ${row.id} (${uniName}) — ${daysLeft}d, threshold ${matched.days}`);
    }
  } catch (err) {
    console.error("[UNI-CONTRACT] Check error:", err);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startUniversityContractChecker(): void {
  if (intervalHandle) return;
  console.log(`[UNI-CONTRACT] Checker started, running every ${CHECK_INTERVAL / 60000} minute(s)`);
  setTimeout(() => { checkUniversityContractExpiries(); }, 18000);
  intervalHandle = setInterval(() => { checkUniversityContractExpiries(); }, CHECK_INTERVAL);
}
