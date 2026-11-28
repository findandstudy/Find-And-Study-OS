export type OperationalQueue = "pipelineEmail" | "pipelineWhatsApp" | "websiteTranslations" | "signedPdfs";

const observations = new Map<OperationalQueue, { observedAt: string; ok: boolean }>();

export function observeQueueCycle(queue: OperationalQueue, ok: boolean): void {
  observations.set(queue, { observedAt: new Date().toISOString(), ok });
}

export function queueObservation(queue: OperationalQueue) {
  return observations.get(queue) ?? null;
}

export const operationalQueueSummarySql = `
  WITH recent_dispatch AS (
    SELECT d.channel, CASE WHEN d.status='enqueued' THEN COALESCE(q.status,'queued') ELSE d.status END AS status,
      d.created_at, greatest(d.updated_at,q.sent_at) AS updated_at
    FROM pipeline_notice_dispatches d LEFT JOIN email_queue q ON q.id=d.email_queue_id
    WHERE d.tenant_id IS NULL AND (d.status IN ('queued','processing','enqueued') OR d.updated_at >= now()-interval '7 days')
  ), pipeline AS (
    SELECT channel, count(*) FILTER (WHERE status IN ('queued','processing','pending','retrying'))::int AS pending,
      count(*) FILTER (WHERE status IN ('unknown','failed') AND updated_at >= now()-interval '1 day')::int AS failed_today,
      min(created_at) FILTER (WHERE status IN ('queued','processing','pending','retrying')) AS oldest_wait,
      max(updated_at) FILTER (WHERE status='sent') AS last_success
    FROM recent_dispatch
    GROUP BY channel
  ), translated AS (
    SELECT count(*) FILTER (WHERE status IN ('queued','retrying','processing','publish_queued','publishing'))::int AS pending,
      count(*) FILTER (WHERE status='failed' AND updated_at >= now()-interval '1 day')::int AS failed_today,
      min(created_at) FILTER (WHERE status IN ('queued','retrying','processing','publish_queued','publishing')) AS oldest_wait,
      max(updated_at) FILTER (WHERE status='published') AS last_success
    FROM website_translation_jobs
    WHERE status IN ('queued','retrying','processing','publish_queued','publishing') OR updated_at >= now()-interval '7 days'
  ), pdf AS (
    SELECT count(*) FILTER (WHERE pdf_object_key IS NULL)::int AS pending,
      min(signed_at) FILTER (WHERE pdf_object_key IS NULL) AS oldest_wait
    FROM signed_contracts WHERE signed_at >= now()-interval '7 days'
  ) SELECT (SELECT to_jsonb(p) - 'channel' FROM pipeline p WHERE p.channel='email') AS "pipelineEmail",
      (SELECT to_jsonb(p) - 'channel' FROM pipeline p WHERE p.channel='whatsapp') AS "pipelineWhatsApp",
      (SELECT to_jsonb(t) FROM translated t) AS "websiteTranslations",
      (SELECT to_jsonb(p) FROM pdf p) AS "signedPdfs"
`;
