import crypto from "crypto";

export type RegistrationTemplateCandidate = {
  id: number;
  entityType: string;
  language: string;
  version: number;
  publishedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export function normalizeRegistrationKey(value: unknown, max = 80): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, max) : "";
}

function time(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Choose one deterministic, newest published template per type/language pair. */
export function pickLatestRegistrationTemplates<T extends RegistrationTemplateCandidate>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) =>
    (b.version - a.version)
    || (time(b.publishedAt) - time(a.publishedAt))
    || (time(b.createdAt) - time(a.createdAt))
    || (b.id - a.id));
  const seen = new Set<string>();
  return sorted.filter((row) => {
    const entityType = normalizeRegistrationKey(row.entityType);
    const language = normalizeRegistrationKey(row.language);
    if (!entityType || !language) return false;
    const key = `${entityType}\u0000${language}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  if (typeof value === "string") return value.trim();
  return value;
}

export function computeAgentApplicationContractHash(value: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function hashSensitiveEvidence(value: string, purpose: string): string {
  const configuredSecret = process.env.SESSION_SECRET || process.env.AUTH_SECRET;
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    throw new Error("AGENT_APPLICATION_EVIDENCE_SECRET_MISSING");
  }
  const secret = configuredSecret || "local-agent-application";
  return crypto.createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
}

export function agentApplicationReference(): string {
  const year = new Date().getUTCFullYear();
  return `AAP-${year}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}
