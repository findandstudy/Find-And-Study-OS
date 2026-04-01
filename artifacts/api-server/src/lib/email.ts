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

interface EmailBranding {
  logoUrl: string | null;
  primaryColor: string;
  buttonColor: string;
  companyName: string;
}

let brandingCache: { data: EmailBranding; fetchedAt: number } | null = null;
const BRANDING_TTL = 120_000;

export async function getEmailBranding(): Promise<EmailBranding> {
  if (brandingCache && Date.now() - brandingCache.fetchedAt < BRANDING_TTL) {
    return brandingCache.data;
  }
  try {
    const [settings] = await db.select({
      emailLogoUrl: settingsTable.emailLogoUrl,
      logoUrl: settingsTable.logoUrl,
      logoSquareUrl: settingsTable.logoSquareUrl,
      emailButtonColor: settingsTable.emailButtonColor,
      themePrimary: settingsTable.themePrimary,
      companyName: settingsTable.companyName,
    }).from(settingsTable);

    const baseUrl = getAppBaseUrl();
    let logoUrl: string | null = null;
    const rawLogo = settings?.emailLogoUrl || settings?.logoSquareUrl || settings?.logoUrl || null;
    if (rawLogo) {
      logoUrl = rawLogo.startsWith("http") ? rawLogo : `${baseUrl}${rawLogo.startsWith("/") ? "" : "/"}${rawLogo}`;
    }

    const data: EmailBranding = {
      logoUrl,
      primaryColor: settings?.emailButtonColor || settings?.themePrimary || "#1e3a5f",
      buttonColor: settings?.emailButtonColor || settings?.themePrimary || "#1e3a5f",
      companyName: settings?.companyName || "Find & Study",
    };
    brandingCache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    console.error("[EMAIL] Failed to load branding:", err);
    return { logoUrl: null, primaryColor: "#1e3a5f", buttonColor: "#1e3a5f", companyName: "Find & Study" };
  }
}

export function getAppBaseUrl(): string {
  if (process.env.REPLIT_DEPLOYMENT_URL) {
    return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
  }
  if (process.env.REPLIT_DOMAINS) {
    const firstDomain = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    if (firstDomain) return `https://${firstDomain}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return "http://localhost:5000";
}

function emailHeader(brand: EmailBranding, subtitle?: string): string {
  const logoHtml = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${brand.companyName}" style="max-height:48px;max-width:200px;margin:0 auto 8px;" />`
    : `<h1 style="margin:0 0 4px;color:#fff;font-size:24px;font-weight:700;">${brand.companyName}</h1>`;
  const subtitleHtml = subtitle
    ? `<p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:14px;">${subtitle}</p>`
    : "";
  return `<div style="background:linear-gradient(135deg,${brand.primaryColor},${lightenColor(brand.primaryColor, 15)});padding:28px 32px;text-align:center;">
      ${logoHtml}
      ${subtitleHtml}
    </div>`;
}

function lightenColor(hex: string, percent: number): string {
  const h = hex.replace("#", "");
  const num = parseInt(h, 16);
  if (isNaN(num)) return hex;
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * percent / 100));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * percent / 100));
  const b = Math.min(255, (num & 0xff) + Math.round(255 * percent / 100));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function emailShell(brand: EmailBranding, subtitle: string | undefined, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    ${emailHeader(brand, subtitle)}
    <div style="padding:32px;">
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}

function emailButton(label: string, url: string, color: string): string {
  return `<div style="text-align:center;margin:0 0 16px;">
        <a href="${url}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">${label}</a>
      </div>`;
}

