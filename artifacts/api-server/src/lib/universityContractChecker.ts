import { db, universityContractsTable, universitiesTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull, isNull, inArray } from "drizzle-orm";
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

async function getRecipients(): Promise<number[]> {
  const admins = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      inArray(usersTable.role, ["super_admin", "admin"]),
      eq(usersTable.isActive, true),
    ));
  return admins.map(u => u.id);
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

      if (daysLeft <= 0) {
        if (row.expiryNoticeSentAt) continue;
        const claimed = await db.update(universityContractsTable)
          .set({ expiryNoticeSentAt: now })
          .where(and(eq(universityContractsTable.id, row.id), isNull(universityContractsTable.expiryNoticeSentAt)))
          .returning({ id: universityContractsTable.id });
        if (claimed.length === 0) continue;

        await dispatchNotification({
          event: "university_contract.expired",
          title: `Üniversite sözleşmesi sona erdi — ${uniName}`,
          body: `${uniName} (${row.country}) sözleşmesi ${expiryStr} tarihinde sona erdi. Lütfen yenileyin.`,
          actionUrl: `/admin/university-contracts`,
          icon: "AlertOctagon",
          recipientUserIds: recipientIds,
          data: { contractId: row.id, universityId: row.universityId, expiryDate: expiry.toISOString() },
          templateVars: { universityName: uniName, country: row.country, expiryDate: expiryStr },
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

      await dispatchNotification({
        event: "university_contract.expiring",
        title: `Üniversite sözleşmesi ${daysLeft} gün içinde sona eriyor — ${uniName}`,
        body: `${uniName} (${row.country}) sözleşmesi ${expiryStr} tarihinde sona eriyor (${daysLeft} gün kaldı).`,
        actionUrl: `/admin/university-contracts`,
        icon: "AlertTriangle",
        recipientUserIds: recipientIds,
        data: { contractId: row.id, universityId: row.universityId, expiryDate: expiry.toISOString(), daysLeft, threshold: matched.days },
        templateVars: { universityName: uniName, country: row.country, expiryDate: expiryStr, daysLeft: String(daysLeft), threshold: String(matched.days) },
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
