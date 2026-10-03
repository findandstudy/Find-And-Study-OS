export const CATALOG_SOURCE_TABS = ["countries", "cities", "universities", "programs", "options"] as const;
export type CatalogSourceTab = typeof CATALOG_SOURCE_TABS[number];

/** Navigation only: a link can select an existing record, never submit edits. */
export function parseCatalogEntryNavigation(search: string) {
  const params = new URLSearchParams(search);
  const requestedTab = params.get("tab");
  const tab: CatalogSourceTab = CATALOG_SOURCE_TABS.includes(requestedTab as CatalogSourceTab) ? requestedTab as CatalogSourceTab : "countries";
  const id = params.get("sourceId") ?? "";
  const sourceId = /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 2_147_483_647 ? Number(id) : null;
  const q = (params.get("q") ?? "").slice(0, 200).replace(/[\u0000-\u001f\u007f]/g, "");
  return { tab, sourceId, q };
}
