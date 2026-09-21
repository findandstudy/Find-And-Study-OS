import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { renderApprovedEmailVersion } from "./emailTemplateLibrary";
import { stageEmailOrigin, stageEmailRecipient, stageEmailRuntime, parseStageAutomaticEmail } from "./stageEmailPolicy";

type Dispatch = { id: number; application_id: number; student_id: number; agent_id: number | null;
  stage_key: string; template_version_id: number; sender_account_id: number; sender_revision: number;
  origin: string; created_at: Date; email_queue_id: number | null };

async function currentBinding(client: Pick<PoolClient, "query">, intent: Dispatch) {
  const runtime = stageEmailRuntime();
  if (!runtime.enabled || !runtime.since || intent.created_at < runtime.since) return { code: "AUTOMATION_INACTIVE_OR_HISTORICAL" } as const;
  if (Date.now() - intent.created_at.getTime() > 24 * 60 * 60 * 1000) return { code: "STAGE_EMAIL_EXPIRED" } as const;
  const { rows } = await client.query(`SELECT a.stage,a.deleted_at,a.student_id,a.agent_id AS application_agent_id,
    s.agent_id,s.deleted_at AS student_deleted,s.email,s.first_name,s.last_name,s.user_id,
    u.email AS user_email,u.email_verified,u.is_active AS user_active,u.deleted_at AS user_deleted,u.role AS user_role,
    g.parent_agent_id,g.deleted_at AS agent_deleted,g.status AS agent_status,
    a.university_name,a.program_name,ps.label,ps.automatic_email,
    v.status AS version_status,t.is_active AS template_active,t.channel AS template_channel,
    ca.is_active AS sender_active,ca.channel,ca.provider,ca.metadata
    FROM applications a JOIN students s ON s.id=a.student_id
    LEFT JOIN users u ON u.id=s.user_id LEFT JOIN agents g ON g.id=s.agent_id
    LEFT JOIN pipeline_stages ps ON ps.entity_type='application' AND ps.key=a.stage
    JOIN message_template_email_versions v ON v.id=$2 JOIN message_templates t ON t.id=v.template_id
    JOIN channel_accounts ca ON ca.id=$3 WHERE a.id=$1`, [intent.application_id,intent.template_version_id,intent.sender_account_id]);
  const row = rows[0];
  if (!row || row.deleted_at || row.student_deleted || row.user_deleted || row.student_id !== intent.student_id ||
    row.stage !== intent.stage_key || row.agent_id !== intent.agent_id ||
    (row.application_agent_id != null && row.application_agent_id !== row.agent_id) ||
    (row.agent_id != null && (row.agent_deleted || row.agent_status !== "active"))) return { code: "RECORD_SCOPE_OR_STAGE_CHANGED" } as const;
  let config;
  try { config = parseStageAutomaticEmail(row.automatic_email); } catch { return { code: "STAGE_POLICY_CHANGED" } as const; }
  const origin = stageEmailOrigin(row.agent_id, row.parent_agent_id);
  if (!config?.enabled || config.templateVersionId !== intent.template_version_id || config.senderAccountId !== intent.sender_account_id ||
    origin !== intent.origin || !config.originTypes.includes(origin)) return { code: "STAGE_POLICY_CHANGED" } as const;
  if (row.version_status !== "approved" || !row.template_active || !["email", "all"].includes(row.template_channel)) return { code: "TEMPLATE_NOT_APPROVED" } as const;
  const sender = row.metadata?.emailSender;
  if (!row.sender_active || row.channel !== "email" || row.provider !== "smtp" || sender?.verified !== true ||
    sender?.revision !== intent.sender_revision) return { code: "SENDER_CHANGED_OR_UNVERIFIED" } as const;
  const email = stageEmailRecipient({ studentEmail: row.email, userEmail: row.user_email, verified: row.email_verified,
    active: row.user_active && row.user_role === "student" });
  if (!email) return { code: "STUDENT_EMAIL_MISSING_OR_UNVERIFIED" } as const;
  return { email, userId: row.user_id as number, variables: {
    studentName: `${row.first_name || ""} ${row.last_name || ""}`.trim(), firstName: row.first_name || "", lastName: row.last_name || "",
    universityName: row.university_name || "", programName: row.program_name || "", newStage: row.label || row.stage,
    newStageKey: row.stage, applicationId: String(intent.application_id),
  } } as const;
}

