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

type ApplicationLeadCandidate = {
  applicationId: number;
  studentId: number;
  candidateLeadIds: number[];
  activeApplicationCount: number;
  classification: "safe_candidate" | "review_unique_identity" | "ambiguous" | "no_candidate";
  evidence: string[];
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

/**
 * Read-only legacy application → lead relationship analysis. A result marked
 * safe_candidate is still not written automatically: an administrator must
 * review it before a future transactional backfill is explicitly approved.
 */
router.get("/admin/data-quality/application-lead-links", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    WITH active_apps AS (
      SELECT a.id AS application_id, a.student_id,
             (
               SELECT count(*)::int
               FROM applications sibling
               WHERE sibling.student_id = a.student_id AND sibling.deleted_at IS NULL
             ) AS active_application_count
      FROM applications a
      WHERE a.deleted_at IS NULL AND a.lead_id IS NULL
    ),
    candidates AS (
      SELECT aa.application_id, aa.student_id, aa.active_application_count,
             l.id AS lead_id,
             (l.id = s.origin_lead_id OR l.converted_student_id = s.id) AS has_lineage,
             (nullif(lower(trim(s.email)), '') IS NOT NULL AND lower(trim(l.email)) = lower(trim(s.email))) AS email_match,
             (
               nullif(coalesce(nullif(trim(s.phone_e164), ''), regexp_replace(coalesce(s.phone, ''), '[^0-9]+', '', 'g')), '') IS NOT NULL
               AND coalesce(nullif(trim(l.phone_e164), ''), regexp_replace(coalesce(l.phone, ''), '[^0-9]+', '', 'g')) =
                   coalesce(nullif(trim(s.phone_e164), ''), regexp_replace(coalesce(s.phone, ''), '[^0-9]+', '', 'g'))
             ) AS phone_match
      FROM active_apps aa
      JOIN students s ON s.id = aa.student_id AND s.deleted_at IS NULL
      LEFT JOIN leads l ON l.deleted_at IS NULL AND (
        l.id = s.origin_lead_id OR
        l.converted_student_id = s.id OR
        (nullif(lower(trim(s.email)), '') IS NOT NULL AND lower(trim(l.email)) = lower(trim(s.email))) OR
        (
          nullif(coalesce(nullif(trim(s.phone_e164), ''), regexp_replace(coalesce(s.phone, ''), '[^0-9]+', '', 'g')), '') IS NOT NULL
          AND coalesce(nullif(trim(l.phone_e164), ''), regexp_replace(coalesce(l.phone, ''), '[^0-9]+', '', 'g')) =
              coalesce(nullif(trim(s.phone_e164), ''), regexp_replace(coalesce(s.phone, ''), '[^0-9]+', '', 'g'))
        )
      )
    ),
    grouped AS (
      SELECT application_id, student_id, active_application_count,
             array_agg(DISTINCT lead_id ORDER BY lead_id) FILTER (WHERE lead_id IS NOT NULL) AS candidate_lead_ids,
             bool_or(has_lineage) FILTER (WHERE lead_id IS NOT NULL) AS has_lineage,
             bool_or(email_match) FILTER (WHERE lead_id IS NOT NULL) AS has_email_match,
             bool_or(phone_match) FILTER (WHERE lead_id IS NOT NULL) AS has_phone_match,
             count(DISTINCT lead_id)::int AS candidate_count
      FROM candidates
      GROUP BY application_id, student_id, active_application_count
    )
    SELECT application_id, student_id, active_application_count,
           coalesce(candidate_lead_ids, ARRAY[]::integer[]) AS candidate_lead_ids,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN has_lineage THEN 'student/lead lineage' END,
             CASE WHEN has_email_match THEN 'normalized email' END,
             CASE WHEN has_phone_match THEN 'normalized phone' END
           ], NULL) AS evidence,
           CASE
             WHEN candidate_count = 0 THEN 'no_candidate'
             WHEN candidate_count = 1 AND active_application_count = 1 AND has_lineage THEN 'safe_candidate'
             WHEN candidate_count = 1 AND active_application_count = 1 THEN 'review_unique_identity'
             ELSE 'ambiguous'
           END AS classification
    FROM grouped
    ORDER BY
      CASE
        WHEN candidate_count = 1 AND active_application_count = 1 AND has_lineage THEN 0
        WHEN candidate_count = 1 AND active_application_count = 1 THEN 1
        WHEN candidate_count > 1 OR active_application_count > 1 THEN 2
        ELSE 3
      END,
      application_id
    LIMIT 2000
  `);

  const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
  const data: ApplicationLeadCandidate[] = rows.map((row) => ({
    applicationId: Number(row.application_id),
    studentId: Number(row.student_id),
    candidateLeadIds: Array.isArray(row.candidate_lead_ids) ? row.candidate_lead_ids.map(Number) : [],
    activeApplicationCount: Number(row.active_application_count ?? 0),
    classification: row.classification as ApplicationLeadCandidate["classification"],
    evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : [],
  }));
  const countBy = (classification: ApplicationLeadCandidate["classification"]) =>
    data.filter((row) => row.classification === classification).length;

  res.json({
    data,
    summary: {
      unlinkedApplications: data.length,
      safeCandidates: countBy("safe_candidate"),
      uniqueIdentityReview: countBy("review_unique_identity"),
      ambiguous: countBy("ambiguous"),
      noCandidate: countBy("no_candidate"),
    },
    writeEnabled: false,
    policy: "Analysis only. No application or lead record was changed.",
  });
});

export default router;
