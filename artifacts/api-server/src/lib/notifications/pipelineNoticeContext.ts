import type { PoolClient } from "pg";
import { workPipelineTenant } from "../workPipelines";
import {
  pipelineNoticePolicy,
  canonicalNotice,
  preferenceAllows,
  type PipelineNoticePolicy,
} from "./pipelineNoticePolicy";
import { isEmailMailbox } from "../emailDeliveryPolicy";
import { toE164 } from "../inbox/phone";
export type NoticeKind = "lead" | "student" | "application" | "work";
export type Notice = {
  id: string;
  entity_kind: NoticeKind;
  entity_id: string;
  tenant_id: string | null;
  board_id: string | null;
  stage_key: string;
  channel: "email" | "whatsapp";
  policy: unknown;
  created_at: Date;
  event_binding_hash?: string | null;
  origin_txid?: string | null;
  journey_key?: string | null;
  attempts?: number;
  claim_token?: string;
  email_queue_id?: number;
  recipient_hash?: string;
  context_hash?: string;
};
export type NoticeContact =
  | { kind: "lead" | "student" | "agent" | "workConversation"; id: number };
export const COMMON_NOTICE_VARIABLES = [
  "recordName",
  "recipientName",
  "newStage",
  "newStageKey",
  "stageName",
  "pipelineName",
  "recordId",
] as const;
export const NOTICE_VARIABLES = {
  application: [
    ...COMMON_NOTICE_VARIABLES,
    "studentName",
    "firstName",
    "lastName",
    "universityName",
    "programName",
    "applicationId",
  ],
  student: [...COMMON_NOTICE_VARIABLES, "studentName", "firstName", "lastName"],
  lead: [...COMMON_NOTICE_VARIABLES, "firstName", "lastName"],
  work: [...COMMON_NOTICE_VARIABLES],
};
type Client = Pick<PoolClient, "query">;
function configuredWorkTenant(): string | null {
  try { return workPipelineTenant(); } catch { return null; }
}

export async function setNoticeScope(c: Client) {
  const tenant = configuredWorkTenant();
  await c.query("SELECT set_config('app.work_pipeline_tenant',$1,true)", [
    tenant ?? "",
  ]);
  return tenant;
}
export async function noticeContext(
  c: Client,
  n: Notice,
): Promise<
  | { code: string }
  | {
      policy: PipelineNoticePolicy;
      variables: Record<string, string>;
      email: string;
      phone: string;
      userId: number | null;
      actorId: number;
      recipientKey: string;
      contact: NoticeContact | null;
    }
