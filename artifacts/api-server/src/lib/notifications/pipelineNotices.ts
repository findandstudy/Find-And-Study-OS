import { randomUUID } from "node:crypto";
import { pool, db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  noticeContext,
  setNoticeScope,
  type Notice,
} from "./pipelineNoticeContext";
import { noticeHash } from "./pipelineNoticePolicy";
import { stageEmailRuntime, stageWhatsAppRuntime } from "./stageEmailPolicy";
import { renderApprovedEmailVersion } from "./emailTemplateLibrary";
import { resolveEmailSenderAccount } from "./emailSenderAccounts";
import { observeQueueCycle } from "../queueObservations";
import { sendPipelineWhatsAppSnapshot, WhatsAppTemplateSendError } from "../inbox/startWhatsAppTemplate";

type Intent = Notice & { sender_revision: number | null };
async function scoped<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout='10000ms'");
    await setNoticeScope(c);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export async function boundPipelineNotice(c: any, n: Intent) {
  const runtime = n.channel === "email" ? stageEmailRuntime() : stageWhatsAppRuntime();
  if (
    !runtime.enabled ||
    !runtime.since ||
    new Date(n.created_at) < runtime.since
  )
    return { code: "NOTICE_RUNTIME_DISABLED" } as const;
  if (!n.event_binding_hash) return { code: "NOTICE_EVENT_BINDING_MISSING" } as const;
  const { rows: [event] } = await c.query(
    `SELECT pipeline_notice_event_binding($1,$2,$3,$4) AS binding, EXISTS (
       SELECT 1 FROM pipeline_notice_dispatches newer
       WHERE newer.entity_kind=$1 AND newer.entity_id=$2 AND newer.tenant_id IS NOT DISTINCT FROM $3::uuid
       AND newer.board_id IS NOT DISTINCT FROM $4::uuid AND newer.channel=$5 AND newer.id>$6
     ) AS superseded`,
    [n.entity_kind, n.entity_id, n.tenant_id, n.board_id, n.channel, n.id],
  );
  if (event?.superseded) return { code: "NOTICE_TRANSITION_SUPERSEDED" } as const;
  if (event?.binding !== n.event_binding_hash) return { code: "NOTICE_RECIPIENT_CHANGED" } as const;
  const binding = await noticeContext(c, n);
  if ("code" in binding) return binding;
  if (n.origin_txid && n.journey_key && n.entity_kind !== "application") {
    const { rows: related } = await c.query(
      `SELECT * FROM pipeline_notice_dispatches
       WHERE origin_txid=$1 AND journey_key=$2 AND channel=$3
         AND entity_kind=ANY($4::text[]) ORDER BY id LIMIT 16`,
      [n.origin_txid, n.journey_key, n.channel, n.entity_kind === "lead" ? ["application", "student"] : ["application"]],
    );
    for (const higher of related as Notice[]) {
      const recipient = await noticeContext(c, higher);
      if ("code" in recipient) {
        const competingPolicy = higher.policy as { recipientType?: string } | null;
        if (competingPolicy?.recipientType === binding.policy.recipientType &&
            competingPolicy.recipientType !== "assignee") return { code: "NOTICE_LINKED_TRANSITION_OWNS_DELIVERY" } as const;
        continue;
      }
      const sameDestination = n.channel === "email" ? recipient.email === binding.email : recipient.phone === binding.phone;
      if (sameDestination && recipient.userId === binding.userId) {
        return { code: "NOTICE_LINKED_TRANSITION_OWNS_DELIVERY" } as const;
      }
    }
  }
  if (n.channel === "email") {
    if (
      !n.sender_revision ||
      !(await resolveEmailSenderAccount(
        binding.policy.senderAccountId!,
        n.sender_revision,
      ))
    )
      return { code: "NOTICE_SENDER_CHANGED" } as const;
    const rendered = await renderApprovedEmailVersion(
      binding.policy.templateVersionId!,
      binding.variables,
    );
    if (!rendered) return { code: "NOTICE_TEMPLATE_INVALID" } as const;
    return { ...binding, rendered };
  }
  const r = await c.query(
    `SELECT t.id,t.content,t.variables,t.external_template_name,t.language,a.external_account_id,a.config_encrypted FROM message_templates t CROSS JOIN channel_accounts a
 WHERE t.id=$1 AND t.is_active AND lower(t.approval_status)='approved' AND t.channel IN ('whatsapp','all') AND btrim(t.external_template_name)<>''
 AND a.id=$2 AND a.is_active AND a.channel='whatsapp' AND a.provider='zernio' AND btrim(a.external_account_id)<>''`,
    [binding.policy.templateId, binding.policy.channelAccountId],
  );
  if (!r.rows[0]) return { code: "NOTICE_TEMPLATE_OR_SENDER_INVALID" } as const;
  return { ...binding, transportHash: noticeHash(r.rows[0]) };
}
const fingerprint = (b: any) =>
  noticeHash({
    recipient: b.email,
    phone: b.phone,
    userId: b.userId,
    key: b.recipientKey,
    contact: b.contact,
  });
