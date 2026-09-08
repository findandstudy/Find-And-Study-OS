import { db, settingsTable, universitiesTable } from "@workspace/db";
import { and, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import {
  normaliseCountryRules,
  normaliseStringList,
  type PublicCatalogPolicy,
} from "./publicCatalogPolicy";

const PUBLIC_CATALOG_POLICY_TTL_MS = 30_000;
let cachedPolicy:
  | { expiresAt: number; value: PublicCatalogPolicy }
  | undefined;

/**
 * Resolve the single public catalogue policy used by every anonymous read
 * surface. An absent or malformed configuration fails closed to private
 * universities only; callers must never invent their own default.
 */
export async function getPublicCatalogPolicy(): Promise<PublicCatalogPolicy> {
  if (cachedPolicy && cachedPolicy.expiresAt > Date.now()) {
    return cachedPolicy.value;
  }
  const [row] = await db
    .select({
      allowedCountries: settingsTable.publicCatalogAllowedCountries,
      allowedUniversityTypes: settingsTable.publicCatalogAllowedUniversityTypes,
      countryRules: settingsTable.publicCatalogCountryRules,
    })
    .from(settingsTable)
    .limit(1);
  const value: PublicCatalogPolicy = {
    allowedCountries: normaliseStringList(row?.allowedCountries),
    allowedUniversityTypes: normaliseStringList(row?.allowedUniversityTypes),
    countryRules: normaliseCountryRules(row?.countryRules),
  };
  if (value.allowedUniversityTypes.length === 0) {
    value.allowedUniversityTypes = ["Private"];
  }
  cachedPolicy = {
    expiresAt: Date.now() + PUBLIC_CATALOG_POLICY_TTL_MS,
    value,
  };
  return value;
}

export function clearPublicCatalogPolicyCache(): void {
  cachedPolicy = undefined;
}

function universityTypeCondition(values: string[]): any | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) {
    return ilike(universitiesTable.universityType, values[0]);
  }
  return or(...values.map((value) =>
    ilike(universitiesTable.universityType, value)
  ))!;
}

/** Add the canonical anonymous-visibility predicate to a Drizzle WHERE list. */
export function addPublicCatalogConditions(
  conditions: any[],
  policy: PublicCatalogPolicy | null,
): void {
  if (!policy) return;
  conditions.push(eq(universitiesTable.isActive, true));

  const countryRuleEntries = Object.entries(policy.countryRules);
  if (countryRuleEntries.length === 0) {
    if (policy.allowedCountries.length === 1) {
      conditions.push(eq(universitiesTable.country, policy.allowedCountries[0]));
    } else if (policy.allowedCountries.length > 1) {
      conditions.push(inArray(universitiesTable.country, policy.allowedCountries));
    }
    conditions.push(
      universityTypeCondition(policy.allowedUniversityTypes) || sql`false`,
    );
    return;
  }

  const explicitCountries = countryRuleEntries.map(([country]) => country);
  const visibilityClauses: any[] = [];
  const defaultTypeCondition = universityTypeCondition(
    policy.allowedUniversityTypes,
  );
  if (defaultTypeCondition) {
    const eligibleDefaultCountries = policy.allowedCountries.filter(
      (country) => !explicitCountries.includes(country),
    );
    if (
      policy.allowedCountries.length === 0
      || eligibleDefaultCountries.length > 0
    ) {
      const defaultCountryCondition = policy.allowedCountries.length > 0
        ? inArray(universitiesTable.country, eligibleDefaultCountries)
        : notInArray(universitiesTable.country, explicitCountries);
      visibilityClauses.push(and(defaultCountryCondition, defaultTypeCondition));
    }
  }
  for (const [country, universityTypes] of countryRuleEntries) {
    const typeCondition = universityTypeCondition(universityTypes);
    if (!typeCondition) continue;
    visibilityClauses.push(and(
      eq(universitiesTable.country, country),
      typeCondition,
    ));
  }
  conditions.push(
    visibilityClauses.length > 0 ? or(...visibilityClauses)! : sql`false`,
  );
}
