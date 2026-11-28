import { STAFF_ROLES } from "./roles";
import { isWorkAdmin, workPipelineTenant, workTx, type WorkActor } from "./workPipelines";

/** Read-only projection into the existing dashboard feed. No CRM shadow rows. */
export async function upcomingWorkFollowUps(actor: WorkActor, until: Date, createdById: number | null = null) {
  // External partners never query the independent internal workspace.
  if (!STAFF_ROLES.includes(actor.role) || !workPipelineTenant()) return [];
  return workTx(async (c, tenant) => {
    const result = await c.query(`
      SELECT f->>'id' AS "followUpId", b.id AS "boardId", k.id AS "cardId",
        b.document->>'name' AS "pipelineName", k.document->>'title' AS "cardTitle",
        f->>'title' AS title, f->>'notes' AS notes, f->>'scheduledAt' AS "scheduledAt",
        NULLIF(concat_ws(' ', creator.first_name, creator.last_name),'') AS "createdByName"
      FROM local_work_pipelines.boards b
      JOIN local_work_pipelines.cards k ON k.tenant_id=b.tenant_id AND k.board_id=b.id
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(k.document->'followUps','[]')) f
      LEFT JOIN users creator ON creator.id=(f->>'createdBy')::int
      WHERE b.tenant_id=$1 AND k.document->>'removedAt' IS NULL AND coalesce((b.document->>'archived')::boolean,false)=false
        AND ($2::boolean OR b.document->>'createdBy'=$3 OR b.document->'memberIds' @> $4::jsonb)
        AND ($2::boolean OR f->>'assigneeId'=$3 OR f->>'createdBy'=$3)
        AND f->>'completed'='false' AND (f->>'scheduledAt')::timestamptz <= $5::timestamptz
        AND ($6::integer IS NULL OR (f->>'createdBy')::int=$6)
      ORDER BY (f->>'scheduledAt')::timestamptz, b.id, k.id, f->>'id' LIMIT 20
    `, [tenant, isWorkAdmin(actor), String(actor.id), JSON.stringify([actor.id]), until.toISOString(), isWorkAdmin(actor) ? createdById : null]);
    return result.rows.map(row => ({ ...row, id: `pipeline:${row.followUpId}`, resourceType: "work_pipeline" as const, leadId: null, studentId: null, completed: false }));
  });
}

export function mergeUpcomingFollowUps<T extends { id: string | number; scheduledAt: string | Date }>(rows: T[], limit = 20): T[] {
  return [...rows].sort((a,b) => new Date(a.scheduledAt).getTime()-new Date(b.scheduledAt).getTime() || String(a.id).localeCompare(String(b.id))).slice(0,limit);
}
