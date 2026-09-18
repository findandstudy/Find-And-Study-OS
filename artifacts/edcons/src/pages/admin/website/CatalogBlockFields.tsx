import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { catalogLimit, catalogParameters } from "@/lib/website/catalogPresentation";

type Field = { key: string; label: string; options: { id: string; label: string; aliases?: string[] }[] };
const normalizedName = (value: unknown) => String(value).trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function Filter({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  return <div className="space-y-1"><label className="text-xs" htmlFor={`catalog-${field.key}`}>{field.label}</label>
    <input aria-label={`Search ${field.label}`} className="w-full rounded border bg-background p-2 text-xs" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search options…" />
    <select id={`catalog-${field.key}`} className="w-full rounded border bg-background p-2 text-sm" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">All</option>
      {value && !field.options.some(o => o.id === value) && <option value={value}>Unmatched, please reselect</option>}
      {field.options.filter(o => o.id === value || o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select></div>;
}
export function CatalogBlockFields({ content, locale, onChange }: { content: Record<string, unknown>; locale: string; onChange: (key: string, value: unknown) => void }) {
  const parameters = catalogParameters(content, locale);
  const { data = [], isPending, isError } = useQuery<Field[]>({ queryKey: ["catalog-filter-options", parameters], queryFn: ({ signal }) => customFetch(`/api/website/catalog-filters?${parameters}`, { signal }), retry: false });
  useEffect(() => {
    for (const field of data) {
      const key = field.key === "countryId" ? "country" : field.key === "cityId" ? "city" : null;
      if (!key || content[field.key] || !content[key]) continue;
      const matches = field.options.filter(o => [o.label, ...(o.aliases || [])].some(v => normalizedName(v) === normalizedName(content[key])));
      if (matches.length === 1) { onChange(field.key, matches[0].id); onChange(key, ""); }
    }
  }, [data, content, onChange]);
  return <div className="space-y-3">
    <label className="block text-xs">Items to show (1–12)<input type="number" min={1} max={12} className="mt-1 w-full rounded border bg-background p-2" value={catalogLimit(content.limit)} onChange={e => onChange("limit", catalogLimit(e.target.value))} /></label>
    <Filter field={{ key: "layout", label: "Layout", options: ["grid", "list", "carousel"].map(id => ({ id, label: id })) }} value={String(content.layout || "grid")} onChange={v => onChange("layout", v || "grid")} />
    {(!content.layout || content.layout === "grid") && <Filter field={{ key: "columns", label: "Columns", options: [2,3,4].map(n => ({ id: String(n), label: String(n) })) }} value={String(content.columns || 3)} onChange={v => onChange("columns", Number(v) || 3)} />}
    {isPending && <p role="status">Loading filter options…</p>}{isError && <p role="alert">Filter options unavailable. Please retry.</p>}
    {data.map(field => {
      const legacyKey = field.key === "countryId" ? "country" : field.key === "cityId" ? "city" : null;
      const legacy = legacyKey ? String(content[legacyKey] || "") : "";
      const matches = field.options.filter(o => [o.label, ...(o.aliases || [])].some(v => normalizedName(v) === normalizedName(legacy)));
      const value = String(content[field.key] || (legacy && matches.length === 1 ? matches[0].id : ""));
      return <div key={field.key}><Filter field={field} value={value} onChange={v => {
        onChange(field.key, v); if (legacyKey) onChange(legacyKey, "");
        if (field.key === "countryId") { onChange("cityId", ""); onChange("city", ""); onChange("universityId", ""); }
      }} />{legacy && matches.length !== 1 && !content[field.key] && <p role="status" className="text-xs text-amber-700">{legacy}: unmatched, please reselect. Ignored on public pages.</p>}</div>;
    })}
  </div>;
}
