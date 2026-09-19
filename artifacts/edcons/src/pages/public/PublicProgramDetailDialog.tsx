import React, { useRef, type ReactNode } from "react";
import { Award, BookOpen, Clock, DollarSign, ExternalLink, GraduationCap, Languages, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/hooks/use-i18n";
import { normalizeCurrency } from "@/lib/currency";
import type { PublicProgramCardData } from "./PublicProgramCard";

export interface PublicProgramDetailData extends PublicProgramCardData {
  description?: string | null;
  requirements?: string | null;
  universityDescription?: string | null;
  universityRanking?: string | number | null;
  universityQsRanking?: string | number | null;
  universityTimesRanking?: string | number | null;
  applicationFee?: number | null;
  advancedFee?: number | null;
}

export interface PublicProgramDetailDialogProps {
  open: boolean;
  onClose: () => void;
  program: PublicProgramDetailData | null;
  /** An explicit slot, including null, replaces every legacy fee field. */
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
  return /^\/(?!\/)/.test(path) && !/[\\\u0000-\u0020\u007f]/.test(path) ? path : null;
}

/** The existing Programs information dialog, shared without route navigation. */
export function PublicProgramDetailDialog({ open, onClose, program, tuitionContent, omitLegacyTiming = false }: PublicProgramDetailDialogProps) {
  const { t, dir } = useI18n();
  const opener = useRef<HTMLElement | null>(null);
  if (!program) return null;
  const effectiveFee = program.discountedFee ?? program.tuitionFee;
  const hasDiscount = !!(program.discountedFee && program.tuitionFee && program.discountedFee < program.tuitionFee);
  const hasTuitionOverride = tuitionContent !== undefined;
  const logoSrc = fixStorageUrl(program.universityLogoUrl);
  const universityWebsite = safeWebsite(program.universityWebsite);

  const detailRows: { icon: ReactNode; label: string; value: string }[] = [];
  if (program.degree) detailRows.push({ icon: <GraduationCap className="w-4 h-4 text-primary" aria-hidden="true" />, label: t("apply.degree"), value: program.degree });
  if (program.field) detailRows.push({ icon: <Award className="w-4 h-4 text-violet-500" aria-hidden="true" />, label: t("apply.field"), value: program.field });
  if (program.language) detailRows.push({ icon: <Languages className="w-4 h-4 text-blue-500" aria-hidden="true" />, label: t("apply.language"), value: program.language });
  if (program.duration) detailRows.push({ icon: <Clock className="w-4 h-4 text-green-500" aria-hidden="true" />, label: t("programs.duration"), value: program.duration });
  if (!omitLegacyTiming && program.intakes) detailRows.push({ icon: <BookOpen className="w-4 h-4 text-orange-500" aria-hidden="true" />, label: t("apply.intakes"), value: program.intakes });
  if (!hasTuitionOverride) {
    if (program.feeType) detailRows.push({ icon: <DollarSign className="w-4 h-4 text-emerald-500" aria-hidden="true" />, label: t("apply.feeType"), value: program.feeType });
    if (program.applicationFee) detailRows.push({ icon: <DollarSign className="w-4 h-4 text-amber-500" aria-hidden="true" />, label: t("apply.applicationFee"), value: formatFee(program.applicationFee, program.currency) });
    if (program.depositFee) detailRows.push({ icon: <DollarSign className="w-4 h-4 text-cyan-500" aria-hidden="true" />, label: t("apply.depositFee"), value: formatFee(program.depositFee, program.currency) });
    if (program.advancedFee) detailRows.push({ icon: <DollarSign className="w-4 h-4 text-sky-500" aria-hidden="true" />, label: t("apply.advancedFee"), value: formatFee(program.advancedFee, program.currency) });
    if (program.languageFee) detailRows.push({ icon: <Languages className="w-4 h-4 text-indigo-500" aria-hidden="true" />, label: t("apply.languageFee"), value: formatFee(program.languageFee, program.currency) });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent dir={dir} className="public-program-detail-dialog w-[calc(100%_-_2rem)] max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden rtl:[&>button]:right-auto rtl:[&>button]:left-4"
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => {
          const target = opener.current;
          opener.current = null;
          if (target?.isConnected) { event.preventDefault(); target.focus({ preventScroll: true }); }
        }}>
        <DialogHeader className="text-start sm:text-start pe-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-primary/20">
              {logoSrc ? (
                <img src={logoSrc} alt={program.universityName} className="w-9 h-9 object-contain" loading="lazy"
                  onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.nextElementSibling?.classList.remove("hidden"); }} />
              ) : null}
              <GraduationCap className={`w-6 h-6 text-primary ${logoSrc ? "hidden" : ""}`} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg leading-tight break-words"><bdi>{program.name}</bdi></DialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5 break-words"><bdi>{program.universityName}</bdi></p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-2 min-w-0">
          {(program.universityCity || program.universityCountry) && <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4 text-primary/60 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words"><bdi>{[program.universityCity, program.universityCountry].filter(Boolean).join(", ")}</bdi></span>
          </div>}

          {hasTuitionOverride ? tuitionContent : (effectiveFee || program.scholarship) ? (
            <div className="bg-gradient-to-r from-primary/5 to-emerald-500/5 rounded-xl p-4 border border-primary/10">
              {effectiveFee ? (
                <div className="flex flex-wrap items-baseline gap-2 mb-1">
                  <span className="text-2xl font-bold text-foreground"><bdi>{formatFee(effectiveFee, program.currency)}</bdi></span>
                  {hasDiscount && <span className="text-sm line-through text-muted-foreground/50"><bdi>{formatFee(program.tuitionFee, program.currency)}</bdi></span>}
                  {hasDiscount && (
                    <Badge className="bg-emerald-500 text-white text-[10px] px-1.5 py-0"><bdi>{t("programs.percentOff", { percent: String(Math.round(((program.tuitionFee! - program.discountedFee!) / program.tuitionFee!) * 100)) })}</bdi></Badge>
                  )}
                </div>
              ) : null}
              {program.scholarship && program.scholarship > 0 ? (
                <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <Award className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="font-medium">{t("apply.scholarship")}: <bdi>{formatFee(program.scholarship, program.currency)}</bdi></span>
                </div>
              ) : null}
            </div>
          ) : null}

          {detailRows.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {detailRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2.5 bg-secondary/30 rounded-lg px-3 py-2.5 min-w-0">
                  <span className="shrink-0">{row.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold break-words">{row.label}</p>
                    <p className="text-sm font-medium text-foreground break-words"><bdi>{row.value}</bdi></p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {program.description && <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{t("common.description")}</p>
            <p className="text-sm text-foreground/80 whitespace-pre-line leading-relaxed break-words"><bdi>{program.description}</bdi></p>
          </div>}
          {program.requirements && <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{t("programs.requirements")}</p>
            <p className="text-sm text-foreground/80 whitespace-pre-line leading-relaxed break-words"><bdi>{program.requirements}</bdi></p>
          </div>}
          {program.universityDescription && <div className="space-y-1.5 pt-2 border-t border-border/30">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{t("apply.universityInfo")}</p>
            <p className="text-sm text-foreground/80 leading-relaxed line-clamp-4 break-words"><bdi>{program.universityDescription}</bdi></p>
          </div>}

          {(program.universityRanking || program.universityQsRanking || program.universityTimesRanking) && <div className="flex flex-wrap gap-2">
            {program.universityRanking && <Badge variant="outline" className="text-xs gap-1"><Award className="w-3 h-3" aria-hidden="true" /><bdi>{t("programs.ranking", { value: program.universityRanking })}</bdi></Badge>}
            {program.universityQsRanking && <Badge variant="outline" className="text-xs gap-1"><bdi>{t("programs.qsRanking", { value: program.universityQsRanking })}</bdi></Badge>}
            {program.universityTimesRanking && <Badge variant="outline" className="text-xs gap-1"><bdi>{t("programs.timesRanking", { value: program.universityTimesRanking })}</bdi></Badge>}
          </div>}

          {universityWebsite && <a href={universityWebsite} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors">
            <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />{t("programs.visitUniversity")}
          </a>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
