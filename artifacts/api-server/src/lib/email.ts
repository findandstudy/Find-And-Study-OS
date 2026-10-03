import crypto from "crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db, integrationsTable, settingsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isLiveIntegrationsEnabled } from "./inbox/liveMode";
import { isBlockedOutboundIp } from "./safeOutboundRequest";
import { decryptConfig, isEncrypted } from "./encryption";
import { classifyEmailTransportError, emailDeliveryAllowed, executeClaimedEmail, isEmailMailbox, serializeEmailAttachments, stageEmailDeliveryErrorCode, type ClaimedEmail, type EmailAttemptResult } from "./emailDeliveryPolicy";

let cachedTransporter: Transporter | null = null;
let transporterConfigHash = "";

interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail?: string;
  fromName?: string;
  tlsServername?: string;
}

export interface TenantSmtpConfig extends SmtpConfig {}

const TENANT_SMTP_PORTS = new Set([465, 587, 2525]);

/**
 * Tenant-owned SMTP settings are untrusted network destinations. Resolve the
 * hostname before connecting and reject local/private/reserved targets so an
 * agency cannot use the mail integration as an SSRF tunnel into our network.
 */
export async function assertSafeTenantSmtpDestination(host: string, port: number): Promise<string> {
  const normalizedHost = String(host || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!normalizedHost || normalizedHost === "localhost" || normalizedHost.endsWith(".localhost") || normalizedHost.endsWith(".local")) {
    throw new Error("unsafe_smtp_destination");
  }
  if (!TENANT_SMTP_PORTS.has(Number(port))) {
    throw new Error("unsupported_smtp_port");
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(normalizedHost, { all: true, verbatim: true });
  } catch {
    throw new Error("smtp_host_unresolvable");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedOutboundIp(address))) {
    throw new Error("unsafe_smtp_destination");
  }
  return addresses[0].address;
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const [integration] = await db.select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, "smtp"));

  if (!integration || !integration.isEnabled) return null;

  const config = decryptConfig(integration.config as Record<string, any>);
  if (!config.host || !config.username || !config.password || isEncrypted(config.password)) return null;

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
    senderName: settings?.emailSenderName || "Find And Study OS",
    senderEmail: settings?.emailSenderEmail || "",
    replyTo: settings?.emailReplyTo || undefined,
  };
}

function buildConfigHash(host: string, port: number, user: string, pass: string): string {
  return crypto.createHash("sha256").update(JSON.stringify([host, port, user, pass])).digest("hex");
}

export async function createSmtpTransporter(config: SmtpConfig): Promise<Transporter> {
  const port = Number(config.port);
  const secure = port === 465;
  const originalHost = String(config.host).trim().replace(/^\[|\]$/g, "");
  const resolvedHost = await assertSafeTenantSmtpDestination(originalHost, port);
  return nodemailer.createTransport({
    // Pin the vetted address so a later DNS lookup cannot rebound to an
    // internal service. Certificate validation still uses the original host.
    host: resolvedHost,
    port,
    secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    // Force STARTTLS on non-implicit-TLS ports so credentials and message
    // bodies are never sent over a plaintext connection.
    ...(secure ? {} : { requireTLS: true }),
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      // Validate the mail server's X.509 certificate to prevent
      // man-in-the-middle interception of credentials and sensitive
      // links (password reset, verification, contract signing).
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...((config.tlsServername || isIP(originalHost) === 0)
        ? { servername: config.tlsServername || originalHost }
        : {}),
    },
  });
}

/**
 * Deliver through an agency-owned SMTP connection. Tenant credentials never
 * enter the shared queue because that queue is retried with the platform SMTP
 * configuration. Live delivery is explicitly disabled in local/test runs.
 */
export async function sendTenantEmail(
  config: TenantSmtpConfig,
  to: string,
  email: { subject: string; html: string; text: string },
): Promise<boolean> {
  if (
    !emailDeliveryAllowed()
    || process.env.NODE_ENV === "test"
    || process.env.EMAIL_DELIVERY_DISABLED === "true"
    || !isLiveIntegrationsEnabled()
  ) {
    return false;
  }
  if (!isEmailMailbox(to) || !isEmailMailbox(config.fromEmail || config.username) || /[\r\n\x00]/.test(email.subject)) return false;
  const transporter = await createSmtpTransporter(config);
  if (!emailDeliveryAllowed()) { transporter.close(); return false; }
  try { await transporter.sendMail({
    from: {
      name: config.fromName || "Agency",
      address: config.fromEmail || config.username,
    },
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
    return true;
  } finally { transporter.close(); }
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
      fromName: defaults.senderName || smtpConfig.fromName || "Find And Study OS",
      replyTo: defaults.replyTo,
    };
  }

  cachedTransporter = await createSmtpTransporter(smtpConfig);
  transporterConfigHash = hash;

  return {
    transporter: cachedTransporter,
    fromEmail: defaults.senderEmail || smtpConfig.fromEmail || smtpConfig.username,
    fromName: defaults.senderName || smtpConfig.fromName || "Find And Study OS",
    replyTo: defaults.replyTo,
  };
}

