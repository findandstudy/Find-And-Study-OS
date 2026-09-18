import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { catalogParameters, catalogLayoutClass } from "@/lib/website/catalogPresentation";

type PreviewItem = { id: number; title: string; description: string; canonicalPath: string };

export function CatalogBlockPreview({ content, locale }: { content: Record<string, unknown>; locale: string }) {
  const parameters = catalogParameters(content, locale);
  const [settled, setSettled] = useState(parameters);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(parameters), 350);
    return () => clearTimeout(timer);
  }, [parameters]);
  const { data, isFetching, isError, error, refetch } = useQuery<{ items: PreviewItem[] }>({
    queryKey: ["website-catalog-preview", settled],
    queryFn: ({ signal }) => customFetch(`/api/website/catalog-preview?${settled}`, { signal }),
    enabled: settled === parameters,
    staleTime: 0,
    retry: false,
  });
  const pending = settled !== parameters || isFetching;
  return <section className="py-8 px-6" aria-busy={pending}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold">{String(content.title || "Explore our catalogue")}</h2>{content.subtitle ? <p className="mt-1 text-sm text-muted-foreground">{String(content.subtitle)}</p> : null}</div>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => refetch()}>Refresh data</Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Live catalogue preview · {locale} · nothing is saved or published</p>
    {pending ? <p role="status" className="py-6 text-sm">Loading current catalogue…</p>
      : isError ? <p role="alert" className="py-6 text-sm text-destructive">{String((error as { data?: { error?: string } }).data?.error || error.message)}</p>
      : !data?.items.length ? <p role="status" className="py-6 text-sm">No public records match these filters.</p>
      : <div className={`mt-4 ${catalogLayoutClass(content)}`} tabIndex={content.layout === "carousel" ? 0 : undefined} aria-label="Catalogue items">
        {data.items.map(item => <article key={item.id} className="min-w-0 rounded-xl border bg-card p-4 break-words">
          <h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          {/^\/[a-z]{2}\/(programs|universities|destinations|cities)\/[a-z0-9-]+$/.test(item.canonicalPath) && <a className="mt-3 inline-block text-xs underline" href={item.canonicalPath} target="_blank" rel="noopener noreferrer">Open detail ↗</a>}
        </article>)}
      </div>}
  </section>;
}
