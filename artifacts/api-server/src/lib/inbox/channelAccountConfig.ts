/**
 * Per-account credential resolution for multi-account channels.
 *
 * A single channel (WhatsApp / Messenger / Instagram) can now have more than
 * one connected account, each stored as a row in `channel_accounts` with its
 * own encrypted config blob. Conversations reference the account they belong to
 * via `conversations.channelAccountId`.
 *
 * These helpers are the single source of truth for turning an account id (or an
 * inbound external account id) into a decrypted config object, with a safe
 * fallback to the legacy single-config `integrations` row so existing
 * conversations (channelAccountId = null) and fresh deployments keep working.
 *
 * Storage note: `channel_accounts.config_encrypted` is a TEXT column holding
 * `JSON.stringify(encryptConfig(obj))` (each secret field individually
 * AES-256-GCM encrypted). The legacy `integrations.config` is jsonb holding the
 * same encryptConfig output directly. Both are decrypted with decryptConfig.
 */
import {
  db,
  channelAccountsTable,
  integrationsTable,
  communicationPipelineAccountsTable,
  communicationPipelinesTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { decryptConfig, encryptConfig } from "../encryption";

/** Map an inbox channel to its legacy `integrations` table key. */
export function legacyIntegrationKey(channel: string): string | null {
  switch (channel) {
    case "whatsapp":
      return "whatsapp";
    case "messenger":
      return "facebook_messenger";
    case "instagram":
      return "instagram";
    default:
      return null;
  }
}

/** Parse + decrypt a channel_accounts.config_encrypted TEXT blob. */
export function parseAccountConfig(configEncrypted: string | null | undefined): Record<string, any> {
  if (!configEncrypted) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(configEncrypted);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  return decryptConfig(parsed as Record<string, any>);
}

/** Serialize a plain config into the TEXT storage format (encrypt + stringify). */
export function serializeAccountConfig(config: Record<string, any>): string {
  return JSON.stringify(encryptConfig(config));
}

/** Decrypt the legacy single-config integrations row for a channel. */
async function resolveLegacyConfig<T extends Record<string, any>>(
  channel: string,
): Promise<T | null> {
  const key = legacyIntegrationKey(channel);
  if (!key) return null;
  const [row] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, key));
  if (!row || !row.isEnabled) return null;
  return (decryptConfig((row.config as Record<string, any>) || {}) as T) || ({} as T);
}

/** Legacy webhook registrations have no account credentials. Bind their
 * fallback to the exact enabled integration identity, never merely the channel.
 * Instagram's business identity is authoritative when present; its page ID is
 * only the legacy identity when no business identity was configured. */
export function legacyConfigMatchesAccount(channel: string, externalAccountId: string | null,
  config: Record<string, any> | null): boolean {
  if (!externalAccountId || !config) return false;
  const identity = channel === "whatsapp" ? config.phoneNumberId
    : channel === "messenger" ? config.pageId
    : channel === "instagram" ? config.igBusinessAccountId || config.pageId : null;
  const token = channel === "whatsapp" ? config.accessToken : config.pageAccessToken;
  return typeof identity === "string" && identity === externalAccountId
    && typeof token === "string" && token.trim().length > 0
    && !token.startsWith("enc::") && !token.includes("•");
}

/**
 * Resolve the OUTBOUND config to use for a conversation.
 *
 * When the conversation carries a `channelAccountId`, the matching active
 * channel_account's config is returned. Credential-free legacy webhook rows
 * may use the enabled integration only when its external identity matches
 * exactly and the row is unambiguous. Disabled, missing or provider-owned
 * accounts never switch credentials. Null legacy conversation IDs retain the
 * historical fallback.
 */