/** A DB intent and its existing mail queue row commit together; no provider calls here. */
export async function processStageEmailOutbox(): Promise<number> {
  if (!stageEmailRuntime().enabled) return 0;
  let count = 0;
  for (let i = 0; i < 20; i++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='10000ms'");
      const { rows } = await client.query<Dispatch>("SELECT * FROM pipeline_stage_email_dispatches WHERE status='queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!rows[0]) { await client.query("ROLLBACK"); break; }
      const intent = rows[0];
      const binding = await currentBinding(client, intent);
      const rendered = binding.email ? await renderApprovedEmailVersion(intent.template_version_id, binding.variables!) : null;
      if (!("email" in binding) || !rendered) {
        await client.query("UPDATE pipeline_stage_email_dispatches SET status='skipped',error_code=$2,updated_at=now() WHERE id=$1",
          [intent.id, "code" in binding ? binding.code : "TEMPLATE_VARIABLES_MISSING"]);
      } else {
        const queued = await client.query<{ id: number }>(`INSERT INTO email_queue(to_email,subject,html_body,text_body,
          sender_account_id,sender_revision,template_version_id,idempotency_key)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO UPDATE SET id=email_queue.id RETURNING id`,
          [binding.email,rendered.subject,rendered.html,rendered.text,intent.sender_account_id,intent.sender_revision,
            intent.template_version_id,`stage-email:${intent.id}`]);
        await client.query("UPDATE pipeline_stage_email_dispatches SET status='enqueued',email_queue_id=$2,updated_at=now() WHERE id=$1", [intent.id,queued.rows[0].id]);
        count++;
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      // Leave a transient DB/render failure retryable, without logging contact data.
      console.warn("[STAGE_EMAIL] Outbox processing deferred");
      break;
    } finally { client.release(); }
  }
  return count;
}

/** Called by the transport immediately before SMTP; stale recipient/policy never escapes. */
export async function validateStageEmailQueueItem(queueId: number): Promise<{ allowed: boolean; code?: string }> {
  const { rows } = await pool.query<Dispatch & { to_email: string; subject: string; text_body: string }>(`SELECT d.*,q.to_email,q.subject,q.text_body FROM pipeline_stage_email_dispatches d
    JOIN email_queue q ON q.id=d.email_queue_id WHERE d.email_queue_id=$1`, [queueId]);
  if (!rows[0]) return { allowed: false, code: "STAGE_INTENT_NOT_FOUND" };
  const binding = await currentBinding(pool, rows[0]);
  if (!("email" in binding)) return { allowed: false, code: binding.code };
  if (binding.email !== rows[0].to_email) return { allowed: false, code: "RECIPIENT_CHANGED" };
  const current = await renderApprovedEmailVersion(rows[0].template_version_id, binding.variables!);
  if (!current || current.subject !== rows[0].subject || current.text !== rows[0].text_body) {
    return { allowed: false, code: "STAGE_EMAIL_CONTEXT_CHANGED" };
  }
  return { allowed: true };
}

/** Suppress only the student's generic stage email when a durable eligible intent exists. */
export async function hasStageEmailForStudent(applicationId: number, stageKey: string, userId: number): Promise<boolean> {
  if (!stageEmailRuntime().enabled) return false;
  const { rows } = await pool.query<Dispatch>(`SELECT d.* FROM pipeline_stage_email_dispatches d JOIN students s ON s.id=d.student_id
    WHERE d.application_id=$1 AND d.stage_key=$2 AND s.user_id=$3`, [applicationId,stageKey,userId]);
  if (!rows[0]) return false;
  return "email" in await currentBinding(pool, rows[0]);
}
