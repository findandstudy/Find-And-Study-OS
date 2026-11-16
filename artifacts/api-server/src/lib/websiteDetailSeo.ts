import type { DetailContentKind, DetailSeo } from "./websiteDetailContentContract";

export type AutomaticDetailSeoFacts = {
  name: string;
  description: string | null;
  universityName: string | null;
  city: string | null;
  country: string | null;
};

const cleanSentence = (value: string) => value.replace(/\s+/g, " ").trim();

/** Search snippets must be complete phrases rather than mechanically cut text. */
const chooseSeoTitle = (variants: string[], brand = "Find & Study") => {
  const suffix = ` | ${brand}`;
  const normalized = variants.map(cleanSentence).filter(Boolean);
  const withBrand = normalized.find(value => value.length + suffix.length <= 60);
  if (withBrand) return `${withBrand}${suffix}`;
  const withoutBrand = normalized.find(value => value.length <= 60);
  if (withoutBrand) return withoutBrand;
  // Long proper names are kept intact rather than rendered as a broken name.
  return normalized.at(-1) ?? brand;
};

const fitMetaDescription = (value: string, max = 155) => {
  const normalized = cleanSentence(value);
  if (normalized.length <= max) return normalized;
  const chunk = normalized.slice(0, max + 1);
  const sentenceBoundary = Math.max(chunk.lastIndexOf(". "), chunk.lastIndexOf("! "), chunk.lastIndexOf("? "));
  const wordBoundary = chunk.lastIndexOf(" ");
  const boundary = sentenceBoundary >= Math.min(105, max * 0.68)
    ? sentenceBoundary + 1
    : wordBoundary >= Math.min(105, max * 0.68)
      ? wordBoundary
      : max;
  let fitted = chunk.slice(0, boundary).replace(/[\s,;:.-]+$/u, "");
  // A length-safe cut must not leave a conjunction, article or preposition as
  // the final visible word (for example "transport, neighbourhood character
  // and."). Backtrack until the snippet has a meaningful lexical ending.
  const danglingEnding = /\s+(?:and|or|but|the|a|an|with|for|to|of|in|on|at|by|from|as)$/iu;
  while (danglingEnding.test(fitted)) fitted = fitted.replace(danglingEnding, "").replace(/[\s,;:.-]+$/u, "");
  return /[.!?]$/u.test(fitted) ? fitted : `${fitted}.`;
};

export function buildAutomaticEnglishDetailSeo(kind: DetailContentKind, facts: AutomaticDetailSeoFacts): DetailSeo {
  const titleVariants = kind === "program"
    ? [`${facts.name}: Fees, Entry & Application`, `${facts.name}: Course & Application`, `${facts.name} Study Guide`, facts.name]
    : kind === "university"
      ? [`${facts.name}: Programs & Admissions`, `${facts.name}: Study Guide`, `${facts.name} University Guide`, facts.name]
      : kind === "city"
        ? [`Study in ${facts.name}: Universities & Student Life`, `Study in ${facts.name}: Student Guide`, `${facts.name} Study Guide`, facts.name]
        : [`Study in ${facts.name}: Cities, Costs & Student Life`, `${facts.name} Student Destination Guide`, `${facts.name} Study & Living Guide`, facts.name];
  const title = chooseSeoTitle(titleVariants);
  const location = [facts.city, facts.country].filter(Boolean).join(", ");
  const fallback = kind === "program"
    ? `Explore ${facts.name}${facts.universityName ? ` at ${facts.universityName}` : ""}: study format, entry requirements, fees, intakes and application guidance.`
    : kind === "university"
      ? `Compare ${facts.name}${location ? ` in ${location}` : ""}: programs, admissions, fees, scholarships, campus services and application planning.`
      : kind === "city"
        ? `Explore universities, programs, campus areas, transport, housing and practical student life in ${facts.name}${facts.country ? `, ${facts.country}` : ""}.`
        : `Explore cities, daily life, climate, housing, transport and study planning in ${facts.name}, with practical guidance on admissions, funding and visas.`;
  const description = fitMetaDescription(facts.description && facts.description.length >= 90 ? facts.description : fallback, 155);
  return { title, description, ogTitle: title, ogDescription: description, twitterTitle: title, twitterDescription: description };
}

export function buildAutomaticEnglishDetailSeoFromSections(
  kind: DetailContentKind,
  facts: AutomaticDetailSeoFacts,
  sections: Array<{ key: string; body?: string }>,
): DetailSeo {
  const preferredCopy = ["overview", "hero", "facts", "highlights"]
    .map((key) => sections.find((section) => section.key === key)?.body)
    .find((body): body is string => !!body && cleanSentence(body).length >= 90);
  return buildAutomaticEnglishDetailSeo(kind, {
    ...facts,
    description: preferredCopy ?? facts.description,
  });
}
