import { useEffect, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { programAdmissionsOpen } from "@/lib/programAdmissions";
import { PublicProgramCard } from "./PublicProgramCard";
import { PublicProgramDetailDialog, type PublicProgramDetailData } from "./PublicProgramDetailDialog";
import { PublicProgramFilters, type PublicProgramFacets, type PublicProgramSelection } from "./PublicProgramFilters";
import { detailCopy, displayTuition, splitRequirements, type DetailTuition } from "./detailPresentation";
import { DetailPrice } from "./DetailEditorial";
import { emptyProgramSelection, programPageNumbers, universityProgramQuery } from "./universityProgramQuery";

type ProgramRow = PublicProgramDetailData & { universityId: number; isActive?: boolean; universityIsActive?: boolean; tuition?: DetailTuition | null };
type Results = { data: ProgramRow[]; meta: { total: number; totalPages: number } };
const emptyFacets: PublicProgramFacets = { countries: [], cities: [], universities: [], universityTypes: [], degrees: [], languages: [], fields: [], feeRange: null };

/** Full server-paged discovery inside one university, not the 12 related links. */
export function UniversityProgramBrowser({ universityId, admissionsOpen }: { universityId: number; admissionsOpen: boolean }) {
  const { t, lang, localePath } = useI18n();
  const [selection, setSelection] = useState(emptyProgramSelection);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [facets, setFacets] = useState(emptyFacets);
  const [result, setResult] = useState<Results>({ data: [], meta: { total: 0, totalPages: 0 } });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [detailProgram, setDetailProgram] = useState<ProgramRow | null>(null);
  const query = universityProgramQuery(universityId, lang, search, selection);
  const [settledQuery, setSettledQuery] = useState(query);
  useEffect(() => { const timer = setTimeout(() => setSettledQuery(query), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    Promise.all([
      customFetch<Results>(`/api/course-finder?${settledQuery}&page=${page}&limit=24`, { method: "GET", signal: controller.signal }),
      customFetch<PublicProgramFacets>(`/api/course-finder/filters?${settledQuery}`, { method: "GET", signal: controller.signal }),
    ]).then(([next, options]) => {
      if (controller.signal.aborted) return;
      // A misconfigured/unexpected response must not widen the university scope.
      if (next.data.some(program => program.universityId !== universityId)) throw new Error("University scope mismatch");
      setResult(next); setFacets(options);
    }).catch(() => { if (!controller.signal.aborted) { setFailed(true); setResult({ data: [], meta: { total: 0, totalPages: 0 } }); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [settledQuery, page, universityId, attempt]);
  const busy = loading || query !== settledQuery;
  const clear = () => { setSelection(emptyProgramSelection()); setSearch(""); setPage(1); };
  const changeSelection = (key: keyof PublicProgramSelection, value: string | string[]) => {
    if (!["level", "language", "field", "feeMin", "feeMax"].includes(key)) return;
    setSelection(current => ({ ...current, [key]: value })); setPage(1);
  };
  return <div className="university-program-browser" role="region" aria-label={t("catalogDetail.availablePrograms")}>
    <PublicProgramFilters filters={facets} selection={selection} onSelect={changeSelection} onFeeChange={changeSelection}
      search={search} onSearchChange={value => { setSearch(value); setPage(1); }} onClear={clear} total={result.meta.total} universityLocked feeHint={detailCopy(lang).legacyPrice} />
    <div className="flex items-center gap-3 my-6 bg-card/60 rounded-2xl px-6 py-4 border border-border/30 shadow-sm" role="status" aria-live="polite">
      <BookOpen className="w-4 h-4 text-primary" aria-hidden="true" />
      {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-label={t("common.loading")} /> : <p className="text-muted-foreground">{failed ? t("common.error") : t("programs.showingResults", { count: String(result.meta.total) })}</p>}
    </div>
    {failed && !busy ? <div className="text-center py-12" role="alert"><p className="mb-4">{t("common.error")}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{t("common.retry")}</Button></div>
      : busy ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true">{[0, 1, 2].map(key => <div key={key} className="h-72 rounded-2xl bg-secondary animate-pulse" />)}</div>
      : result.data.length === 0 ? <div className="text-center py-16 bg-card rounded-2xl border border-border/30"><h3 className="text-xl font-bold mb-2">{t("programs.noResults")}</h3><p className="text-muted-foreground mb-6">{t("programs.noResultsDesc")}</p><Button variant="outline" onClick={clear}>{t("programs.clearFilters")}</Button></div>
      : <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">{result.data.map((program, index) => <PublicProgramCard key={program.id} program={program} index={index}
        onDetails={() => setDetailProgram({ ...program, requirements: splitRequirements(program.requirements, { canonicalPath: program.canonicalPath, id: program.id }).requirements.join("\n") })}
        applyHref={`${localePath("/programs")}?programId=${program.id}`} applyDisabled={!admissionsOpen || !programAdmissionsOpen(program)} omitLegacyTiming
        tuitionContent={<div className="university-program-tuition"><p className="text-[10px] text-muted-foreground mb-1.5">{t("courseFinderPage.tuitionFee")}</p><DetailPrice tuition={displayTuition({ ...program, tuition: program.tuition ?? null }, lang)} locale={lang} verifiedLabel={t("catalogDetail.verifiedPrice")} /></div>} />)}</div>}
    {!failed && result.meta.totalPages > 1 && <nav aria-label={t("catalogDetail.availablePrograms")} className="flex flex-wrap items-center justify-center gap-1.5 mt-10">
      <Button variant="outline" size="icon" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-full w-10 h-10" aria-label={t("programs.prevPage")}><ChevronLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" /></Button>
      {programPageNumbers(page, result.meta.totalPages).map((number, index) => number === "..." ? <span key={`dots-${index}`} aria-hidden="true">…</span> : <button key={number} type="button" disabled={busy} onClick={() => setPage(number)} aria-label={t("programs.goToPage", { page: String(number) })} aria-current={number === page ? "page" : undefined} className={`w-10 h-10 rounded-full text-sm font-semibold ${number === page ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:bg-secondary"}`}>{number}</button>)}
      <Button variant="outline" size="icon" disabled={busy || page >= result.meta.totalPages} onClick={() => setPage(value => value + 1)} className="rounded-full w-10 h-10" aria-label={t("programs.nextPage")}><ChevronRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" /></Button>
    </nav>}
    <PublicProgramDetailDialog open={!!detailProgram} onClose={() => setDetailProgram(null)} program={detailProgram} omitLegacyTiming
      tuitionContent={detailProgram ? <div className="university-program-tuition"><p className="text-[10px] text-muted-foreground mb-1.5">{t("courseFinderPage.tuitionFee")}</p><DetailPrice tuition={displayTuition({ ...detailProgram, tuition: detailProgram.tuition ?? null }, lang)} locale={lang} verifiedLabel={t("catalogDetail.verifiedPrice")} /></div> : null} />
  </div>;
}
