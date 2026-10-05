import { db, channelAccountsTable, type ChannelAccount } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { isEncrypted } from "../encryption";
import { parseAccountConfig } from "../inbox/channelAccountConfig";
import { emailDeliveryAllowed, isEmailMailbox } from "../emailDeliveryPolicy";
import { EmailLibraryError, positiveEmailId } from "./emailTemplateLibrary";

export type EmailSenderMetadata = {
  revision: number; fromEmail: string; fromName: string; replyTo: string;
  verified: boolean; createdById: number; lastChangedById: number; approvedById?: number;
};
export type ResolvedEmailSender = { host: string; port: number; secure: boolean; user: string; pass: string; fromName: string; fromEmail: string; replyTo: string };
type SenderInput = { displayName: string; host: string; port: number; username: string; password: string; fromEmail: string; fromName: string; replyTo: string };

export function emailSenderMetadata(value: unknown): EmailSenderMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const meta = (value as { emailSender?: unknown }).emailSender as EmailSenderMetadata | undefined;
  if (!meta || !Number.isSafeInteger(meta.revision) || meta.revision < 1
    || !Number.isSafeInteger(meta.createdById) || meta.createdById < 1
    || !Number.isSafeInteger(meta.lastChangedById) || meta.lastChangedById < 1
    || typeof meta.verified !== "boolean" || !isEmailMailbox(meta.fromEmail)
    || typeof meta.fromName !== "string" || meta.fromName.length > 120 || /[\x00-\x1f\x7f]/.test(meta.fromName)
    || typeof meta.replyTo !== "string" || (!!meta.replyTo && !isEmailMailbox(meta.replyTo))) return null;
  if (meta.verified && (!Number.isSafeInteger(meta.approvedById) || meta.approvedById! < 1 || meta.approvedById === meta.lastChangedById)) return null;
  return meta;
}

export function validateEmailSender(input: unknown, previous?: SenderInput): SenderInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EmailLibraryError("EMAIL_SENDER_INVALID");
  const data = input as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...previous, ...data };
  if (previous && (data.password === undefined || data.password === "")) merged.password = previous.password;
  const text = (key: string, max: number, required = true): string => {
    if (typeof merged[key] !== "string" || (required && !(merged[key] as string).trim()) || (merged[key] as string).length > max
      || /[\x00-\x1f\x7f]/.test(merged[key] as string)) throw new EmailLibraryError("EMAIL_SENDER_INVALID");
    return key === "password" ? merged[key] as string : (merged[key] as string).trim();
  };
  const password = text("password", 4096);
  if (isEncrypted(password) || password.includes("••")) throw new EmailLibraryError("EMAIL_SENDER_SECRET_INVALID");
  const host = text("host", 253).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes("..") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new EmailLibraryError("EMAIL_SENDER_HOST_INVALID");
  const port = Number(merged.port);
  if (![465, 587, 2525].includes(port)) throw new EmailLibraryError("EMAIL_SENDER_PORT_INVALID");
  const fromEmail = text("fromEmail", 254);
  const replyTo = merged.replyTo === undefined ? "" : text("replyTo", 254, false);
  if (!isEmailMailbox(fromEmail) || (replyTo && !isEmailMailbox(replyTo))) throw new EmailLibraryError("EMAIL_SENDER_ADDRESS_INVALID");
  return { displayName: text("displayName", 120), host, port, username: text("username", 254), password,
    fromEmail, fromName: merged.fromName === undefined ? "" : text("fromName", 120, false), replyTo };
}

export function senderInputFromRow(row: ChannelAccount): SenderInput {
  const meta = emailSenderMetadata(row.metadata);
  if (!meta) throw new EmailLibraryError("EMAIL_SENDER_INVALID", 409);
  const config = parseAccountConfig(row.configEncrypted);
  return validateEmailSender({ displayName: row.displayName, ...config, fromEmail: meta.fromEmail, fromName: meta.fromName, replyTo: meta.replyTo });
}