const contextHash = (b: any) =>
  noticeHash({
    policy: b.policy,
    variables: b.variables,
    rendered: b.rendered ?? null,
    transportHash: b.transportHash ?? null,
  });
/** Bounded durable intent processing; DB triggers cover every mutation path. */
type MockWhatsApp = typeof sendPipelineWhatsAppSnapshot;
export async function processPipelineNotices(
  mockWhatsApp?: MockWhatsApp,
  channel?: Notice["channel"],
): Promise<number> {
  if (mockWhatsApp) {
    const u = new URL(process.env.DATABASE_URL ?? "invalid:");
    if (
      process.env.NODE_ENV !== "test" ||
      u.hostname !== "127.0.0.1" ||
      u.port !== "5433" ||
      !["/fasos_apply_local", "/fas_dev_pipeline_hardening"].includes(u.pathname) ||
      process.env.ALLOW_LIVE_INTEGRATIONS !== "false" ||
      process.env.EMAIL_DELIVERY_DISABLED !== "true"
    )
      throw Error("NOTICE_MOCK_SCOPE_DENIED");
  }
  const emailEnabled = channel !== "whatsapp" && stageEmailRuntime().enabled;
  const whatsappEnabled = channel !== "email" && stageWhatsAppRuntime().enabled &&
    (process.env.ALLOW_LIVE_INTEGRATIONS === "true" || !!mockWhatsApp);
  if (!emailEnabled && !whatsappEnabled) return 0;
  // Ambiguous/crashed WhatsApp sends are never automatically retried.
  await scoped((c) =>
    c.query(
      "UPDATE pipeline_notice_dispatches SET status='unknown',error_code='NOTICE_CLAIM_EXPIRED',updated_at=now() WHERE status='processing' AND claimed_at<now()-interval '10 minutes' AND ($1::text IS NULL OR channel=$1)",
      [channel ?? null],
    ),
  );
  let count = 0;
  for (let i = 0; i < 20; i++) {
    const token = randomUUID();
    const claimed = await scoped(async (c) => {
      const r = await c.query(
        "SELECT * FROM pipeline_notice_dispatches WHERE status='queued' AND next_attempt_at <= now() AND ((channel='email' AND $1) OR (channel='whatsapp' AND $2)) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
        [emailEnabled, whatsappEnabled],
      );
      const n = r.rows[0] as Intent | undefined;
      if (!n) return null;
      const b = await boundPipelineNotice(c, n);
      if ("code" in b) {
        await c.query(
          "UPDATE pipeline_notice_dispatches SET status='skipped',error_code=$2,updated_at=now() WHERE id=$1",
          [n.id, b.code],
        );
        return { skip: true } as const;
      }
      if (n.channel === "email") {
        if (!("rendered" in b) || !b.rendered)
          throw Error("NOTICE_RENDER_MISSING");
        const q = await c.query(
          `INSERT INTO email_queue(to_email,subject,html_body,text_body,sender_account_id,sender_revision,template_version_id,idempotency_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO UPDATE SET id=email_queue.id RETURNING id`,
          [
            b.email,
            b.rendered.subject,
            b.rendered.html,
            b.rendered.text,
            b.policy.senderAccountId,
            n.sender_revision,
            b.policy.templateVersionId,
            "pipeline-notice:" + n.id,
          ],
        );
        await c.query(
          "UPDATE pipeline_notice_dispatches SET status='enqueued',email_queue_id=$2,recipient_hash=$3,context_hash=$4,updated_at=now() WHERE id=$1",
          [n.id, q.rows[0].id, fingerprint(b), contextHash(b)],
        );
        return { skip: true } as const;
      }
      // Do not simulate provider acceptance or consume the intent while outbound is disabled.
      if (process.env.ALLOW_LIVE_INTEGRATIONS !== "true" && !mockWhatsApp)
        return { disabled: true } as const;
      await c.query(
        "UPDATE pipeline_notice_dispatches SET status='processing',claim_token=$2,claimed_at=now(),recipient_hash=$3,context_hash=$4,attempts=attempts+1,updated_at=now() WHERE id=$1",
        [n.id, token, fingerprint(b), contextHash(b)],
      );
      return { n, b };
    });
    if (!claimed) break;
    if ("disabled" in claimed) break;
    if ("skip" in claimed) {
      count++;
      continue;
    }
    const { n, b } = claimed;
    let providerStarted = false;
    try {
      const [actor] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, b.actorId));
      if (!actor) throw Error("NOTICE_CONFIGURATOR_INACTIVE");
      const result = await (mockWhatsApp ?? sendPipelineWhatsAppSnapshot)({
        actor: { ...actor, replitId: actor.replitId ?? "" },
        noticeId: Number(n.id),
        recipientKey: noticeHash({
          tenant: n.tenant_id,
          board: n.board_id,
          key: b.recipientKey,
        }),
        phone: b.phone,
        contact: b.contact,
        name: b.variables.recipientName,
        templateId: b.policy.templateId!,
        channelAccountId: b.policy.channelAccountId!,
        context: b.variables,
        beforeSend: async () => {
          if (process.env.ALLOW_LIVE_INTEGRATIONS !== "true" && !mockWhatsApp)
            throw Error("NOTICE_RUNTIME_DISABLED");
          await scoped(async (c) => {
            const r = await c.query(
              "SELECT * FROM pipeline_notice_dispatches WHERE id=$1 AND status='processing' AND claim_token=$2",
              [n.id, token],
            );
            if (!r.rows[0]) throw Error("NOTICE_CLAIM_LOST");
            const now = await boundPipelineNotice(c, r.rows[0]);
            if (
              "code" in now ||
              fingerprint(now) !== fingerprint(b) ||
              contextHash(now) !== contextHash(b)
            )
              throw Error("NOTICE_BINDING_CHANGED");
          });
          providerStarted = true;
        },
      });
      await scoped((c) =>
        c.query(
          "UPDATE pipeline_notice_dispatches SET status='sent',provider_message_id=$3,updated_at=now() WHERE id=$1 AND claim_token=$2 AND status='processing'",
          [n.id, token, result.externalMessageId ?? result.providerBroadcastId],
        ),
      );
      count++;
    } catch (error) {
      const denied = error instanceof WhatsAppTemplateSendError && error.status < 500;
      const bindingChanged = error instanceof Error && error.message === "NOTICE_BINDING_CHANGED";
      const retry = !providerStarted && !denied && !bindingChanged && (n.attempts ?? 0) < 2;
      const status = retry ? "queued" : providerStarted ? "unknown" : denied || bindingChanged ? "skipped" : "failed";
      const code = providerStarted ? "NOTICE_DELIVERY_UNCONFIRMED" : denied
        ? error.code.toUpperCase() : bindingChanged ? "NOTICE_BINDING_CHANGED" : "NOTICE_PREFLIGHT_FAILED";
      await scoped((c) =>
        c.query(
          `UPDATE pipeline_notice_dispatches
           SET status=$3,error_code=$4,claim_token=NULL,claimed_at=NULL,
             next_attempt_at=CASE WHEN $3='queued' THEN now()+make_interval(secs=>30*attempts) ELSE next_attempt_at END,updated_at=now()
           WHERE id=$1 AND claim_token=$2 AND status='processing'`,
          [n.id, token, status, code],
        ),
      );
    }
  }
  return count;
}

