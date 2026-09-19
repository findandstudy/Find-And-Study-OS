/** Pure, conservative display helpers. These never create catalogue facts. */
import { DETAIL_PRESENTATION_LOCALES } from "./detailPresentationLocales";
export type DetailTuition = { amount: number; currency: string; verified: boolean; source: "verified" | "legacy"; frequency: string | null; isFrom?: boolean };

export function detailMoney(amount: number | null | undefined, currency: string | null | undefined, locale: string): string | null {
  const code = currency?.trim().toUpperCase();
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || !code || !/^[A-Z]{3}$/.test(code)) return null;
  // Intl accepts invented three-letter codes; reject them when the runtime has
  // the ISO list. The server projection is the authority for older runtimes.
  if (typeof Intl.supportedValuesOf === "function" && !Intl.supportedValuesOf("currency").includes(code)) return null;
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(amount); }
  catch { return null; }
}

export function displayTuition(row: { tuition?: DetailTuition | null; tuitionFee?: number | null; discountedFee?: number | null; currency?: string | null }, locale: string): DetailTuition | null {
  // An explicit null from the new API must not revive a rejected legacy value.
  if (row.tuition !== undefined) return row.tuition && detailMoney(row.tuition.amount, row.tuition.currency, locale) ? row.tuition : null;
  const amount = row.discountedFee ?? row.tuitionFee;
  return detailMoney(amount, row.currency, locale) ? { amount: amount!, currency: row.currency!.trim().toUpperCase(), verified: false, source: "legacy", frequency: null } : null;
}

export function tuitionOffer(tuition: DetailTuition | null, admissionsOpen: boolean) {
  return tuition && admissionsOpen && tuition.verified === true && tuition.source === "verified" && tuition.isFrom !== true
    && detailMoney(tuition.amount, tuition.currency, "en")
    ? { "@type": "Offer" as const, price: tuition.amount, priceCurrency: tuition.currency }
    : undefined;
}

export function durationIsAmbiguous(value: string | null | undefined): boolean {
  return !!value && /\d[^/|]*[/|][^/|]*\d/.test(value);
}

export function catalogueCount(value: unknown, label: string): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? `${value} ${label}` : null;
}

export type RequirementMetadata = { key: "country" | "campus" | "mode"; value: string };
export function splitRequirements(value: string | null | undefined): { requirements: string[]; metadata: RequirementMetadata[] } {
  const requirements: string[] = [], metadata: RequirementMetadata[] = [];
  for (const part of (value || "").split(/\s*\|\s*|\r?\n/).map(item => item.trim()).filter(Boolean)) {
    const match = /^([^:]{1,40}):\s*(.+)$/.exec(part);
    const key = match?.[1].trim().toLowerCase().replace(/\s+/g, " ");
    // Importer references are not student admission requirements or evidence.
    if (key && /^(edvoy(?: ref(?:erence)?)?|source(?: url| ref(?:erence)?)?|import(?: ref(?:erence)?)?)$/.test(key)) continue;
    // Import timing can be stale; only governed active intake records supply it.
    if (key && /^(intakes?(?: years?)?|(?:application )?deadline|offer turnaround|decision time)$/.test(key)) continue;
    const mapping: Record<string, RequirementMetadata["key"]> = { country: "country", campus: "campus", mode: "mode", "study mode": "mode" };
    const mapped = key ? mapping[key] : undefined;
    if (mapped && match) metadata.push({ key: mapped, value: match[2] });
    else requirements.push(part);
  }
  return { requirements, metadata };
}

export function localDetailPath(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\/[a-z]{2}\/[a-z0-9/_-]+(?:\?[a-zA-Z0-9%=&_-]+)?$/.test(value) ? value : null;
}

