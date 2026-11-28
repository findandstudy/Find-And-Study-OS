import type { Request } from "express";
import { pool } from "@workspace/db";
import { emailAutomationHumanAllowed } from "./emailAutomationPolicy";
import { canonicalNotice, pipelineNoticePolicy } from "./pipelineNoticePolicy";
import { NOTICE_VARIABLES, type NoticeKind } from "./pipelineNoticeContext";
import {
  canonicalMessageTemplateVariable,
  extractNamedMessageTemplateVariables,
} from "../inbox/templateVariables";
export async function configurePipelineNotice(
  req: Request,
  kind: NoticeKind,
  channel: "email" | "whatsapp",
  raw: any,
  old: any,
): Promise<any> {
  const clean = (x: any) => {
    if (!x?.enabled) return null;
    const { configuredById, ...rest } = x;
    return rest;
  };
  if (canonicalNotice(clean(raw)) === canonicalNotice(clean(old)))
    return old ?? null;
  if (!(await emailAutomationHumanAllowed(req)))
    throw Error("EMAIL_CONFIGURATION_HUMAN_ADMIN_REQUIRED");
  if (!raw?.enabled) return null;
  const policy = pipelineNoticePolicy(
    {
      ...raw,
      policyVersion: 2,
      recipientType: raw.recipientType ?? "auto",
      configuredById: req.user!.id,
    },
    channel,
  )!;
  if (kind === "work" && policy.recipientType === "agent")
    throw Error("EMAIL_CONFIGURATION_INVALID");
  if (channel === "email") {
    const r = await pool.query(
      `SELECT v.variables FROM message_template_email_versions v JOIN message_templates t ON t.id=v.template_id CROSS JOIN channel_accounts a
   WHERE v.id=$1 AND v.status='approved' AND t.is_active AND t.channel IN ('email','all') AND a.id=$2 AND a.is_active AND a.channel='email' AND a.provider='smtp' AND a.metadata->'emailSender'->'verified'='true'::jsonb`,
      [policy.templateVersionId, policy.senderAccountId],
    );
    if (
      !r.rows[0] ||
      r.rows[0].variables.some(
        (key: string) =>
          !(NOTICE_VARIABLES[kind] as readonly string[]).includes(key),
      )
    )
      throw Error("EMAIL_APPROVED_TEMPLATE_AND_VERIFIED_SENDER_REQUIRED");
  } else {
    const r = await pool.query(
      `SELECT t.content,t.variables FROM message_templates t CROSS JOIN channel_accounts a WHERE t.id=$1 AND t.is_active AND lower(t.approval_status)='approved' AND t.channel IN ('whatsapp','all') AND btrim(t.external_template_name)<>'' AND a.id=$2 AND a.is_active AND a.channel='whatsapp' AND a.provider='zernio' AND btrim(a.external_account_id)<>''`,
      [policy.templateId, policy.channelAccountId],
    );
    const t = r.rows[0];
    const keys = t
      ? [
          ...extractNamedMessageTemplateVariables(t.content ?? ""),
          ...(Array.isArray(t.variables) ? t.variables : []),
        ]
      : [];
    if (
      !t ||
      keys.some(
        (key: string) =>
          !(NOTICE_VARIABLES[kind] as readonly string[]).includes(
            canonicalMessageTemplateVariable(key) ?? "",
          ),
      )
    )
      throw Error("EMAIL_APPROVED_TEMPLATE_AND_VERIFIED_SENDER_REQUIRED");
  }
  return policy;
}
