export type AiWritingField = {
  path: string;
  label: string;
  value: string;
  maxLength: number;
  format: "plain" | "html";
};

export type DetailAiPageFacts = {
  city?: string;
  country?: string;
  university?: string;
  program?: string;
  universities?: string[];
  programs?: string[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const valueText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const namedItems = (value: unknown, limit = 12): string[] => Array.isArray(value)
  ? [...new Set(value.flatMap(item => {
      if (typeof item === "string") return valueText(item) ? [item.trim()] : [];
      const row = record(item);
      const name = valueText(row?.name) ?? valueText(row?.title) ?? valueText(row?.programName) ?? valueText(row?.universityName);
      return name ? [name] : [];
    }))].slice(0, limit)
  : [];

/** Extracts only verified catalogue identity values for section/SEO AI context. */
export function detailAiPageFacts(kind: "program" | "university" | "destination" | "city", payload: unknown, fallbackTitle = ""): DetailAiPageFacts {
  const root = record(payload);
  const entity = record(kind === "destination" ? root?.destination : root?.data);
  const name = valueText(entity?.name) ?? valueText(entity?.programName) ?? valueText(fallbackTitle);
  const country = kind === "destination"
    ? valueText(entity?.country) ?? name
    : valueText(entity?.country) ?? valueText(entity?.universityCountry);
  const city = kind === "city"
    ? name
    : valueText(entity?.city) ?? valueText(entity?.universityCity);
  const university = kind === "university"
    ? name
    : valueText(entity?.universityName);
  const program = kind === "program" ? name : undefined;
  const universities = namedItems(root?.universities ?? entity?.universities);
  const programs = namedItems(root?.programs ?? root?.related ?? entity?.programs);
  return {
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
    ...(university ? { university } : {}),
    ...(program ? { program } : {}),
    ...(universities.length ? { universities } : {}),
    ...(programs.length ? { programs } : {}),
  };
}

export function detailAiWritingContext(input: {
  kind: "program" | "university" | "destination" | "city";
  pageTitle: string;
  sectionTitle: string;
  sectionKey: string;
  payload: unknown;
  currentIntroduction?: string;
}): string {
  const facts = detailAiPageFacts(input.kind, input.payload, input.pageTitle);
  const lines = [
    `PAGE_TYPE: ${input.kind}`,
    `PAGE_TITLE: ${input.pageTitle}`,
    `SECTION_KEY: ${input.sectionKey}`,
    `SECTION_TITLE: ${input.sectionTitle}`,
    facts.country ? `COUNTRY: ${facts.country}` : "",
    facts.city ? `CITY: ${facts.city}` : "",
    facts.university ? `UNIVERSITY: ${facts.university}` : "",
    facts.program ? `PROGRAM: ${facts.program}` : "",
    facts.universities?.length ? `RELATED_UNIVERSITIES: ${facts.universities.join(" | ")}` : "",
    facts.programs?.length ? `RELATED_PROGRAMS: ${facts.programs.join(" | ")}` : "",
    input.currentIntroduction ? `CURRENT_PAGE_INTRODUCTION: ${input.currentIntroduction}` : "",
    "FACT_POLICY: Use only the populated catalogue values above. Never guess a missing city, country, university or program.",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 6000);
}

const SKIP_KEYS = new Set([
  "id", "key", "type", "locale", "slug", "url", "href", "src", "source", "sources",
  "icon", "image", "color", "style", "class", "layout", "position", "width", "size",
  "column", "columns", "limit", "opacity", "visible", "enabled", "overlay", "presentation",
  "reviewedon", "createdat", "updatedat",
]);

function isEditableTextKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return !SKIP_KEYS.has(normalized) && !["url", "href", "src", "slug", "color", "image", "icon"].some(suffix => normalized.endsWith(suffix));
}

function fieldLimit(key: string): number {
  const normalized = key.toLowerCase();
  if (normalized.includes("alt")) return 300;
  if (normalized.includes("caption")) return 500;
  if (["title", "heading", "label", "eyebrow", "question", "name"].some(part => normalized.includes(part))) return 300;
  if (normalized.includes("html")) return 12_000;
  return 6_000;
}

function humanizePath(path: string): string {
  return path
    .replace(/^root\.?/, "")
    .replace(/\[(\d+)\]/g, (_, index: string) => ` ${Number(index) + 1}`)
    .replace(/\./g, " · ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, value => value.toUpperCase()) || "Text";
}

export function collectAiWritingFields(value: unknown): AiWritingField[] {
  const fields: AiWritingField[] = [];
  const visit = (current: unknown, path: string, key: string) => {
    if (typeof current === "string") {
      if (!isEditableTextKey(key)) return;
      const trimmed = current.trim();
      if (trimmed && /^(?:https?:\/\/|mailto:|tel:|\/|#(?:[0-9a-f]{3,8})$)/i.test(trimmed)) return;
      fields.push({
        path,
        label: humanizePath(path),
        value: current,
        maxLength: fieldLimit(key),
        format: /html/i.test(key) || /<([a-z][^>]*)>/i.test(current) ? "html" : "plain",
      });
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, key));
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [childKey, child] of Object.entries(current as Record<string, unknown>)) {
      if (!isEditableTextKey(childKey) && (typeof child === "string" || childKey === "sources" || childKey === "presentation")) continue;
      visit(child, path ? `${path}.${childKey}` : childKey, childKey);
    }
  };
  visit(value, "root", "root");
  return fields;
}

export function applyAiWritingField<T>(value: T, path: string, text: string): T {
  const clone = typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
  const tokens = path.replace(/^root\.?/, "").match(/[^.[\]]+/g) ?? [];
  if (!tokens.length) return text as T;
  let cursor: any = clone;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = /^\d+$/.test(tokens[index]) ? Number(tokens[index]) : tokens[index];
    cursor = cursor[token];
    if (cursor === undefined || cursor === null) throw new Error(`AI field path is no longer available: ${path}`);
  }
  const last = /^\d+$/.test(tokens.at(-1)!) ? Number(tokens.at(-1)!) : tokens.at(-1)!;
  cursor[last] = text;
  return clone;
}
