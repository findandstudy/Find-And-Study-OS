import { useMemo, useState } from "react";
import { Braces, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DETAIL_TEMPLATE_VARIABLES, type DetailLayoutKind } from "@/lib/website/detailLayoutContract";
import { DETAIL_VARIABLE_GROUP_TR, detailVariableGroup, detailVariableHelp, detailVariableLabel } from "./detailVariableLabels";

type Copy = (en: string, tr: string) => string;
export function DetailVariableInsertPanel({ kind, language, copy, onInsertTitle, onInsertBody }: { kind: DetailLayoutKind; language: string; copy: Copy; onInsertTitle?: (token: string) => void; onInsertBody: (token: string) => void }) {
  const variables = DETAIL_TEMPLATE_VARIABLES[kind];
  const [selected, setSelected] = useState(variables[0]?.key ?? "");
  const [search, setSearch] = useState("");
  const locale = language === "tr" ? "tr-TR" : "en-US";
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    return query ? variables.filter(item => [detailVariableLabel(item, language), detailVariableGroup(item, language), item.key].some(value => value.toLocaleLowerCase(locale).includes(query))) : [...variables];
  }, [language, locale, search, variables]);
  const groups = [...new Set(visible.map(item => item.group))];
  const item = variables.find(value => value.key === selected) ?? variables[0];
  if (!item) return null;
  const token = `{{${item.key}}}`;
  return <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
    <div><h4 className="flex items-center gap-2 text-sm font-semibold"><Braces className="h-4 w-4 text-primary" />{copy("Insert live page data", "Canlı sayfa verisi ekle")}</h4><p className="mt-1 text-xs text-muted-foreground">{copy("Choose a catalogue value; it will stay connected to this exact page record.", "Bir katalog bilgisi seçin; değer bu sayfanın gerçek kaydına bağlı ve güncel kalır.")}</p></div>
    <div className="relative"><Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label={copy("Find a live field", "Canlı alan ara")} className="h-9 ps-9" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy("Search fields…", "Alanlarda ara…")} /></div>
    <Select value={selected} onValueChange={setSelected}><SelectTrigger aria-label={copy("Live information to insert", "Eklenecek canlı bilgi")}><SelectValue /></SelectTrigger><SelectContent>{groups.map((group, index) => <SelectGroup key={group}>{index > 0 && <SelectSeparator />}<SelectLabel>{language === "tr" ? DETAIL_VARIABLE_GROUP_TR[group] ?? group : group}</SelectLabel>{visible.filter(value => value.group === group).map(value => <SelectItem key={value.key} value={value.key}>{detailVariableLabel(value, language)}</SelectItem>)}</SelectGroup>)}</SelectContent></Select>
    {search && visible.length === 0 ? <p className="text-xs text-amber-700">{copy("No matching field. Clear the search to see all fields.", "Eşleşen alan yok. Tümünü görmek için aramayı temizleyin.")}</p> : null}
    <div className="rounded-lg border bg-background p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{detailVariableLabel(item, language)}</strong><Badge variant="secondary">{detailVariableGroup(item, language)}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{detailVariableHelp(item, language)}</p><code className="mt-2 inline-block rounded bg-muted px-2 py-1 text-xs">{token}</code><div className="mt-3 grid gap-2 sm:grid-cols-2">{onInsertTitle ? <Button type="button" size="sm" variant="outline" onClick={() => onInsertTitle(token)}>{copy("Add to section title", "Bölüm başlığına ekle")}</Button> : null}<Button type="button" size="sm" onClick={() => onInsertBody(token)}>{copy("Add to section text", "Bölüm metnine ekle")}</Button></div></div>
    <p className="text-[11px] text-muted-foreground">{copy("Optional fallback: {{field|Text shown when empty}}", "İsteğe bağlı yedek değer: {{alan|Bilgi boşsa gösterilecek metin}}")}</p>
  </div>;
}
