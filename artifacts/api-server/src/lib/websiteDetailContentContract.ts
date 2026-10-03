/** Supplemental human-reviewed editorial content, never catalogue/SEO authority. */
export const DETAIL_CONTENT_KINDS = ["program", "university", "destination", "city"] as const;
export type DetailContentKind = typeof DETAIL_CONTENT_KINDS[number];
export const DETAIL_CONTENT_KEYS: Record<DetailContentKind, readonly string[]> = {
  program: ["gallery", "highlights", "curriculum", "admission", "scholarships", "living", "campus", "housing", "services", "recognition", "faq", "applyGuide"],
  university: ["gallery", "highlights", "cautions", "education", "admission", "scholarships", "campus", "housing", "services", "recognition", "living", "faq", "applyGuide"],
  destination: ["gallery", "highlights", "cautions", "education", "admission", "scholarships", "living", "housing", "services", "recognition", "faq", "applyGuide"],
  city: ["gallery", "highlights", "cautions", "education", "living", "campus", "housing", "services", "faq", "applyGuide"],
};
export const DETAIL_CONTENT_LOCALES = ["en","tr","ar","fr","ru","fa","zh","hi","es","id","ur","tk","ky","kk","uz","tg","bn","pt","ne","vi","ko","uk","it"] as const;
export type DetailContentSection = {
  key: string; title: string; body?: string;
  cards?: { title: string; body: string; href?: string }[];
  table?: { columns: string[]; rows: string[][] };
  steps?: { title: string; body: string }[];
  images?: { src: string; alt: string; caption?: string }[];
  questions?: { question: string; answer: string }[];
  sources: { label: string; url: string }[];
  reviewedOn: string;
};
export type DetailContent = { version: 1; kind: DetailContentKind; entityId: number; locale: string; sections: DetailContentSection[] };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[], required: string[] = []) => Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v,k));
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
export function safeDetailContentUrl(v: unknown, externalOnly = false): boolean {
  if (typeof v !== "string" || v.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(v)) return false;
  if (!externalOnly && /^\/(?!\/)/.test(v)) return !v.includes("..");
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
export function parseDetailContent(value: unknown, today = new Date().toISOString().slice(0,10)): DetailContent | null {
  if (!record(value) || !keys(value,["version","kind","entityId","locale","sections"],["version","kind","entityId","locale","sections"])
    || value.version !== 1 || !DETAIL_CONTENT_KINDS.includes(value.kind as DetailContentKind)
    || !Number.isSafeInteger(value.entityId) || Number(value.entityId) <= 0 || Number(value.entityId) > 2147483647
    || !DETAIL_CONTENT_LOCALES.includes(value.locale as typeof DETAIL_CONTENT_LOCALES[number])
    || !Array.isArray(value.sections) || value.sections.length > 14
    || new Set(value.sections.map(s => record(s) ? s.key : null)).size !== value.sections.length) return null;
  for (const s of value.sections) {
    if (!record(s) || !keys(s,["key","title","body","cards","table","steps","images","questions","sources","reviewedOn"],["key","title","sources","reviewedOn"])
      || typeof s.key !== "string" || !DETAIL_CONTENT_KEYS[value.kind as DetailContentKind].includes(s.key) || !text(s.title,160)
      || (s.body !== undefined && !text(s.body,6000)) || typeof s.reviewedOn !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(s.reviewedOn) || !Number.isFinite(Date.parse(s.reviewedOn))
      || new Date(s.reviewedOn).toISOString().slice(0,10) !== s.reviewedOn || s.reviewedOn > today
      || !Array.isArray(s.sources) || s.sources.length < 1 || s.sources.length > 8
      || !s.sources.every(x => record(x) && keys(x,["label","url"],["label","url"]) && text(x.label,160) && safeDetailContentUrl(x.url,true))) return null;
    for (const prop of ["cards","steps","images","questions"] as const) {
      const items = s[prop]; if (items === undefined) continue;
      if (!Array.isArray(items) || items.length < 1 || items.length > (prop === "images" ? 8 : 12)) return null;
      if (!items.every(x => {
        if (!record(x)) return false;
        if (prop === "images") return keys(x,["src","alt","caption"],["src","alt"]) && safeDetailContentUrl(x.src) && text(x.alt,300) && (x.caption === undefined || text(x.caption,500));
        if (prop === "questions") return keys(x,["question","answer"],["question","answer"]) && text(x.question,300) && text(x.answer,3000);
        return keys(x, prop === "cards" ? ["title","body","href"] : ["title","body"],["title","body"]) && text(x.title,160) && text(x.body,2000) && (x.href === undefined || safeDetailContentUrl(x.href));
      })) return null;
    }
    if (s.table !== undefined) {
      const t = s.table;
      if (!record(t) || !keys(t,["columns","rows"],["columns","rows"]) || !Array.isArray(t.columns) || t.columns.length < 1 || t.columns.length > 6
        || !t.columns.every(x => text(x,160)) || !Array.isArray(t.rows) || t.rows.length < 1 || t.rows.length > 20
        || !t.rows.every(row => Array.isArray(row) && row.length === (t.columns as unknown[]).length && row.every(x => text(x,500)))) return null;
    }
    if (!s.body && !s.cards && !s.table && !s.steps && !s.images && !s.questions) return null;
  }
  if (JSON.stringify(value).length > 100000) return null;
  return JSON.parse(JSON.stringify(value)) as DetailContent;
}