export async function resolveOutboundConfig<T extends Record<string, any>>(
  channel: string,
  channelAccountId: number | null | undefined,
  communicationPipelineId?: number | null,
): Promise<T | null> {
  let explicitAccount: typeof channelAccountsTable.$inferSelect | undefined;
  let boundLegacyConfig: T | null = null;
  if (channelAccountId != null) {
    [explicitAccount] = await db.select().from(channelAccountsTable)
      .where(eq(channelAccountsTable.id, channelAccountId));
    if (!explicitAccount || explicitAccount.channel !== channel ||
        explicitAccount.provider !== "direct" || !explicitAccount.isActive) return null;
    if (explicitAccount.configEncrypted == null) {
      boundLegacyConfig = await resolveLegacyConfig<T>(channel);
      if (!legacyConfigMatchesAccount(channel, explicitAccount.externalAccountId, boundLegacyConfig)) return null;
      const identities = await db.select({ id: channelAccountsTable.id }).from(channelAccountsTable)
        .where(and(eq(channelAccountsTable.channel, channel), eq(channelAccountsTable.provider, "direct"),
          eq(channelAccountsTable.externalAccountId, explicitAccount.externalAccountId!))).limit(2);
      if (identities.length !== 1 || identities[0].id !== explicitAccount.id) return null;
    } else if (!explicitAccount.configEncrypted) return null;
  }
  if (communicationPipelineId != null) {
    const [pipeline] = await db
      .select({
        isActive: communicationPipelinesTable.isActive,
        isDefault: communicationPipelinesTable.isDefault,
      })
      .from(communicationPipelinesTable)
      .where(eq(communicationPipelinesTable.id, communicationPipelineId));

    // A conversation pinned to an unknown/inactive pipeline must never escape
    // to another project's credentials.
    if (!pipeline?.isActive) return null;

    const candidates = await db
      .select({
        channel: channelAccountsTable.channel,
        isActive: channelAccountsTable.isActive,
        configEncrypted: channelAccountsTable.configEncrypted,
      })
      .from(communicationPipelineAccountsTable)
      .innerJoin(
        communicationPipelinesTable,
        eq(communicationPipelinesTable.id, communicationPipelineAccountsTable.pipelineId),
      )
      .innerJoin(
        channelAccountsTable,
        eq(channelAccountsTable.id, communicationPipelineAccountsTable.channelAccountId),
      )
      .where(
        and(
          eq(communicationPipelineAccountsTable.pipelineId, communicationPipelineId),
          eq(communicationPipelineAccountsTable.canSend, true),
          eq(communicationPipelinesTable.isActive, true),
          eq(channelAccountsTable.channel, channel),
          eq(channelAccountsTable.provider, "direct"),
          eq(channelAccountsTable.isActive, true),
        ),
      )
      .orderBy(asc(communicationPipelineAccountsTable.priority));

    // Primary and secondary are evaluated before any legacy/direct fallback.
    // We intentionally do not retry a provider request with the secondary after
    // an ambiguous provider failure; that could deliver the same message twice.
    for (const candidate of candidates) {
      if (candidate.configEncrypted) {
        return parseAccountConfig(candidate.configEncrypted) as T;
      }
    }

    // Only the migration-created default pipeline may retain the legacy
    // single-account fallback. Custom project pipelines fail closed when their
    // primary/secondary sender configuration is incomplete.
    if (!pipeline.isDefault) return null;
  }

  if (explicitAccount) {
    return boundLegacyConfig ?? parseAccountConfig(explicitAccount.configEncrypted) as T;
  }
  return resolveLegacyConfig<T>(channel);
}

export interface InboundCommunicationContext {
  communicationPipelineId: number | null;
  aiBotId: number | null;
}

/**
 * Resolve the project pipeline and bot that own an inbound channel account.
 * A channel account may receive for only one pipeline (enforced by the partial
 * unique index), so inbound conversations cannot leak between projects/bots.
 */
export async function resolveInboundCommunicationContext(
  channelAccountId: number | null | undefined,
): Promise<InboundCommunicationContext> {
  if (channelAccountId == null) {
    return { communicationPipelineId: null, aiBotId: null };
  }
  const [mapping] = await db
    .select({
      communicationPipelineId: communicationPipelinesTable.id,
      aiBotId: communicationPipelinesTable.aiBotId,
    })
    .from(communicationPipelineAccountsTable)
    .innerJoin(
      communicationPipelinesTable,
      eq(communicationPipelinesTable.id, communicationPipelineAccountsTable.pipelineId),
    )
    .innerJoin(
      channelAccountsTable,
      eq(channelAccountsTable.id, communicationPipelineAccountsTable.channelAccountId),
    )
    .where(
      and(
        eq(communicationPipelineAccountsTable.channelAccountId, channelAccountId),
        eq(communicationPipelineAccountsTable.canReceive, true),
        eq(communicationPipelinesTable.isActive, true),
        eq(channelAccountsTable.isActive, true),
      ),
    );
  return mapping || { communicationPipelineId: null, aiBotId: null };
}

export interface InboundAccountResolution<T extends Record<string, any>> {
  /** The channel_account id to attribute the inbound message to, or null for legacy. */
  channelAccountId: number | null;
  /** Decrypted config for the resolved account (or legacy fallback). */
  config: T;
}

/**
 * Resolve the INBOUND account for a webhook delivery, given the external
 * account id parsed from the payload (WA phone_number_id, Meta page/IG id).
 *
 * Returns the matching active channel_account (so the caller verifies the
 * signature against THAT account's appSecret and attributes the message to it).
 * When no per-account row matches the external id, returns null so the caller
 * falls back to the legacy single-config verification path. This never weakens
 * verification: the caller still rejects when no secret validates the raw body.
 */
export async function resolveInboundAccount<T extends Record<string, any>>(
  channel: string,
  externalAccountId: string | null | undefined,
): Promise<InboundAccountResolution<T> | null> {
  if (!externalAccountId) return null;
  const [acct] = await db
    .select()
    .from(channelAccountsTable)
    .where(
      and(
        eq(channelAccountsTable.channel, channel),
        eq(channelAccountsTable.externalAccountId, externalAccountId),
        eq(channelAccountsTable.provider, "direct"),
      ),
    );
  if (!acct || !acct.isActive || !acct.configEncrypted) return null;
  return {
    channelAccountId: acct.id,
    config: parseAccountConfig(acct.configEncrypted) as T,
  };
}
