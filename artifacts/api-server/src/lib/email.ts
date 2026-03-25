import crypto from "crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db, emailQueueTable, integrationsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let cachedTransporter: Transporter | null = null;
let transporterConfigHash = "";

interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail?: string;
  fromName?: string;
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const [integration] = await db.select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, "smtp"));

  if (!integration || !integration.isEnabled) return null;

  const config = integration.config as Record<string, any>;
  if (!config.host || !config.username || !config.password) return null;

  return {
    host: config.host,
    port: parseInt(config.port, 10) || 587,
    username: config.username,
    password: config.password,
    fromEmail: config.fromEmail || config.username,
    fromName: config.fromName,
  };
}

async function getSenderDefaults(): Promise<{ senderName: string; senderEmail: string; replyTo?: string }> {
  const [settings] = await db.select({
    emailSenderName: settingsTable.emailSenderName,
    emailSenderEmail: settingsTable.emailSenderEmail,
    emailReplyTo: settingsTable.emailReplyTo,
  }).from(settingsTable);

  return {
    senderName: settings?.emailSenderName || "Find & Study",
    senderEmail: settings?.emailSenderEmail || "",
    replyTo: settings?.emailReplyTo || undefined,
  };
}

function buildConfigHash(host: string, port: number, user: string, pass: string): string {
  return `${host}:${port}:${user}:${pass}`;
}

