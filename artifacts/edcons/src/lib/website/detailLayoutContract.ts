/** Presentation only. Never contains catalogue facts, HTML, URLs or SEO overrides. */
export const DETAIL_LAYOUT_KINDS = ["program", "university", "destination", "city"] as const;
export type DetailLayoutKind = typeof DETAIL_LAYOUT_KINDS[number];
export type DetailLayout = { version: 1; kind: DetailLayoutKind; sections: string[]; hidden: string[] };
export const DETAIL_LAYOUT_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", "related"],
  university: ["hero", "navigation", "overview", "programs"],
  destination: ["hero", "overview", "universities", "cta"],
  city: ["hero", "overview", "universities", "programs"],
};
export function defaultDetailLayout(kind: DetailLayoutKind): DetailLayout {
  return { version: 1, kind, sections: [...DETAIL_LAYOUT_SECTIONS[kind]], hidden: [] };
}
export function parseDetailLayout(value: unknown): DetailLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "hidden,kind,sections,version" || v.version !== 1 ||
      !DETAIL_LAYOUT_KINDS.includes(v.kind as DetailLayoutKind)) return null;
  const kind = v.kind as DetailLayoutKind, allowed = DETAIL_LAYOUT_SECTIONS[kind];
  if (!Array.isArray(v.sections) || !Array.isArray(v.hidden) ||
      v.sections.length !== allowed.length || new Set(v.sections).size !== allowed.length ||
      !v.sections.every(x => typeof x === "string" && allowed.includes(x)) ||
      new Set(v.hidden).size !== v.hidden.length ||
      !v.hidden.every(x => typeof x === "string" && allowed.includes(x) && !["hero", "navigation", "overview"].includes(x)) ||
      v.sections[0] !== "hero" || (allowed.includes("navigation") && v.sections[1] !== "navigation") ||
      v.sections[allowed.includes("navigation") ? 2 : 1] !== "overview") return null;
  return { version: 1, kind, sections: [...v.sections] as string[], hidden: [...v.hidden] as string[] };
}
