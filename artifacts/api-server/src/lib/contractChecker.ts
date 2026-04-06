import { db, agentsTable, usersTable } from "@workspace/db";
import { isNotNull, isNull, eq, and, sql } from "drizzle-orm";
import { sendEmail, getEmailBranding, getAppBaseUrl } from "./email";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function buildContractExpiryEmail(
  brand: { logoUrl: string | null; primaryColor: string; buttonColor: string; companyName: string },
  agentName: string,
  businessName: string | null,
  daysLeft: number,
  contractEndDate: string,
  appUrl: string,
  recipientType: "admin" | "staff" | "agent"
): { subject: string; html: string; text: string } {
  const urgency = daysLeft <= 3 ? "URGENT" : "REMINDER";
  const subject = `[${urgency}] Contract Expiring in ${daysLeft} Days — ${businessName || agentName}`;

  const recipientMessage = recipientType === "agent"
    ? `Your contract with ${brand.companyName} is expiring soon.`
    : `The contract for agent <strong>${agentName}</strong>${businessName ? ` (${businessName})` : ""} is expiring soon.`;

  const statusColor = daysLeft <= 3 ? "#dc2626" : "#f59e0b";
  const statusLabel = daysLeft <= 3 ? "Expiring Soon" : "Expiring Soon";

  const logoHtml = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${brand.companyName}" style="max-height:48px;max-width:200px;margin:0 auto 8px;" />`
    : `<h1 style="margin:0 0 4px;color:#fff;font-size:24px;font-weight:700;">${brand.companyName}</h1>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,${brand.primaryColor},${brand.primaryColor}cc);padding:28px 32px;text-align:center;">
      ${logoHtml}
      <p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:14px;">Contract Expiry Notice</p>
    </div>
    <div style="padding:32px;">
      <div style="background:${statusColor}15;border:1px solid ${statusColor}40;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
        <span style="display:inline-block;background:${statusColor};color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:8px;">${statusLabel}</span>
        <p style="margin:8px 0 0;font-size:28px;font-weight:700;color:${statusColor};">${daysLeft} Days Left</p>
      </div>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">${recipientMessage}</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">Agent</td>
          <td style="padding:8px 0;color:#111;font-size:14px;font-weight:500;border-bottom:1px solid #e5e7eb;text-align:right;">${agentName}</td>
        </tr>
        ${businessName ? `<tr>
          <td style="padding:8px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">Company</td>
          <td style="padding:8px 0;color:#111;font-size:14px;font-weight:500;border-bottom:1px solid #e5e7eb;text-align:right;">${businessName}</td>
        </tr>` : ""}
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">Contract End Date</td>
          <td style="padding:8px 0;color:${statusColor};font-size:14px;font-weight:600;border-bottom:1px solid #e5e7eb;text-align:right;">${contractEndDate}</td>
        </tr>
      </table>
      ${recipientType !== "agent" ? `<div style="text-align:center;margin:0 0 16px;">
        <a href="${appUrl}/agents" style="display:inline-block;background:${brand.buttonColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">View Agent Details</a>
      </div>` : ""}
      <p style="color:#6b7280;font-size:13px;line-height:1.5;margin:16px 0 0;">Please take the necessary action to renew or update the contract before it expires.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `${urgency}: Contract Expiring in ${daysLeft} Days\n\n${recipientType === "agent" ? `Your contract with ${brand.companyName}` : `Contract for ${agentName}${businessName ? ` (${businessName})` : ""}`} is expiring on ${contractEndDate}.\n\nPlease take action to renew or update the contract.`;

  return { subject, html, text };
}

export async function checkContractExpiries(): Promise<void> {
  try {
    const agents = await db.select({
      id: agentsTable.id,
      firstName: agentsTable.firstName,
      lastName: agentsTable.lastName,
      email: agentsTable.email,
      businessName: agentsTable.businessName,
      contractEndDate: agentsTable.contractEndDate,
      contractLastNotified: agentsTable.contractLastNotified,
      assignedStaffId: agentsTable.assignedStaffId,
      status: agentsTable.status,
    })
      .from(agentsTable)
      .where(and(
        isNotNull(agentsTable.contractEndDate),
        isNull(agentsTable.deletedAt),
        eq(agentsTable.status, "active")
      ));

    if (agents.length === 0) return;

    const brand = await getEmailBranding();
    const appUrl = getAppBaseUrl();
    const now = new Date();

    const admins = await db.select({ email: usersTable.email, firstName: usersTable.firstName })
      .from(usersTable)
      .where(sql`${usersTable.role} IN ('super_admin', 'admin') AND ${usersTable.email} IS NOT NULL`);

    for (const agent of agents) {
      if (!agent.contractEndDate) continue;

      const endDate = new Date(agent.contractEndDate);
      const diffMs = endDate.getTime() - now.getTime();
      const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (daysLeft <= 0 || daysLeft > 60) continue;

      let notifyKey = "";
      if (daysLeft <= 3) {
        notifyKey = "3d";
      } else if (daysLeft <= 60) {
        notifyKey = "60d";
      }

      const alreadyNotified = agent.contractLastNotified === notifyKey;
      const shouldNotify = !alreadyNotified;

      if (!shouldNotify) continue;

      const agentName = `${agent.firstName} ${agent.lastName}`;
      const contractEndStr = endDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

      const emails: { to: string; type: "admin" | "staff" | "agent" }[] = [];

      for (const admin of admins) {
        if (admin.email) {
          emails.push({ to: admin.email, type: "admin" });
        }
      }

      if (agent.assignedStaffId) {
        const [staff] = await db.select({ email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, agent.assignedStaffId));
        if (staff?.email) {
          emails.push({ to: staff.email, type: "staff" });
        }
      }

      if (agent.email) {
        emails.push({ to: agent.email, type: "agent" });
      }

      for (const recipient of emails) {
        const emailContent = buildContractExpiryEmail(
          brand, agentName, agent.businessName, daysLeft, contractEndStr, appUrl, recipient.type
        );
        await sendEmail(recipient.to, emailContent);
      }

      await db.update(agentsTable)
        .set({ contractLastNotified: notifyKey })
        .where(eq(agentsTable.id, agent.id));

      console.log(`[CONTRACT] Notified ${emails.length} recipient(s) for agent ${agentName} — ${daysLeft} days left`);
    }
  } catch (err) {
    console.error("[CONTRACT] Expiry check error:", err);
  }
}

let contractCheckerInterval: ReturnType<typeof setInterval> | null = null;

export function startContractChecker(): void {
  if (contractCheckerInterval) return;
  console.log(`[CONTRACT] Checker started, running every ${CHECK_INTERVAL / 3600000}h`);

  setTimeout(() => {
    checkContractExpiries().then(() => {
      console.log("[CONTRACT] Initial check completed");
    });
  }, 10000);

  contractCheckerInterval = setInterval(() => {
    checkContractExpiries();
  }, CHECK_INTERVAL);
}
