import { createHash } from "node:crypto";
import { db, integrationsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptConfig } from "../encryption";

/** Credentials stay in the existing integration. References pin the full source
 * configuration, so a changed integration cannot inherit an earlier approval. */
export async function legacySmtpSnapshot() {
  const [integration] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "smtp")).limit(1);
  if (!integration) return null;
  const [branding] = await db.select({ fromEmail: settingsTable.emailSenderEmail, fromName: settingsTable.emailSenderName,
    replyTo: settingsTable.emailReplyTo }).from(settingsTable).limit(1);
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical({ id: integration.id,
    enabled: integration.isEnabled, config: integration.config, branding: branding ?? null }))).digest("hex");
  const config = decryptConfig(integration.config as Record<string, unknown>);
  return { fingerprint, enabled: integration.isEnabled, input: {
    displayName: "SMTP", host: config.host, port: Number(config.port || 587), username: config.username, password: config.password,
    fromEmail: branding?.fromEmail || config.fromEmail || config.username,
    fromName: branding?.fromName || config.fromName || "Find And Study OS", replyTo: branding?.replyTo || "",
  } };
}
