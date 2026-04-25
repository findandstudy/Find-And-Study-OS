import { db, leadsTable, studentsTable, agentsTable, usersTable, conversationsTable } from "@workspace/db";
import { isNull, sql } from "drizzle-orm";
import { toE164 } from "../src/lib/inbox/phone";

async function backfillTable<T extends { id: number; phone: string | null; phoneE164: string | null }>(
  name: string,
  table: any
): Promise<{ scanned: number; updated: number; failed: number }> {
  const rows = await db.select().from(table).where(isNull(table.phoneE164));
  let updated = 0;
  let failed = 0;
  for (const row of rows as any[]) {
    if (!row.phone) continue;
    const normalized = toE164(row.phone);
    if (!normalized) { failed++; continue; }
    await db.update(table).set({ phoneE164: normalized }).where(sql`id = ${row.id}`);
    updated++;
  }
  console.log(`[${name}] scanned=${rows.length} updated=${updated} failed=${failed}`);
  return { scanned: rows.length, updated, failed };
}

async function main() {
  console.log("Backfilling phoneE164...");
  await backfillTable("leads", leadsTable);
  await backfillTable("students", studentsTable);
  await backfillTable("agents", agentsTable);
  await backfillTable("users", usersTable);

  console.log("Backfilling conversations.channel='internal' where NULL...");
  const result = await db.execute(
    sql`UPDATE conversations SET channel = 'internal' WHERE channel IS NULL`
  );
  console.log(`conversations channel backfill done. rowCount=${(result as any).rowCount ?? "?"}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
