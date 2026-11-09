/** Pure, conservative display helpers. These never create catalogue facts. */
import { DETAIL_PRESENTATION_LOCALES } from "./detailPresentationLocales";
export { cityHeroCopy } from "./detailPresentationLocales";
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

const CATALOGUE_COUNT_QUALIFIER = /catalog(?:ue)?|katalog|каталог|目录|कैटलॉग|کیٹلاگ|феҳрист|ক্যাটালগ|catálogo|к्याटलग|danh mục|카탈로그/iu;
/** Removes the old catalogue-qualified count labels while preserving deliberate custom labels. */
export function detailCountLabel(value: string | null | undefined, fallback: string): string {
  const label = value?.trim();
  return label && !CATALOGUE_COUNT_QUALIFIER.test(label) ? label : fallback;
}

export type RequirementMetadata = { key: "country" | "campus" | "mode"; value: string };
export function splitRequirements(value: string | null | undefined, context?: { canonicalPath?: string; id?: number }): { requirements: string[]; metadata: RequirementMetadata[] } {
  const slug = context?.canonicalPath?.split("?")[0].replace(/\/$/, "").split("/").pop();
  const exactSlug = slug && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(slug) ? slug : null;
  const withoutId = exactSlug && Number.isSafeInteger(context?.id) && exactSlug.endsWith(`-${context!.id}`) ? exactSlug.slice(0, -String(context!.id).length - 1) : null;
  const requirements: string[] = [], metadata: RequirementMetadata[] = [];
  for (const part of (value || "").split(/\s*\|\s*|\r?\n/).map(item => item.trim()).filter(Boolean)) {
    if (part === exactSlug || part === withoutId) continue;
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

export function localizedCountryName(name: string, countryCode: string | null | undefined, locale: string): string {
  const code = countryCode?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return name;
  try { return new Intl.DisplayNames([locale], { type: "region" }).of(code) || name; }
  catch { return name; }
}

const LANGUAGE_CODES: Record<string, string> = {
  arabic: "ar", chinese: "zh", english: "en", french: "fr", german: "de", hindi: "hi", italian: "it",
  persian: "fa", portuguese: "pt", russian: "ru", spanish: "es", turkish: "tr",
};
export function localizedLanguageNames(values: readonly string[], locale: string): string {
  let display: Intl.DisplayNames;
  try { display = new Intl.DisplayNames([locale], { type: "language" }); }
  catch { return values.join(" · "); }
  return values.map(value => {
    const code = LANGUAGE_CODES[value.trim().toLowerCase()];
    if (!code) return value;
    try { return display.of(code) || value; }
    catch { return value; }
  }).join(" · ");
}

const UNIVERSITY_TYPE_LABELS: Record<string, Record<string, string>> = {
  public: { en: "Public", tr: "Devlet", ar: "حكومية", fr: "Publique", ru: "Государственный", fa: "دولتی", zh: "公立", hi: "सार्वजनिक", es: "Pública", id: "Negeri" },
  private: { en: "Private", tr: "Vakıf / Özel", ar: "خاصة", fr: "Privée", ru: "Частный", fa: "خصوصی", zh: "私立", hi: "निजी", es: "Privada", id: "Swasta" },
};
export function localizedUniversityType(value: string | null | undefined, locale: string): string | null {
  if (!value?.trim()) return null;
  return UNIVERSITY_TYPE_LABELS[value.trim().toLowerCase()]?.[locale] ?? UNIVERSITY_TYPE_LABELS[value.trim().toLowerCase()]?.en ?? value;
}

const TURKISH_NAME_PARTS: Record<string, string> = {
  istanbul: "İstanbul", izmir: "İzmir", eskisehir: "Eskişehir", duzce: "Düzce", canakkale: "Çanakkale",
  mugla: "Muğla", sanliurfa: "Şanlıurfa", kirikkale: "Kırıkkale", kahramanmaras: "Kahramanmaraş",
  diyarbakir: "Diyarbakır", balikesir: "Balıkesir", agri: "Ağrı", nigde: "Niğde", gumushane: "Gümüşhane",
  isik: "Işık", istinye: "İstinye", uskudar: "Üsküdar", acibadem: "Acıbadem", aydin: "Aydın",
};

function turkishNameSpelling(value: string): string {
  return value.split(/(\s+|-)/).map(part => TURKISH_NAME_PARTS[part.toLocaleLowerCase("en-US")] ?? part).join("");
}

/**
 * Localises only deterministic presentation terms. It never invents a translated
 * institution identity: outside Türkiye (or outside Turkish UI) the canonical
 * catalogue name is returned unchanged.
 */
export function localizedInstitutionName(name: string, country: string | null | undefined, locale: string): string {
  if (locale !== "tr" || !/^(?:turkey|türkiye)$/iu.test(country?.trim() ?? "")) return name;
  const distance = name.match(/\s*\(Distance Education\)\s*$/iu) ? " (Uzaktan Eğitim)" : "";
  const base = name.replace(/\s*\(Distance Education\)\s*$/iu, "").trim();
  const university = /\s+University$/iu.test(base)
    ? `${base.replace(/\s+University$/iu, "")} Üniversitesi`
    : base;
  return `${turkishNameSpelling(university)}${distance}`;
}

export function localizedCityName(name: string, country: string | null | undefined, locale: string): string {
  return locale === "tr" && /^(?:turkey|türkiye)$/iu.test(country?.trim() ?? "") ? turkishNameSpelling(name) : name;
}

const DEGREE_LABELS: Record<string, Record<string, string>> = {
  associate: { tr: "Ön Lisans", en: "Associate" }, bachelor: { tr: "Lisans", en: "Bachelor" },
  master: { tr: "Yüksek Lisans", en: "Master" }, doctorate: { tr: "Doktora", en: "Doctorate" },
  phd: { tr: "Doktora", en: "PhD" }, foundation: { tr: "Hazırlık", en: "Foundation" },
};
export function localizedDegreeName(value: string | null | undefined, locale: string): string | null {
  if (!value?.trim()) return null;
  return DEGREE_LABELS[value.trim().toLocaleLowerCase("en-US")]?.[locale] ?? value;
}

export const DETAIL_COPY = {
  ...DETAIL_PRESENTATION_LOCALES,
  en: { from: "From", institutionLocation: "Institution location", campus: "Campus", legacyPrice: "Listed tuition · confirmation required", confirmPrice: "Confirm tuition with an adviser", durationAsListed: "Duration · as listed", courseInformation: "Catalogue information", catalogueNote: "Details supplied in the catalogue. Confirm the campus, study mode and duration for your selected intake.", overview: "At a glance", studyOptions: "Explore your study options", catalogue: "Study catalogue", destination: "Study destination", city: "Student city", institution: "University profile", program: "Program guide", country: "Country", mode: "Study mode", intakes: "Intakes listed", decision: "Decision time listed", scrollTable: "Scroll to see all program details", unavailable: "Details are not available yet.", next: "Your next step", priceBasis: "The displayed amount follows the published fee basis; confirm any conditions before applying.", durationNote: "Multiple durations are listed. Confirm the duration for your chosen study mode and intake.", universityCount: "Universities", programCount: "Programs" },
  tr: { from: "Başlangıç", institutionLocation: "Kurumun konumu", campus: "Kampüs", legacyPrice: "Katalog ücreti · teyit gerekli", confirmPrice: "Öğrenim ücretini danışmana sorun", durationAsListed: "Süre · katalogdaki bilgi", courseInformation: "Katalog bilgileri", catalogueNote: "Katalogda verilen bilgilerdir. Seçtiğiniz dönem için kampüsü, eğitim şeklini ve süreyi teyit edin.", overview: "Bir bakışta", studyOptions: "Eğitim seçeneklerini keşfedin", catalogue: "Eğitim kataloğu", destination: "Eğitim destinasyonu", city: "Öğrenci şehri", institution: "Üniversite profili", program: "Program rehberi", country: "Ülke", mode: "Eğitim şekli", intakes: "Katalogdaki dönemler", decision: "Katalogdaki karar süresi", scrollTable: "Tüm program bilgileri için tabloyu kaydırın", unavailable: "Ayrıntılar henüz mevcut değil.", next: "Sonraki adımınız", priceBasis: "Gösterilen tutar yayımlanan ücret esasına göredir; başvurmadan önce koşulları teyit edin.", durationNote: "Birden fazla süre listeleniyor. Seçtiğiniz eğitim şekli ve dönem için süreyi teyit edin.", universityCount: "Üniversiteler", programCount: "Programlar" },
  ar: { from: "ابتداءً من", institutionLocation: "موقع المؤسسة", campus: "الحرم الجامعي", legacyPrice: "الرسوم المدرجة · يلزم التأكيد", confirmPrice: "تأكد من الرسوم مع المستشار", durationAsListed: "المدة · كما وردت", courseInformation: "معلومات الدليل", catalogueNote: "معلومات واردة في الدليل. تأكد من الحرم ونمط الدراسة والمدة للفصل الذي تختاره.", overview: "لمحة سريعة", studyOptions: "اكتشف خيارات الدراسة", catalogue: "دليل الدراسة", destination: "وجهة الدراسة", city: "مدينة طلابية", institution: "الجامعة", program: "دليل البرنامج", country: "البلد", mode: "نمط الدراسة", intakes: "الفصول المدرجة", decision: "مدة القرار المدرجة", scrollTable: "مرّر للاطلاع على جميع تفاصيل البرامج", unavailable: "التفاصيل غير متاحة بعد.", next: "خطوتك التالية", priceBasis: "يعتمد المبلغ المعروض على أساس الرسوم المنشور؛ تأكد من الشروط قبل التقديم.", durationNote: "توجد مدد متعددة. تأكد من مدة نمط الدراسة والفصل المختار.", universityCount: "الجامعات", programCount: "البرامج" },
} as const;
const PUBLIC_CATALOGUE_WORD = /catalog(?:ue)?|katalog|каталог|目录|कैटलॉग|کیٹلاگ|کاتالوگ|феҳрист|ফেহরিস্ত|ক্যাটালগ|catálogo|क्याटलग|danh mục|카탈로그/giu;
const publicFacingCopy = (value: string) => value.replace(PUBLIC_CATALOGUE_WORD, "").replace(/\s+([,.;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
export function detailCopy(locale: string) {
  const base = DETAIL_COPY[locale as keyof typeof DETAIL_COPY] || DETAIL_COPY.en;
  // “Catalogue” is an internal source concept, not visitor-facing copy. Use
  // the already-localised study/program labels and clean legacy saved phrases.
  return {
    ...base,
    legacyPrice: publicFacingCopy(base.legacyPrice) || base.confirmPrice,
    durationAsListed: publicFacingCopy(base.durationAsListed) || base.mode,
    courseInformation: base.program,
    catalogueNote: publicFacingCopy(base.durationNote),
    catalogue: base.studyOptions,
    intakes: publicFacingCopy(base.intakes),
    decision: publicFacingCopy(base.decision),
    durationNote: publicFacingCopy(base.durationNote),
  };
}
