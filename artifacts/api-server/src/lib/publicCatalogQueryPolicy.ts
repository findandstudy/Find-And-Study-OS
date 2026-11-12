import { db, settingsTable, universitiesTable, catalogOptionsTable } from "@workspace/db";
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
  const [[row], optionRows] = await Promise.all([
    db
      .select({
        allowedCountries: settingsTable.publicCatalogAllowedCountries,
        allowedUniversityTypes: settingsTable.publicCatalogAllowedUniversityTypes,
        countryRules: settingsTable.publicCatalogCountryRules,
      })
      .from(settingsTable)
      .limit(1),
    db.select({
      value: catalogOptionsTable.value,
      metadata: catalogOptionsTable.metadata,
    }).from(catalogOptionsTable).where(and(
      eq(catalogOptionsTable.category, "university_type"),
      eq(catalogOptionsTable.isActive, true),
    )),
  ]);
  const universityTypeAliases = Object.fromEntries(optionRows.map((option) => {
    const aliases = option.metadata && Array.isArray(option.metadata.aliases)
      ? option.metadata.aliases.map(String).map((value) => value.trim()).filter(Boolean)
      : [];
    return [option.value, [...new Set(aliases)]];
  }));
  const value: PublicCatalogPolicy = {
    allowedCountries: normaliseStringList(row?.allowedCountries),
    allowedUniversityTypes: normaliseStringList(row?.allowedUniversityTypes),
    countryRules: normaliseCountryRules(row?.countryRules),
    universityTypeAliases,
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

export function publicUniversityTypeAliases(
  values: string[],
  aliasesByValue: Record<string, string[]> = {},
): string[] {
  return [...new Set(values.flatMap((value) => {
    const normalized = value.trim().toLowerCase();
    const legacyAliases = normalized === "private"
      ? ["Foundation", "Foundation University", "Vakıf", "Vakıf Üniversitesi"]
      : normalized === "public"
        ? ["State", "State University", "Devlet", "Devlet Üniversitesi"]
        : [];
    return [value, ...legacyAliases, ...(aliasesByValue[value] || [])];
  }).map(value => value.trim()).filter(Boolean))];
}

function universityTypeCondition(
  values: string[],
  aliasesByValue: Record<string, string[]> = {},
): any | undefined {
  if (values.length === 0) return undefined;
  const aliases = publicUniversityTypeAliases(values, aliasesByValue);
  return aliases.length === 1
    ? ilike(universitiesTable.universityType, aliases[0])
    : or(...aliases.map(value => ilike(universitiesTable.universityType, value)))!;
}

/** Add the canonical anonymous-visibility predicate to a Drizzle WHERE list. */
export function addPublicCatalogConditions(
  conditions: any[],
  policy: PublicCatalogPolicy | null,
): void {
  conditions.push(eq(universitiesTable.isActive, true));
  if (!policy) return;

  const countryRuleEntries = Object.entries(policy.countryRules);
  if (countryRuleEntries.length === 0) {
    if (policy.allowedCountries.length === 1) {
      conditions.push(eq(universitiesTable.country, policy.allowedCountries[0]));
    } else if (policy.allowedCountries.length > 1) {
      conditions.push(inArray(universitiesTable.country, policy.allowedCountries));
    }
    conditions.push(
      universityTypeCondition(policy.allowedUniversityTypes, policy.universityTypeAliases) || sql`false`,
    );
    return;
  }

  const explicitCountries = countryRuleEntries.map(([country]) => country);
  const visibilityClauses: any[] = [];
  const defaultTypeCondition = universityTypeCondition(
    policy.allowedUniversityTypes,
    policy.universityTypeAliases,
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
    const typeCondition = universityTypeCondition(universityTypes, policy.universityTypeAliases);
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
