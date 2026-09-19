import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, SlidersHorizontal, ChevronUp, ChevronDown, Globe2, MapPin, Building2, GraduationCap, BookOpen, Languages, Award, DollarSign, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { useI18n } from "@/hooks/use-i18n";

export type PublicProgramFacets = {
  countries: string[]; cities: string[]; universityTypes: string[];
  universities: { id: number; name: string }[];
  degrees: string[]; languages: string[]; fields: string[];
  feeRange: { min: number; max: number } | null;
};
export type PublicProgramSelection = {
  country: string[]; city: string[]; universityType: string[]; universityId: string[];
  level: string[]; language: string[]; field: string[]; feeMin: string; feeMax: string;
};
type MultiKey = Exclude<keyof PublicProgramSelection, "feeMin" | "feeMax">;

/** The existing public Programs controls, shared without owning query/business logic. */
export function PublicProgramFilters({ filters, selection, onSelect, onFeeChange, search, onSearchChange, onClear, total, universityLocked = false, feeHint }: {
  filters: PublicProgramFacets; selection: PublicProgramSelection;
  onSelect: (key: MultiKey, values: string[]) => void;
  onFeeChange: (key: "feeMin" | "feeMax", value: string) => void;
  search: string; onSearchChange: (value: string) => void;
  onClear: () => void; total: number; universityLocked?: boolean; feeHint?: string;
}) {
  const { t } = useI18n();
  const [showFilters, setShowFilters] = useState(false);
  const panelId = useId();
  const activeKeys: Array<keyof PublicProgramSelection> = universityLocked
    ? ["level", "language", "field", "feeMin", "feeMax"]
    : ["country", "city", "universityType", "universityId", "level", "language", "field", "feeMin", "feeMax"];
  const activeCount = activeKeys.filter(key => selection[key].length > 0).length;
  const hasFilters = activeCount > 0 || search.length > 0;
  const locationControls = [
    { key: "country", label: "programs.filterCountry", placeholder: "programs.allCountries", Icon: Globe2, options: filters.countries.map(value => ({ value, label: value })) },
    { key: "city", label: "programs.filterCity", placeholder: "programs.allCities", Icon: MapPin, options: filters.cities.map(value => ({ value, label: value })) },
    { key: "universityType", label: "programs.filterUniversityType", placeholder: "programs.allTypes", Icon: Building2, options: filters.universityTypes.map(value => ({ value, label: value })) },
    { key: "universityId", label: "programs.filterUniversity", placeholder: "programs.allUniversities", Icon: GraduationCap, options: filters.universities.map(u => ({ value: String(u.id), label: u.name })) },
  ] as const;
  const programControls = [
    { key: "level", label: "programs.filterLevel", placeholder: "programs.allLevels", Icon: BookOpen, options: filters.degrees.map(value => ({ value, label: value })) },
    { key: "language", label: "programs.filterLanguage", placeholder: "programs.allLanguages", Icon: Languages, options: filters.languages.map(value => ({ value, label: value })) },
    { key: "field", label: "programs.filterField", placeholder: "programs.allFields", Icon: Award, options: filters.fields.map(value => ({ value, label: value })) },
  ] as const;
  const control = (item: typeof locationControls[number] | typeof programControls[number]) => <div key={item.key} className="space-y-1.5 min-w-0" role="group" aria-label={t(item.label)}>
    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><item.Icon className="w-3 h-3" aria-hidden="true" />{t(item.label)}</span>
    <MultiSelectFilter values={selection[item.key]} onChange={values => onSelect(item.key, values)} options={item.options} placeholder={t(item.placeholder)} searchPlaceholder={t("programs.searchPlaceholder")} noResultsText={t("programs.noResults")} clearAllText={t("programs.clearFilters")} />
  </div>;
  return <div className="public-program-filters glass-card rounded-2xl p-6 relative z-20 shadow-lg shadow-primary/[0.03]">
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary/60" aria-hidden="true" />
        <Input value={search} onChange={e => onSearchChange(e.target.value)} placeholder={t("programs.searchPlaceholder")} aria-label={t("programs.searchPlaceholder")} className="ps-12 pe-4 h-12 text-base rounded-xl border-border/50 focus:border-primary bg-background/80 backdrop-blur-sm shadow-sm w-full" />
      </div>
      <button type="button" onClick={() => setShowFilters(value => !value)} aria-expanded={showFilters} aria-controls={panelId} aria-label={showFilters ? t("programs.lessFilters") : t("programs.moreFilters")}
        className={`inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl text-sm font-semibold transition-all duration-200 border shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${showFilters ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20 hover:bg-primary/90" : "bg-background/80 text-foreground border-border/50 hover:border-primary/40 hover:bg-primary/5 shadow-sm"}`}>
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" /><span>{showFilters ? t("programs.lessFilters") : t("programs.moreFilters")}</span>
        {activeCount > 0 && <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold ${showFilters ? "bg-white/25 text-primary-foreground" : "bg-primary text-primary-foreground"}`}>{activeCount}</span>}
        {showFilters ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
      </button>
    </div>
    <AnimatePresence initial={false}>{showFilters && <motion.div key="filter-panel" initial={{ opacity: 0, height: 0, overflow: "hidden" }} animate={{ opacity: 1, height: "auto", overflow: "visible" }} exit={{ opacity: 0, height: 0, overflow: "hidden" }} transition={{ duration: 0.25, ease: "easeInOut" }}>
      <div id={panelId} className="pt-5 space-y-4">
        <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
        {!universityLocked && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">{locationControls.map(control)}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
          {programControls.map(control)}
          <div className="space-y-1.5 min-w-0">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><DollarSign className="w-3 h-3" aria-hidden="true" />{t("programs.filterTuitionFee")}</span>
            <div className="flex items-center gap-2">
              <Input type="number" value={selection.feeMin} onChange={e => onFeeChange("feeMin", e.target.value)} placeholder={filters.feeRange?.min != null ? t("programs.feeMinValue", { value: String(filters.feeRange.min) }) : t("programs.feeMin")} aria-label={t("programs.feeMin")} className="h-10 rounded-xl border-border/50 bg-background/80 text-sm flex-1 min-w-0 hover:border-primary/40 transition-all" min="0" max={filters.feeRange?.max} />
              <span className="text-muted-foreground text-sm font-medium" aria-hidden="true">–</span>
              <Input type="number" value={selection.feeMax} onChange={e => onFeeChange("feeMax", e.target.value)} placeholder={filters.feeRange?.max != null ? t("programs.feeMaxValue", { value: String(filters.feeRange.max) }) : t("programs.feeMax")} aria-label={t("programs.feeMax")} className="h-10 rounded-xl border-border/50 bg-background/80 text-sm flex-1 min-w-0 hover:border-primary/40 transition-all" min="0" max={filters.feeRange?.max} />
            </div>
            {feeHint && <p className="text-[11px] text-muted-foreground leading-relaxed">{feeHint}</p>}
          </div>
        </div>
        {hasFilters && <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-1 border-t border-border/30">
          <div className="flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-primary" aria-hidden="true" /><p className="text-sm text-muted-foreground">{t("programs.showingResults", { count: String(total) })}</p></div>
          <button type="button" onClick={onClear} className="inline-flex items-center gap-1.5 text-sm text-destructive/80 hover:text-destructive font-semibold transition-colors bg-destructive/5 hover:bg-destructive/10 px-3 py-1.5 rounded-lg"><X className="w-3.5 h-3.5" aria-hidden="true" />{t("programs.clearFilters")}</button>
        </div>}
      </div>
    </motion.div>}</AnimatePresence>
  </div>;
}
