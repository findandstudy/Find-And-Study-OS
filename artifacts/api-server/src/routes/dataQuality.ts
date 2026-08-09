import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";

const router: IRouter = Router();

type DuplicateRow = {
  entity: "student" | "lead";
  matchKey: "email" | "phone";
  normalizedValue: string;
  recordIds: number[];
  recordCount: number;
};

/**
 * Read-only duplicate candidate report. Deliberately does not merge records:
 * a safe merge must account for documents, applications, conversations,
 * finance and audit ownership in one reviewed transaction.
 */
router.get("/admin/data-quality/duplicates", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT 'student'::text AS entity, 'email'::text AS match_key,
             lower(trim(email)) AS normalized_value, array_agg(id ORDER BY id) AS record_ids,
             count(*)::int AS record_count
      FROM students
      WHERE deleted_at IS NULL AND nullif(trim(email), '') IS NOT NULL
      GROUP BY lower(trim(email)) HAVING count(*) > 1
      UNION ALL
      SELECT 'student', 'phone', coalesce(nullif(trim(phone_e164), ''), regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g')),
             array_agg(id ORDER BY id), count(*)::int
      FROM students
      WHERE deleted_at IS NULL
        AND nullif(coalesce(nullif(trim(phone_e164), ''), regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g')), '') IS NOT NULL
      GROUP BY coalesce(nullif(trim(phone_e164), ''), regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g')) HAVING count(*) > 1
      UNION ALL
      SELECT 'lead', 'email', lower(trim(email)), array_agg(id ORDER BY id), count(*)::int
      FROM leads
      WHERE deleted_at IS NULL AND nullif(trim(email), '') IS NOT NULL
      GROUP BY lower(trim(email)) HAVING count(*) > 1
      UNION ALL
      SELECT 'lead', 'phone', coalesce(nullif(trim(phone_e164), ''), regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g')),
             array_agg(id ORDER BY id), count(*)::int
      FROM leads
      WHERE deleted_at IS NULL
        AND nullif(coalesce(nullif(trim(phone_e164), ''), regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g')), '') IS NOT NULL
      GROUP BY coalesce(nullif(trim(phone_e164), ''), regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g')) HAVING count(*) > 1
    )
    SELECT entity, match_key, normalized_value, record_ids, record_count
    FROM candidates
    ORDER BY record_count DESC, entity, match_key
    LIMIT 500
  `);

  const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
  const data: DuplicateRow[] = rows.map((row) => ({
    entity: row.entity as DuplicateRow["entity"],
    matchKey: row.match_key as DuplicateRow["matchKey"],
    normalizedValue: String(row.normalized_value ?? ""),
    recordIds: Array.isArray(row.record_ids) ? row.record_ids.map(Number) : [],
    recordCount: Number(row.record_count ?? 0),
  }));

  res.json({
    data,
    summary: {
      groups: data.length,
      affectedRecords: data.reduce((sum, row) => sum + row.recordCount, 0),
    },
    mergeAvailable: false,
    mergePolicy: "Review candidates before a dedicated transactional merge is enabled.",
  });
});

export default router;
