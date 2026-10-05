import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { catalogLimit, catalogParameters } from "@/lib/website/catalogPresentation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";

type Field = { key: string; label: string; options: { id: string; label: string; aliases?: string[] }[] };
const FILTER_LABELS: Record<string, [string, string]> = {
  countryId: ["Country", "Ülke"], cityId: ["City", "Şehir"], universityId: ["University", "Üniversite"],
  institutionType: ["Institution type", "Kurum türü"], degree: ["Study level", "Eğitim seviyesi"], language: ["Instruction language", "Eğitim dili"],
};
const EMPTY_FIELDS: Field[] = [];
function validFields(value: unknown): value is Field[] {
  if (!Array.isArray(value) || value.length > 6) return false;
  let optionCount = 0;
  const keys = new Set<string>();
  return value.every(field => {
    if (!field || typeof field !== "object" || typeof field.key !== "string" || !Object.hasOwn(FILTER_LABELS, field.key)
      || keys.has(field.key) || typeof field.label !== "string" || field.label.length > 256 || !Array.isArray(field.options)) return false;
    keys.add(field.key);
    optionCount += field.options.length;
    if (optionCount > 20000) return false;
    return field.options.every((option: Field["options"][number]) => option && typeof option === "object"
      && typeof option.id === "string" && option.id.length > 0 && option.id.length <= 1024
      && typeof option.label === "string" && option.label.length <= 4096
      && (option.aliases === undefined || (Array.isArray(option.aliases) && option.aliases.length <= 16
        && option.aliases.every(alias => typeof alias === "string" && alias.length <= 4096))));
  });
}
const normalizedName = (value: unknown) => String(value).trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function Filter({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  const { lang } = useI18n();
  const copy = (en: string, tr: string) => lang === "tr" ? tr : en;
  const [search, setSearch] = useState("");
  return <div className="space-y-1"><label className="text-xs" htmlFor={`catalog-${field.key}`}>{field.label}</label>
    <input aria-label={copy(`Search ${field.label}`, `${field.label} seçeneklerinde ara`)} className="w-full rounded border bg-background p-2 text-xs" value={search} onChange={e => setSearch(e.target.value)} placeholder={copy("Search options…", "Seçeneklerde ara…")} />
    <select id={`catalog-${field.key}`} className="w-full rounded border bg-background p-2 text-sm" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{copy("All", "Tümü")}</option>
      {value && !field.options.some(o => o.id === value) && <option value={value}>{copy("Unmatched, please reselect", "Eşleşme yok, yeniden seçin")}</option>}
      {field.options.filter(o => o.id === value || o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select></div>;
}
export function CatalogBlockFields({ content, locale, onChange }: { content: Record<string, unknown>; locale: string; onChange: (key: string, value: unknown) => void }) {
  const { lang } = useI18n();
  const copy = (en: string, tr: string) => lang === "tr" ? tr : en;
  const parameters = catalogParameters(content, locale);
  const { data = EMPTY_FIELDS, isPending, isFetching, isError, refetch } = useQuery<Field[]>({ queryKey: ["catalog-filter-options", parameters], queryFn: async ({ signal }) => {
    const result: unknown = await customFetch(`/api/website/catalog-filters?${parameters}`, { signal });
    if (!validFields(result)) throw new Error("Invalid catalogue filter response");
    return result;
  }, retry: false });
  useEffect(() => {
    if (isError) return;
    for (const field of data) {
      const key = field.key === "countryId" ? "country" : field.key === "cityId" ? "city" : null;
      if (!key || content[field.key] || !content[key]) continue;
      const matches = field.options.filter(o => [o.label, ...(o.aliases || [])].some(v => normalizedName(v) === normalizedName(content[key])));
      if (matches.length === 1) { onChange(field.key, matches[0].id); onChange(key, ""); }
    }
  }, [data, content, onChange, isError]);
  return <div className="space-y-3">
    <label className="block text-xs">{copy("Items to show (1–12)", "Gösterilecek kayıt sayısı (1–12)")}<input type="number" min={1} max={12} className="mt-1 w-full rounded border bg-background p-2" value={catalogLimit(content.limit)} onChange={e => onChange("limit", catalogLimit(e.target.value))} /></label>
    <Filter field={{ key: "layout", label: copy("Layout", "Görünüm"), options: [{ id: "grid", label: copy("Grid", "Izgara") }, { id: "list", label: copy("List", "Liste") }, { id: "carousel", label: copy("Carousel", "Kaydırmalı liste") }] }} value={String(content.layout || "grid")} onChange={v => onChange("layout", v || "grid")} />
    {(!content.layout || content.layout === "grid") && <Filter field={{ key: "columns", label: copy("Columns", "Sütunlar"), options: [2,3,4].map(n => ({ id: String(n), label: String(n) })) }} value={String(content.columns || 3)} onChange={v => onChange("columns", Number(v) || 3)} />}
    {isPending && <p role="status">{copy("Loading filter options…", "Filtre seçenekleri yükleniyor…")}</p>}
    {isError && <div role="alert"><p>{copy("Filter options unavailable. Please retry.", "Filtre seçenekleri kullanılamıyor. Yeniden deneyin.")}</p><Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>{copy("Retry filter options", "Filtreleri yeniden yükle")}</Button></div>}
    {!isError && data.map(field => {
      const legacyKey = field.key === "countryId" ? "country" : field.key === "cityId" ? "city" : null;
      const legacy = legacyKey ? String(content[legacyKey] || "") : "";
      const matches = field.options.filter(o => [o.label, ...(o.aliases || [])].some(v => normalizedName(v) === normalizedName(legacy)));
      const value = String(content[field.key] || (legacy && matches.length === 1 ? matches[0].id : ""));
      const labels = FILTER_LABELS[field.key];
      return <div key={field.key}><Filter field={{ ...field, label: labels ? copy(...labels) : field.label }} value={value} onChange={v => {
        onChange(field.key, v); if (legacyKey) onChange(legacyKey, "");
        if (field.key === "countryId") { onChange("cityId", ""); onChange("city", ""); onChange("universityId", ""); }
      }} />{legacy && matches.length !== 1 && !content[field.key] && <p role="status" className="text-xs text-amber-700">{legacy}: {copy("unmatched, please reselect. Ignored on public pages.", "eşleşme yok, yeniden seçin. Halka açık sayfalarda dikkate alınmaz.")}</p>}</div>;
    })}
  </div>;
}
