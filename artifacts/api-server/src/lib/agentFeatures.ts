export const AGENT_FEATURE_KEYS = [
  "web_to_lead",
  "embed_standard",
  "embed_ai",
  "email_integration",
  "whatsapp_integration",
  "custom_branding",
  "academy",
  "lead_document_upload",
] as const;

export type AgentFeatureKey = typeof AGENT_FEATURE_KEYS[number];
export type AgentFeatureMap = Record<AgentFeatureKey, boolean>;

const STANDARD: AgentFeatureMap = {
  web_to_lead: true,
  embed_standard: true,
  embed_ai: false,
  email_integration: false,
  whatsapp_integration: false,
  custom_branding: true,
  academy: true,
  lead_document_upload: true,
};

const PLAN_DEFAULTS: Record<string, AgentFeatureMap> = {
  standard: STANDARD,
  premium: {
    ...STANDARD,
    embed_ai: true,
    email_integration: true,
    whatsapp_integration: true,
  },
  enterprise: {
    ...STANDARD,
    embed_ai: true,
    email_integration: true,
    whatsapp_integration: true,
  },
};

export function normalizeAgentPlan(value: unknown): "standard" | "premium" | "enterprise" {
  return value === "premium" || value === "enterprise" ? value : "standard";
}

export function normalizeFeatureOverrides(value: unknown): Partial<AgentFeatureMap> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(AGENT_FEATURE_KEYS.flatMap((key) => (
    typeof record[key] === "boolean" ? [[key, record[key]]] : []
  ))) as Partial<AgentFeatureMap>;
}

export function resolveAgentFeatures(plan: unknown, overrides: unknown): AgentFeatureMap {
  const normalizedPlan = normalizeAgentPlan(plan);
  return { ...PLAN_DEFAULTS[normalizedPlan], ...normalizeFeatureOverrides(overrides) };
}

export function isHexBrandColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
