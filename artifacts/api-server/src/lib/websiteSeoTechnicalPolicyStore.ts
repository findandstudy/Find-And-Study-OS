import { db, settingsTable } from "@workspace/db";
import {
  DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY,
  parseWebsiteSeoTechnicalPolicy,
  type WebsiteSeoTechnicalPolicy,
} from "./websiteSeoTechnicalPolicy";

let cached: { value: WebsiteSeoTechnicalPolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function readWebsiteSeoTechnicalPolicy(): Promise<WebsiteSeoTechnicalPolicy> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const [row] = await db.select({ policy: settingsTable.seoTechnicalPolicy }).from(settingsTable).limit(1);
    const value = parseWebsiteSeoTechnicalPolicy(row?.policy);
    cached = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch {
    return { ...DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY };
  }
}

export function invalidateWebsiteSeoTechnicalPolicyCache(): void {
  cached = null;
}
