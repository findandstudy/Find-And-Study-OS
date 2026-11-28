import { pool } from "@workspace/db";
import { stageEmailRuntime } from "./stageEmailPolicy";
import { emailDeliveryAllowed } from "../emailDeliveryPolicy";
import { backgroundJobsEnabled } from "../backgroundJobs";
import { STAGE_EMAIL_TEMPLATE_VARIABLES } from "./emailTemplateLibrary";

/** Read-only operational checks. No recipient data, SMTP connections or queue writes. */
export async function stageEmailReadiness() {
  const { rows } = await pool.query<{ approved_versions: number; verified_senders: number; total_stages: number; configured_stages: number; ready_stages: number }>(`
    WITH versions AS (
      SELECT v.id FROM message_template_email_versions v JOIN message_templates t ON t.id=v.template_id
      WHERE v.status='approved' AND t.is_active AND t.channel IN ('email','all')
        AND v.variables <@ $1::jsonb
    ), senders AS (
      SELECT id FROM channel_accounts WHERE channel='email' AND provider='smtp' AND is_active
        AND metadata->'emailSender'->'verified'='true'::jsonb
        AND coalesce(metadata->'emailSender'->>'revision','') ~ '^[1-9][0-9]{0,8}$'
    ) SELECT (SELECT count(*)::int FROM versions) approved_versions,
      (SELECT count(*)::int FROM senders) verified_senders,
      count(*)::int total_stages,
      count(*) FILTER(WHERE automatic_email->'enabled'='true'::jsonb)::int configured_stages,
      count(*) FILTER(WHERE automatic_email->'enabled'='true'::jsonb
        AND automatic_email->>'templateVersionId' IN (SELECT id::text FROM versions)
        AND automatic_email->>'senderAccountId' IN (SELECT id::text FROM senders)
        AND jsonb_typeof(automatic_email->'originTypes')='array'
        AND jsonb_array_length(CASE WHEN jsonb_typeof(automatic_email->'originTypes')='array' THEN automatic_email->'originTypes' ELSE '[]'::jsonb END)>0
        AND automatic_email->'originTypes' <@ '["direct","agent","sub_agent"]'::jsonb)::int ready_stages
    FROM pipeline_stages WHERE entity_type='application'`, [JSON.stringify(STAGE_EMAIL_TEMPLATE_VARIABLES)]);
  const counts = rows[0];
  const runtime = stageEmailRuntime().enabled;
  const delivery = emailDeliveryAllowed();
  const worker = backgroundJobsEnabled();
  return { runtime, delivery, worker, counts,
    ready: runtime && delivery && worker && counts.ready_stages > 0 };
}
