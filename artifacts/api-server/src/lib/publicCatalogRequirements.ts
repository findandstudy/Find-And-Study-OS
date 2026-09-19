/** Public catalogue prose excludes importer references and unstructured timing claims. */
export function publicCatalogRequirements(value: string | null | undefined): string | null {
  const rows = (value || "").split(/\s*\|\s*|\r?\n/).map(row => row.trim()).filter(Boolean);
  const safe = rows.filter(row => {
    const match = /^([^:]{1,40}):\s*(.*)$/.exec(row);
    const key = match?.[1].trim().toLowerCase().replace(/\s+/g, " ");
    return !key || !/^(edvoy(?: ref(?:erence)?)?|source(?: url| ref(?:erence)?)?|import(?: ref(?:erence)?)?|intakes?(?: years?)?|deadline|application deadline|offer turnaround|decision(?: time)?)$/.test(key);
  });
  return safe.length ? safe.join(" | ") : null;
}
