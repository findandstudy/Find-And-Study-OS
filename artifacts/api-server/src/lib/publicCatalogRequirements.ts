/** Public catalogue prose excludes importer references and unstructured timing claims. */
export function publicCatalogRequirements(value: string | null | undefined, context?: { canonicalPath?: string; id?: number }): string | null {
  const slug = context?.canonicalPath?.split("?")[0].replace(/\/$/, "").split("/").pop();
  const exactSlug = slug && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(slug) ? slug : null;
  const withoutId = exactSlug && Number.isSafeInteger(context?.id) && exactSlug.endsWith(`-${context!.id}`) ? exactSlug.slice(0, -String(context!.id).length - 1) : null;
  const rows = (value || "").split(/\s*\|\s*|\r?\n/).map(row => row.trim()).filter(Boolean);
  const safe = rows.filter(row => {
    if (row === exactSlug || row === withoutId) return false;
    const match = /^([^:]{1,40}):\s*(.*)$/.exec(row);
    const key = match?.[1].trim().toLowerCase().replace(/\s+/g, " ");
    return !key || !/^(edvoy(?: ref(?:erence)?)?|source(?: url| ref(?:erence)?)?|import(?: ref(?:erence)?)?|intakes?(?: years?)?|deadline|application deadline|offer turnaround|decision(?: time)?)$/.test(key);
  });
  return safe.length ? safe.join(" | ") : null;
}