export function startPipelineNoticeWorker() {
  const running = new Map<Notice["channel"], Promise<number>>();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    for (const channel of ["email", "whatsapp"] as const) {
      if (running.has(channel)) continue;
      const attempt = processPipelineNotices(undefined, channel);
      running.set(channel, attempt);
      const queue = channel === "email" ? "pipelineEmail" : "pipelineWhatsApp";
      void attempt.then(() => observeQueueCycle(queue, true), () => {
        observeQueueCycle(queue, false);
        console.error("[pipeline-notices] Worker pass failed", { channel });
      })
        .finally(() => running.delete(channel));
    }
  };
  const interval = setInterval(tick, 5_000);
  interval.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(interval);
    await Promise.race([
      Promise.allSettled(running.values()),
      new Promise<void>(resolve => { setTimeout(resolve, 10_000).unref(); }),
    ]);
  };
}
export async function validatePipelineNoticeQueueItem(
  queueId: number,
): Promise<boolean> {
  return scoped(async (c) => {
    const r = await c.query(
      `SELECT d.*,q.to_email,q.subject,q.html_body,q.text_body,q.sender_account_id,q.template_version_id,q.sender_revision AS queue_sender_revision FROM pipeline_notice_dispatches d JOIN email_queue q ON q.id=d.email_queue_id WHERE q.id=$1 AND d.status='enqueued'`,
      [queueId],
    );
    const n = r.rows[0];
    if (!n) return false;
    const b = await boundPipelineNotice(c, n);
    return (
      !("code" in b) &&
      "rendered" in b &&
      !!b.rendered &&
      fingerprint(b) === n.recipient_hash &&
      contextHash(b) === n.context_hash &&
      b.email === n.to_email &&
      b.rendered.subject === n.subject &&
      b.rendered.html === n.html_body &&
      b.rendered.text === n.text_body &&
      b.policy.senderAccountId === n.sender_account_id &&
      b.policy.templateVersionId === n.template_version_id &&
      n.sender_revision === n.queue_sender_revision
    );
  });
}
