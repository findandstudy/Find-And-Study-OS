import crypto from "crypto";
import { db, emailQueueTable } from "@workspace/db";

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

export async function sendEmail(to: string, email: { subject: string; html: string; text: string }): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[EMAIL] To: ${to}`);
  console.log(`[EMAIL] Subject: ${email.subject}`);
  console.log(`[EMAIL] Text Preview:\n${email.text}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    await db.insert(emailQueueTable).values({
      toEmail: to,
      subject: email.subject,
      htmlBody: email.html,
      textBody: email.text,
      status: "pending",
    });
  } catch (err) {
    console.error("[EMAIL] Failed to persist email to queue:", err);
  }
}
