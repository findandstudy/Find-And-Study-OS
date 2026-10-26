export type PublicationPreflightIssue = { code: string; message: string };

const FACTUAL_CATALOG_KEYS = ["source", "country", "city", "countryId", "cityId", "universityId", "programId", "degree", "language", "limit"] as const;

function translationBlocks(value: unknown): Array<{ blockType?: unknown; content: unknown }> | null {
  if (Array.isArray(value)) return value as Array<{ blockType?: unknown; content: unknown }>;
  if (value && typeof value === "object" && Array.isArray((value as { blocks?: unknown }).blocks)) return (value as { blocks: Array<{ blockType?: unknown; content: unknown }> }).blocks;
  return null;
}

export function inspectWebsitePageTranslations(sourceBlocks: Array<{ blockType?: unknown; content: unknown }>, translations: unknown) {
  const blockers: PublicationPreflightIssue[] = [];
  const warnings: PublicationPreflightIssue[] = [];
  if (!translations || typeof translations !== "object" || Array.isArray(translations)) return { blockers, warnings };
  for (const [locale, value] of Object.entries(translations as Record<string, unknown>)) {
    const blocks = translationBlocks(value);
    if (!blocks) continue;
    const inspection = inspectWebsitePageBlockLinks(blocks);
    blockers.push(...inspection.blockers.map(issue => ({ ...issue, message: `translations.${locale}.${issue.message}` })));
    warnings.push(...inspection.warnings.map(issue => ({ ...issue, message: `translations.${locale}.${issue.message}` })));
    blocks.forEach((translated, index) => {
      const source = sourceBlocks[index];
      if (!source || source.blockType !== translated.blockType || !source.content || typeof source.content !== "object" || !translated.content || typeof translated.content !== "object") return;
      for (const key of FACTUAL_CATALOG_KEYS) {
        const sourceValue = (source.content as Record<string, unknown>)[key];
        if (sourceValue === undefined) continue;
        const translatedValue = (translated.content as Record<string, unknown>)[key];
        if (JSON.stringify(sourceValue) !== JSON.stringify(translatedValue)) blockers.push({ code: "TRANSLATION_FACTUAL_OVERRIDE", message: `translations.${locale}.blocks[${index}].content.${key} must match the source page.` });
      }
    });
  }
  return { blockers, warnings };
}

export function inspectWebsitePageBlockLinks(blocks: Array<{ content: unknown }>) {
  const blockers: PublicationPreflightIssue[] = [];
  const warnings: PublicationPreflightIssue[] = [];
  let visited = 0;
  const visit = (value: unknown, path: string) => {
    visited += 1;
    if (visited > 500) return;
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      const childPath = `${path}.${key}`;
      if (typeof child === "string" && /(url|href|src|image|photo)$/i.test(key) && child.trim()) {
        const url = child.trim();
        const safeRelative = url.startsWith("/") && !url.startsWith("//") || url.startsWith("#") || /^(mailto|tel):/i.test(url);
        let protocol: string | null = null;
        if (!safeRelative) {
          try { protocol = new URL(url).protocol; } catch { protocol = null; }
        }
        if (!safeRelative && protocol !== "https:" && protocol !== "http:") blockers.push({ code: "UNSAFE_OR_INVALID_URL", message: `${childPath} contains an unsafe or invalid URL.` });
        else if (protocol === "http:") warnings.push({ code: "INSECURE_HTTP_URL", message: `${childPath} uses HTTP instead of HTTPS.` });
        if (/(image|photo)(url)?$/i.test(key) && ![record.alt, record.name, record.title].some(label => typeof label === "string" && label.trim())) warnings.push({ code: "MEDIA_LABEL_MISSING", message: `${childPath} has no accessible name or alternative text.` });
      }
      visit(child, childPath);
    }
  };
  blocks.forEach((block, index) => visit(block.content, `blocks[${index}].content`));
  if (visited > 500) blockers.push({ code: "CONTENT_TOO_COMPLEX", message: "Content exceeds the bounded publication inspection limit." });
  return { blockers, warnings };
}
