export const WEBSITE_AI_LOCALES = ["en","tr","ar","fr","ru","fa","zh","hi","es","id","ur","tk","ky","kk","uz","tg","bn","pt","ne","vi","ko","uk","it"] as const;
export const WEBSITE_AI_KINDS = ["country", "city", "university", "program", "managed", "blog"] as const;

export type WebsiteAiContentSettings = {
  enabled: boolean;
  provider: "auto" | "openai" | "claude";
  modelOverride: string;
  candidateModel: string;
  candidateTrafficPercent: number;
  fallbackModel: string;
  temperature: number;
  qualityMode: "fast" | "balanced" | "premium";
  allowedKinds: string[];
  allowedLocales: string[];
  maxPairsPerRequest: number;
  dailyRequestLimit: number;
  dailyEstimatedTokenLimit: number;
  editorialGuidance: string;
  automaticTranslationEnabled: boolean;
  automaticRunHourUtc: number;
  automaticBatchSize: number;
  workerConcurrency: number;
  maxAttempts: number;
  reviewRequired: true;
  publicationPolicy: "draft_only";
};

export const DEFAULT_WEBSITE_AI_SETTINGS: WebsiteAiContentSettings = {
  enabled: true,
  provider: "auto",
  modelOverride: "",
  candidateModel: "",
  candidateTrafficPercent: 0,
  fallbackModel: "",
  temperature: 0.3,
  qualityMode: "balanced",
  allowedKinds: [...WEBSITE_AI_KINDS],
  allowedLocales: [...WEBSITE_AI_LOCALES],
  maxPairsPerRequest: 50,
  dailyRequestLimit: 250,
  dailyEstimatedTokenLimit: 500_000,
  editorialGuidance: "",
  automaticTranslationEnabled: false,
  automaticRunHourUtc: 0,
  automaticBatchSize: 25,
  workerConcurrency: 2,
  maxAttempts: 5,
  reviewRequired: true,
  publicationPolicy: "draft_only",
};

const integer = (value: unknown, min: number, max: number, fallback: number) =>
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;

export function readWebsiteAiSettings(featureFlags: unknown): WebsiteAiContentSettings {
  const flags = featureFlags && typeof featureFlags === "object" && !Array.isArray(featureFlags) ? featureFlags as Record<string, unknown> : {};
  const raw = flags.aiContentTranslation && typeof flags.aiContentTranslation === "object" && !Array.isArray(flags.aiContentTranslation)
    ? flags.aiContentTranslation as Record<string, unknown> : {};
  const provider = ["auto", "openai", "claude"].includes(String(raw.provider)) ? raw.provider as WebsiteAiContentSettings["provider"] : "auto";
  const qualityMode = ["fast", "balanced", "premium"].includes(String(raw.qualityMode)) ? raw.qualityMode as WebsiteAiContentSettings["qualityMode"] : "balanced";
  const allowedKinds = Array.isArray(raw.allowedKinds) ? [...new Set(raw.allowedKinds.filter(value => WEBSITE_AI_KINDS.includes(value as any)) as string[])] : [...WEBSITE_AI_KINDS];
  const allowedLocales = Array.isArray(raw.allowedLocales) ? [...new Set(raw.allowedLocales.filter(value => WEBSITE_AI_LOCALES.includes(value as any)) as string[])] : [...WEBSITE_AI_LOCALES];
  return {
    enabled: raw.enabled !== false,
    provider,
    modelOverride: typeof raw.modelOverride === "string" && /^[A-Za-z0-9._:/-]{0,120}$/.test(raw.modelOverride) ? raw.modelOverride : "",
    candidateModel: typeof raw.candidateModel === "string" && /^[A-Za-z0-9._:/-]{0,120}$/.test(raw.candidateModel) ? raw.candidateModel : "",
    candidateTrafficPercent: integer(raw.candidateTrafficPercent, 0, 25, 0),
    fallbackModel: typeof raw.fallbackModel === "string" && /^[A-Za-z0-9._:/-]{0,120}$/.test(raw.fallbackModel) ? raw.fallbackModel : "",
    temperature: typeof raw.temperature === "number" && raw.temperature >= 0 && raw.temperature <= 1 ? raw.temperature : DEFAULT_WEBSITE_AI_SETTINGS.temperature,
    qualityMode,
    allowedKinds,
    allowedLocales,
    maxPairsPerRequest: integer(raw.maxPairsPerRequest, 1, 50, 50),
    dailyRequestLimit: integer(raw.dailyRequestLimit, 1, 10_000, 250),
    dailyEstimatedTokenLimit: integer(raw.dailyEstimatedTokenLimit, 1_000, 10_000_000, 500_000),
    editorialGuidance: typeof raw.editorialGuidance === "string" ? raw.editorialGuidance.trim().slice(0, 1_000) : "",
    automaticTranslationEnabled: raw.automaticTranslationEnabled === true,
    automaticRunHourUtc: integer(raw.automaticRunHourUtc, 0, 23, 0),
    automaticBatchSize: integer(raw.automaticBatchSize, 1, 50, 25),
    workerConcurrency: integer(raw.workerConcurrency, 1, 4, 2),
    maxAttempts: integer(raw.maxAttempts, 1, 8, 5),
    reviewRequired: true,
    publicationPolicy: "draft_only",
  };
}

export function parseWebsiteAiSettings(input: unknown): WebsiteAiContentSettings | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const keys = Object.keys(input as Record<string, unknown>);
  const allowed = new Set(Object.keys(DEFAULT_WEBSITE_AI_SETTINGS));
  if (keys.some(key => !allowed.has(key))) return null;
  const parsed = readWebsiteAiSettings({ aiContentTranslation: input });
  if (!parsed.allowedKinds.length || !parsed.allowedLocales.length) return null;
  return parsed;
}

export function mergeWebsiteAiSettings(featureFlags: unknown, settings: WebsiteAiContentSettings): Record<string, unknown> {
  const flags = featureFlags && typeof featureFlags === "object" && !Array.isArray(featureFlags) ? featureFlags as Record<string, unknown> : {};
  return { ...flags, aiContentTranslation: settings };
}

