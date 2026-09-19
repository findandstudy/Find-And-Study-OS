/** Presentation only. Never contains catalogue facts, HTML, URLs or SEO overrides. */
export const DETAIL_LAYOUT_KINDS = ["program", "university", "destination", "city"] as const;
export type DetailLayoutKind = typeof DETAIL_LAYOUT_KINDS[number];
export type DetailLayout = { version: 3; kind: DetailLayoutKind; sections: string[]; hidden: string[] };
const LEGACY_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", "related"],
  university: ["hero", "navigation", "overview", "programs"],
  destination: ["hero", "overview", "universities", "cta"],
  city: ["hero", "overview", "universities", "programs"],
};
const V2_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", "requirements", "intakes", "fees", "related"],
  university: ["hero", "navigation", "overview", "facts", "programs"],
  destination: ["hero", "navigation", "overview", "facts", "cities", "universities", "cta"],
  city: ["hero", "navigation", "overview", "facts", "universities", "programs"],
};
const editorial = (...keys: string[]) => keys.map(key => `editorial-${key}`);
export const DETAIL_LAYOUT_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", ...editorial("gallery", "highlights", "curriculum"), "requirements", ...editorial("admission"), "intakes", "fees", ...editorial("scholarships", "living", "campus", "housing", "services", "recognition", "faq", "applyGuide"), "related", "mobileActions"],
  university: ["hero", "navigation", "overview", ...editorial("gallery", "highlights", "cautions"), "facts", ...editorial("education"), "programs", ...editorial("admission", "scholarships", "campus", "housing", "services", "recognition", "living", "faq", "applyGuide"), "mobileActions"],
  destination: ["hero", "navigation", "overview", ...editorial("gallery", "highlights", "cautions", "education"), "facts", ...editorial("admission", "scholarships", "living", "housing", "services", "recognition"), "cities", "universities", ...editorial("faq", "applyGuide"), "cta"],
  city: ["hero", "navigation", "overview", ...editorial("gallery", "highlights", "cautions", "education"), "facts", ...editorial("living", "campus", "housing", "services"), "universities", "programs", ...editorial("faq", "applyGuide")],
};
export function defaultDetailLayout(kind: DetailLayoutKind): DetailLayout {
  return { version: 3, kind, sections: [...DETAIL_LAYOUT_SECTIONS[kind]], hidden: [] };
}
export function parseDetailLayout(value: unknown): DetailLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "hidden,kind,sections,version" || ![1, 2, 3].includes(v.version as number)
      || !DETAIL_LAYOUT_KINDS.includes(v.kind as DetailLayoutKind)) return null;
  const kind = v.kind as DetailLayoutKind;
  const allowed = v.version === 1 ? LEGACY_SECTIONS[kind] : v.version === 2 ? V2_SECTIONS[kind] : DETAIL_LAYOUT_SECTIONS[kind];
  if (!Array.isArray(v.sections) || !Array.isArray(v.hidden)
      || v.sections.length !== allowed.length || new Set(v.sections).size !== allowed.length
      || !v.sections.every(x => typeof x === "string" && allowed.includes(x))
      || new Set(v.hidden).size !== v.hidden.length
      || !v.hidden.every(x => typeof x === "string" && allowed.includes(x) && !["hero", "navigation", "overview"].includes(x))
      || v.sections[0] !== "hero" || (allowed.includes("navigation") && v.sections[1] !== "navigation")
      || v.sections[allowed.includes("navigation") ? 2 : 1] !== "overview") return null;
  let sections = [...v.sections] as string[];
  if (v.version === 1) {
    // Expand formerly nested overview content without losing the saved tail order.
    const tail = (v.sections as string[]).filter(x => !["hero", "navigation", "overview"].includes(x));
    const expanded = V2_SECTIONS[kind].filter(x => !tail.includes(x));
    sections = [...expanded, ...tail];
  }
  // Insert additive sections near their default neighbour, preserving the order
  // and hidden state of every previously saved section. No database migration.
  for (const [index, section] of DETAIL_LAYOUT_SECTIONS[kind].entries()) {
    if (sections.includes(section)) continue;
    const next = DETAIL_LAYOUT_SECTIONS[kind].slice(index + 1).find(key => sections.includes(key));
    if (next) sections.splice(sections.indexOf(next), 0, section);
    else sections.push(section);
  }
  return { version: 3, kind, sections, hidden: [...v.hidden] as string[] };
}