export async function buildWelcomeEmail(params: {
  firstName: string;
  email: string;
  setPasswordUrl: string;
  verifyEmailUrl: string;
  loginUrl: string;
  programName?: string;
  universityName?: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const { firstName, email, setPasswordUrl, verifyEmailUrl, loginUrl, programName, universityName } = params;
  const brand = await getEmailBranding();

  const subject = "Your Application Has Been Received - Set Up Your Account";

  const applicationInfo = programName
    ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Program:</strong> ${programName}</p>
       ${universityName ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>University:</strong> ${universityName}</p>` : ""}`
    : "";

  const body = `
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Welcome, ${firstName}!</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Your application has been received and is being reviewed by our team. We have created an account for you so you can track your application progress.
      </p>
      ${applicationInfo ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;">${applicationInfo}</div>` : ""}
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 24px;">
        <p style="margin:0 0 4px;color:#166534;font-size:13px;font-weight:600;">Your Login Email</p>
        <p style="margin:0;color:#15803d;font-size:15px;font-weight:700;">${email}</p>
      </div>
      ${emailButton("Set Your Password", setPasswordUrl, brand.buttonColor)}
      ${emailButton("Verify Your Email", verifyEmailUrl, "#10b981")}
      ${emailButton("Go to Login Page", loginUrl, "#374151")}
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or copy these links into your browser:</p>
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;word-break:break-all;">Set Password: <a href="${setPasswordUrl}" style="color:${brand.buttonColor};">${setPasswordUrl}</a></p>
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;word-break:break-all;">Verify Email: <a href="${verifyEmailUrl}" style="color:${brand.buttonColor};">${verifyEmailUrl}</a></p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:12px;word-break:break-all;">Login: <a href="${loginUrl}" style="color:${brand.buttonColor};">${loginUrl}</a></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        The password setup link expires in 48 hours.<br/>
        If you did not apply, you can safely ignore this email.
      </p>`;

  const html = emailShell(brand, "Your Global Education Journey", body);

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

export async function buildExistingAccountEmail(params: {
  firstName: string;
  loginUrl: string;
  programName?: string;
  universityName?: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const { firstName, loginUrl, programName, universityName } = params;
  const brand = await getEmailBranding();

  const subject = "New Application Received";

  const applicationInfo = programName
    ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Program:</strong> ${programName}</p>
       ${universityName ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>University:</strong> ${universityName}</p>` : ""}`
    : "";

  const body = `
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">New Application Received</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Hi ${firstName}, your new application has been received and is being reviewed by our team. You can log in to your existing account to track its progress.
      </p>
      ${applicationInfo ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;">${applicationInfo}</div>` : ""}
      ${emailButton("Log In to Your Account", loginUrl, brand.buttonColor)}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        If you did not submit this application, please contact us immediately.
      </p>`;

  const html = emailShell(brand, "Your Global Education Journey", body);

  const text = `Hi ${firstName},

Your new application has been received and is being reviewed.

${programName ? `Program: ${programName}` : ""}
${universityName ? `University: ${universityName}` : ""}

Log in to track your application: ${loginUrl}`;

  return { subject, html, text };
}

export async function buildVerificationEmail(params: {
  firstName: string;
  verifyEmailUrl: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const { firstName, verifyEmailUrl } = params;
  const brand = await getEmailBranding();

  const subject = "Verify Your Email Address";

  const body = `
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Verify Your Email</h2>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
        Hi ${firstName}, please click the button below to verify your email address.
      </p>
      ${emailButton("Verify Email Address", verifyEmailUrl, "#10b981")}
      <p style="margin:0;color:#6b7280;font-size:12px;word-break:break-all;">Or copy: <a href="${verifyEmailUrl}" style="color:${brand.buttonColor};">${verifyEmailUrl}</a></p>`;

  const html = emailShell(brand, undefined, body);

  const text = `Hi ${firstName},

Please verify your email by visiting: ${verifyEmailUrl}`;

  return { subject, html, text };
}

export async function buildPasswordResetEmail(params: {
  firstName: string;
  resetUrl: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const { firstName, resetUrl } = params;
  const brand = await getEmailBranding();

  const subject = `Reset Your Password — ${brand.companyName}`;

  const body = `
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Reset Your Password</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Hi ${firstName}, we received a request to reset your password. Click the button below to set a new password.
      </p>
      ${emailButton("Reset Password", resetUrl, brand.buttonColor)}
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or copy this link into your browser:</p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:12px;word-break:break-all;"><a href="${resetUrl}" style="color:${brand.buttonColor};">${resetUrl}</a></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        This link expires in 1 hour.<br/>
        If you did not request a password reset, you can safely ignore this email.
      </p>`;

  const html = emailShell(brand, "Password Reset Request", body);

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
