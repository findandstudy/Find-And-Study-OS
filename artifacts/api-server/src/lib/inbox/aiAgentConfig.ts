// DB-managed configuration for the inbox AI intake agent (FAZ 1).
//
// The config lives in the `integrations` table under key `ai_agent`, stored
// and read through the same encryptConfig/decryptConfig pipeline as the other
// integration configs (whatsapp, claude). It holds the global on/off switch,
// the "default-on for new chats" flag, the model + sampling temperature, the
// runaway-reply handoff threshold + handoff message, the supported languages,
// the multilingual escalation keyword sets, and the editable knowledge base
// (markdown system prompt). The admin panel (FAZ 2) edits this record; the
// auto-reply engine and lead automation (FAZ 3) read it.
import { db, integrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { decryptConfig, encryptConfig } from "../encryption";
import {
  DEFAULT_KNOWLEDGE_BASE,
  DEFAULT_ESCALATION_KEYWORDS,
  type BotLanguage,
  type EscalationTopic,
} from "./botBrain";

export const AI_AGENT_INTEGRATION_KEY = "ai_agent";
export const AI_AGENT_INTEGRATION_NAME = "AI Intake Agent";
export const AI_AGENT_INTEGRATION_CATEGORY = "ai";
export const DEFAULT_BOT_MODEL = "claude-haiku-4-5-20251001";

export interface AiAgentConfig {
  /** Global master switch. When false, NO auto-replies are sent on any
   *  conversation regardless of the per-conversation toggle. */
  enabled: boolean;
  /** When true, newly created conversations start with the bot enabled. */
  defaultOnForNew: boolean;
  /** Anthropic model used for the intake reply. */
  model: string;
  /** Sampling temperature (0–2). Default 1 == the engine's prior behavior. */
  temperature: number;
  /** Max consecutive bot replies before handing off to a human. 0 = no limit. */
  maxConsecutiveReplies: number;
  /** Message sent once when the handoff threshold is crossed. */
  handoffMessage: string;
  /** Supported intake languages (informational + future routing). */
  languages: BotLanguage[];
  /** Multilingual escalation keyword sets, per topic. */
  escalationKeywords: Record<EscalationTopic, string[]>;
  /** The editable markdown knowledge base / system-prompt body. */
  knowledgeBase: string;
  /**
   * Faz 1 — country / university-type scope for the live searchPrograms tool.
   * When enabled=false the tool is disabled entirely (bot falls back to the
   * static knowledgeBase, as if no live program data existed). "all" means no
   * restriction on that axis. Mirrored onto the knowledge_sources
   * type='program_scope' row so both surfaces stay in sync (see
   * knowledgeSources.ts / routes/inbox.ts knowledge-sources endpoints).
   */
  programScope: ProgramScope;
}

export interface ProgramScope {
  enabled: boolean;
  countries: string[] | "all";
  universityTypes: string[] | "all";
}

const SUPPORTED_LANGUAGES: BotLanguage[] = ["tr", "en", "ar", "ru", "fr"];

export const DEFAULT_PROGRAM_SCOPE: ProgramScope = {
  enabled: true,
  countries: "all",
  universityTypes: "all",
};

export const DEFAULT_AI_AGENT_CONFIG: AiAgentConfig = {
  // enabled defaults TRUE so existing #530 behavior (per-conversation toggle
  // decides) is preserved; an admin can flip the master switch off to silence
  // the whole bot.
  enabled: true,
  // defaultOnForNew defaults FALSE so new conversations stay bot-off until
  // staff opt in — nothing auto-enables.
  defaultOnForNew: false,
  model: DEFAULT_BOT_MODEL,
  temperature: 1,
  maxConsecutiveReplies: 5,
  handoffMessage:
    "Thanks for your patience — a member of our team will continue helping you shortly.",
  languages: [...SUPPORTED_LANGUAGES],
  escalationKeywords: DEFAULT_ESCALATION_KEYWORDS,
  knowledgeBase: DEFAULT_KNOWLEDGE_BASE,
  programScope: DEFAULT_PROGRAM_SCOPE,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const escalationKeywordsSchema = z.object({
  contract: z.array(z.string()),
  payment: z.array(z.string()),
  commission: z.array(z.string()),
  partner: z.array(z.string()),
});

const programScopeSchema = z.object({
  enabled: z.boolean(),
  countries: z.union([z.array(z.string()), z.literal("all")]),
  universityTypes: z.union([z.array(z.string()), z.literal("all")]),
});

export const aiAgentConfigSchema = z.object({
  enabled: z.boolean(),
  defaultOnForNew: z.boolean(),
  model: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2),
  maxConsecutiveReplies: z.number().int().min(0).max(100),
  handoffMessage: z.string().max(2000),
  languages: z.array(z.enum(["tr", "en", "ar", "ru", "fr"])).min(1),
  escalationKeywords: escalationKeywordsSchema,
  knowledgeBase: z.string().min(1).max(200000),
  programScope: programScopeSchema,
});

export const aiAgentConfigPatchSchema = aiAgentConfigSchema.partial();
export type AiAgentConfigPatch = z.infer<typeof aiAgentConfigPatchSchema>;

// ---------------------------------------------------------------------------
// Defaults merge — tolerant of partial / older-shape stored configs.
// ---------------------------------------------------------------------------

function cloneKeywords(kw: Record<EscalationTopic, string[]>): Record<EscalationTopic, string[]> {
  return {
    contract: [...kw.contract],
    payment: [...kw.payment],
    commission: [...kw.commission],
    partner: [...kw.partner],
  };
}

function mergeKeywords(raw: unknown): Record<EscalationTopic, string[]> {
  const d = DEFAULT_AI_AGENT_CONFIG.escalationKeywords;
  if (!raw || typeof raw !== "object") return cloneKeywords(d);
  const r = raw as Partial<Record<EscalationTopic, unknown>>;
  const pick = (topic: EscalationTopic): string[] => {
    const v = r[topic];
    return Array.isArray(v) ? v.map((s) => String(s)) : [...d[topic]];
  };
  return {
    contract: pick("contract"),
    payment: pick("payment"),
    commission: pick("commission"),
    partner: pick("partner"),
  };
}

function cloneProgramScope(scope: ProgramScope): ProgramScope {
  return {
    enabled: scope.enabled,
    countries: scope.countries === "all" ? "all" : [...scope.countries],
    universityTypes: scope.universityTypes === "all" ? "all" : [...scope.universityTypes],
  };
}

function mergeProgramScope(raw: unknown): ProgramScope {
  const d = DEFAULT_AI_AGENT_CONFIG.programScope;
  if (!raw || typeof raw !== "object") return cloneProgramScope(d);
  const r = raw as Partial<ProgramScope>;
  const pickListOrAll = (v: unknown, fallback: string[] | "all"): string[] | "all" => {
    if (v === "all") return "all";
    if (Array.isArray(v)) return v.map((s) => String(s));
    return fallback;
  };
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    countries: pickListOrAll(r.countries, d.countries),
    universityTypes: pickListOrAll(r.universityTypes, d.universityTypes),
  };
}