export function invalidateSmtpCache(): void {
  cachedTransporter?.close();
  cachedTransporter = null;
  transporterConfigHash = "";
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

async function sendViaSmtp(item: ClaimedEmail, attachments?: EmailAttachment[]): Promise<EmailAttemptResult> {
  if (!emailDeliveryAllowed()) return { status: "pending", code: "EMAIL_DELIVERY_DISABLED" };
  let smtp: Awaited<ReturnType<typeof getTransporter>>;
  let closeAfterSend = false;
  let revalidatePinnedSender: (() => Promise<boolean>) | undefined;
  try {
    if (item.sender_account_id !== null) {
      if (!Number.isSafeInteger(item.sender_revision) || Number(item.sender_revision) <= 0) return { status: "blocked", code: "EMAIL_SENDER_REVISION_REQUIRED" };
      const { resolveEmailSenderAccount } = await import("./notifications/emailSenderAccounts");
      const pinned = await resolveEmailSenderAccount(item.sender_account_id, item.sender_revision!);
      if (!pinned) return { status: "blocked", code: "EMAIL_SENDER_UNAVAILABLE" };
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(pinned)).digest("hex");
      revalidatePinnedSender = async () => {
        const current = await resolveEmailSenderAccount(item.sender_account_id!, item.sender_revision!);
        return !!current && crypto.createHash("sha256").update(JSON.stringify(current)).digest("hex") === fingerprint;
      };
      smtp = {
        transporter: await createSmtpTransporter({ host: pinned.host, port: pinned.port, username: pinned.user, password: pinned.pass, fromEmail: pinned.fromEmail, fromName: pinned.fromName }),
        fromEmail: pinned.fromEmail, fromName: pinned.fromName, replyTo: pinned.replyTo || undefined,
      };
      closeAfterSend = true;
    } else {
      smtp = await getTransporter();
      if (!smtp) return { status: "pending", code: "SMTP_NOT_CONFIGURED" };
    }
  } catch {
    return { status: "blocked", code: "SMTP_CONFIGURATION_UNAVAILABLE" };
  }

  try {
    if (!isEmailMailbox(smtp.fromEmail) || (smtp.replyTo && !isEmailMailbox(smtp.replyTo)) || /[\r\n\x00]/.test(smtp.fromName)) {
      return { status: "blocked", code: "EMAIL_SENDER_INVALID" };
    }
    if (item.template_version_id !== null) {
      try {
        const approved = await pool.query(`SELECT v.id FROM message_template_email_versions v
          JOIN message_templates t ON t.id=v.template_id
          WHERE v.id=$1 AND v.status='approved' AND t.is_active=true AND t.channel IN ('email','all')`, [item.template_version_id]);
        if (!approved.rows.length) return { status: "blocked", code: "EMAIL_TEMPLATE_NOT_APPROVED" };
      } catch { return { status: "blocked", code: "EMAIL_TEMPLATE_POLICY_UNAVAILABLE" }; }
    }
    if (item.idempotency_key?.startsWith("stage-email:")) {
      try {
        const { validateStageEmailQueueItem } = await import("./notifications/stageEmailAutomation");
        const verdict = await validateStageEmailQueueItem(item.id);
        if (!verdict.allowed) return { status: "blocked", code: stageEmailDeliveryErrorCode(verdict.code) };
      } catch { return { status: "blocked", code: "STAGE_EMAIL_POLICY_UNAVAILABLE" }; }
    }
    // Re-evaluate after resolving credentials and policies, at the last send boundary.
    if (!emailDeliveryAllowed()) return { status: "pending", code: "EMAIL_DELIVERY_DISABLED" };
    const owned = await pool.query("SELECT id FROM email_queue WHERE id=$1 AND status='processing' AND claim_token=$2", [item.id, item.claim_token]);
    if (!owned.rows.length) return { status: "unknown", code: "EMAIL_CLAIM_LOST" };
    // DNS/transport setup can outlive a sender edit or deactivation. Generic
    // notification rows need this check too, not only the stage-specific lane.
    if (revalidatePinnedSender) {
      try {
        if (!await revalidatePinnedSender()) return { status: "blocked", code: "EMAIL_SENDER_CHANGED_OR_UNVERIFIED" };
      } catch { return { status: "blocked", code: "EMAIL_SENDER_POLICY_UNAVAILABLE" }; }
    }
    if (!emailDeliveryAllowed()) return { status: "pending", code: "EMAIL_DELIVERY_DISABLED" };
    const messageId = `<fas-email-${item.id}@${smtp.fromEmail.split("@")[1].toLowerCase()}>`;
    try {
      const result = await smtp.transporter.sendMail({
        from: { name: smtp.fromName, address: smtp.fromEmail },
        to: item.to_email, subject: item.subject, html: item.html_body, text: item.text_body,
        messageId,
        ...(smtp.replyTo ? { replyTo: smtp.replyTo } : {}),
        ...(attachments?.length ? { attachments } : {}),
      });
      if (Array.isArray(result.accepted) && result.accepted.length > 0 && (!Array.isArray(result.rejected) || result.rejected.length === 0)) {
        return { status: "sent", code: null, messageId };
      }
      if (Array.isArray(result.rejected) && result.rejected.length > 0 && (!Array.isArray(result.accepted) || result.accepted.length === 0)) {
        return { status: "failed", code: "SMTP_RECIPIENT_REJECTED" };
      }
      return { status: "unknown", code: "SMTP_OUTCOME_UNKNOWN" };
    } catch (error) { return classifyEmailTransportError(error); }
  } finally { if (closeAfterSend) smtp.transporter.close(); }
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
      // Private object-storage URLs (/api/storage/objects/...) require auth and
      // break in email clients. Route them through the public branding endpoint
      // which streams the logo without authentication.
      if (rawLogo.startsWith("http") && !rawLogo.includes("/api/storage/objects/")) {
        logoUrl = rawLogo;
      } else if (rawLogo.includes("/api/storage/objects/") || rawLogo.startsWith("/objects/")) {
        // Always request the email-specific variant so the proxy serves
        // emailLogoUrl (with logoSquareUrl → logoUrl fallback) rather than
        // the main site logo. The endpoint is public — no auth required.
        logoUrl = `${baseUrl}/api/settings/branding/logo?variant=email`;
      } else {
        logoUrl = `${baseUrl}${rawLogo.startsWith("/") ? "" : "/"}${rawLogo}`;
      }
    }

    const data: EmailBranding = {
      logoUrl,
      primaryColor: settings?.emailButtonColor || settings?.themePrimary || "#1e3a5f",
      buttonColor: settings?.emailButtonColor || settings?.themePrimary || "#1e3a5f",
      companyName: settings?.companyName || "Find And Study OS",
    };
    brandingCache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    console.error("[EMAIL] Failed to load branding");
    return { logoUrl: null, primaryColor: "#1e3a5f", buttonColor: "#1e3a5f", companyName: "Find And Study OS" };
  }
}

