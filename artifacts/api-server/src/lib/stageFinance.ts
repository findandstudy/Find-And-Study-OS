import { db, pipelineStagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const LEGACY_EXCLUDED_COMMISSION = new Set([
  "rejected", "all_registered", "cancelled", "visa_reject", "refound", "100scholar",
]);
const LEGACY_CONFIRMED_COMMISSION = new Set(["enrolled"]);

const LEGACY_EXCLUDED_SERVICE_FEE = new Set([
  "rejected", "all_registered", "cancelled", "refound",
]);
const LEGACY_CONFIRMED_SERVICE_FEE = new Set(["enrolled", "100scholar", "visa_reject"]);

let stageVariantCache: Map<string, string | null> = new Map();
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

async function loadStageVariants(): Promise<Map<string, string | null>> {
  const now = Date.now();
  if (now - cacheTimestamp < CACHE_TTL && stageVariantCache.size > 0) {
    return stageVariantCache;
  }

  try {
    const stages = await db
      .select({ key: pipelineStagesTable.key, variant: pipelineStagesTable.variant })
      .from(pipelineStagesTable)
      .where(eq(pipelineStagesTable.entityType, "application"));

    const map = new Map<string, string | null>();
    for (const s of stages) {
      map.set(s.key, s.variant);
    }

    if (map.size > 0) {
      stageVariantCache = map;
      cacheTimestamp = now;
    }
    return map;
  } catch {
    return stageVariantCache;
  }
}

export function clearStageFinanceCache() {
  cacheTimestamp = 0;
  stageVariantCache.clear();
}

function resolveFromVariant(variant: string | null | undefined): "potential" | "confirmed" | "excluded" | null {
  if (variant === "won") return "confirmed";
  if (variant === "partial_won") return "potential";
  if (variant === "lost") return "excluded";
  if (variant === "none_finance") return "excluded";
  return null;
}

export async function getCommissionFinanceStatus(stage: string): Promise<"potential" | "confirmed" | "excluded"> {
  const variants = await loadStageVariants();

  if (variants.size > 0) {
    const variant = variants.get(stage);
    const result = resolveFromVariant(variant);
    if (result !== null) return result;
    if (variants.has(stage)) return "potential";
  }

  if (LEGACY_CONFIRMED_COMMISSION.has(stage)) return "confirmed";
  if (LEGACY_EXCLUDED_COMMISSION.has(stage)) return "excluded";
  return "potential";
}

export async function getServiceFeeFinanceStatus(stage: string): Promise<"potential" | "confirmed" | "excluded"> {
  const variants = await loadStageVariants();

  if (variants.size > 0) {
    const variant = variants.get(stage);
    const result = resolveFromVariant(variant);
    if (result !== null) return result;
    if (variants.has(stage)) return "potential";
  }

  if (LEGACY_CONFIRMED_SERVICE_FEE.has(stage)) return "confirmed";
  if (LEGACY_EXCLUDED_SERVICE_FEE.has(stage)) return "excluded";
  return "potential";
}

export async function isWonStage(stage: string): Promise<boolean> {
  const variants = await loadStageVariants();
  if (variants.size > 0) {
    return variants.get(stage) === "won";
  }
  return LEGACY_CONFIRMED_COMMISSION.has(stage);
}

export async function getCancelledStageKey(): Promise<string> {
  const variants = await loadStageVariants();
  for (const [key, variant] of variants) {
    if (key === "cancelled") return key;
  }
  return "cancelled";
}

export async function shouldHaveCommission(stage: string): Promise<boolean> {
  const status = await getCommissionFinanceStatus(stage);
  return status !== "excluded";
}

export async function shouldHaveServiceFee(stage: string): Promise<boolean> {
  const status = await getServiceFeeFinanceStatus(stage);
  return status !== "excluded";
}
