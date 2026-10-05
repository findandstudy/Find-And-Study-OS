import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { catalogParameters, catalogLayoutClass } from "@/lib/website/catalogPresentation";

type PreviewItem = { id: number; title: string; description: string; canonicalPath: string };

function validPreview(value: unknown): value is { items: PreviewItem[] } {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items) || value.items.length > 12) return false;
  return value.items.every(item => item && typeof item === "object"
    && Number.isSafeInteger(item.id) && item.id > 0
    && typeof item.title === "string" && item.title.length <= 4096
    && typeof item.description === "string" && item.description.length <= 20000
    && typeof item.canonicalPath === "string" && item.canonicalPath.length <= 2048);
}

export function CatalogBlockPreview({ content, locale }: { content: Record<string, unknown>; locale: string }) {
  const { lang } = useI18n();
  const copy = (en: string, tr: string) => lang === "tr" ? tr : en;
  const parameters = catalogParameters(content, locale);
  const [settled, setSettled] = useState(parameters);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(parameters), 350);
    return () => clearTimeout(timer);
  }, [parameters]);
  const { data, isFetching, isError, refetch } = useQuery<{ items: PreviewItem[] }>({
    queryKey: ["website-catalog-preview", settled],
    queryFn: async ({ signal }) => {
      const result: unknown = await customFetch(`/api/website/catalog-preview?${settled}`, { signal });
      if (!validPreview(result)) throw new Error("Invalid catalogue preview response");
      return result;
    },
    enabled: settled === parameters,
    staleTime: 0,
    retry: false,
  });
  const pending = settled !== parameters || isFetching;
  return <section className="py-8 px-6" aria-busy={pending}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold">{String(content.title || copy("Explore our catalogue", "Kataloğumuzu keşfedin"))}</h2>{content.subtitle ? <p className="mt-1 text-sm text-muted-foreground">{String(content.subtitle)}</p> : null}</div>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => refetch()}>{copy("Refresh data", "Verileri yenile")}</Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{copy("Live catalogue preview", "Güncel katalog önizlemesi")} · {locale} · {copy("nothing is saved or published", "hiçbir şey kaydedilmez veya yayınlanmaz")}</p>
    {pending ? <p role="status" className="py-6 text-sm">{copy("Loading current catalogue…", "Güncel katalog yükleniyor…")}</p>
      : isError ? <p role="alert" className="py-6 text-sm text-destructive">{copy("Preview unavailable. Refresh data to try again.", "Önizleme kullanılamıyor. Yeniden denemek için verileri yenileyin.")}</p>
      : !data?.items.length ? <p role="status" className="py-6 text-sm">{copy("No public records match these filters.", "Bu filtrelerle eşleşen halka açık kayıt yok.")}</p>
      : <div className={`mt-4 ${catalogLayoutClass(content)}`} tabIndex={content.layout === "carousel" ? 0 : undefined} aria-label={copy("Catalogue items", "Katalog kayıtları")}>
        {data.items.map(item => <article key={item.id} className="min-w-0 rounded-xl border bg-card p-4 break-words">
          <h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          {/^\/[a-z]{2}\/(programs|universities|destinations|cities)\/[a-z0-9-]+$/.test(item.canonicalPath) && <a className="mt-3 inline-block text-xs underline" href={item.canonicalPath} target="_blank" rel="noopener noreferrer">{copy("Open detail", "Detayı aç")} ↗</a>}
        </article>)}
      </div>}
  </section>;
}
