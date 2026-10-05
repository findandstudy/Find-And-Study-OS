import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DetailContent } from "@/lib/website/detailContentContract";
import { emptyProgramSelection, universityProgramQuery } from "@/pages/public/universityProgramQuery";
import { bindDetailPreviewLayout, bindDetailPreviewPayload, bindPreviewUniversityPrograms, detailPreviewRoute, PREVIEW_TIMEOUT_MS, readDetailPreviewJson, type DetailPreviewTarget } from "./detailFullPreviewContract";

type Copy = (en: string, tr: string) => string;
const widths = { desktop: 1280, tablet: 768, mobile: 375 } as const;

export default function DetailFullPreview({ target, content, copy, onReady }: {
  target: DetailPreviewTarget; content: DetailContent; copy: Copy; onReady: (ready: boolean) => void;
}) {
  const [device, setDevice] = useState<keyof typeof widths>(() => typeof window !== "undefined" && window.innerWidth < 640 ? "mobile" : typeof window !== "undefined" && window.innerWidth < 1024 ? "tablet" : "desktop");
  const [result, setResult] = useState<{ html: string; canonicalPath: string; indexable: boolean; at: string; binding: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const contentKey = JSON.stringify(content);
  const binding = JSON.stringify([target.kind, target.entityId, target.locale, target.canonicalPath, contentKey]);
  const currentResult = result?.binding === binding ? result : null;
  const viewport = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const scaleDescription = useId();
  const scale = availableWidth > 0 ? Math.min(1, availableWidth / widths[device]) : 1;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setAvailableWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)));
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [currentResult?.binding]);
  const route = detailPreviewRoute(target, content);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => { if (current) { setFailed(true); onReady(false); } controller.abort(); }, PREVIEW_TIMEOUT_MS);
    setResult(null); setFailed(false); onReady(false);
    const load = async () => {
      if (!route) throw new Error("Preview route unavailable");
      const [rawPayload, rawLayout] = await Promise.all([
        readDetailPreviewJson(route.readPath, controller.signal),
        readDetailPreviewJson(`/api/public/web/detail-layouts/${target.kind}`, controller.signal),
      ]);
      const payload = bindDetailPreviewPayload(rawPayload, target, content);
      const layout = bindDetailPreviewLayout(rawLayout, target.kind);
      let universityPrograms;
      if (target.kind === "university" && !layout.hidden.includes("programs")) {
        const query = universityProgramQuery(target.entityId, content.locale, "", emptyProgramSelection());
        const [programs, facets] = await Promise.all([
          readDetailPreviewJson(`/api/course-finder?${query}&page=1&limit=24`, controller.signal),
          readDetailPreviewJson(`/api/course-finder/filters?${query}`, controller.signal),
        ]);
        universityPrograms = bindPreviewUniversityPrograms(programs, facets, target.entityId);
      }
      const { renderDetailFullPreview } = await import("./detailFullPreviewRender");
      const html = await renderDetailFullPreview({ content, payload, layout, route, universityPrograms, signal: controller.signal });
      if (!current || controller.signal.aborted) return;
      const meta = payload.meta as { canonicalPath: string; indexable: boolean };
      setResult({ html, canonicalPath: meta.canonicalPath, indexable: meta.indexable, at: new Date().toLocaleTimeString(), binding });
    };
    void load().catch(() => { controller.abort(); if (current) { setFailed(true); onReady(false); } }).finally(() => clearTimeout(timeout));
    return () => { current = false; clearTimeout(timeout); controller.abort(); onReady(false); };
  }, [target.kind, target.entityId, target.locale, target.canonicalPath, contentKey, attempt, onReady]);

  return <section className="min-w-0 space-y-3" aria-label={copy("Full detail preview", "Tam detay önizlemesi")}>
    <p className="text-sm text-muted-foreground">{copy("Current public facts and published layout with this in-memory editorial draft. Actions and external/private images are disabled. Nothing is saved or published; this is not SEO approval. Catalogue translations may use their existing fallback.", "Güncel katalog bilgileri ve yayınlanmış düzen, bellekteki bu editoryal taslakla gösterilir. İşlemler ve dış/özel görseller kapalıdır. Kayıt veya yayın yapılmaz; SEO onayı değildir. Katalog çevirileri mevcut kaynak diline dönebilir.")}</p>
    {!route ? <p role="alert">{copy("Full preview requires a valid public catalogue route and complete, sourced draft sections. Complete the fields or choose the record in the required catalogue language.", "Tam önizleme için geçerli katalog adresi ve kaynakları tamamlanmış taslak bölümleri gerekir. Alanları tamamlayın veya katalog kaydını gereken dilde seçin.")}</p>
      : failed ? <div role="alert" className="space-y-2 rounded-lg border p-3"><p>{copy("Full preview could not be verified or timed out. Your draft is kept. Retry before reviewing for publication.", "Tam önizleme doğrulanamadı veya süre doldu. Taslağınız korunuyor. Yayın incelemesinden önce yeniden deneyin.")}</p><Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>{copy("Retry full preview", "Tam önizlemeyi yeniden dene")}</Button></div>
        : !currentResult ? <p role="status">{copy("Loading and verifying full preview…", "Tam önizleme yükleniyor ve doğrulanıyor…")}</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-2"><div role="group" aria-label={copy("Preview viewport", "Önizleme ekranı")} className="flex flex-wrap gap-2">{(Object.keys(widths) as Array<keyof typeof widths>).map(value => <Button key={value} size="sm" variant={device === value ? "secondary" : "outline"} aria-pressed={device === value} onClick={() => setDevice(value)}>{value === "desktop" ? copy("Desktop", "Masaüstü") : value === "tablet" ? copy("Tablet", "Tablet") : copy("Mobile", "Mobil")} · {widths[value]}px</Button>)}</div><span className="text-xs text-muted-foreground">{copy("Facts loaded", "Bilgiler yüklendi")}: {currentResult.at} · {currentResult.indexable ? copy("Current public index flag", "Mevcut public indeks işareti") : "NOINDEX"}</span></div>
          <p className="break-all text-xs text-muted-foreground" dir="ltr">{currentResult.canonicalPath}</p>
          <p id={scaleDescription} className="text-xs text-muted-foreground">{copy("Scaled to fit", "Alana sığacak ölçek")}: {Math.round(scale * 100)}%. {copy("The page keeps the selected viewport width. Scroll within the preview to inspect its content.", "Sayfa seçilen ekran genişliğini korur. İçeriği incelemek için önizlemenin içinde kaydırın.")}</p>
          <div className="min-w-0 overflow-hidden rounded-lg border bg-muted p-2" role="region" aria-label={copy("Preview scaled to the available space", "Kullanılabilir alana ölçeklenmiş önizleme")} aria-describedby={scaleDescription}>
            <div ref={viewport} className="min-w-0 w-full" data-preview-viewport>
              <div className="relative mx-auto" style={{ width: availableWidth > 0 ? widths[device] * scale : "100%", height: availableWidth > 0 ? 680 * scale : 0 }}>
                {availableWidth > 0 && <iframe title={copy("Full detail preview", "Tam detay önizlemesi")} sandbox="" referrerPolicy="no-referrer" srcDoc={currentResult.html} aria-describedby={scaleDescription}
                  onLoad={() => onReady(true)} className="absolute left-0 top-0 block border-0 bg-white" style={{ width: widths[device], minWidth: widths[device], height: 680, transform: `scale(${scale})`, transformOrigin: "top left" }} />}
              </div>
            </div>
          </div>
        </>}
  </section>;
}
