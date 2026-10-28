import { db, integrationsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { decryptConfig, isEncrypted } from "./encryption";
import { DEFAULT_WEBSITE_AI_SETTINGS, type WebsiteAiContentSettings } from "./websiteAiContentPolicy";
import type { AiProviderConfig } from "./aiService";

/** Matches the local authoring flow: enabled OpenAI first, then Claude. */
export async function resolveWebsiteAiIntegration(
  policy: WebsiteAiContentSettings = DEFAULT_WEBSITE_AI_SETTINGS,
): Promise<AiProviderConfig | null> {
  if (!policy.enabled) return null;
  const integrations = await db.select().from(integrationsTable)
    .where(inArray(integrationsTable.key, ["openai", "claude"]));
  const keys = policy.provider === "openai" ? ["openai"]
    : policy.provider === "claude" ? ["claude"] : ["openai", "claude"];
  for (const key of keys) {
    const integration = integrations.find(item => item.key === key);
    if (!integration?.isEnabled) continue;
    const config = decryptConfig(integration.config as Record<string, string>);
    if (!config.apiKey || isEncrypted(config.apiKey)) continue;
    return {
      provider: key === "openai" ? "openai" : "anthropic",
      apiKey: config.apiKey,
      model: policy.modelOverride || config.model || undefined,
      temperature: policy.temperature,
      guidance: policy.editorialGuidance,
      qualityMode: policy.qualityMode,
    };
  }
  return null;
}