> {
  if (Date.now() - new Date(n.created_at).getTime() > 86400000)
    return { code: "NOTICE_EXPIRED" };
  let record: any,
    stage: any,
    board: any,
    subject: any,
    agentId: number | null = null;
  if (n.entity_kind === "work") {
    if (!n.tenant_id || n.tenant_id !== configuredWorkTenant() || !n.board_id)
      return { code: "NOTICE_SCOPE_CHANGED" };
    const { rows } = await c.query(
      `SELECT k.document,b.document board FROM local_work_pipelines.cards k JOIN local_work_pipelines.boards b ON b.tenant_id=k.tenant_id AND b.id=k.board_id
      WHERE k.tenant_id=$1 AND k.board_id=$2 AND k.id=$3 AND k.document->>'removedAt' IS NULL`,
      [n.tenant_id, n.board_id, n.entity_id],
    );
    if (!rows[0] || rows[0].board.archived)
      return { code: "NOTICE_SCOPE_CHANGED" };
    record = rows[0].document;
    board = rows[0].board;
    subject = record;
    if (record.stageId !== n.stage_key) return { code: "NOTICE_STAGE_CHANGED" };
    stage = board.stages.find((s: any) => s.id === n.stage_key);
  } else {
    if (!/^[1-9][0-9]{0,8}$/.test(n.entity_id))
      return { code: "NOTICE_SCOPE_CHANGED" };
    const table = {
      lead: "leads",
      student: "students",
      application: "applications",
    }[n.entity_kind];
    const { rows } = await c.query(
      `SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL`,
      [Number(n.entity_id)],
    );
    record = rows[0];
    if (!record) return { code: "NOTICE_SCOPE_CHANGED" };
    if (
      (n.entity_kind === "application" ? record.stage : record.status) !==
      n.stage_key
    )
      return { code: "NOTICE_STAGE_CHANGED" };
    subject = record;
    if (n.entity_kind === "application") {
      const r = await c.query(
        "SELECT * FROM students WHERE id=$1 AND deleted_at IS NULL",
        [record.student_id],
      );
      subject = r.rows[0];
      if (
        !subject ||
        (record.agent_id != null &&
          subject.agent_id != null &&
          record.agent_id !== subject.agent_id)
      )
        return { code: "NOTICE_SCOPE_CHANGED" };
      const settings = await c.query(
        "SELECT suppress_automation_app_notifications AS suppressed FROM settings LIMIT 1",
      );
      if (
        record.created_source === "automation" &&
        (settings.rows[0]?.suppressed ?? true)
      )
        return { code: "NOTICE_AUTOMATION_SUPPRESSED" };
    }
    agentId = record.agent_id ?? subject.agent_id ?? null;
    const s = await c.query(
      "SELECT label,automatic_email,automatic_message FROM pipeline_stages WHERE entity_type=$1 AND key=$2",
      [n.entity_kind, n.stage_key],
    );
    stage = s.rows[0];
  }
  if (!stage) return { code: "NOTICE_POLICY_CHANGED" };
  const raw =
    n.entity_kind === "work"
      ? n.channel === "email"
        ? stage.automaticEmail
        : stage.automaticMessage
      : n.channel === "email"
        ? stage.automatic_email
        : stage.automatic_message;
  let policy: PipelineNoticePolicy | null;
  try {
    policy = pipelineNoticePolicy(raw, n.channel);
    if (
      !policy ||
      canonicalNotice(policy) !==
        canonicalNotice(pipelineNoticePolicy(n.policy, n.channel))
    )
      return { code: "NOTICE_POLICY_CHANGED" };
  } catch {
    return { code: "NOTICE_POLICY_CHANGED" };
  }
  const actor = await c.query(
    "SELECT id FROM users WHERE id=$1 AND is_active=true AND deleted_at IS NULL AND role IN ('admin','super_admin')",
    [policy.configuredById],
  );
  if (!actor.rows.length) return { code: "NOTICE_CONFIGURATOR_INACTIVE" };
  let agent: any = null;
  if (agentId) {
    const r = await c.query(
      "SELECT * FROM agents WHERE id=$1 AND deleted_at IS NULL AND status='active'",
      [agentId],
    );
    agent = r.rows[0];
    if (!agent) return { code: "NOTICE_SCOPE_CHANGED" };
  }
  const origin = agent
    ? agent.parent_agent_id
      ? "sub_agent"
      : "agent"
    : "direct";
  if (!policy.originTypes.includes(origin))
    return { code: "NOTICE_ORIGIN_EXCLUDED" };
  const recipient =
    policy.recipientType === "auto"
      ? agent
        ? "agent"
        : "contact"
      : policy.recipientType;
  let email = "",
    phone = "",
    name = "",
    user: any = null,
    userId: number | null = null,
    recipientKey = "";
  const display =
    n.entity_kind === "work"
      ? record.contactName || record.title
      : [subject.first_name, subject.last_name].filter(Boolean).join(" ");
  if (recipient === "assignee") {
    userId =
      n.entity_kind === "work" ? record.assigneeId : record.assigned_to_id;
    if (
      !userId ||
      (board && userId !== board.createdBy && !board.memberIds.includes(userId))
    )
      return { code: "NOTICE_RECIPIENT_MISSING" };
    const r = await c.query(
      "SELECT * FROM users WHERE id=$1 AND is_active=true AND deleted_at IS NULL",
      [userId],
    );
    user = r.rows[0];
    if (
      !user ||
      !["super_admin", "admin", "manager", "staff", "consultant"].includes(
        user.role,
      )
    )
      return { code: "NOTICE_RECIPIENT_MISSING" };
    email = user.email ?? "";
    phone = user.phone_e164 || user.phone || "";
    name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    recipientKey = `user:${userId}`;
  } else if (recipient === "agent") {
    if (!agent?.user_id) return { code: "NOTICE_RECIPIENT_MISSING" };
    const r = await c.query(
      "SELECT * FROM users WHERE id=$1 AND is_active=true AND deleted_at IS NULL AND role IN ('agent','sub_agent')",
      [agent.user_id],
    );
    user = r.rows[0];
    if (!user) return { code: "NOTICE_RECIPIENT_MISSING" };
    userId = user.id;
    email = agent.email ?? "";
    if (email.trim().toLowerCase() !== user.email?.trim().toLowerCase())
      return { code: "NOTICE_RECIPIENT_CHANGED" };
    phone =
      agent.phone_e164 || agent.phone || user.phone_e164 || user.phone || "";
    name = [agent.first_name, agent.last_name].filter(Boolean).join(" ");
    recipientKey = `agent:${agent.id}:${user.id}`;
  } else {
    email = subject.email ?? "";
    phone = subject.phone_e164 || subject.phone || "";
    name = display;
    recipientKey = `${n.entity_kind}:${n.entity_id}:contact`;
    const id = subject.user_id;
    // Leads/work contacts are not required to become students. Email ownership
    // evidence still comes from an exact active verified account; no guessed fallback.
    const r = id
      ? await c.query(
          "SELECT * FROM users WHERE id=$1 AND is_active=true AND deleted_at IS NULL",
          [id],
        )
      : await c.query(
          "SELECT * FROM users WHERE lower(trim(email))=$1 AND is_active=true AND deleted_at IS NULL AND email_verified=true LIMIT 2",
          [email.trim().toLowerCase()],
        );
    user = r.rows.length === 1 ? r.rows[0] : null;
    userId = user?.id ?? null;
    if (id && n.entity_kind !== "lead" && user?.role !== "student")
      return { code: "NOTICE_RECIPIENT_CHANGED" };
    if (user && email.trim().toLowerCase() !== user.email?.trim().toLowerCase())
      return { code: "NOTICE_RECIPIENT_CHANGED" };
  }
  if (
    user &&
    !preferenceAllows(
      `${n.entity_kind}.stage_changed`,
      user.notification_preferences,
    )
  )
    return { code: "NOTICE_PREFERENCE_DISABLED" };
  if (
    n.channel === "email" &&
    (!user?.email_verified || !isEmailMailbox(email.trim().toLowerCase()))
  )
    return { code: "NOTICE_EMAIL_UNVERIFIED" };
  const normalizedPhone = toE164(phone);
  if (n.channel === "whatsapp") {
    if (!normalizedPhone) return { code: "NOTICE_PHONE_MISSING" };
    const blocked = await c.query(
      "SELECT 1 FROM external_contacts WHERE channel='whatsapp' AND is_blocked AND (phone_e164=$1 OR external_id=$2 OR external_id=$3) LIMIT 1",
      [normalizedPhone, normalizedPhone.replace(/^\+/, ""), `wa_out:${normalizedPhone.replace(/^\+/, "")}`],
    );
    if (blocked.rows.length) return { code: "NOTICE_RECIPIENT_BLOCKED" };
  }
  let contact: NoticeContact | null = null;
  if (recipient === "agent" && agent) contact = { kind: "agent", id: agent.id };
  if (recipient === "contact") {
    if (n.entity_kind === "work") {
      const sourceConversationId = record.source?.conversationId;
      if (record.source?.kind === "channel" && Number.isSafeInteger(sourceConversationId) && sourceConversationId > 0 &&
          String(policy.channelAccountId) === record.source.key) {
        contact = { kind: "workConversation", id: sourceConversationId };
      }
    } else {
      contact = n.entity_kind === "lead" && !subject.converted_student_id
        ? { kind: "lead", id: subject.id }
        : { kind: "student", id: subject.converted_student_id ?? subject.id };
    }
  }
  const label = stage.label || stage.name;
  const common = {
    recordName: display,
    recipientName: name,
    newStage: label,
    newStageKey: n.stage_key,
    stageName: label,
    pipelineName: board?.name || n.entity_kind,
    recordId: n.entity_id,
  };
  const variables: Record<string, string> =
    n.entity_kind === "work"
      ? common
      : {
          ...common,
          firstName: subject.first_name || "",
          lastName: subject.last_name || "",
          ...(n.entity_kind !== "lead" ? { studentName: display } : {}),
          ...(n.entity_kind === "application"
            ? {
                applicationId: n.entity_id,
                programName: record.program_name || "",
                universityName: record.university_name || "",
              }
            : {}),
        };
  return {
    policy,
    variables,
    email: email.trim().toLowerCase(),
    phone: normalizedPhone || "",
    userId,
    actorId: policy.configuredById,
    recipientKey,
    contact,
  };
}
