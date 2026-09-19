import type { ReactNode } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Award, BookOpen, Building2, Calendar, Clock, Globe2, GraduationCap, Info, Languages, MapPin, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { normalizeCurrency } from "@/lib/currency";

/** Only the public fields rendered by the shared catalogue card. */
export interface PublicProgramCardData {
  id: number;
  name: string;
  canonicalPath: string;
  universityName: string;
  universityPath: string;
  universityCity?: string | null;
  universityCountry?: string | null;
  universityType?: string | null;
  universityLogoUrl?: string | null;
  universityWebsite?: string | null;
  degree?: string | null;
  field?: string | null;
  language?: string | null;
  duration?: string | null;
  intakes?: string | null;
  tuitionFee?: number | null;
  discountedFee?: number | null;
  scholarship?: number | null;
  depositFee?: number | null;
  languageFee?: number | null;
  currency?: string | null;
  feeType?: string | null;
}

export interface PublicProgramCardProps {
  program: PublicProgramCardData;
  index: number;
  onApply?: () => void;
  onDetails?: () => void;
  applyHref?: string;
  applyDisabled?: boolean;
  /** An explicit slot (including null) replaces every legacy fee decoration. */
  tuitionContent?: ReactNode;
  omitLegacyTiming?: boolean;
}

const BASE_URL = import.meta.env?.BASE_URL?.replace(/\/$/, "") || "";

function formatFee(fee: number | null | undefined, currency: string | null | undefined): string {
  if (!fee) return "";
  const cur = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(fee);
  } catch {
    return `${fee} ${cur}`;
  }
}

function safePublicPath(value: string | null | undefined): string | null {
  if (!value || !/^\/(?!\/)/.test(value) || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  return value;
}

function safeWebsite(value: string | null | undefined): string | null {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? value : null;
  } catch {
    return null;
  }
}

function fixStorageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const fixed = url.replace(/\/api\/storage\/objects\/objects\//, "/api/storage/objects/");
  if (/^https?:\/\//i.test(fixed)) return safeWebsite(fixed);
  if (/^[a-z][a-z\d+.-]*:/i.test(fixed) || fixed.startsWith("//")) return null;
  const path = !fixed.startsWith("/") ? `${BASE_URL}/${fixed}`
    : BASE_URL && fixed !== BASE_URL && !fixed.startsWith(`${BASE_URL}/`) ? `${BASE_URL}${fixed}` : fixed;
  return safePublicPath(path);
}

const detailsClassName = "w-9 h-9 rounded-full border-2 border-border/60 flex items-center justify-center text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all shrink-0";
const applyClassName = "flex-1 min-w-0 rounded-xl font-bold shadow-md shadow-primary/10 hover:shadow-lg hover:shadow-primary/20 transition-all duration-300";

export function PublicProgramCard({ program: prog, index, onApply, onDetails, applyHref, applyDisabled = false, tuitionContent, omitLegacyTiming = false }: PublicProgramCardProps) {
  const { t } = useI18n();
  const effectiveFee = prog.discountedFee ?? prog.tuitionFee;
  const hasDiscount = !!(prog.discountedFee && prog.tuitionFee && prog.discountedFee < prog.tuitionFee);
  const hasTuitionOverride = tuitionContent !== undefined;
  const logoSrc = fixStorageUrl(prog.universityLogoUrl);
  const universityWebsite = safeWebsite(prog.universityWebsite);
  const universityPath = safePublicPath(prog.universityPath);
  const programPath = safePublicPath(prog.canonicalPath);
  const applicationPath = safePublicPath(applyHref);
  const applicationDisabled = applyDisabled || (!onApply && !applicationPath);
  const logo = <>
    {logoSrc ? (
      <img src={logoSrc} alt={prog.universityName} className="w-full h-full object-contain p-0.5" loading="lazy"
        onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.nextElementSibling?.classList.remove("hidden"); }}
      />
    ) : null}
    <Building2 className={`w-5 h-5 text-muted-foreground ${logoSrc ? "hidden" : ""}`} aria-hidden="true" />
  </>;
  const title = <h3 className="font-bold text-foreground text-[15px] leading-snug line-clamp-2 break-words group-hover:text-primary transition-colors duration-200"><bdi>{prog.name}</bdi></h3>;
  const applyLabel = <>{t("courseFinderPage.apply")} <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span></>;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.04, duration: 0.4 }}
      className="public-program-card group min-w-0 bg-card rounded-2xl overflow-hidden shadow-md shadow-black/[0.04] hover:-translate-y-1.5 hover:shadow-xl hover:shadow-primary/[0.08] transition-all duration-300 border border-border/40 hover:border-primary/20 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-card">
        {universityWebsite ? (
          <a href={universityWebsite} target="_blank" rel="noopener noreferrer" aria-label={prog.universityName}
            className="w-10 h-10 rounded-xl border border-border/60 bg-background flex items-center justify-center shrink-0 overflow-hidden hover:border-primary/40 hover:scale-105 transition-all cursor-pointer"
            onClick={(event) => event.stopPropagation()}>{logo}</a>
        ) : (
          <div className="w-10 h-10 rounded-xl border border-border/60 bg-background flex items-center justify-center shrink-0 overflow-hidden">{logo}</div>
        )}
        <div className="min-w-0 flex-1">
          {universityPath ? (
            <Link href={universityPath} className="block truncate text-[12px] font-bold leading-tight text-foreground/80 hover:text-primary hover:underline"><bdi>{prog.universityName}</bdi></Link>
          ) : (
            <span className="block truncate text-[12px] font-bold leading-tight text-foreground/80"><bdi>{prog.universityName}</bdi></span>
          )}
          {(prog.universityCity || prog.universityCountry) && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
              <MapPin className="w-3 h-3 shrink-0 text-primary/60" aria-hidden="true" />
              <span className="truncate"><bdi>{[prog.universityCity, prog.universityCountry].filter(Boolean).join(", ")}</bdi></span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 max-w-[40%]">
          {prog.universityType && (
            <Badge variant="outline" className="text-[10px] px-2 py-0 h-[18px] font-medium max-w-full"><bdi className="truncate">{prog.universityType}</bdi></Badge>
          )}
          {prog.degree && (
            <Badge className="text-[10px] px-2 py-0 h-[18px] bg-primary text-primary-foreground font-medium max-w-full"><bdi className="truncate">{prog.degree}</bdi></Badge>
          )}
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-3 min-w-0">
        {programPath ? <Link href={programPath} className="block">{title}</Link> : title}

        {hasTuitionOverride ? tuitionContent : effectiveFee != null && (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-muted-foreground mb-1.5">
                {t("courseFinderPage.tuitionFee")}{prog.feeType ? <> (<bdi>{prog.feeType}</bdi>)</> : ""}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[22px] font-extrabold leading-none tracking-tight"><bdi>{formatFee(effectiveFee, prog.currency)}</bdi></span>
                {hasDiscount && (
                  <span className="text-sm text-muted-foreground/50 line-through leading-none"><bdi>{formatFee(prog.tuitionFee, prog.currency)}</bdi></span>
                )}
                {hasDiscount && (
                  <Badge className="bg-emerald-500 text-white text-[10px] font-bold rounded-full border-0 px-2 py-0 h-[18px]">
                    <bdi>{Math.round(((prog.tuitionFee! - prog.discountedFee!) / prog.tuitionFee!) * 100)}% OFF</bdi>
                  </Badge>
                )}
              </div>
            </div>
            {prog.scholarship != null && prog.scholarship > 0 && (
              <div className="shrink-0 border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl px-3 py-2 text-center min-w-[76px]">
                <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mx-auto" aria-hidden="true" />
                <p className="text-[9px] text-muted-foreground font-medium mt-0.5">{t("courseFinderPage.scholarship")}:</p>
                <p className="text-[13px] font-extrabold text-emerald-700 dark:text-emerald-400 leading-tight"><bdi>{formatFee(prog.scholarship, prog.currency)}</bdi></p>
              </div>
            )}
          </div>
        )}

        {!hasTuitionOverride && prog.depositFee != null && prog.depositFee > 0 && (
          <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-700/30 rounded-lg px-3 py-2 text-[11px] text-indigo-700 dark:text-indigo-400 font-medium">
            <Shield className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{t("courseFinderPage.depositStrip", { fee: formatFee(prog.depositFee, prog.currency) })}</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 bg-muted/40 rounded-xl p-3">
          {prog.degree && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium"><GraduationCap className="w-3 h-3 text-violet-500 shrink-0" aria-hidden="true" />{t("courseFinderPage.degree")}</span>
              <span className="text-[11px] font-bold truncate"><bdi>{prog.degree}</bdi></span>
            </div>
          )}
          {prog.field && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium"><BookOpen className="w-3 h-3 text-orange-500 shrink-0" aria-hidden="true" />{t("courseFinderPage.field")}</span>
              <span className="text-[11px] font-bold truncate"><bdi>{prog.field}</bdi></span>
            </div>
          )}
          {prog.language && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium"><Languages className="w-3 h-3 text-blue-500 shrink-0" aria-hidden="true" />{t("courseFinderPage.language")}</span>
              <span className="text-[11px] font-bold truncate"><bdi>{prog.language}</bdi></span>
            </div>
          )}
          {prog.duration && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium"><Clock className="w-3 h-3 text-green-500 shrink-0" aria-hidden="true" />{t("courseFinderPage.duration")}</span>
              <span className="text-[11px] font-bold truncate"><bdi>{prog.duration}</bdi></span>
            </div>
          )}
          {!omitLegacyTiming && prog.intakes && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium"><Calendar className="w-3 h-3 text-indigo-500 shrink-0" aria-hidden="true" />{t("courseFinderPage.intakes")}</span>
              <span className="text-[11px] font-bold truncate"><bdi>{prog.intakes}</bdi></span>
            </div>
          )}
          {!hasTuitionOverride && prog.languageFee != null && prog.languageFee > 0 && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium"><Globe2 className="w-3 h-3 text-pink-500 shrink-0" aria-hidden="true" />{t("courseFinderPage.languageFee")}</span>
              <span className="text-[11px] font-bold truncate"><bdi>{formatFee(prog.languageFee, prog.currency)}</bdi></span>
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          {onDetails ? (
            <button type="button" onClick={onDetails} className={detailsClassName} aria-label={t("programs.programDetails")}><Info className="w-4 h-4" aria-hidden="true" /></button>
          ) : programPath ? (
            <Link href={programPath} className={detailsClassName} aria-label={t("programs.programDetails")}><Info className="w-4 h-4" aria-hidden="true" /></Link>
          ) : (
            <button type="button" disabled className={`${detailsClassName} opacity-50`} aria-label={t("programs.programDetails")}><Info className="w-4 h-4" aria-hidden="true" /></button>
          )}
          {!applicationDisabled && !onApply && applicationPath ? (
            <Button asChild className={applyClassName}><Link href={applicationPath}>{applyLabel}</Link></Button>
          ) : (
            <Button type="button" disabled={applicationDisabled} onClick={onApply} className={applyClassName}>{applyLabel}</Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