export async function createSmtpTransporter(config: SmtpConfig): Promise<Transporter> {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

async function getTransporter(): Promise<{ transporter: Transporter; fromEmail: string; fromName: string; replyTo?: string } | null> {
  const smtpConfig = await getSmtpConfig();
  if (!smtpConfig) return null;

  const hash = buildConfigHash(smtpConfig.host, smtpConfig.port, smtpConfig.username, smtpConfig.password);
  const defaults = await getSenderDefaults();

  if (cachedTransporter && transporterConfigHash === hash) {
    return {
      transporter: cachedTransporter,
      fromEmail: defaults.senderEmail || smtpConfig.fromEmail || smtpConfig.username,
      fromName: defaults.senderName || smtpConfig.fromName || "Find & Study",
      replyTo: defaults.replyTo,
    };
  }

  cachedTransporter = await createSmtpTransporter(smtpConfig);
  transporterConfigHash = hash;

  return {
    transporter: cachedTransporter,
    fromEmail: defaults.senderEmail || smtpConfig.fromEmail || smtpConfig.username,
    fromName: defaults.senderName || smtpConfig.fromName || "Find & Study",
    replyTo: defaults.replyTo,
  };
}

export function invalidateSmtpCache(): void {
  cachedTransporter = null;
  transporterConfigHash = "";
}

async function sendViaSmtp(to: string, subject: string, html: string, text: string): Promise<boolean> {
  try {
    const smtp = await getTransporter();
    if (!smtp) {
      console.log("[EMAIL] SMTP not configured or disabled, email queued only");
      return false;
    }

    const from = `"${smtp.fromName}" <${smtp.fromEmail}>`;

    await smtp.transporter.sendMail({
      from,
      to,
      subject,
      html,
      text,
      ...(smtp.replyTo ? { replyTo: smtp.replyTo } : {}),
    });

    console.log(`[EMAIL] Sent via SMTP to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] SMTP send failed for ${to}:`, err);
    return false;
  }
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function buildWelcomeEmail(params: {
  firstName: string;
  email: string;
  setPasswordUrl: string;
  verifyEmailUrl: string;
  loginUrl: string;
  programName?: string;
  universityName?: string;
}): { subject: string; html: string; text: string } {
  const { firstName, email, setPasswordUrl, verifyEmailUrl, loginUrl, programName, universityName } = params;

  const subject = "Your Application Has Been Received - Set Up Your Account";

  const applicationInfo = programName
    ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Program:</strong> ${programName}</p>
       ${universityName ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>University:</strong> ${universityName}</p>` : ""}`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">Find & Study</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px;">Your Global Education Journey</p>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Welcome, ${firstName}!</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Your application has been received and is being reviewed by our team. We have created an account for you so you can track your application progress.
      </p>
      ${applicationInfo ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;">${applicationInfo}</div>` : ""}
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 24px;">
        <p style="margin:0 0 4px;color:#166534;font-size:13px;font-weight:600;">Your Login Email</p>
        <p style="margin:0;color:#15803d;font-size:15px;font-weight:700;">${email}</p>
      </div>
      <div style="text-align:center;margin:0 0 16px;">
        <a href="${setPasswordUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">Set Your Password</a>
      </div>
      <div style="text-align:center;margin:0 0 16px;">
        <a href="${verifyEmailUrl}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">Verify Your Email</a>
      </div>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${loginUrl}" style="display:inline-block;background:#374151;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;">Go to Login Page</a>
      </div>
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or copy these links into your browser:</p>
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;word-break:break-all;">Set Password: ${setPasswordUrl}</p>
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;word-break:break-all;">Verify Email: ${verifyEmailUrl}</p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:12px;word-break:break-all;">Login: ${loginUrl}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        The password setup link expires in 48 hours.<br/>
        If you did not apply, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Welcome, ${firstName}!

Your application has been received and is being reviewed by our team.

${programName ? `Program: ${programName}` : ""}
${universityName ? `University: ${universityName}` : ""}

Your login email: ${email}

Set your password: ${setPasswordUrl}
Verify your email: ${verifyEmailUrl}
Login: ${loginUrl}

The password setup link expires in 48 hours.`;

  return { subject, html, text };
}

export function buildExistingAccountEmail(params: {
  firstName: string;
  loginUrl: string;
  programName?: string;
  universityName?: string;
}): { subject: string; html: string; text: string } {
  const { firstName, loginUrl, programName, universityName } = params;

  const subject = "New Application Received";

  const applicationInfo = programName
    ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Program:</strong> ${programName}</p>
       ${universityName ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>University:</strong> ${universityName}</p>` : ""}`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">Find & Study</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px;">Your Global Education Journey</p>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">New Application Received</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Hi ${firstName}, your new application has been received and is being reviewed by our team. You can log in to your existing account to track its progress.
      </p>
      ${applicationInfo ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;">${applicationInfo}</div>` : ""}
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${loginUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">Log In to Your Account</a>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        If you did not submit this application, please contact us immediately.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Hi ${firstName},

Your new application has been received and is being reviewed.

${programName ? `Program: ${programName}` : ""}
${universityName ? `University: ${universityName}` : ""}

Log in to track your application: ${loginUrl}`;

  return { subject, html, text };
}

export function buildVerificationEmail(params: {
  firstName: string;
  verifyEmailUrl: string;
}): { subject: string; html: string; text: string } {
  const { firstName, verifyEmailUrl } = params;

  const subject = "Verify Your Email Address";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">Find & Study</h1>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Verify Your Email</h2>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
        Hi ${firstName}, please click the button below to verify your email address.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${verifyEmailUrl}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">Verify Email Address</a>
      </div>
      <p style="margin:0;color:#6b7280;font-size:12px;word-break:break-all;">Or copy: ${verifyEmailUrl}</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Hi ${firstName},

Please verify your email by visiting: ${verifyEmailUrl}`;

  return { subject, html, text };
}

export function buildPasswordResetEmail(params: {
  firstName: string;
  resetUrl: string;
}): { subject: string; html: string; text: string } {
  const { firstName, resetUrl } = params;

  const subject = "Reset Your Password — Find & Study";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">Find & Study</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px;">Password Reset Request</p>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Reset Your Password</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Hi ${firstName}, we received a request to reset your password. Click the button below to set a new password.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">Reset Password</a>
      </div>
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or copy this link into your browser:</p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:12px;word-break:break-all;">${resetUrl}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        This link expires in 1 hour.<br/>
        If you did not request a password reset, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Hi ${firstName},

We received a request to reset your password. Visit the link below to set a new password:

${resetUrl}

This link expires in 1 hour.
If you did not request this, you can safely ignore this email.`;

  return { subject, html, text };
}

export async function sendEmail(to: string, email: { subject: string; html: string; text: string }): Promise<void> {
  console.log(`[EMAIL] Queuing email to ${to}: ${email.subject}`);

  let queueId: number | undefined;
  try {
    const [row] = await db.insert(emailQueueTable).values({
      toEmail: to,
      subject: email.subject,
      htmlBody: email.html,
      textBody: email.text,
      status: "pending",
    }).returning({ id: emailQueueTable.id });
    queueId = row?.id;
  } catch (err) {
    console.error("[EMAIL] Failed to persist email to queue:", err);
  }

  const sent = await sendViaSmtp(to, email.subject, email.html, email.text);
  if (sent && queueId) {
    try {
      await db.update(emailQueueTable)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(emailQueueTable.id, queueId));
    } catch (err) {
      console.error("[EMAIL] Failed to update queue status:", err);
    }
  }
}

export async function processEmailQueue(): Promise<number> {
  let processed = 0;
  try {
    const pending = await db.select().from(emailQueueTable)
      .where(eq(emailQueueTable.status, "pending"))
      .limit(20);

    if (pending.length === 0) return 0;

    for (const email of pending) {
      const sent = await sendViaSmtp(email.toEmail, email.subject, email.htmlBody, email.textBody);
      if (sent) {
        await db.update(emailQueueTable)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(emailQueueTable.id, email.id));
        processed++;
      } else {
        await db.update(emailQueueTable)
          .set({ status: "failed" })
          .where(eq(emailQueueTable.id, email.id));
      }
    }
  } catch (err) {
    console.error("[EMAIL] Queue processing error:", err);
  }
  return processed;
}

let emailWorkerInterval: ReturnType<typeof setInterval> | null = null;

export function startEmailWorker(intervalMs = 30000): void {
  if (emailWorkerInterval) return;
  console.log(`[EMAIL] Worker started, processing queue every ${intervalMs / 1000}s`);

  processEmailQueue().then(count => {
    if (count > 0) console.log(`[EMAIL] Initial queue: sent ${count} emails`);
  });

  emailWorkerInterval = setInterval(async () => {
    const count = await processEmailQueue();
    if (count > 0) console.log(`[EMAIL] Queue processed: sent ${count} emails`);
  }, intervalMs);
}

export function stopEmailWorker(): void {
  if (emailWorkerInterval) {
    clearInterval(emailWorkerInterval);
    emailWorkerInterval = null;
    console.log("[EMAIL] Worker stopped");
  }
}
