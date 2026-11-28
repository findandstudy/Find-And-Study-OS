import type { PoolClient } from "pg";
import type { NoticeKind } from "./pipelineNoticeContext";

export async function readPipelineNoticeHistory(
  reader: Pick<PoolClient, "query">,
  kind: NoticeKind,
  scope?: { tenantId: string; boardId: string; cardId: string },
) {
  const result = await reader.query(
    `SELECT d.id::text AS id, d.entity_id AS "recordId", d.stage_key AS "stageKey",
      d.channel, CASE WHEN d.status='enqueued' THEN COALESCE(q.status, 'queued') ELSE d.status END AS status,
      d.error_code AS "errorCode", left(COALESCE(d.provider_message_id, q.provider_message_id), 160) AS "providerReference",
      greatest(d.updated_at, q.sent_at) AS "updatedAt"
     FROM pipeline_notice_dispatches d LEFT JOIN email_queue q ON q.id=d.email_queue_id
     WHERE d.entity_kind=$1 AND d.tenant_id IS NOT DISTINCT FROM $2::uuid
       AND d.board_id IS NOT DISTINCT FROM $3::uuid AND ($4::text IS NULL OR d.entity_id=$4)
     ORDER BY d.id DESC LIMIT 50`,
    [kind, scope?.tenantId ?? null, scope?.boardId ?? null, scope?.cardId ?? null],
  );
  return result.rows;
}
