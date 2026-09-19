import { courseFinderUniversityLogoUrl } from "./courseFinderVisibility";
import { publicCatalogPath } from "./publicCatalogRouteContract";
import { publicCatalogRequirements } from "./publicCatalogRequirements";
import { projectPublicTuition } from "./publicCatalogTuition";

export type PublicProgramBriefSource = {
  id: number; name: string; degree: string | null; field: string | null;
  duration: string | null; language: string | null; description: string | null; requirements: string | null;
  isActive: boolean; tuitionFee: number | null; discountedFee: number | null; currency: string | null;
  universityId: number; universityName: string; universityCountry: string; universityCity: string | null;
  universityType: string | null; universityIsActive: boolean; universityWebsite: string | null;
  universityHasLogo: boolean;
};

/** Public brief only: no document links, contact details, importer timing or internal fees. */
export function projectPublicProgramBrief(row: PublicProgramBriefSource, input: {
  locale: string;
  prices: Parameters<typeof projectPublicTuition>[1];
  universityName: string;
  universityType: string | null;
  universityPath: string | null;
}) {
  const canonicalPath = publicCatalogPath({ locale: input.locale, entityType: "program", id: row.id, name: row.name });
  let universityWebsite: string | null = null;
  const rawWebsite = row.universityWebsite?.trim() ?? "";
  if (rawWebsite.length <= 2048 && !/[\\\u0000-\u0020\u007f]/.test(rawWebsite)) {
    try {
      const parsed = new URL(rawWebsite);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) universityWebsite = parsed.href;
    } catch { /* A catalogue URL is not authority for an arbitrary protocol. */ }
  }
  return {
    id: row.id, name: row.name, canonicalPath, degree: row.degree, field: row.field,
    duration: row.duration, language: row.language, description: row.description,
    requirements: publicCatalogRequirements(row.requirements, { canonicalPath, id: row.id }),
    isActive: row.isActive, universityIsActive: row.universityIsActive,
    tuition: projectPublicTuition(row, input.prices),
    universityId: row.universityId, universityName: input.universityName,
    universityPath: input.universityPath, universityCountry: row.universityCountry,
    universityCity: row.universityCity, universityType: input.universityType,
    universityLogoUrl: courseFinderUniversityLogoUrl(row.universityId, row.universityHasLogo), universityWebsite,
  };
}
