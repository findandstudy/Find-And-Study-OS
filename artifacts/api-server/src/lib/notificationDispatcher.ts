import { db, notificationRulesTable, notificationsTable, usersTable } from "@workspace/db";
import { eq, and, inArray, ne } from "drizzle-orm";
import { sendEmail } from "./email";

interface DispatchContext {
  event: string;
  title: string;
  body: string;
  actionUrl?: string;
  icon?: string;
  recipientUserIds?: number[];
  actorUserId?: number;
  data?: Record<string, unknown>;
  emailOverride?: {
    subject: string;
    html: string;
    text: string;
  };
  templateVars?: Record<string, string>;
}

function buildEmailFromTemplate(
  template: Record<string, string> | undefined,
  vars: Record<string, string>,
  fallback: { title: string; body: string; actionUrl?: string }
): { subject: string; html: string; text: string } {
  const subject = template?.subject
    ? replaceVars(template.subject, vars)
    : fallback.title;

  const bodyText = template?.body
    ? replaceVars(template.body, vars)
    : fallback.body;

  const actionUrl = fallback.actionUrl || "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">Find & Study</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px;">Notification</p>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">${escapeHtml(subject)}</h2>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(bodyText)}</p>
      ${actionUrl ? `<div style="text-align:center;margin:0 0 24px;">
        <a href="${actionUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">View Details</a>
      </div>` : ""}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        This is an automated notification from Find & Study.
      </p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text: bodyText };
}

function replaceVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
  }
  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function dispatchNotification(ctx: DispatchContext): Promise<void> {
  try {
    const [rule] = await db.select().from(notificationRulesTable)
      .where(and(eq(notificationRulesTable.event, ctx.event), eq(notificationRulesTable.isActive, true)));

    if (!rule) return;

    const channels = (rule.channels as string[]) || ["in_app"];
    const recipientType = rule.recipientType;
    const recipientRoles = (rule.recipientRoles as string[]) || [];

    let userIds: number[] = [];

    if (ctx.recipientUserIds && ctx.recipientUserIds.length > 0) {
      userIds = [...ctx.recipientUserIds];
    }

    if (recipientType === "role" && recipientRoles.length > 0) {
      const users = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(
          inArray(usersTable.role, recipientRoles),
          eq(usersTable.isActive, true)
        ));
      const roleIds = users.map(u => u.id);
      for (const id of roleIds) {
        if (!userIds.includes(id)) userIds.push(id);
      }
    } else if (recipientType === "all") {
      const users = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.isActive, true));
      userIds = users.map(u => u.id);
    } else if ((recipientType === "assigned" || recipientType === "owner" || recipientType === "specific") && userIds.length === 0) {
      if (recipientRoles.length > 0) {
        const users = await db.select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            inArray(usersTable.role, recipientRoles),
            eq(usersTable.isActive, true)
          ));
        userIds = users.map(u => u.id);
      }
    }

    if (ctx.actorUserId) {
      userIds = userIds.filter(id => id !== ctx.actorUserId);
    }

    if (userIds.length === 0) return;

    if (channels.includes("in_app")) {
      for (const userId of userIds) {
        try {
          await db.insert(notificationsTable).values({
            userId,
            type: ctx.event,
            title: ctx.title,
            body: ctx.body,
            icon: ctx.icon,
            actionUrl: ctx.actionUrl,
            data: ctx.data || {},
            channel: "in_app",
          });
        } catch (err) {
          console.error(`[NOTIFY] Failed to create in-app notification for user ${userId}:`, err);
        }
      }
    }

    if (channels.includes("email")) {
      const users = await db.select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(and(
          inArray(usersTable.id, userIds),
          eq(usersTable.isActive, true)
        ));

      const template = (rule.template as Record<string, string>) || undefined;
      const hasTemplate = template && (template.subject || template.body);

      for (const user of users) {
        if (!user.email) continue;
        try {
          const emailContent = ctx.emailOverride
            ? ctx.emailOverride
            : buildEmailFromTemplate(
                hasTemplate ? template : undefined,
                ctx.templateVars || {},
                { title: ctx.title, body: ctx.body, actionUrl: ctx.actionUrl }
              );
          await sendEmail(user.email, emailContent);
        } catch (err) {
          console.error(`[NOTIFY] Failed to send email to ${user.email}:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`[NOTIFY] Dispatch error for ${ctx.event}:`, err);
  }
}
