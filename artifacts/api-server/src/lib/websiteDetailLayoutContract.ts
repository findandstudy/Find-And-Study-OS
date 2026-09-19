/** Presentation only. Never contains catalogue facts, HTML, URLs or SEO overrides. */
export const DETAIL_LAYOUT_KINDS = ["program", "university", "destination", "city"] as const;
export type DetailLayoutKind = typeof DETAIL_LAYOUT_KINDS[number];
export type DetailLayout = { version: 2; kind: DetailLayoutKind; sections: string[]; hidden: string[] };
const LEGACY_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", "related"],
  university: ["hero", "navigation", "overview", "programs"],
  destination: ["hero", "overview", "universities", "cta"],
  city: ["hero", "overview", "universities", "programs"],
};
export const DETAIL_LAYOUT_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", "requirements", "intakes", "fees", "related"],
  university: ["hero", "navigation", "overview", "facts", "programs"],
  destination: ["hero", "navigation", "overview", "facts", "cities", "universities", "cta"],
  city: ["hero", "navigation", "overview", "facts", "universities", "programs"],
};
export function defaultDetailLayout(kind: DetailLayoutKind): DetailLayout {
  return { version: 2, kind, sections: [...DETAIL_LAYOUT_SECTIONS[kind]], hidden: [] };
}
export function parseDetailLayout(value: unknown): DetailLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "hidden,kind,sections,version" || ![1, 2].includes(v.version as number)
      || !DETAIL_LAYOUT_KINDS.includes(v.kind as DetailLayoutKind)) return null;
  const kind = v.kind as DetailLayoutKind;
  const allowed = v.version === 1 ? LEGACY_SECTIONS[kind] : DETAIL_LAYOUT_SECTIONS[kind];
  if (!Array.isArray(v.sections) || !Array.isArray(v.hidden)
      || v.sections.length !== allowed.length || new Set(v.sections).size !== allowed.length
      || !v.sections.every(x => typeof x === "string" && allowed.includes(x))
      || new Set(v.hidden).size !== v.hidden.length
      || !v.hidden.every(x => typeof x === "string" && allowed.includes(x) && !["hero", "navigation", "overview"].includes(x))
      || v.sections[0] !== "hero" || (allowed.includes("navigation") && v.sections[1] !== "navigation")
      || v.sections[allowed.includes("navigation") ? 2 : 1] !== "overview") return null;
  if (v.version === 1) {
    // Expand formerly nested overview content without losing the saved tail order.
    const tail = (v.sections as string[]).filter(x => !["hero", "navigation", "overview"].includes(x));
    const expanded = DETAIL_LAYOUT_SECTIONS[kind].filter(x => !tail.includes(x));
    return { version: 2, kind, sections: [...expanded, ...tail], hidden: [...v.hidden] as string[] };
  }
  return { version: 2, kind, sections: [...v.sections] as string[], hidden: [...v.hidden] as string[] };
}