/** Never returns credentials, encrypted blobs, arbitrary metadata, or a placeholder password. */
export function safeEmailSender(row: ChannelAccount) {
  const meta = emailSenderMetadata(row.metadata);
  let config: Record<string, unknown> = {};
  try { config = parseAccountConfig(row.configEncrypted); } catch { /* unavailable secret is not a valid sender */ }
  return { id: row.id, displayName: row.displayName, provider: row.provider, channel: row.channel,
    revision: meta?.revision ?? null, verified: meta?.verified === true, isActive: row.isActive && meta?.verified === true,
    fromEmail: meta?.fromEmail ?? "", fromName: meta?.fromName ?? "", replyTo: meta?.replyTo ?? "",
    createdById: meta?.createdById ?? null, lastChangedById: meta?.lastChangedById ?? null, approvedById: meta?.approvedById ?? null,
    config: { host: typeof config.host === "string" ? config.host : "", port: Number(config.port) || null,
      username: typeof config.username === "string" ? config.username : "", passwordConfigured: typeof config.password === "string" && !!config.password && !isEncrypted(config.password) },
    verificationKind: "smtp_connection_authentication", createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function resolveEmailSenderRow(row: ChannelAccount | undefined, revision: number): ResolvedEmailSender | null {
  if (!row || row.channel !== "email" || row.provider !== "smtp" || !row.isActive || row.status !== "active") return null;
  const meta = emailSenderMetadata(row.metadata);
  if (!meta?.verified || meta.revision !== revision) return null;
  try {
    const config = senderInputFromRow(row);
    return { host: config.host, port: config.port, secure: config.port === 465, user: config.username, pass: config.password,
      fromName: config.fromName, fromEmail: config.fromEmail, replyTo: config.replyTo };
  } catch { return null; }
}

export async function resolveEmailSenderAccount(id: number, revision: number): Promise<ResolvedEmailSender | null> {
  positiveEmailId(id); positiveEmailId(revision);
  const [row] = await db.select().from(channelAccountsTable).where(and(eq(channelAccountsTable.id, id), eq(channelAccountsTable.channel, "email"), eq(channelAccountsTable.provider, "smtp"))).limit(1);
  return resolveEmailSenderRow(row, revision);
}

type VerifyTransport = { verify(): Promise<unknown>; close(): void };
let pendingVerifications = 0;
const activeAccounts = new Set<number>();
const verificationAttempts = new Map<number, number>();
/** The retained slot bounds late DNS/SMTP work even after the caller's deadline expires. */
export async function verifyEmailSenderConnection(accountId: number, config: SenderInput,
  create?: () => Promise<VerifyTransport>, timeoutMs = 15_000): Promise<void> {
  if (!emailDeliveryAllowed()) throw new EmailLibraryError("EMAIL_VERIFICATION_DISABLED", 409);
  const now = Date.now();
  for (const [id, time] of verificationAttempts) if (now - time >= 60_000) verificationAttempts.delete(id);
  if (verificationAttempts.has(accountId) || verificationAttempts.size >= 1000) throw new EmailLibraryError("EMAIL_VERIFICATION_RATE_LIMITED", 429);
  if (pendingVerifications >= 2 || activeAccounts.has(accountId)) throw new EmailLibraryError("EMAIL_VERIFICATION_BUSY", 429);
  verificationAttempts.set(accountId, now);
  pendingVerifications++; activeAccounts.add(accountId);
  let transport: VerifyTransport | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { try { transport?.close(); } catch { /* cleanup must never release secrets or retain a slot */ } };
  const work = (async () => {
    transport = create ? await create() : await (await import("../email")).createSmtpTransporter(config);
    if (expired || !emailDeliveryAllowed()) throw new EmailLibraryError("EMAIL_VERIFICATION_DISABLED", 409);
    await transport.verify();
    if (!emailDeliveryAllowed()) throw new EmailLibraryError("EMAIL_VERIFICATION_DISABLED", 409);
  })().finally(() => { close(); pendingVerifications--; activeAccounts.delete(accountId); });
  try {
    await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => {
      expired = true; close(); reject(new EmailLibraryError("EMAIL_VERIFICATION_TIMEOUT", 504));
    }, timeoutMs); })]);
  } catch (error) {
    if (error instanceof EmailLibraryError) throw error;
    throw new EmailLibraryError("EMAIL_VERIFICATION_FAILED", 422);
  } finally { if (timer) clearTimeout(timer); }
}