function mergeWithDefaults(raw: Record<string, unknown> | null | undefined): AiAgentConfig {
  const d = DEFAULT_AI_AGENT_CONFIG;
  if (!raw || typeof raw !== "object") {
    return {
      ...d,
      languages: [...d.languages],
      escalationKeywords: cloneKeywords(d.escalationKeywords),
      programScope: cloneProgramScope(d.programScope),
    };
  }
  const r = raw as Partial<AiAgentConfig>;
  const languages =
    Array.isArray(r.languages) && r.languages.length
      ? r.languages.filter((l): l is BotLanguage => SUPPORTED_LANGUAGES.includes(l as BotLanguage))
      : [...d.languages];
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    defaultOnForNew: typeof r.defaultOnForNew === "boolean" ? r.defaultOnForNew : d.defaultOnForNew,
    model: typeof r.model === "string" && r.model.trim() ? r.model : d.model,
    temperature: typeof r.temperature === "number" && Number.isFinite(r.temperature) ? r.temperature : d.temperature,
    maxConsecutiveReplies:
      typeof r.maxConsecutiveReplies === "number" && Number.isFinite(r.maxConsecutiveReplies)
        ? r.maxConsecutiveReplies
        : d.maxConsecutiveReplies,
    handoffMessage: typeof r.handoffMessage === "string" ? r.handoffMessage : d.handoffMessage,
    languages: languages.length ? languages : [...d.languages],
    escalationKeywords: mergeKeywords(r.escalationKeywords),
    knowledgeBase: typeof r.knowledgeBase === "string" && r.knowledgeBase.trim() ? r.knowledgeBase : d.knowledgeBase,
    programScope: mergeProgramScope(r.programScope),
  };
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