export const DETAIL_COPY = {
  ...DETAIL_PRESENTATION_LOCALES,
  en: { from: "From", institutionLocation: "Institution location", campus: "Campus", legacyPrice: "Listed tuition · confirmation required", confirmPrice: "Confirm tuition with an adviser", durationAsListed: "Duration · as listed", courseInformation: "Catalogue information", catalogueNote: "Details supplied in the catalogue. Confirm the campus, study mode and duration for your selected intake.", overview: "At a glance", studyOptions: "Explore your study options", catalogue: "Study catalogue", destination: "Study destination", city: "Student city", institution: "University profile", program: "Program guide", country: "Country", mode: "Study mode", intakes: "Intakes listed", decision: "Decision time listed", scrollTable: "Scroll to see all program details", unavailable: "Details are not available yet.", next: "Your next step", priceBasis: "The displayed amount follows the published fee basis; confirm any conditions before applying.", durationNote: "Multiple durations are listed. Confirm the duration for your chosen study mode and intake.", universityCount: "Universities in this catalogue", programCount: "Programs in this catalogue" },
  tr: { from: "Başlangıç", institutionLocation: "Kurumun konumu", campus: "Kampüs", legacyPrice: "Katalog ücreti · teyit gerekli", confirmPrice: "Öğrenim ücretini danışmana sorun", durationAsListed: "Süre · katalogdaki bilgi", courseInformation: "Katalog bilgileri", catalogueNote: "Katalogda verilen bilgilerdir. Seçtiğiniz dönem için kampüsü, eğitim şeklini ve süreyi teyit edin.", overview: "Bir bakışta", studyOptions: "Eğitim seçeneklerini keşfedin", catalogue: "Eğitim kataloğu", destination: "Eğitim destinasyonu", city: "Öğrenci şehri", institution: "Üniversite profili", program: "Program rehberi", country: "Ülke", mode: "Eğitim şekli", intakes: "Katalogdaki dönemler", decision: "Katalogdaki karar süresi", scrollTable: "Tüm program bilgileri için tabloyu kaydırın", unavailable: "Ayrıntılar henüz mevcut değil.", next: "Sonraki adımınız", priceBasis: "Gösterilen tutar yayımlanan ücret esasına göredir; başvurmadan önce koşulları teyit edin.", durationNote: "Birden fazla süre listeleniyor. Seçtiğiniz eğitim şekli ve dönem için süreyi teyit edin.", universityCount: "Katalogdaki üniversiteler", programCount: "Katalogdaki programlar" },
  ar: { from: "ابتداءً من", institutionLocation: "موقع المؤسسة", campus: "الحرم الجامعي", legacyPrice: "الرسوم المدرجة · يلزم التأكيد", confirmPrice: "تأكد من الرسوم مع المستشار", durationAsListed: "المدة · كما وردت", courseInformation: "معلومات الدليل", catalogueNote: "معلومات واردة في الدليل. تأكد من الحرم ونمط الدراسة والمدة للفصل الذي تختاره.", overview: "لمحة سريعة", studyOptions: "اكتشف خيارات الدراسة", catalogue: "دليل الدراسة", destination: "وجهة الدراسة", city: "مدينة طلابية", institution: "الجامعة", program: "دليل البرنامج", country: "البلد", mode: "نمط الدراسة", intakes: "الفصول المدرجة", decision: "مدة القرار المدرجة", scrollTable: "مرّر للاطلاع على جميع تفاصيل البرامج", unavailable: "التفاصيل غير متاحة بعد.", next: "خطوتك التالية", priceBasis: "يعتمد المبلغ المعروض على أساس الرسوم المنشور؛ تأكد من الشروط قبل التقديم.", durationNote: "توجد مدد متعددة. تأكد من مدة نمط الدراسة والفصل المختار.", universityCount: "الجامعات في هذا الدليل", programCount: "البرامج في هذا الدليل" },
} as const;
export function detailCopy(locale: string) { return DETAIL_COPY[locale as keyof typeof DETAIL_COPY] || DETAIL_COPY.en; }