/**
 * Resolve the public base URL used when constructing links inside outgoing
 * emails. Priority (highest first):
 *   1. APP_BASE_URL — explicit operator override. Set this to your custom
 *      production domain (e.g. https://portal.masterstudyinturkey.com) so
 *      onboarding/contract links go to the branded URL instead of the
 *      generic *.replit.app deployment URL. Trailing slashes are trimmed.
 *   2. REPLIT_DOMAINS — the comma-separated list of domains routed to the
 *      deployment. When a custom domain is attached this is preferred over
 *      the bare REPLIT_DEPLOYMENT_URL because users recognize their own
 *      brand. We pick the first non-*.replit.app entry when one exists,
 *      otherwise fall back to the first entry.
 *   3. REPLIT_DEPLOYMENT_URL — fallback Replit-assigned production URL.
 *   4. REPLIT_DEV_DOMAIN — development workspace URL.
 *   5. http://localhost:5000 — last-resort local default.
 */
export function getAppBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  if (process.env.REPLIT_DOMAINS) {
    const domains = process.env.REPLIT_DOMAINS
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const custom = domains.find((d) => !d.endsWith(".replit.app") && !d.endsWith(".replit.dev"));
    const chosen = custom || domains[0];
    if (chosen) return `https://${chosen}`;
  }
  if (process.env.REPLIT_DEPLOYMENT_URL) {
    return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
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

function escapeNotifText(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a branded notification email from a (possibly localized) subject +
 * rich HTML body. Reuses the same shell/header/button/branding helpers as the
 * transactional emails so notification mails match the rest of the system.
 *
 * `bodyHtml` is rendered as-is (admin-authored, trusted) inside the shell.
 */
export async function buildNotificationEmail(params: {
  subject: string;
  bodyHtml: string;
  actionUrl?: string;
  actionLabel?: string;
  subtitle?: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const brand = await getEmailBranding();
  const { subject, bodyHtml, actionUrl, actionLabel, subtitle } = params;
  const button = actionUrl
    ? emailButton(actionLabel || "View Details", actionUrl, brand.buttonColor)
    : "";
  const body = `
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">${escapeNotifText(subject)}</h2>
      <div style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">${bodyHtml}</div>
      ${button}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">This is an automated notification from ${escapeNotifText(brand.companyName)}.</p>`;
  const html = emailShell(brand, subtitle, body);
  const text = bodyHtml.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return { subject, html, text };
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

/**
 * Agent onboarding email — sent when an admin creates a new agent account.
 * Includes both a CTA button (auto-verify via link) and a 6-digit code box
 * (manual fallback). Uses the system brand colors via getEmailBranding so it
 * matches the rest of the system's transactional mail.
 */
export async function buildAgentOnboardingEmail(params: {
  firstName: string;
  email: string;
  code: string;
  verifyUrl: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const { firstName, email, code, verifyUrl } = params;
  const brand = await getEmailBranding();
  const subject = `Hesabınızı doğrulayın / Verify your ${brand.companyName} account`;

  const body = `
      <h2 style="margin:0 0 12px;color:#111827;font-size:20px;">Hesabınızı doğrulayın / Verify your account</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Merhaba ${firstName}, ${brand.companyName} acente hesabınız oluşturuldu. Aşağıdaki butona tıklayarak doğrulamayı tamamlayın, ardından kendi şifrenizi belirleyin ve sözleşmenizi imzalayın.
      </p>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
        Hi ${firstName}, your ${brand.companyName} agent account has been created. Click the button below to verify, then set your password and sign your contract.
      </p>
      ${emailButton("Hesabımı doğrula / Verify my account", verifyUrl, brand.buttonColor)}
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-align:center;word-break:break-all;">
        Buton çalışmıyorsa: <a href="${verifyUrl}" style="color:${brand.buttonColor};">${verifyUrl}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0 0 8px;color:#374151;font-size:14px;text-align:center;">
        Alternatif olarak, giriş yaptıktan sonra aşağıdaki 6 haneli doğrulama kodunu girebilirsiniz.<br/>
        <span style="color:#6b7280;font-size:12px;">Or enter the 6-digit code below after logging in.</span>
      </p>
      <div style="text-align:center;margin:0 0 16px;">
        <div style="display:inline-block;background:${lightenColor(brand.primaryColor, 45)};border:2px solid ${brand.primaryColor};border-radius:12px;padding:14px 28px;letter-spacing:8px;font-size:28px;font-weight:700;color:${brand.primaryColor};">${code}</div>
      </div>
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        Bu link ve kod 15 dakika içinde geçersiz olacaktır. / This link and code expire in 15 minutes.<br/>
        Bu e-postayı beklemiyorsanız yok sayabilirsiniz. / If you did not expect this email, you can ignore it.
      </p>`;

  const html = emailShell(brand, "Agent Onboarding · Acente Kayıt", body);

  const text = `Merhaba ${firstName},

${brand.companyName} acente hesabınız oluşturuldu.

Hesabınızı doğrulamak için: ${verifyUrl}

Alternatif olarak giriş yaptıktan sonra şu 6 haneli kodu girin: ${code}

Link ve kod 15 dakika içinde geçersiz olur. Doğrulama sonrası şifrenizi belirleyip sözleşmenizi imzalamanız gerekecek.

—

Hi ${firstName},

Your ${brand.companyName} agent account (${email}) has been created.

Verify your account: ${verifyUrl}

Or log in and enter the 6-digit code: ${code}

The link and code expire in 15 minutes. After verifying, you'll set a password and sign your contract.`;

  return { subject, html, text };
}

/**
 * Agent credentials email — sent when an admin creates a new agent account.
 * The account is provisioned active + email-verified with a system-generated
 * password, so this email hands the agent their login email, that password,
 * and a direct link to the login page. The agent can change the password
 * later from their own panel.
 */
export async function buildAgentCredentialsEmail(params: {
  firstName: string;
  email: string;
  password: string;
  loginUrl: string;
  hasContract?: boolean;
}): Promise<{ subject: string; html: string; text: string }> {
  const { firstName, email, password, loginUrl, hasContract = true } = params;
  const brand = await getEmailBranding();
  const subject = `Giriş bilgileriniz / Your ${brand.companyName} login details`;

  const trNextStep = hasContract
    ? "Aşağıdaki bilgilerle giriş yapın, ardından sözleşmenizi imzalamak için yönlendirileceksiniz."
    : "Aşağıdaki bilgilerle giriş yaparak panelinizi kullanmaya başlayabilirsiniz.";
  const enNextStep = hasContract
    ? "Log in with the details below; you'll then be guided to sign your contract."
    : "Log in with the details below to start using your panel.";

  const body = `
      <h2 style="margin:0 0 12px;color:#111827;font-size:20px;">Hesabınız hazır / Your account is ready</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Merhaba ${escapeNotifText(firstName)}, ${escapeNotifText(brand.companyName)} acente hesabınız oluşturuldu. ${trNextStep}
      </p>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
        Hi ${escapeNotifText(firstName)}, your ${escapeNotifText(brand.companyName)} agent account has been created. ${enNextStep}
      </p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;">
        <p style="margin:0 0 4px;color:#6b7280;font-size:13px;font-weight:600;">E-posta / Email</p>
        <p style="margin:0 0 12px;color:#111827;font-size:15px;font-weight:700;">${escapeNotifText(email)}</p>
        <p style="margin:0 0 4px;color:#6b7280;font-size:13px;font-weight:600;">Şifre / Password</p>
        <p style="margin:0;color:#111827;font-size:15px;font-weight:700;font-family:monospace;letter-spacing:1px;">${escapeNotifText(password)}</p>
      </div>
      ${emailButton("Giriş yap / Log in", loginUrl, brand.buttonColor)}
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-align:center;word-break:break-all;">
        Buton çalışmıyorsa: <a href="${loginUrl}" style="color:${brand.buttonColor};">${loginUrl}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        Güvenliğiniz için giriş yaptıktan sonra panelinizden şifrenizi değiştirmenizi öneririz.<br/>
        For your security, we recommend changing your password from your panel after logging in.
      </p>`;

  const html = emailShell(brand, "Agent Onboarding · Acente Kayıt", body);

  const text = `Merhaba ${firstName},

${brand.companyName} acente hesabınız oluşturuldu.

E-posta: ${email}
Şifre: ${password}

Giriş yapın: ${loginUrl}

Güvenliğiniz için giriş yaptıktan sonra panelinizden şifrenizi değiştirmenizi öneririz.

—

Hi ${firstName},

Your ${brand.companyName} agent account has been created.

Email: ${email}
Password: ${password}

Log in: ${loginUrl}

For your security, we recommend changing your password from your panel after logging in.${hasContract ? " After logging in you'll be guided to sign your contract." : ""}`;

  return { subject, html, text };
}

export async function buildAgencyPortalInvitationEmail(params: {
  firstName: string;
  referenceCode: string;
  passwordSetupUrl: string;
  trackingUrl: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const brand = await getEmailBranding();
  const subject = `Agency application portal · ${params.referenceCode}`;
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Your application portal is ready</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hi ${escapeNotifText(params.firstName)}, your agency application <strong>${escapeNotifText(params.referenceCode)}</strong> was received.
      Create your password to enter the applicant portal and follow the review and contract process.
    </p>
    ${emailButton("Create password & open portal", params.passwordSetupUrl, brand.buttonColor)}
    <p style="margin:16px 0 8px;color:#6b7280;font-size:13px;">You can also track the public application here:</p>
    <p style="margin:0 0 16px;color:#6b7280;font-size:12px;word-break:break-all;"><a href="${params.trackingUrl}" style="color:${brand.buttonColor};">${params.trackingUrl}</a></p>
    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
      The password setup link expires in 48 hours. You may request a new password link from the login page afterwards.
    </p>`;
  const html = emailShell(brand, "Agency Application Portal", body);
  const text = `Hi ${params.firstName},
Your agency application ${params.referenceCode} was received.
Create your password and enter the applicant portal:
${params.passwordSetupUrl}
Track the application:
${params.trackingUrl}
The password setup link expires in 48 hours.`;
  return { subject, html, text };
}

export async function buildAgencyContractReminderEmail(params: {
  firstName: string;
  referenceCode: string;
  signUrl: string;
  expiresAt: Date;
  daysLeft: number;
}): Promise<{ subject: string; html: string; text: string }> {
  const brand = await getEmailBranding();
  const subject = `Action required: Sign your agency contract · ${params.referenceCode}`;
  const expiry = params.expiresAt.toUTCString();
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Your agency contract is waiting</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hi ${escapeNotifText(params.firstName)}, your agency application <strong>${escapeNotifText(params.referenceCode)}</strong>
      is still waiting for the contract signature. ${params.daysLeft} day${params.daysLeft === 1 ? "" : "s"} remain before limited portal access is restricted.
    </p>
    ${emailButton("Open portal & sign contract", params.signUrl, brand.buttonColor)}
    <p style="margin:0;color:#6b7280;font-size:13px;">Signing deadline: <strong>${expiry}</strong>.</p>
    <p style="margin:12px 0 0;color:#9ca3af;font-size:12px;">Your account will remain available after the deadline so you can view the application status and contact support.</p>`;
  const html = emailShell(brand, "Agency contract reminder", body);
  const text = `Hi ${params.firstName},
Your agency application ${params.referenceCode} is waiting for the contract signature.
${params.daysLeft} day${params.daysLeft === 1 ? "" : "s"} remain.
Open the portal and sign: ${params.signUrl}
Deadline: ${expiry}`;
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

export async function buildContractSignRequestEmail(params: {
  signerName?: string | null;
  agentName?: string | null;
  templateName: string;
  signUrl: string;
  expiresAt: Date;
  selfFill?: boolean;
}): Promise<{ subject: string; html: string; text: string }> {
  const brand = await getEmailBranding();
  const greeting = params.signerName ? `Hello ${params.signerName},` : "Hello,";
  const intro = params.selfFill
    ? `You have been invited to fill in your details and electronically sign your contract <strong>${params.templateName}</strong>.`
    : `An electronic signature is requested for your contract <strong>${params.templateName}</strong>${params.agentName ? ` (${params.agentName})` : ""}.`;
  const expiryStr = params.expiresAt.toUTCString();
  const subject = params.selfFill
    ? `Action required: Complete & sign your contract`
    : `Action required: Sign your contract — ${params.templateName}`;
  const bodyHtml = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">${subject}</h2>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">${greeting}</p>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">${intro}</p>
    ${emailButton(params.selfFill ? "Start & Sign" : "Open & Sign", params.signUrl, brand.primaryColor)}
    <p style="margin:0 0 12px;color:#6b7280;font-size:13px;">This signing link expires on <strong>${expiryStr}</strong>.</p>
    <p style="margin:0;color:#9ca3af;font-size:12px;">If you did not request this, please ignore this email.</p>`;
  const text = `${greeting}\n\n${params.selfFill ? "You have been invited to fill in and sign your contract." : "An e-signature is requested for your contract."}\n\nOpen: ${params.signUrl}\nExpires: ${expiryStr}`;
  return { subject, html: emailShell(brand, "Contract signing", bodyHtml), text };
}

type SignedEmailLang = "en" | "tr" | "ar" | "fr" | "ru";
const SIGNED_EMAIL_STRINGS: Record<SignedEmailLang, {
  subject: (n: string) => string;
  greeting: (n?: string | null) => string;
  body: (n: string) => string;
  download: string;
  portal: string;
  portalIntro: string;
  portalOnlyIntro: (n: string) => string;
  portalOnlyButton: string;
  footer: string;
  shellSubtitle: string;
}> = {
  en: {
    subject: n => `Your signed contract — ${n}`,
    greeting: n => n ? `Hello ${n},` : "Hello,",
    body: n => `Your signed copy of <strong>${n}</strong> is ready.`,
    download: "Download signed PDF",
    portal: "Open the portal",
    portalIntro: "You can also access your contracts and applications from the agent portal:",
    portalOnlyIntro: n => `Your signed copy of <strong>${n}</strong> is ready. Log in to the agent portal to view and download it.`,
    portalOnlyButton: "Log in to view your contract",
    footer: "Keep this email for your records.",
    shellSubtitle: "Signed contract",
  },
  tr: {
    subject: n => `İmzalanmış sözleşmeniz — ${n}`,
    greeting: n => n ? `Merhaba ${n},` : "Merhaba,",
    body: n => `<strong>${n}</strong> sözleşmesinin imzalı kopyası hazırlandı.`,
    download: "İmzalı PDF'i indir",
    portal: "Portala giriş yap",
    portalIntro: "Sözleşmelerinize ve başvurularınıza acente portalından da ulaşabilirsiniz:",
    portalOnlyIntro: n => `<strong>${n}</strong> sözleşmesinin imzalı kopyası hazırlandı. Görüntülemek ve indirmek için portala giriş yapın.`,
    portalOnlyButton: "Sözleşmenizi görüntülemek için giriş yapın",
    footer: "Bu e-postayı kayıtlarınız için saklayın.",
    shellSubtitle: "İmzalı sözleşme",
  },
  ar: {
    subject: n => `عقدك الموقّع — ${n}`,
    greeting: n => n ? `مرحباً ${n}،` : "مرحباً،",
    body: n => `نسختك الموقّعة من <strong>${n}</strong> جاهزة.`,
    download: "تنزيل ملف PDF الموقّع",
    portal: "افتح البوابة",
    portalIntro: "يمكنك أيضاً الوصول إلى عقودك وطلباتك من بوابة الوكيل:",
    portalOnlyIntro: n => `نسختك الموقّعة من <strong>${n}</strong> جاهزة. سجّل الدخول إلى بوابة الوكيل لعرضها وتنزيلها.`,
    portalOnlyButton: "تسجيل الدخول لعرض العقد",
    footer: "احتفظ بهذا البريد الإلكتروني لسجلاتك.",
    shellSubtitle: "عقد موقّع",
  },
  fr: {
    subject: n => `Votre contrat signé — ${n}`,
    greeting: n => n ? `Bonjour ${n},` : "Bonjour,",
    body: n => `Votre copie signée de <strong>${n}</strong> est prête.`,
    download: "Télécharger le PDF signé",
    portal: "Ouvrir le portail",
    portalIntro: "Vous pouvez aussi consulter vos contrats et candidatures depuis le portail agent :",
    portalOnlyIntro: n => `Votre copie signée de <strong>${n}</strong> est prête. Connectez-vous au portail agent pour la consulter et la télécharger.`,
    portalOnlyButton: "Se connecter pour voir le contrat",
    footer: "Conservez cet e-mail pour vos archives.",
    shellSubtitle: "Contrat signé",
  },
  ru: {
    subject: n => `Ваш подписанный договор — ${n}`,
    greeting: n => n ? `Здравствуйте, ${n},` : "Здравствуйте,",
    body: n => `Ваша подписанная копия <strong>${n}</strong> готова.`,
    download: "Скачать подписанный PDF",
    portal: "Открыть портал",
    portalIntro: "Вы также можете просматривать договоры и заявки в портале агента:",
    portalOnlyIntro: n => `Ваша подписанная копия <strong>${n}</strong> готова. Войдите в портал агента, чтобы просмотреть и скачать её.`,
    portalOnlyButton: "Войти и просмотреть договор",
    footer: "Сохраните это письмо для своих записей.",
    shellSubtitle: "Подписанный договор",
  },
};

export async function buildSignedContractEmail(params: {
  signerName?: string | null;
  templateName: string;
  /** Direct PDF download URL. When absent (delivery worker path), the email
   * shows a portal login link instead — the PDF is rendered lazily on first
   * download and is not available at delivery time. */
  pdfDownloadUrl?: string;
  portalUrl?: string;
  language?: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const brand = await getEmailBranding();
  const lang: SignedEmailLang = (params.language && (["en","tr","ar","fr","ru"] as const).includes(params.language as any))
    ? (params.language as SignedEmailLang)
    : "en";
  const s = SIGNED_EMAIL_STRINGS[lang];
  const subject = s.subject(params.templateName);

  let bodyHtml: string;
  let text: string;

  if (params.pdfDownloadUrl) {
    // Legacy/direct path: PDF already rendered, show download button + optional portal.
    const portalLink = params.portalUrl
      ? `<p style="margin:24px 0 8px;color:#374151;font-size:14px;line-height:1.6;">${s.portalIntro}</p>${emailButton(s.portal, params.portalUrl, brand.primaryColor)}`
      : "";
    bodyHtml = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">${subject}</h2>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">${s.greeting(params.signerName)}</p>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">${s.body(params.templateName)}</p>
    ${emailButton(s.download, params.pdfDownloadUrl, brand.primaryColor)}
    ${portalLink}
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">${s.footer}</p>`;
    text = `${s.greeting(params.signerName)}\n\n${s.download}: ${params.pdfDownloadUrl}${params.portalUrl ? `\n${s.portal}: ${params.portalUrl}` : ""}`;
  } else {
    // Link-only path (delivery worker): PDF not yet rendered — direct to portal.
    const portalTarget = params.portalUrl || (getAppBaseUrl() + "/login");
    bodyHtml = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">${subject}</h2>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">${s.greeting(params.signerName)}</p>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">${s.portalOnlyIntro(params.templateName)}</p>
    ${emailButton(s.portalOnlyButton, portalTarget, brand.primaryColor)}
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">${s.footer}</p>`;
    text = `${s.greeting(params.signerName)}\n\n${s.portalOnlyIntro(params.templateName).replace(/<[^>]+>/g, "")}\n\n${portalTarget}`;
  }

  return { subject, html: emailShell(brand, s.shellSubtitle, bodyHtml), text };
}

const SIGN_CODE_STRINGS: Record<SignedEmailLang, {
  subject: string;
  title: string;
  body: (n: string) => string;
  expiry: string;
  ignore: string;
  shellSubtitle: string;
}> = {
  en: {
    subject: "Your verification code",
    title: "Verify your email",
    body: n => `To continue signing <strong>${n}</strong>, enter the code below.`,
    expiry: "This code expires in 15 minutes.",
    ignore: "If you did not request this, you can ignore this email.",
    shellSubtitle: "Email verification",
  },
  tr: {
    subject: "Doğrulama kodunuz",
    title: "E-postanızı doğrulayın",
    body: n => `<strong>${n}</strong> sözleşmesini imzalamaya devam etmek için aşağıdaki kodu girin.`,
    expiry: "Bu kod 15 dakika içinde geçersiz olur.",
    ignore: "Bu isteği siz yapmadıysanız, bu e-postayı yok sayabilirsiniz.",
    shellSubtitle: "E-posta doğrulama",
  },
  ar: {
    subject: "رمز التحقق الخاص بك",
    title: "تحقق من بريدك الإلكتروني",
    body: n => `لمتابعة توقيع <strong>${n}</strong>، أدخل الرمز أدناه.`,
    expiry: "تنتهي صلاحية هذا الرمز خلال 15 دقيقة.",
    ignore: "إذا لم تطلب هذا، يمكنك تجاهل هذا البريد الإلكتروني.",
    shellSubtitle: "التحقق من البريد الإلكتروني",
  },
  fr: {
    subject: "Votre code de vérification",
    title: "Vérifiez votre e-mail",
    body: n => `Pour continuer la signature de <strong>${n}</strong>, saisissez le code ci-dessous.`,
    expiry: "Ce code expire dans 15 minutes.",
    ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
    shellSubtitle: "Vérification de l'e-mail",
  },
  ru: {
    subject: "Ваш код подтверждения",
    title: "Подтвердите e-mail",
    body: n => `Чтобы продолжить подписание <strong>${n}</strong>, введите код ниже.`,
    expiry: "Срок действия кода — 15 минут.",
    ignore: "Если вы не запрашивали это, проигнорируйте письмо.",
    shellSubtitle: "Подтверждение e-mail",
  },
};

export async function buildSignVerificationCodeEmail(params: {
  code: string;
  templateName: string;
  language?: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const brand = await getEmailBranding();
  const lang: SignedEmailLang = (params.language && (["en","tr","ar","fr","ru"] as const).includes(params.language as any))
    ? (params.language as SignedEmailLang)
    : "en";
  const s = SIGN_CODE_STRINGS[lang];
  const codeHtml = `<div style="text-align:center;margin:24px 0;">
      <div style="display:inline-block;background:#f3f4f6;border-radius:10px;padding:16px 28px;font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">${escapeNotifText(params.code)}</div>
    </div>`;
  const bodyHtml = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">${s.title}</h2>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">${s.body(escapeNotifText(params.templateName))}</p>
    ${codeHtml}
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">${s.expiry}</p>
    <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">${s.ignore}</p>`;
  const text = `${s.title}\n\n${params.code}\n\n${s.expiry}`;
  return { subject: s.subject, html: emailShell(brand, s.shellSubtitle, bodyHtml), text };
}

export async function buildSignedContractAdminEmail(params: {
  signerName?: string | null;
  signerEmail: string;
  templateName: string;
  /** Optional direct PDF download URL. When absent (delivery worker path), the
   * email links to the admin signed-contracts panel instead — the PDF is
   * rendered lazily on first download and is not available at delivery time. */
  pdfDownloadUrl?: string;
  /** Link to the admin signed-contracts panel. Used when pdfDownloadUrl is
   * absent so admins can navigate directly to review the record. */
  adminContractUrl?: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const brand = await getEmailBranding();
  const subject = `Signed contract — ${params.templateName}`;
  const who = params.signerName
    ? `${escapeNotifText(params.signerName)} (${escapeNotifText(params.signerEmail)})`
    : escapeNotifText(params.signerEmail);
  const pdfNote = params.pdfDownloadUrl
    ? `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">The signed PDF is attached to this email.</p>
    ${emailButton("Download signed PDF", params.pdfDownloadUrl, brand.primaryColor)}`
    : `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">The signed PDF will be available in the admin panel once rendered (on first download by the agent).</p>
    ${params.adminContractUrl ? emailButton("View signed contracts", params.adminContractUrl, brand.primaryColor) : ""}`;
  const bodyHtml = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">${subject}</h2>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">A contract has been signed.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;color:#374151;">
      <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Contract</td><td style="padding:6px 0;font-weight:600;">${escapeNotifText(params.templateName)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Signed by</td><td style="padding:6px 0;font-weight:600;">${who}</td></tr>
    </table>
    ${pdfNote}`;
  const viewUrl = params.pdfDownloadUrl || params.adminContractUrl || "";
  const text = `${subject}\n\nSigned by: ${params.signerName ? `${params.signerName} (${params.signerEmail})` : params.signerEmail}${viewUrl ? `\nView: ${viewUrl}` : ""}`;
  return { subject, html: emailShell(brand, "Signed contract", bodyHtml), text };
}

export interface SendEmailOptions {
  attachments?: EmailAttachment[];
  senderAccountId?: number;
  senderRevision?: number;
  templateVersionId?: number;
  idempotencyKey?: string;
}

const QUEUE_RETURN_FIELDS = `id, claim_token, to_email, subject, html_body, text_body,
  retry_count, max_retries, sender_account_id, sender_revision, template_version_id, idempotency_key, attachments`;

async function claimEmail(queueId?: number): Promise<ClaimedEmail | null> {
  if (!emailDeliveryAllowed()) return null;
  const token = crypto.randomUUID();
  const { rows } = await pool.query<ClaimedEmail>(
    `UPDATE email_queue SET status = 'processing', claim_token = $1, claimed_at = NOW(), delivery_error_code = NULL
     WHERE id IN (
       SELECT id FROM email_queue WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         AND ($2::integer IS NULL OR id = $2)
       ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
     ) RETURNING ${QUEUE_RETURN_FIELDS}`,
    [token, queueId ?? null],
  );
  return rows[0] ?? null;
}

async function deliverClaimed(item: ClaimedEmail): Promise<boolean> {
  return executeClaimedEmail(item, {
    allowed: emailDeliveryAllowed,
    send: async (row, attachments) => {
      // Never execute a stale/replaced claim. Recovery only moves to UNKNOWN.
      const current = await pool.query("SELECT id FROM email_queue WHERE id=$1 AND status='processing' AND claim_token=$2", [row.id, row.claim_token]);
      if (!current.rows.length) return { status: "unknown", code: "EMAIL_CLAIM_LOST" };
      return sendViaSmtp(row, attachments);
    },
    save: async (row, result) => {
      await pool.query(
        `UPDATE email_queue SET status=$3, retry_count=$4, delivery_error_code=$5,
           provider_message_id=coalesce($6,provider_message_id),
           sent_at=CASE WHEN $3='sent' THEN NOW() ELSE sent_at END,
           next_retry_at=CASE WHEN $7::integer IS NULL THEN NULL ELSE NOW()+($7 * INTERVAL '1 second') END,
           claim_token=NULL, claimed_at=NULL
         WHERE id=$1 AND status='processing' AND claim_token=$2`,
        [row.id, row.claim_token, result.status, result.retryCount, result.code, result.messageId ?? null, result.backoffSeconds],
      );
    },
    onSaveFailure: () => console.error("[EMAIL] Delivery receipt persistence failed; claimed item requires reconciliation"),
  });
}

export async function sendEmail(
  to: string,
  email: { subject: string; html: string; text: string },
  opts?: SendEmailOptions,
): Promise<boolean> {
  // Do not enqueue or send in test/simulation mode, including copied local queues.
  if (!emailDeliveryAllowed()) return false;
  if (!isEmailMailbox(to) || !email || typeof email.subject !== "string" || /[\r\n\x00]/.test(email.subject)
    || email.subject.length > 998 || typeof email.html !== "string" || typeof email.text !== "string"
    || Buffer.byteLength(email.html) + Buffer.byteLength(email.text) > 2 * 1024 * 1024) return false;
  const senderId = opts?.senderAccountId ?? null;
  const senderRevision = opts?.senderRevision ?? null;
  const templateVersion = opts?.templateVersionId ?? null;
  if ((senderId === null) !== (senderRevision === null)
    || [senderId, senderRevision, templateVersion].some(value => value !== null && (!Number.isSafeInteger(value) || value <= 0))) return false;
  const idempotencyKey = opts?.idempotencyKey ?? null;
  if (idempotencyKey !== null && !/^[A-Za-z0-9:._-]{1,200}$/.test(idempotencyKey)) return false;

  let queueId: number;
  try {
    const attachments = serializeEmailAttachments(opts?.attachments);
    // There is deliberately no send fallback when durable queue insertion fails.
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO email_queue
        (to_email,subject,html_body,text_body,status,sender_account_id,sender_revision,template_version_id,idempotency_key,attachments)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [to, email.subject, email.html, email.text, senderId, senderRevision, templateVersion, idempotencyKey, attachments === null ? null : JSON.stringify(attachments)],
    );
    if (!inserted.rows[0]) {
      if (!idempotencyKey) return false;
      // Same key with different content is not a resend/overwrite authority.
      const replay = await pool.query<{ id: number; status: string }>(
        `SELECT id,status FROM email_queue WHERE idempotency_key=$1 AND to_email=$2 AND subject=$3
          AND html_body=$4 AND text_body=$5 AND sender_account_id IS NOT DISTINCT FROM $6::integer
          AND sender_revision IS NOT DISTINCT FROM $7::integer AND template_version_id IS NOT DISTINCT FROM $8::integer
          AND attachments IS NOT DISTINCT FROM $9::jsonb`,
        [idempotencyKey, to, email.subject, email.html, email.text, senderId, senderRevision, templateVersion, attachments === null ? null : JSON.stringify(attachments)],
      );
      if (!replay.rows[0]) return false;
      if (replay.rows[0].status === "sent") return true;
      queueId = replay.rows[0].id;
    } else queueId = inserted.rows[0].id;
    const claimed = await claimEmail(queueId);
    if (!claimed) return false;
    return await deliverClaimed(claimed);
  } catch {
    console.error("[EMAIL] Durable email delivery failed");
    return false;
  }
}

/** A crash or ambiguous SMTP acknowledgement can mean the message was accepted.
 * Stale processing is quarantined as UNKNOWN, never changed back to pending. */
export async function recoverStaleEmailClaims(): Promise<void> {
  if (!emailDeliveryAllowed()) return;
  await pool.query(`UPDATE email_queue SET status='unknown', delivery_error_code='EMAIL_CLAIM_STALE',
    claim_token=NULL, claimed_at=NULL
    WHERE status='processing' AND (claimed_at IS NULL OR claimed_at < NOW()-INTERVAL '15 minutes')`);
}

export async function processEmailQueue(): Promise<number> {
  if (!emailDeliveryAllowed()) return 0;
  let processed = 0;
  try {
    await recoverStaleEmailClaims();
    // One claim at a time avoids leasing a large batch while SMTP is slow.
    for (let i = 0; i < 20 && emailDeliveryAllowed(); i++) {
      const item = await claimEmail();
      if (!item) break;
      if (await deliverClaimed(item)) processed++;
    }
  } catch {
    console.error("[EMAIL] Queue processing failed");
  }
  return processed;
}

let emailWorkerInterval: ReturnType<typeof setInterval> | null = null;
let emailWorkerInFlight: Promise<void> | null = null;

function runEmailWorkerSweep(label: "Initial queue" | "Queue processed"): void {
  if (emailWorkerInFlight) return;
  emailWorkerInFlight = (async () => {
    if (!emailDeliveryAllowed()) return 0;
    try {
      const { processStageEmailOutbox } = await import("./notifications/stageEmailAutomation");
      await processStageEmailOutbox();
    } catch { console.warn("[EMAIL] Stage outbox processing deferred"); }
    return processEmailQueue();
  })()
    .then((count) => {
      if (count > 0) console.log(`[EMAIL] ${label}: sent ${count} emails`);
    })
    .finally(() => {
      emailWorkerInFlight = null;
    });
}

export function startEmailWorker(intervalMs = 30000): () => Promise<void> {
  if (emailWorkerInterval) return stopEmailWorker;
  console.log(`[EMAIL] Worker started, processing queue every ${intervalMs / 1000}s`);

  runEmailWorkerSweep("Initial queue");

  emailWorkerInterval = setInterval(() => {
    runEmailWorkerSweep("Queue processed");
  }, intervalMs);
  return stopEmailWorker;
}

export async function stopEmailWorker(): Promise<void> {
  if (emailWorkerInterval) {
    clearInterval(emailWorkerInterval);
    emailWorkerInterval = null;
  }
  await emailWorkerInFlight;
  console.log("[EMAIL] Worker stopped");
}
