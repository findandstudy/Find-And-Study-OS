import { db, priceComponentsTable, programIntakesTable, catalogSourceRecordsTable, catalogSourcesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export type PublicPriceRow = {
  id: string; programId: number; intakeId: string | null; componentCode: string; componentType: string;
  amountMinor: string; currencyCode: string; frequency: string;
  effectiveFrom: Date; effectiveUntil: Date | null; sourceVerifiedAt: Date; sourceExpiresAt: Date | null;
};
export type PublicPriceSet = PublicPriceRow[] & { truncated?: boolean };

/** One bounded batch for detail and cards; no N+1 and no expired-intake prices. */
export async function readPublicCatalogPrices(programIds: readonly number[], now = new Date(), executor: Pick<typeof db, "execute"> = db): Promise<Map<number, PublicPriceSet>> {
  const ids = [...new Set(programIds)].filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 64);
  const result = new Map<number, PublicPriceSet>();
  if (!ids.length) return result;
  const rows = await executor.execute(sql`
    WITH ranked AS (
      SELECT p.id, p.program_id AS "programId", p.intake_id AS "intakeId",
        p.component_code AS "componentCode", p.component_type AS "componentType",
        p.amount_minor::text AS "amountMinor", p.currency_code AS "currencyCode", p.frequency,
        p.effective_from AS "effectiveFrom", p.effective_until AS "effectiveUntil",
        p.source_verified_at AS "sourceVerifiedAt", p.source_expires_at AS "sourceExpiresAt",
        row_number() OVER (PARTITION BY p.program_id ORDER BY p.component_type, p.effective_from DESC, p.id) AS row_no
      FROM ${priceComponentsTable} p
      INNER JOIN ${catalogSourceRecordsTable} r ON r.id = p.source_record_id
      INNER JOIN ${catalogSourcesTable} s ON s.id = r.source_id
      WHERE p.program_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
        AND s.status = 'ACTIVE' AND r.status = 'VERIFIED' AND r.entity_type = 'PRICE'
        AND r.verified_at <= ${now} AND r.effective_at <= ${now}
        AND (r.expires_at IS NULL OR r.expires_at >= ${now})
        AND p.status = 'ACTIVE' AND p.source_verified_at IS NOT NULL AND p.source_verified_at <= ${now}
        AND p.effective_from <= ${now}
        AND (p.effective_until IS NULL OR p.effective_until >= ${now})
        AND (p.source_expires_at IS NULL OR p.source_expires_at >= ${now})
        AND (p.intake_id IS NULL OR EXISTS (
          SELECT 1 FROM ${programIntakesTable} i WHERE i.id = p.intake_id AND i.program_id = p.program_id
            AND i.status = 'ACTIVE'
            AND (i.application_deadline_at IS NULL OR i.application_deadline_at >= ${now})
            AND (i.source_expires_at IS NULL OR i.source_expires_at >= ${now})
        ))
    ) SELECT * FROM ranked WHERE row_no <= 49 ORDER BY "programId", row_no`);
  for (const row of rows.rows as unknown as PublicPriceRow[]) {
    const list = result.get(row.programId) ?? [];
    list.push(row);
    result.set(row.programId, list);
  }
  // Overflow is explicit, never silently choose a potentially misleading partial price set.
  for (const [id, list] of result) if (list.length > 48) result.set(id, Object.assign(list.slice(0, 48), { truncated: true }));
  return result;
}