// Test seam: the engine reads config via getAiAgentConfig. Tests override it to
// exercise gating / handoff / escalation without a DB row or a live key.
let __configOverride: AiAgentConfig | null = null;
export function __setAiAgentConfigOverrideForTests(patch: Partial<AiAgentConfig> | null): void {
  __configOverride = patch ? mergeWithDefaults(patch as Record<string, unknown>) : null;
}

async function readRawConfig(): Promise<AiAgentConfig> {
  try {
    const [row] = await db
      .select()
      .from(integrationsTable)
      .where(eq(integrationsTable.key, AI_AGENT_INTEGRATION_KEY));
    if (row?.config) {
      const decrypted = decryptConfig(row.config as Record<string, any>);
      return mergeWithDefaults(decrypted);
    }
  } catch {
    // DB unavailable — fall back to safe defaults.
  }
  return mergeWithDefaults(null);
}

/** Load the live AI agent config, merged over safe defaults. */
export async function getAiAgentConfig(): Promise<AiAgentConfig> {
  if (__configOverride) return __configOverride;
  return readRawConfig();
}

/**
 * Validate + persist a (partial) config patch over the current stored config,
 * encrypted like the other integration configs. Returns the merged, validated
 * config. Used by the seed and the FAZ 2 admin panel.
 */
export async function writeAiAgentConfig(patch: AiAgentConfigPatch): Promise<AiAgentConfig> {
  const current = await readRawConfig();
  const merged = mergeWithDefaults({
    ...current,
    ...patch,
    escalationKeywords: {
      ...current.escalationKeywords,
      ...(patch.escalationKeywords ?? {}),
    },
  });
  const validated = aiAgentConfigSchema.parse(merged);
  const encrypted = encryptConfig(validated as Record<string, any>);
  await db
    .insert(integrationsTable)
    .values({
      key: AI_AGENT_INTEGRATION_KEY,
      name: AI_AGENT_INTEGRATION_NAME,
      category: AI_AGENT_INTEGRATION_CATEGORY,
      isEnabled: validated.enabled,
      config: encrypted,
    })
    .onConflictDoUpdate({
      target: integrationsTable.key,
      set: {
        name: AI_AGENT_INTEGRATION_NAME,
        category: AI_AGENT_INTEGRATION_CATEGORY,
        isEnabled: validated.enabled,
        config: encrypted,
      },
    });
  return validated;
}

/**
 * Idempotently seed the default ai_agent config (real intake brain) if the row
 * does not yet exist. Runs on api-server boot, like seedClaudeIntegration.
 */
export async function seedAiAgentConfig(): Promise<void> {
  try {
    const [existing] = await db
      .select({ id: integrationsTable.id })
      .from(integrationsTable)
      .where(eq(integrationsTable.key, AI_AGENT_INTEGRATION_KEY));
    if (existing) return;
    const validated = aiAgentConfigSchema.parse(DEFAULT_AI_AGENT_CONFIG);
    const encrypted = encryptConfig(validated as Record<string, any>);
    await db
      .insert(integrationsTable)
      .values({
        key: AI_AGENT_INTEGRATION_KEY,
        name: AI_AGENT_INTEGRATION_NAME,
        category: AI_AGENT_INTEGRATION_CATEGORY,
        isEnabled: validated.enabled,
        config: encrypted,
      })
      .onConflictDoNothing({ target: integrationsTable.key });
    console.log("[seed] ai_agent config seeded with default intake brain");
  } catch (err) {
    console.error("[seed] seedAiAgentConfig error:", err);
  }
}
