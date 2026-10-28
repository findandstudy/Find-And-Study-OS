import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  ArrowDown,
  ArrowUp,
  Database,
  ExternalLink,
  Sparkles,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LANGUAGE_META,
  translations as getTranslation,
  type Language,
} from "@/lib/i18n";
import { loadLanguage } from "@/lib/i18n/index";
import { useI18n } from "@/hooks/use-i18n";
import { DetailVariableInsertPanel } from "./DetailVariableInsertPanel";
import { useAuth } from "@/hooks/use-auth";
import {
  DETAIL_CONTENT_KEYS,
  DETAIL_CONTENT_LOCALES,
  DETAIL_GENERATED_CONTENT_KEYS,
  DETAIL_CONTENT_LAYOUT_KEYS,
  ensureDetailSeo,
  parseDetailContent,
  type DetailContent,
  type DetailContentKind,
  type DetailContentSection,
  type DetailHeroSettings,
  type DetailSeo,
} from "@/lib/website/detailContentContract";
import { DETAIL_LAYOUT_SECTIONS, DETAIL_TEMPLATE_VARIABLES } from "@/lib/website/detailLayoutContract";
import { cityHeroCopy, detailCopy } from "@/pages/public/detailPresentation";
import { detailTemplateLabel } from "./detailTemplateLabels";
import { DetailSectionAppearanceFields } from "./DetailSectionAppearanceFields";
import { translateStructuredDraft } from "./adminAiTranslation";
import { AiWritingAssistant } from "./AiWritingAssistant";
import { applyAiWritingField, collectAiWritingFields, detailAiPageFacts, detailAiWritingContext, type DetailAiPageFacts } from "./adminAiWriting";

export type DetailContentTarget = {
  kind: DetailContentKind;
  entityId: number;
  locale: string;
  title: string;
  sourceEditPath: string;
  canonicalPath?: string | null;
};
const DetailFullPreview = lazy(() => import("./DetailFullPreview"));
type SavedContent = {
  content: DetailContent;
  pageId: number | null;
  updatedAt: string | null;
  digest: string | null;
  published: DetailContent | null;
  editorContext?: Record<string, unknown> | null;
};
type Copy = (en: string, tr: string) => string;
type PendingAction =
  | { type: "close" }
  | { type: "locale"; locale: string }
  | { type: "reload" }
  | { type: "translation" }
  | { type: "remove"; key: string };
type HeroEditorContext = {
  effective: Partial<DetailHeroSettings>;
  facts: Array<{ label: string; value: string }>;
  title?: string;
  body?: string;
};

export const detailLayoutContentKey = (key: string) =>
  key.startsWith("editorial-") ? key.slice("editorial-".length) : key;
type BoundPreviewPayload = {
  binding: string;
  payload: Record<string, unknown>;
};

/**
 * Keep the last verified catalogue payload while the same page preview refreshes.
 * A different entity or locale must never inherit the previous page's facts.
 */
export function retainBoundPreviewPayload(
  current: BoundPreviewPayload | null,
  binding: string,
  payload: Record<string, unknown> | null,
): BoundPreviewPayload | null {
  if (payload) return { binding, payload };
  return current?.binding === binding ? current : null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(nonEmpty).filter((item): item is string => Boolean(item))
    : [];

/** Mirrors the values used by CityDetail without copying live catalogue facts into CMS. */
export function cityHeroEditorContext(
  payload: unknown,
  content: DetailContent | null,
  locale: string,
): HeroEditorContext | null {
  const root = asRecord(payload);
  const city = asRecord(root?.data);
  if (!city || !Number.isSafeInteger(city.id) || !nonEmpty(city.name))
    return null;
  const language = (locale in LANGUAGE_META ? locale : "en") as Language;
  const copy = detailCopy(language);
  const heroCopy = cityHeroCopy(language);
  const sectionTitle = (key: string, fallback: string) =>
    content?.sections.find((section) => section.key === key)?.title?.trim() ||
    fallback;
  const country = nonEmpty(city.country);
  const cityName = nonEmpty(city.name)!;
  const filterCountry = nonEmpty(city.filterCountry) || country || "";
  const filterCity = nonEmpty(city.filterCity) || cityName;
  const translated = (key: string, fallback: string) => {
    const value = getTranslation(language, key);
    return value === key ? fallback : value;
  };
  const effective: Partial<DetailHeroSettings> = {
    eyebrow: copy.city,
    primaryCtaLabel: translated(
      "countryDetail.viewAllPrograms",
      "View All Programs",
    ),
    primaryCtaHref: `/${language}/programs?country=${encodeURIComponent(filterCountry)}&city=${encodeURIComponent(filterCity)}`,
    secondaryCtaLabel: translated(
      "countryDetail.talkToAdvisor",
      "Talk to an Advisor",
    ),
    secondaryCtaHref: `/${language}/contact`,
    countryLabel: copy.country,
    universityCountLabel: copy.universityCount,
    programCountLabel: copy.programCount,
    programLanguagesLabel: sectionTitle("education", heroCopy.education),
    climateLabel: sectionTitle("climate", "Climate"),
    transportLabel: sectionTitle("transport", heroCopy.transport),
    campusGeographyLabel: sectionTitle("campus", heroCopy.campus),
    housingLabel: sectionTitle("housing", heroCopy.housing),
    backgroundColor: "#081727",
    overlayColor: "#040A16",
    overlayOpacity: 100,
    textColor: "#FFFFFF",
    accentColor: "#6EA8FF",
  };
  const external = asRecord(city.externalFacts);
  const formats = Array.isArray(external?.housingFormats)
    ? external.housingFormats
        .map((item) => nonEmpty(asRecord(item)?.name))
        .filter((item): item is string => Boolean(item))
    : [];
  const climate =
    nonEmpty(external?.climateSummary) ||
    (typeof external?.climateAnnualAverageC === "number" &&
    Number.isFinite(external.climateAnnualAverageC)
      ? `${external.climateAnnualAverageC}°C`
      : null);
  const facts: HeroEditorContext["facts"] = [];
  const add = (label: string | undefined, value: string | null) => {
    if (label && value) facts.push({ label, value });
  };
  add(effective.countryLabel as string, country);
  add(
    effective.universityCountLabel as string,
    Number.isSafeInteger(city.universityCount)
      ? Number(city.universityCount).toLocaleString(language)
      : null,
  );
  add(
    effective.programCountLabel as string,
    Number.isSafeInteger(city.programCount)
      ? Number(city.programCount).toLocaleString(language)
      : null,
  );
  add(
    effective.programLanguagesLabel as string,
    stringList(city.programLanguages).join(" · ") || null,
  );
  add(effective.climateLabel as string, climate);
  add(
    effective.transportLabel as string,
    stringList(city.transportModes).join(" · ") || null,
  );
  add(effective.campusGeographyLabel as string, nonEmpty(city.campusGeography));
  add(
    effective.housingLabel as string,
    nonEmpty(external?.housingSummary) || formats.join(" · ") || null,
  );
  return {
    effective,
    facts,
    title:
      content?.sections.find((section) => section.key === "hero")?.title ||
      cityName,
    body:
      content?.sections.find((section) => section.key === "hero")?.body ||
      nonEmpty(city.description) ||
      undefined,
  };
}

const heroAppearanceDefaults: Pick<
  DetailHeroSettings,
  | "backgroundColor"
  | "overlayColor"
  | "overlayOpacity"
  | "textColor"
  | "accentColor"
> = {
  backgroundColor: "#081727",
  overlayColor: "#040A16",
  overlayOpacity: 100,
  textColor: "#FFFFFF",
  accentColor: "#6EA8FF",
};

const translatedLabel = (language: Language, key: string, fallback: string) => {
  const value = getTranslation(language, key);
  return value === key ? fallback : value;
};

const editorSourceUrl = (payload: unknown, locale: string): string => {
  const root = asRecord(payload);
  const candidates = [
    asRecord(root?.data)?.website,
    asRecord(root?.destination)?.website,
    asRecord(root?.data)?.universityWebsite,
    root?.website,
  ];
  for (const candidate of candidates) {
    const url = nonEmpty(candidate);
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password)
          return parsed.toString();
      } catch {
        // Fall back to the canonical public catalogue below.
      }
    }
  }
  return `https://findandstudy.com/${locale}`;
};

const initialSectionBody = (
  key: string,
  title: string,
  entityName: string,
  description: string | null,
  locale: string,
) => {
  if ((key === "hero" || key === "overview") && description) return description;
  const tr = locale === "tr";
  const live = new Set([
    "navigation",
    "facts",
    "weather",
    "fees",
    "intakes",
    "related",
    "programs",
    "universities",
    "cities",
    "cta",
    "mobileActions",
  ]).has(key);
  if (live)
    return tr
      ? `${entityName} için ${title.toLocaleLowerCase("tr-TR")} bilgileri güncel kaynak kayıtlarıyla birlikte gösterilir.`
      : `${title} for ${entityName} is shown together with the current source records.`;
  return tr
    ? `${entityName} için ${title.toLocaleLowerCase("tr-TR")} bölümünü bu alandan düzenleyebilirsiniz.`
    : `Edit the ${title.toLocaleLowerCase("en-US")} section for ${entityName} from this page.`;
};

/**
 * Builds the complete editable page model from the bound public payload.
 * Existing CMS copy always wins; only missing template sections are initialized.
 */
export function hydrateDetailContentForEditor(
  content: DetailContent,
  payload: unknown,
  targetTitle: string,
  replaceKeys: ReadonlySet<string> = new Set(),
): DetailContent {
  const root = asRecord(payload);
  const entity = asRecord(
    content.kind === "destination" ? root?.destination : root?.data,
  );
  const entityName = nonEmpty(entity?.name) || targetTitle.trim() || `#${content.entityId}`;
  const description =
    nonEmpty(entity?.description) ||
    nonEmpty(entity?.shortDescription) ||
    nonEmpty(entity?.summary);
  const sourceUrl = editorSourceUrl(payload, content.locale);
  const metadata = asRecord(entity?.sourceMetadata);
  const sourceKeys: Record<string, string[]> = {
    hero: ["heroMedia", "name", "website"], overview: ["description", "shortDescription", "name"],
    facts: ["keyFacts", "name", "country", "city"], weather: ["climate"], climate: ["climate"],
    housing: ["housing"], fees: ["fees", "tuitionFee", "currency"], intakes: ["intakes", "intakeGuide"],
    admission: ["admission", "admissionProcess", "admissionRules"], requirements: ["requirements", "admissionRules"],
    programs: ["programs"], universities: ["universities"], cities: ["cities"], gallery: ["gallery"],
    services: ["services", "support"], education: ["education", "curriculum"], recognition: ["recognition"],
    living: ["living", "livingCost"], scholarships: ["scholarships"], faq: ["faq"],
  };
  const sourcesFor = (key: string) => {
    const rows = (sourceKeys[key] ?? [key]).flatMap((field) => {
      const entry = asRecord(metadata?.[field]);
      const url = nonEmpty(entry?.sourceUrl);
      if (!url || !/^https?:\/\//i.test(url)) return [];
      return [{ label: nonEmpty(entry?.sourceName) || (content.locale === "tr" ? "Resmî kaynak" : "Official source"), url }];
    });
    const unique = rows.filter((row, index) => rows.findIndex(candidate => candidate.url === row.url) === index).slice(0, 8);
    if (unique.length) return unique;
    return [{
      label: sourceUrl.includes("findandstudy.com")
        ? content.locale === "tr" ? "Find & Study kaynak kaydı" : "Find & Study source record"
        : content.locale === "tr" ? "Resmî web sitesi" : "Official website",
      url: sourceUrl,
    }];
  };
  const reviewedOn = new Date().toISOString().slice(0, 10);
  const existing = new Map(content.sections.map((section) => [section.key, section]));
  const heroContext = detailHeroEditorContext(
    content.kind,
    payload,
    content,
    content.locale,
  );
  const sections = DETAIL_CONTENT_KEYS[content.kind].map((key) => {
    const savedSection = existing.get(key);
    if (savedSection && !replaceKeys.has(key)) return savedSection;
    const layoutKey =
      DETAIL_CONTENT_LAYOUT_KEYS[content.kind].find(
        (candidate) => detailLayoutContentKey(candidate) === key,
      ) ?? key;
    const title =
      key === "hero"
        ? heroContext?.title || entityName
        : detailTemplateLabel(layoutKey, content.locale);
    const body =
      key === "hero"
        ? heroContext?.body || description || initialSectionBody(key, title, entityName, description, content.locale)
        : initialSectionBody(key, title, entityName, description, content.locale);
    const hero =
      key === "hero" && heroContext?.effective
        ? (Object.fromEntries(
            Object.entries(heroContext.effective).filter(
              ([, value]) => value !== undefined && value !== "",
            ),
          ) as DetailHeroSettings)
        : undefined;
    return {
      key,
      title,
      body,
      ...(hero && Object.keys(hero).length ? { hero } : {}),
      reviewedOn,
      sources: sourcesFor(key),
    } satisfies DetailContentSection;
  });
  return ensureDetailSeo({
    ...content,
    sectionOrder: [...DETAIL_CONTENT_LAYOUT_KEYS[content.kind]],
    sections,
  }, detailAiPageFacts(content.kind, payload, targetTitle));
}

/**
 * Exposes the exact catalogue/template values used by the public hero without
 * copying them into CMS. Editors see the real value first; changing a field
 * creates an explicit page override.
 */
export function detailHeroEditorContext(
  kind: DetailContentKind,
  payload: unknown,
  content: DetailContent | null,
  locale: string,
): HeroEditorContext | null {
  if (kind === "city") return cityHeroEditorContext(payload, content, locale);
  const root = asRecord(payload);
  const entity = asRecord(kind === "destination" ? root?.destination : root?.data);
  if (!entity || !nonEmpty(entity.name)) return null;
  const language = (locale in LANGUAGE_META ? locale : "en") as Language;
  const copy = detailCopy(language);
  const name = nonEmpty(entity.name)!;
  const heroSection = content?.sections.find((section) => section.key === "hero");
  const facts: HeroEditorContext["facts"] = [];
  const add = (label: string, value: unknown) => {
    const normalized =
      typeof value === "number" && Number.isFinite(value)
        ? value.toLocaleString(language)
        : nonEmpty(value);
    if (normalized) facts.push({ label, value: normalized });
  };
  const base = {
    ...heroAppearanceDefaults,
    countryLabel: copy.country,
    programCountLabel: copy.programCount,
    universityCountLabel: copy.universityCount,
  } satisfies Partial<DetailHeroSettings>;

  if (kind === "destination") {
    const stats = asRecord(root?.stats);
    const country = nonEmpty(entity.filterCountry) || nonEmpty(entity.country) || name;
    const cities = Array.isArray(root?.cities) ? root.cities : [];
    const effective: Partial<DetailHeroSettings> = {
      ...base,
      eyebrow: `${copy.destination} · 2026–27`,
      primaryCtaLabel: translatedLabel(
        language,
        "countryDetail.browsePrograms",
        "Browse Programs",
      ),
      primaryCtaHref: `/${language}/programs?country=${encodeURIComponent(country)}`,
      secondaryCtaLabel: translatedLabel(
        language,
        "countryDetail.talkToAdvisor",
        "Talk to an Advisor",
      ),
      secondaryCtaHref: `/${language}/contact`,
    };
    add(copy.country, name);
    add(copy.universityCount, stats?.universityCount);
    add(copy.programCount, stats?.programCount);
    add(translatedLabel(language, "countryDetail.language", "Language"), entity.language);
    add(translatedLabel(language, "countryDetail.currency", "Currency"), entity.currency);
    add(translatedLabel(language, "countryDetail.climate", "Climate"), entity.climate);
    if (cities.length)
      add(
        translatedLabel(language, "countryDetail.popularCities", "Popular Cities"),
        String(cities.length),
      );
    return {
      effective,
      facts,
      title: heroSection?.title || name,
      body:
        heroSection?.body ||
        nonEmpty(entity.shortDescription) ||
        nonEmpty(entity.description) ||
        undefined,
    };
  }

  if (kind === "university") {
    const meta = asRecord(root?.meta);
    const website = nonEmpty(entity.website);
    const effective: Partial<DetailHeroSettings> = {
      ...base,
      eyebrow: copy.institution,
      primaryCtaLabel: translatedLabel(
        language,
        "catalogDetail.availablePrograms",
        "Available Programs",
      ),
      primaryCtaHref: "#programs",
      secondaryCtaLabel: website
        ? translatedLabel(language, "programs.visitUniversity", "Visit University")
        : translatedLabel(language, "countryDetail.talkToAdvisor", "Talk to an Advisor"),
      secondaryCtaHref: website || `/${language}/contact`,
    };
    add(copy.country, entity.country);
    add(copy.institutionLocation, [nonEmpty(entity.city), nonEmpty(entity.country)].filter(Boolean).join(" · "));
    add(translatedLabel(language, "common.type", "Type"), entity.universityType);
    add(copy.programCount, meta?.programCount);
    add("QS", entity.qsRanking);
    add("Times", entity.timesRanking);
    return {
      effective,
      facts,
      title: heroSection?.title || name,
      body: heroSection?.body || nonEmpty(entity.description) || undefined,
    };
  }

  const universityId = Number(entity.universityId);
  const effective: Partial<DetailHeroSettings> = {
    ...base,
    eyebrow: copy.program,
    primaryCtaLabel: translatedLabel(language, "courseFinderPage.apply", "Apply Now"),
    primaryCtaHref: Number.isSafeInteger(universityId)
      ? `/${language}/programs?programId=${Number(entity.id)}`
      : `/${language}/programs`,
    secondaryCtaLabel: translatedLabel(
      language,
      "countryDetail.talkToAdvisor",
      "Talk to an Advisor",
    ),
    secondaryCtaHref: `/${language}/contact`,
  };
  add(copy.institution, entity.universityName);
  add(copy.institutionLocation, [nonEmpty(entity.universityCity), nonEmpty(entity.universityCountry)].filter(Boolean).join(" · "));
  add(translatedLabel(language, "courseFinderPage.degree", "Degree"), entity.degree);
  add(translatedLabel(language, "courseFinderPage.field", "Field"), entity.field);
  add(translatedLabel(language, "courseFinderPage.language", "Language"), entity.language);
  add(translatedLabel(language, "courseFinderPage.duration", "Duration"), entity.duration);
  add(copy.intakes, Array.isArray(root?.intakes) ? root.intakes.length : null);
  return {
    effective,
    facts,
    title: heroSection?.title || name,
    body: heroSection?.body || nonEmpty(entity.description) || undefined,
  };
}
const sectionLabels: Record<string, [string, string]> = {
  gallery: ["Gallery", "Galeri"],
  highlights: ["Highlights", "Öne çıkanlar"],
  cautions: ["Things to consider", "Dikkat edilmesi gerekenler"],
  curriculum: ["Curriculum", "Müfredat"],
  education: ["Education and faculties", "Eğitim ve fakülteler"],
  admission: ["Admission guidance", "Kabul rehberi"],
  scholarships: ["Scholarship guidance", "Burs rehberi"],
  living: ["Living and local context", "Yaşam ve yerel bilgiler"],
  campus: ["Campus", "Kampüs"],
  housing: ["Housing", "Konaklama"],
  services: ["Support services", "Destek hizmetleri"],
  recognition: ["Recognition and outcomes", "Tanınma ve sonuçlar"],
  climate: ["Weather and climate", "Hava durumu ve iklim"],
  transport: ["Transport", "Ulaşım"],
  visa: ["Visa and calendar", "Vize ve takvim"],
  intakeGuide: ["Intakes and calendar", "Başvuru dönemleri ve takvim"],
  support: ["Student support", "Öğrenci desteği"],
  reviews: ["Student reviews", "Öğrenci yorumları"],
  studentStory: ["Student experience", "Öğrenci deneyimi"],
  requirements: ["Requirements guidance", "Gereklilik rehberi"],
  faq: ["Frequently asked questions", "Sık sorulan sorular"],
  applyGuide: ["Application guide", "Başvuru rehberi"],
};

function TextField({
  label,
  value,
  onChange,
  maxLength,
  multiline = false,
  type = "text",
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  multiline?: boolean;
  type?: string;
  max?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <Textarea
          id={id}
          dir="auto"
          value={value}
          maxLength={maxLength}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          dir={type === "url" || type === "date" ? "ltr" : "auto"}
          type={type}
          max={max}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

const appendVariableToken = (value: string | undefined, token: string) => `${value?.trimEnd() ?? ""}${value?.trim() ? " " : ""}${token}`;

function RepeatFields<T extends object>({
  title,
  items,
  fields,
  create,
  onChange,
  limit,
  minimum = 0,
  copy,
}: {
  title: string;
  items: T[];
  fields: {
    key: Extract<keyof T, string>;
    label: string;
    max: number;
    multiline?: boolean;
    type?: string;
  }[];
  create: () => T;
  onChange: (items: T[]) => void;
  limit: number;
  minimum?: number;
  copy: Copy;
}) {
  return (
    <details
      className="rounded-lg border p-3"
      open={items.length > 0 || undefined}
    >
      <summary className="cursor-pointer font-medium">
        {title} · {items.length}/{limit}
      </summary>
      <div className="mt-3 space-y-3">
        {items.map((item, index) => (
          <fieldset
            key={index}
            className="space-y-3 rounded-lg bg-muted/40 p-3"
          >
            <legend className="px-1 text-sm">
              {title} {index + 1}
            </legend>
            {fields.map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                value={String(item[field.key] ?? "")}
                maxLength={field.max}
                multiline={field.multiline}
                type={field.type}
                onChange={(value) =>
                  onChange(
                    items.map((entry, i) =>
                      i === index ? { ...entry, [field.key]: value } : entry,
                    ),
                  )
                }
              />
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={items.length <= minimum}
              aria-label={`${copy("Remove", "Kaldır")}: ${title} ${index + 1}`}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 className="me-1 h-4 w-4" />
              {copy("Remove", "Kaldır")}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={items.length >= limit}
          onClick={() => onChange([...items, create()])}
        >
          <Plus className="me-1 h-4 w-4" />
          {copy("Add", "Ekle")}: {title}
        </Button>
      </div>
    </details>
  );
}

function TableFields({
  value,
  onChange,
  copy,
}: {
  value: DetailContentSection["table"];
  onChange: (table: DetailContentSection["table"]) => void;
  copy: Copy;
}) {
  const title = copy("Table", "Tablo");
  if (!value)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ columns: ["", ""], rows: [["", ""]] })}
      >
        <Plus className="me-1 h-4 w-4" />
        {copy("Add table", "Tablo ekle")}
      </Button>
    );
  return (
    <details open className="rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">
        {title} · {value.columns.length}/6 · {value.rows.length}/20
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          {copy(
            "Up to 6 columns and 20 rows. Every cell is required. Do not duplicate catalogue tuition or intake data here.",
            "En fazla 6 sütun ve 20 satır. Her hücre zorunludur. Katalog ücret ve başvuru dönemi verilerini buraya kopyalamayın.",
          )}
        </p>
        {value.columns.map((column, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <TextField
                label={`${copy("Column", "Sütun")} ${index + 1}`}
                value={column}
                maxLength={160}
                onChange={(text) =>
                  onChange({
                    ...value,
                    columns: value.columns.map((v, i) =>
                      i === index ? text : v,
                    ),
                  })
                }
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={value.columns.length <= 1}
              aria-label={`${copy("Remove column", "Sütunu kaldır")} ${index + 1}`}
              onClick={() =>
                onChange({
                  columns: value.columns.filter((_, i) => i !== index),
                  rows: value.rows.map((row) =>
                    row.filter((_, i) => i !== index),
                  ),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.columns.length >= 6}
          onClick={() =>
            onChange({
              columns: [...value.columns, ""],
              rows: value.rows.map((row) => [...row, ""]),
            })
          }
        >
          {copy("Add column", "Sütun ekle")}
        </Button>
        {value.rows.map((row, index) => (
          <fieldset
            key={index}
            className="grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2"
          >
            <legend className="px-1 text-sm">
              {copy("Row", "Satır")} {index + 1}
            </legend>
            {row.map((cell, column) => (
              <TextField
                key={column}
                label={
                  value.columns[column] ||
                  `${copy("Column", "Sütun")} ${column + 1}`
                }
                value={cell}
                maxLength={500}
                onChange={(text) =>
                  onChange({
                    ...value,
                    rows: value.rows.map((r, i) =>
                      i === index
                        ? r.map((v, j) => (j === column ? text : v))
                        : r,
                    ),
                  })
                }
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={value.rows.length <= 1}
              onClick={() =>
                onChange({
                  ...value,
                  rows: value.rows.filter((_, i) => i !== index),
                })
              }
            >
              {copy("Remove row", "Satırı kaldır")} {index + 1}
            </Button>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={value.rows.length >= 20}
            onClick={() =>
              onChange({
                ...value,
                rows: [...value.rows, value.columns.map(() => "")],
              })
            }
          >
            {copy("Add row", "Satır ekle")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(undefined)}
          >
            {copy("Remove table", "Tabloyu kaldır")}
          </Button>
        </div>
      </div>
    </details>
  );
}

function EvidenceFields({
  section,
  patch,
  copy,
}: {
  section: DetailContentSection;
  patch: (value: Partial<DetailContentSection>) => void;
  copy: Copy;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 p-3">
      <p className="text-sm font-medium">
        {copy(
          "Evidence required for this section",
          "Bu bölüm için kaynak zorunludur",
        )}
      </p>
      <TextField
        label={copy("Actually reviewed on", "Gerçek inceleme tarihi")}
        value={section.reviewedOn}
        type="date"
        max={new Date().toISOString().slice(0, 10)}
        onChange={(reviewedOn) => patch({ reviewedOn })}
      />
      <RepeatFields
        title={copy("Sources", "Kaynaklar")}
        items={section.sources}
        fields={[
          { key: "label", label: copy("Source label", "Kaynak adı"), max: 160 },
          {
            key: "url",
            label: copy("Source URL (HTTPS)", "Kaynak URL’si (HTTPS)"),
            max: 2048,
            type: "url",
          },
        ]}
        create={() => ({ label: "", url: "" })}
        onChange={(sources) => patch({ sources })}
        limit={8}
        minimum={1}
        copy={copy}
      />
    </div>
  );
}

function HeroFields({
  section,
  kind,
  onChange,
  copy,
  context,
}: {
  section: DetailContentSection;
  kind: DetailContentKind;
  onChange: (section: DetailContentSection) => void;
  copy: Copy;
  context: HeroEditorContext | null;
}) {
  const { lang } = useI18n();
  const patch = (value: Partial<DetailContentSection>) =>
    onChange({ ...section, ...value });
  const hero = section.hero ?? {};
  const patchHero = (value: Partial<DetailHeroSettings>) =>
    patch({ hero: { ...hero, ...value } });
  const field = (
    key: keyof DetailHeroSettings,
    label: string,
    maxLength = 120,
  ) => {
    const overridden = hero[key] !== undefined && hero[key] !== "";
    const effective = context?.effective[key];
    return (
      <div className="space-y-1">
        <TextField
          label={label}
          value={String(overridden ? hero[key] : (effective ?? ""))}
          maxLength={maxLength}
          onChange={(value) => patchHero({ [key]: value || undefined })}
        />
        {effective !== undefined && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              {overridden
                ? copy("Page-specific override", "Sayfaya özel değer")
                : copy(
                    "Current frontend/template value",
                    "Ön yüzde kullanılan güncel değer",
                  )}
            </span>
            {overridden && (
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => patchHero({ [key]: undefined })}
              >
                {copy("Use frontend value", "Ön yüz değerini kullan")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        {copy(
          "Text, links, imagery, labels and visual treatment are editable here. Live catalogue values remain connected to their authoritative sources.",
          "Metin, bağlantı, görsel, etiket ve görünüm burada düzenlenir. Canlı katalog değerleri yetkili kaynaklarına bağlı kalır.",
        )}
      </div>
      <DetailVariableInsertPanel
        kind={kind}
        language={lang}
        copy={copy}
        onInsertTitle={(token) => patch({ title: appendVariableToken(section.title, token) })}
        onInsertBody={(token) => patch({ body: appendVariableToken(section.body, token) })}
      />
      {context?.facts.length ? (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div>
            <h4 className="font-medium">
              {copy(
                "Live values shown on this page",
                "Bu sayfada görünen canlı değerler",
              )}
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {copy(
                "These values come from the current catalogue or approved external facts. Edit them at their source; they are intentionally read-only here.",
                "Bu değerler güncel katalogdan veya onaylı dış verilerden gelir. Kaynağında düzenlenir; burada bilerek salt okunurdur.",
              )}
            </p>
          </div>
          <dl className="grid gap-2 sm:grid-cols-2">
            {context.facts.map((fact) => (
              <div
                key={`${fact.label}:${fact.value}`}
                className="min-w-0 rounded-md bg-background p-2"
              >
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {fact.label}
                </dt>
                <dd className="mt-1 break-words text-sm font-medium">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <div className="space-y-3 rounded-lg border p-3">
        <h4 className="font-medium">{copy("Hero content", "Hero içeriği")}</h4>
        {field("eyebrow", copy("Upper label / eyebrow", "Üst etiket"))}
        <TextField
          label={copy("Main heading", "Ana başlık")}
          value={section.title || context?.title || ""}
          onChange={(title) => patch({ title })}
          maxLength={160}
        />
        <TextField
          label={copy("Supporting text", "Destekleyici metin")}
          value={section.body ?? context?.body ?? ""}
          onChange={(body) => patch({ body: body || undefined })}
          maxLength={6000}
          multiline
        />
      </div>
      <div className="space-y-3 rounded-lg border p-3">
        <h4 className="font-medium">{copy("Buttons", "Butonlar")}</h4>
        {field(
          "primaryCtaLabel",
          copy("Primary button label", "Birincil buton metni"),
        )}
        {field(
          "primaryCtaHref",
          copy("Primary button link", "Birincil buton bağlantısı"),
          2048,
        )}
        {field(
          "secondaryCtaLabel",
          copy("Secondary button label", "İkincil buton metni"),
        )}
        {field(
          "secondaryCtaHref",
          copy("Secondary button link", "İkincil buton bağlantısı"),
          2048,
        )}
      </div>
      {kind !== "destination" && <RepeatFields
        title={copy("Hero background image", "Hero arka plan görseli")}
        items={section.images?.slice(0, 1) ?? []}
        fields={[
          {
            key: "src",
            label: copy(
              "Owned / licensed image URL or site path",
              "Sahip olduğunuz / lisanslı görsel URL’si veya site yolu",
            ),
            max: 2048,
          },
          {
            key: "alt",
            label: copy("Alternative text", "Alternatif metin"),
            max: 300,
          },
          {
            key: "caption",
            label: copy(
              "Caption / credit (optional)",
              "Açıklama / kaynak (isteğe bağlı)",
            ),
            max: 500,
          },
        ]}
        create={() => ({ src: "", alt: "", caption: "" })}
        onChange={(images) =>
          patch({ images: images.length ? images : undefined })
        }
        limit={1}
        copy={copy}
      />}
      <div className="space-y-3 rounded-lg border p-3">
        <h4 className="font-medium">
          {copy("Information box labels", "Bilgi kutusu etiketleri")}
        </h4>
        {field("countryLabel", copy("Country label", "Ülke etiketi"))}
        {field(
          "universityCountLabel",
          copy("University count label", "Üniversite sayısı etiketi"),
        )}
        {field(
          "programCountLabel",
          copy("Program count label", "Program sayısı etiketi"),
        )}
        {kind === "city" && (
          <>
            {field(
              "programLanguagesLabel",
              copy("Teaching languages label", "Eğitim dilleri etiketi"),
            )}
            {field("climateLabel", copy("Climate label", "İklim etiketi"))}
            {field("transportLabel", copy("Transport label", "Ulaşım etiketi"))}
            {field(
              "campusGeographyLabel",
              copy("Campus geography label", "Kampüs coğrafyası etiketi"),
            )}
            {field(
              "housingLabel",
              copy("Housing formats label", "Konaklama biçimleri etiketi"),
            )}
          </>
        )}
      </div>
      <div className="space-y-3 rounded-lg border p-3">
        <h4 className="font-medium">{copy("Appearance", "Görünüm")}</h4>
        <p className="text-xs text-muted-foreground">
          {copy(
            "Use six-digit HEX colours. Empty fields use the shared template defaults.",
            "Altı haneli HEX renk kullanın. Boş alanlarda ortak şablon varsayılanları kullanılır.",
          )}
        </p>
        {field(
          "backgroundColor",
          copy("Background colour", "Arka plan rengi"),
          7,
        )}
        {field(
          "overlayColor",
          copy("Image overlay colour", "Görsel kaplama rengi"),
          7,
        )}
        <TextField
          label={copy(
            "Image overlay opacity (0–100)",
            "Görsel kaplama opaklığı (0–100)",
          )}
          value={String(
            hero.overlayOpacity ?? context?.effective.overlayOpacity ?? "",
          )}
          type="number"
          onChange={(value) =>
            patchHero({
              overlayOpacity:
                value === ""
                  ? undefined
                  : Math.max(0, Math.min(100, Number(value))),
            })
          }
        />
        {hero.overlayOpacity === undefined &&
          context?.effective.overlayOpacity !== undefined && (
            <p className="text-[11px] text-muted-foreground">
              {copy(
                "Current frontend/template value",
                "Ön yüzde kullanılan güncel değer",
              )}
            </p>
          )}
        {field("textColor", copy("Text colour", "Metin rengi"), 7)}
        {field(
          "accentColor",
          copy(
            "Accent and primary button colour",
            "Vurgu ve birincil buton rengi",
          ),
          7,
        )}
      </div>
      <EvidenceFields section={section} patch={patch} copy={copy} />
    </div>
  );
}

function SectionFields({
  section,
  kind,
  onChange,
  copy,
  heroContext,
  locale,
  pageTitle,
  editorContext,
}: {
  section: DetailContentSection;
  kind: DetailContentKind;
  onChange: (section: DetailContentSection) => void;
  copy: Copy;
  heroContext: HeroEditorContext | null;
  locale: string;
  pageTitle: string;
  editorContext: unknown;
}) {
  const { lang } = useI18n();
  const patch = (value: Partial<DetailContentSection>) =>
    onChange({ ...section, ...value });
  const appearance = (
    <DetailSectionAppearanceFields
      value={section.presentation ?? {}}
      copy={copy}
      inherited
      onChange={(presentation) =>
        patch({ presentation: Object.keys(presentation).length ? presentation : undefined })
      }
    />
  );
  const writingAssistant = (
    <AiWritingAssistant
      locale={locale}
      context={detailAiWritingContext({
        kind,
        pageTitle,
        sectionTitle: section.title || section.key,
        sectionKey: section.key,
        payload: editorContext,
        currentIntroduction: heroContext?.body,
      })}
      fields={collectAiWritingFields(section)}
      allowedVariables={DETAIL_TEMPLATE_VARIABLES[kind].map(variable => variable.key)}
      copy={copy}
      onApply={(path, value) => onChange(applyAiWritingField(section, path, value))}
    />
  );
  if (section.key === "hero")
    return (
      <div className="space-y-4">
        <HeroFields
          section={section}
          kind={kind}
          onChange={onChange}
          copy={copy}
          context={heroContext}
        />
        {writingAssistant}
        {appearance}
      </div>
    );
  if (
    DETAIL_GENERATED_CONTENT_KEYS.includes(
      section.key as (typeof DETAIL_GENERATED_CONTENT_KEYS)[number],
    )
  )
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
          {copy(
            "Edit the heading and introduction here. The records, counts, prices and availability below them remain connected to the catalogue.",
            "Başlık ve giriş metnini burada düzenleyin. Altındaki kayıtlar, sayılar, fiyatlar ve kullanılabilirlik katalogla bağlı kalır.",
          )}
        </div>
        <DetailVariableInsertPanel kind={kind} language={lang} copy={copy} onInsertTitle={(token) => patch({ title: appendVariableToken(section.title, token) })} onInsertBody={(token) => patch({ body: appendVariableToken(section.body, token) })} />
        <TextField
          label={copy("Section title", "Bölüm başlığı")}
          value={section.title}
          onChange={(title) => patch({ title })}
          maxLength={160}
        />
        <TextField
          label={copy(
            "Introduction (plain text)",
            "Giriş açıklaması (düz metin)",
          )}
          value={section.body ?? ""}
          onChange={(body) => patch({ body: body || undefined })}
          maxLength={6000}
          multiline
        />
        {writingAssistant}
        {appearance}
        <EvidenceFields section={section} patch={patch} copy={copy} />
      </div>
    );
  const itemFields = [
    { key: "title" as const, label: copy("Title", "Başlık"), max: 160 },
    {
      key: "body" as const,
      label: copy("Text", "Metin"),
      max: 2000,
      multiline: true,
    },
  ];
  return (
    <div className="space-y-4">
      <DetailVariableInsertPanel kind={kind} language={lang} copy={copy} onInsertTitle={(token) => patch({ title: appendVariableToken(section.title, token) })} onInsertBody={(token) => patch({ body: appendVariableToken(section.body, token) })} />
      <TextField
        label={copy("Section title", "Bölüm başlığı")}
        value={section.title}
        onChange={(title) => patch({ title })}
        maxLength={160}
      />
      <TextField
        label={copy(
          "Body (optional, plain text)",
          "Açıklama (isteğe bağlı, düz metin)",
        )}
        value={section.body ?? ""}
        onChange={(body) => patch({ body: body || undefined })}
        maxLength={6000}
        multiline
      />
      {writingAssistant}
      <RepeatFields
        title={copy("Cards", "Kartlar")}
        items={section.cards ?? []}
        fields={[
          ...itemFields,
          {
            key: "href",
            label: copy(
              "Link (optional: #section, /site-path or HTTPS)",
              "Bağlantı (isteğe bağlı: #bölüm, /site-yolu veya HTTPS)",
            ),
            max: 2048,
            type: "text",
          },
        ]}
        create={() => ({ title: "", body: "", href: "" })}
        onChange={(cards) => patch({ cards: cards.length ? cards : undefined })}
        limit={12}
        copy={copy}
      />
      <TableFields
        value={section.table}
        onChange={(table) => patch({ table })}
        copy={copy}
      />
      <RepeatFields
        title={copy("Steps", "Adımlar")}
        items={section.steps ?? []}
        fields={itemFields}
        create={() => ({ title: "", body: "" })}
        onChange={(steps) => patch({ steps: steps.length ? steps : undefined })}
        limit={12}
        copy={copy}
      />
      <RepeatFields
        title={copy("Images", "Görseller")}
        items={section.images ?? []}
        fields={[
          {
            key: "src",
            label: copy(
              "Owned / licensed image URL or site path",
              "Sahip olduğunuz / lisanslı görsel URL’si veya site yolu",
            ),
            max: 2048,
          },
          {
            key: "alt",
            label: copy("Alternative text", "Alternatif metin"),
            max: 300,
          },
          {
            key: "caption",
            label: copy(
              "Caption / credit (optional)",
              "Açıklama / kaynak (isteğe bağlı)",
            ),
            max: 500,
          },
        ]}
        create={() => ({ src: "", alt: "", caption: "" })}
        onChange={(images) =>
          patch({ images: images.length ? images : undefined })
        }
        limit={8}
        copy={copy}
      />
      {!!section.images?.length && (
        <p className="text-xs text-muted-foreground">
          {copy(
            "Image URL is required. If alternative text is left empty, a safe section-based value is generated when the draft is previewed or saved. Caption / credit is optional.",
            "Görsel URL’si zorunludur. Alternatif metin boş bırakılırsa taslak önizlenirken veya kaydedilirken bölüm başlığına dayalı güvenli bir değer oluşturulur. Açıklama / kaynak isteğe bağlıdır.",
          )}
        </p>
      )}
      <RepeatFields
        title={copy("Questions and answers", "Sorular ve yanıtlar")}
        items={section.questions ?? []}
        fields={[
          { key: "question", label: copy("Question", "Soru"), max: 300 },
          {
            key: "answer",
            label: copy("Answer", "Yanıt"),
            max: 3000,
            multiline: true,
          },
        ]}
        create={() => ({ question: "", answer: "" })}
        onChange={(questions) =>
          patch({ questions: questions.length ? questions : undefined })
        }
        limit={12}
        copy={copy}
      />
      {appearance}
      <EvidenceFields section={section} patch={patch} copy={copy} />
    </div>
  );
}

/** Text-only local preview: no public draft route, remote image request or unsafe HTML. */
export function DetailContentPreview({
  content,
  copy,
}: {
  content: DetailContent;
  copy: Copy;
}) {
  return (
    <div
      className="space-y-5"
      dir={LANGUAGE_META[content.locale as Language]?.dir ?? "ltr"}
    >
      {!content.sections.length && (
        <p>
          {copy(
            "No supplemental sections. Publishing this draft removes previously published supplemental sections only.",
            "Ek bölüm yok. Bu taslağı yayınlamak yalnız önceki ek bölümleri kaldırır.",
          )}
        </p>
      )}
      {content.sections.map((section) => (
        <section key={section.key} className="space-y-3 rounded-lg border p-4">
          <h3 className="break-words text-lg font-semibold">{section.title}</h3>
          {section.body && (
            <p className="whitespace-pre-wrap break-words">{section.body}</p>
          )}
          {!!section.cards?.length && (
            <div className="grid gap-3 sm:grid-cols-2">
              {section.cards.map((card, index) => (
                <div key={index} className="min-w-0 rounded border p-3">
                  <h4 className="break-words font-medium">{card.title}</h4>
                  <p className="whitespace-pre-wrap break-words">{card.body}</p>
                  {card.href && (
                    <p
                      className="break-all text-xs text-muted-foreground"
                      dir="ltr"
                    >
                      {card.href}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {section.table && (
            <div
              role="region"
              aria-label={section.title}
              tabIndex={0}
              className="overflow-x-auto"
            >
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {section.table.columns.map((column, i) => (
                      <th scope="col" key={i} className="border p-2 text-start">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.table.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className="min-w-28 max-w-xs break-words border p-2"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!section.steps?.length && (
            <ol className="list-decimal space-y-2 ps-5">
              {section.steps.map((step, index) => (
                <li key={index}>
                  <strong>{step.title}</strong>
                  <p className="whitespace-pre-wrap break-words">{step.body}</p>
                </li>
              ))}
            </ol>
          )}
          {!!section.images?.length && (
            <div className="space-y-2">
              {section.images.map((image, index) => (
                <div key={index} className="rounded border p-3">
                  <p className="font-medium">
                    {copy("Image", "Görsel")} {index + 1}: {image.alt}
                  </p>
                  <p className="break-all text-xs" dir="ltr">
                    {image.src}
                  </p>
                  {image.caption && (
                    <p className="break-words text-sm">{image.caption}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {section.questions?.map((question, index) => (
            <div key={index}>
              <h4 className="break-words font-medium">{question.question}</h4>
              <p className="whitespace-pre-wrap break-words">
                {question.answer}
              </p>
            </div>
          ))}
          <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
            <p>
              {copy("Reviewed on", "İnceleme tarihi")}:{" "}
              <bdi>{section.reviewedOn}</bdi>
            </p>
            {section.sources.map((source, index) => (
              <p key={index} className="break-words">
                {source.label} — <bdi className="break-all">{source.url}</bdi>
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function prepareDetailContentDraft(
  content: DetailContent,
  facts: DetailAiPageFacts = {},
): DetailContent {
  return ensureDetailSeo({
    ...content,
    sections: content.sections.map(({ hero, ...section }) => {
      const cleanedHero = hero
        ? (Object.fromEntries(
            Object.entries(hero).filter(
              ([, value]) => value !== "" && value !== undefined,
            ),
          ) as DetailHeroSettings)
        : undefined;
      return {
        ...section,
        ...(cleanedHero && Object.keys(cleanedHero).length
          ? { hero: cleanedHero }
          : {}),
        cards: section.cards?.map(({ href, ...card }) => {
          const normalizedHref = href?.trim();
          return {
            ...card,
            ...(normalizedHref ? { href: normalizedHref } : {}),
          };
        }),
        images: section.images?.map(({ caption, ...image }, index) => ({
          ...image,
          alt:
            image.alt.trim() ||
            `${section.title.trim()} ${index + 1}`,
          ...(caption?.trim() ? { caption: caption.trim() } : {}),
        })),
      };
    }),
  }, facts);
}

export default function DetailContentEditor({
  target,
  onClose,
  onSaved,
}: {
  target: DetailContentTarget;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const canSelfPublish = user?.role === "super_admin";
  const copy: Copy = (en, tr) => (lang === "tr" ? tr : en);
  const [locale, setLocale] = useState(target.locale);
  const [saved, setSaved] = useState<SavedContent | null>(null);
  const [content, setContent] = useState<DetailContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [, setPreviewReady] = useState(false);
  const previewPayloadBinding = `${target.kind}:${target.entityId}:${locale}`;
  const [previewPayloadSnapshot, setPreviewPayloadSnapshot] =
    useState<BoundPreviewPayload | null>(null);
  const previewPayload =
    previewPayloadSnapshot?.binding === previewPayloadBinding
      ? previewPayloadSnapshot.payload
      : null;
  const [, setTranslationRevision] = useState(0);
  const onPreviewReady = useCallback((ready: boolean) => {
    setPreviewReady(ready);
  }, []);
  const onPreviewPayload = useCallback(
    (payload: Record<string, unknown> | null) =>
      setPreviewPayloadSnapshot((current) =>
        retainBoundPreviewPayload(current, previewPayloadBinding, payload),
      ),
    [previewPayloadBinding],
  );
  const [showPublished, setShowPublished] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [newKey, setNewKey] = useState("");
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(
    null,
  );
  const [mobilePane, setMobilePane] = useState<
    "sections" | "editor" | "preview"
  >("sections");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const opener = useRef<HTMLElement | null>(null);
  const confirmationOpener = useRef<HTMLElement | null>(null);
  const editorSurface = useRef<HTMLDivElement | null>(null);
  const initializedSectionKeys = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  const dirty =
    content !== null &&
    saved !== null &&
    JSON.stringify(content) !== JSON.stringify(saved.content);
  const savedIsPublished =
    saved?.published !== null &&
    saved !== null &&
    JSON.stringify(saved.content) === JSON.stringify(saved.published);
  const canSaveOrPublish =
    dirty ||
    (!!saved?.pageId && canSelfPublish && !savedIsPublished);
  const aiPageFacts = detailAiPageFacts(target.kind, saved?.editorContext, target.title);
  const readUrl = `/api/website/detail-content?${new URLSearchParams({ kind: target.kind, entityId: String(target.entityId), locale })}`;
  const checkedEntry = (entry: SavedContent): SavedContent => {
    const parsed = parseDetailContent(entry.content);
    if (
      !parsed ||
      parsed.kind !== target.kind ||
      parsed.entityId !== target.entityId ||
      parsed.locale !== locale ||
      (entry.published !== null &&
        (!parseDetailContent(entry.published) ||
          entry.published.kind !== target.kind ||
          entry.published.entityId !== target.entityId ||
          entry.published.locale !== locale))
    )
      throw new Error("Invalid detail content binding");
    return { ...entry, content: parsed };
  };
  const readEntry = async (signal?: AbortSignal) =>
    checkedEntry(
      await customFetch<SavedContent>(readUrl, { signal, cache: "no-store" }),
    );
  const accept = (entry: SavedContent) => {
    const editorContext = entry.editorContext ?? saved?.editorContext ?? null;
    initializedSectionKeys.current = new Set(
      DETAIL_CONTENT_KEYS[target.kind].filter(
        (key) => !entry.content.sections.some((section) => section.key === key),
      ),
    );
    const initialContent = hydrateDetailContentForEditor(
      entry.content,
      editorContext,
      target.title,
    );
    const initialPublished = entry.published
      ? hydrateDetailContentForEditor(
          entry.published,
          editorContext,
          target.title,
        )
      : null;
    setSaved({
      ...entry,
      editorContext,
      content: initialContent,
      published: initialPublished,
    });
    setContent(initialContent);
    setSelectedSectionKey((current) =>
      current &&
      DETAIL_LAYOUT_SECTIONS[target.kind].some(
        (key) => detailLayoutContentKey(key) === current,
      )
        ? current
        : detailLayoutContentKey(DETAIL_LAYOUT_SECTIONS[target.kind][0] ?? ""),
    );
    setPreviewReady(false);
    setReloadRequired(false);
    setNewKey("");
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    void loadLanguage(
      (locale in LANGUAGE_META ? locale : "en") as Language,
    ).then(() => {
      if (current) setTranslationRevision((value) => value + 1);
    });
    return () => {
      current = false;
    };
  }, [locale]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSaved(null);
    setContent(null);
    setError("");
    setMessage("");
    setShowPublished(false);
    readEntry(controller.signal)
      .then((entry) => {
        if (!controller.signal.aborted) accept(entry);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            copy(
              "Content could not load. Nothing was changed; retry before editing.",
              "İçerik yüklenemedi. Hiçbir kayıt değiştirilmedi; düzenlemeden önce yeniden deneyin.",
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [readUrl, attempt]);
  useEffect(() => {
    if (!previewPayload || !content || !saved || dirty || busy) return;
    const next = hydrateDetailContentForEditor(
      content,
      previewPayload,
      target.title,
      initializedSectionKeys.current,
    );
    const before = JSON.stringify(content);
    if (JSON.stringify(next) === before) return;
    setContent(next);
    setSaved((current) => {
      if (!current || JSON.stringify(current.content) !== before) return current;
      const published =
        current.published && JSON.stringify(current.published) === before
          ? hydrateDetailContentForEditor(
              current.published,
              previewPayload,
              target.title,
              initializedSectionKeys.current,
            )
          : current.published;
      return { ...current, content: next, published };
    });
  }, [previewPayload, content, saved, dirty, busy, target.title]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const change = (next: DetailContent) => {
    setContent(next);
    setPreviewReady(false);
    setMessage("");
    setError("");
    setShowPublished(false);
  };
  const performAction = (action: PendingAction) => {
    if (action.type === "close") onClose();
    else if (action.type === "locale") {
      setContent(null);
      setSaved(null);
      setLocale(action.locale);
    } else if (action.type === "reload") setAttempt((value) => value + 1);
    else if (action.type === "remove" && content)
      change({
        ...content,
        sections: content.sections.filter(
          (section) => section.key !== action.key,
        ),
      });
  };
  const requestAction = (action: PendingAction) => {
    if (busy || pendingAction) return;
    if (dirty || action.type === "remove") {
      confirmationOpener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setPendingAction(action);
    } else performAction(action);
  };
  const close = () => requestAction({ type: "close" });
  const changeSection = (index: number, section: DetailContentSection) => {
    if (content)
      change({
        ...content,
        sections: content.sections.map((value, i) =>
          i === index ? section : value,
        ),
      });
  };
  const moveLayoutSection = (index: number, by: number) => {
    if (!content) return;
    const sectionOrder = [
      ...(content.sectionOrder ?? DETAIL_CONTENT_LAYOUT_KEYS[target.kind]),
    ];
    const targetIndex = index + by;
    if (index < 3 || targetIndex < 3 || targetIndex >= sectionOrder.length)
      return;
    [sectionOrder[index], sectionOrder[targetIndex]] = [
      sectionOrder[targetIndex],
      sectionOrder[index],
    ];
    change({ ...content, sectionOrder });
  };
  const mutationError = (reason: unknown) => {
    const status =
      (reason as { status?: number; response?: { status?: number } } | null)
        ?.status ??
      (reason as { response?: { status?: number } } | null)?.response?.status;
    return status === 409
      ? copy(
          "The saved draft changed. Your edits are kept here. Copy anything you need, then reload and review the latest version.",
          "Kaydedilmiş taslak değişti. Düzenlemeleriniz burada korunuyor. Gereken metinleri kopyalayıp son sürümü yeniden yükleyin ve inceleyin.",
        )
      : status === 403
        ? canSelfPublish
          ? copy(
              "Publication was not allowed. Reload the exact saved draft and try again.",
              "Yayına izin verilmedi. Kaydedilmiş taslağın son halini yeniden yükleyip tekrar deneyin.",
            )
          : copy(
              "Not allowed. Publication needs a different authorized administrator; your own draft cannot be self-approved.",
              "İzin verilmedi. Yayın için farklı bir yetkili yönetici gerekir; kendi taslağınızı onaylayamazsınız.",
            )
        : copy(
            "The operation could not be confirmed. Your edits are kept; reload the saved state before trying again.",
            "İşlem doğrulanamadı. Düzenlemeleriniz korunuyor; yeniden denemeden önce kaydedilmiş durumu yükleyin.",
          );
  };
  const save = async () => {
    if (!content || !saved || busy || reloadRequired) return;
    const next = prepareDetailContentDraft(content, aiPageFacts);
    if (!parseDetailContent(next)) {
      const invalid = next.sections.filter(
        (section) => !parseDetailContent({ ...next, sections: [section] }),
      );
      setError(
        `${copy("Complete each section: title, content, an HTTPS source and a real review date (not in the future). Complete every added item/cell, remove empty items, and use plain text without HTML. Maximum total: 100,000 characters.", "Her bölümü tamamlayın: başlık, içerik, HTTPS kaynak ve gerçek inceleme tarihi (gelecekte olamaz). Eklenen her öğeyi/hücreyi doldurun, boş öğeleri kaldırın ve HTML içermeyen düz metin kullanın. Toplam en fazla 100.000 karakter.")} ${invalid.map((section) => section.title || sectionLabels[section.key]?.[lang === "tr" ? 1 : 0] || section.key).join(", ")}`,
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    let draftEntry: SavedContent | null = null;
    try {
      draftEntry = checkedEntry(
        await customFetch<SavedContent>("/api/website/detail-content/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: next,
            expectedUpdatedAt: saved.updatedAt,
          }),
        }),
      );
      const entry =
        canSelfPublish && draftEntry.pageId && draftEntry.digest
          ? checkedEntry(
              await customFetch<SavedContent>(
                "/api/website/detail-content/publish",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    pageId: draftEntry.pageId,
                    digest: draftEntry.digest,
                    approved: true,
                  }),
                },
              ),
            )
          : draftEntry;
      if (mounted.current) {
        accept(entry);
        setMessage(
          copy(
            canSelfPublish
              ? "Changes saved and published. They are now live."
              : "Changes saved. They are not live; an authorized administrator must publish them.",
            canSelfPublish
              ? "Değişiklikler kaydedildi ve yayınlandı. Artık yayında."
              : "Değişiklikler kaydedildi. Canlıya geçmedi; yetkili bir yönetici yayınlamalıdır.",
          ),
        );
        onSaved?.();
      }
    } catch (reason) {
      if (mounted.current) {
        if (draftEntry) accept(draftEntry);
        setError(
          draftEntry
            ? copy(
                "Changes were saved, but publication failed. Reload and try Save changes again.",
                "Değişiklikler kaydedildi ancak yayınlanamadı. Yeniden yükleyip Değişiklikleri kaydet düğmesini tekrar kullanın.",
              )
            : mutationError(reason),
        );
        const status =
          (reason as { status?: number; response?: { status?: number } } | null)
            ?.status ??
          (reason as { response?: { status?: number } } | null)?.response
            ?.status;
        setReloadRequired(status === 409);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const generateLocaleTranslation = async (replaceExisting = false) => {
    if (locale === "en" || busy || !content) return;
    if (!replaceExisting && (dirty || !!saved?.pageId)) {
      confirmationOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingAction({ type: "translation" });
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const sourceEntry = await customFetch<SavedContent>(`/api/website/detail-content?${new URLSearchParams({ kind: target.kind, entityId: String(target.entityId), locale: "en" })}`, { cache: "no-store" });
      const source = parseDetailContent(sourceEntry.content);
      if (!source || source.kind !== target.kind || source.entityId !== target.entityId || source.locale !== "en") throw new Error(copy("The English source content is unavailable.", "İngilizce kaynak içerik kullanılamıyor."));
      const hydratedSource = hydrateDetailContentForEditor(source, sourceEntry.editorContext ?? null, target.title);
      const translated = await translateStructuredDraft(hydratedSource, locale, "en");
      change({ ...translated, locale, templateSections: undefined });
      setMessage(copy(
        "AI created a translation draft from English. Review every section and save changes when ready; nothing was published automatically.",
        "AI, İngilizceden bir çeviri taslağı oluşturdu. Her bölümü kontrol edip hazır olduğunuzda değişiklikleri kaydedin; hiçbir şey otomatik yayınlanmadı.",
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy("Translation could not be created. Existing content was preserved.", "Çeviri oluşturulamadı. Mevcut içerik korundu."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const availableKeys = DETAIL_CONTENT_KEYS[target.kind].filter(
    (key) => !content?.sections.some((section) => section.key === key),
  );
  const keyLabel = (key: string) =>
    key === "__seo__" ? copy("SEO and social sharing", "SEO ve sosyal paylaşım") :
    sectionLabels[key]?.[lang === "tr" ? 1 : 0] ??
    detailTemplateLabel(key, lang);
  const layoutSections =
    content?.sectionOrder ?? DETAIL_CONTENT_LAYOUT_KEYS[target.kind];
  const isEditableSection = (key: string) =>
    DETAIL_CONTENT_KEYS[target.kind].includes(key);
  const previewContent = showPublished ? saved?.published : content;
  const editorPreviewPayload = saved?.editorContext
    ? {
        ...saved.editorContext,
        meta: {
          ...((saved.editorContext.meta as Record<string, unknown> | undefined) ?? {}),
          canonicalPath: target.canonicalPath,
          locale,
          indexable: false,
        },
      }
    : null;
  const selectedSectionIndex =
    content?.sections.findIndex(
      (section) => section.key === selectedSectionKey,
    ) ?? -1;
  const selectedSection =
    selectedSectionIndex >= 0
      ? (content?.sections[selectedSectionIndex] ?? null)
      : null;
  const heroContext = detailHeroEditorContext(
    target.kind,
    previewPayload,
    previewContent ?? null,
    locale,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        ref={editorSurface}
        className="flex h-[96dvh] max-h-[96dvh] w-[calc(100%_-_1rem)] max-w-[1600px] flex-col gap-0 overflow-hidden p-0"
        dir={LANGUAGE_META[lang as Language]?.dir ?? "ltr"}
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b bg-card px-4 py-3 pe-12 text-start">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">
                {copy("Dynamic page editor", "Dinamik sayfa editörü")} ·{" "}
                <bdi>{target.title}</bdi>
              </DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                <bdi>
                  {target.kind} · #{target.entityId}
                </bdi>{" "}
                ·{" "}
                {copy(
                  "Catalogue facts stay connected to their source record",
                  "Katalog bilgileri kaynak kayda bağlı kalır",
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label={copy("Content language", "İçerik dili")}
                disabled={busy}
                value={locale}
                onChange={(event) =>
                  requestAction({ type: "locale", locale: event.target.value })
                }
              >
                {DETAIL_CONTENT_LOCALES.map((value) => (
                  <option key={value} value={value}>
                    {LANGUAGE_META[value].name}
                  </option>
                ))}
              </select>
              {locale !== "en" && <Button variant="outline" size="sm" disabled={busy || loading || !content} onClick={() => void generateLocaleTranslation()}>
                <Sparkles className="me-1 h-4 w-4" />
                {busy ? copy("Translating…", "Çevriliyor…") : copy("Translate from English", "İngilizceden çevir")}
              </Button>}
              <Button asChild variant="outline" size="sm">
                <a
                  href={target.sourceEditPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="me-1 h-4 w-4" />
                  {copy("Catalogue", "Katalog")}
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={close}
              >
                {copy("Back", "Geri")}
              </Button>
              <Button
                size="sm"
                disabled={
                  loading ||
                  busy ||
                  !content ||
                  !saved ||
                  reloadRequired ||
                  !canSaveOrPublish
                }
                onClick={() => void save()}
              >
                {busy
                  ? copy("Working…", "İşleniyor…")
                  : copy("Save changes", "Değişiklikleri kaydet")}
              </Button>
            </div>
          </div>
        </DialogHeader>
        {(loading || error || message) && (
          <div className="shrink-0 border-b px-4 py-2 text-sm">
            {loading && (
              <p role="status">
                {copy(
                  "Loading saved content…",
                  "Kaydedilmiş içerik yükleniyor…",
                )}
              </p>
            )}
            {error && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 text-destructive"
              >
                <p>{error}</p>
                {(!content || reloadRequired) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => requestAction({ type: "reload" })}
                  >
                    {copy("Reload", "Yeniden yükle")}
                  </Button>
                )}
              </div>
            )}
            {message && <p role="status">{message}</p>}
          </div>
        )}
        {content && saved && (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={dirty ? "outline" : savedIsPublished ? "secondary" : "outline"}>
                  {dirty
                    ? copy("Unsaved changes", "Kaydedilmemiş değişiklikler")
                    : savedIsPublished
                      ? copy("Live", "Yayında")
                      : saved.pageId
                        ? copy("Saved — not live", "Kaydedildi — yayında değil")
                        : copy("New page", "Yeni sayfa")}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {copy(
                    "Save changes publishes immediately",
                    "Değişiklikleri kaydet anında yayınlar",
                  )}
                </span>
                {saved.updatedAt && (
                  <span className="text-xs text-muted-foreground">
                    <bdi>{new Date(saved.updatedAt).toLocaleString(lang)}</bdi>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={!showPublished ? "secondary" : "outline"}
                  onClick={() => {
                    setShowPublished(false);
                    setMobilePane("preview");
                  }}
                >
                  {copy("Preview changes", "Değişiklikleri önizle")}
                </Button>
                {saved.published && (
                  <Button
                    size="sm"
                    variant={showPublished ? "secondary" : "outline"}
                    onClick={() => {
                      setShowPublished(true);
                      setMobilePane("preview");
                    }}
                  >
                    {copy("View live version", "Canlı sürümü görüntüle")}
                  </Button>
                )}
              </div>
            </div>
            <nav
              aria-label={copy("Editor panels", "Editör panelleri")}
              className="grid w-full shrink-0 grid-cols-3 gap-2 border-b p-2 lg:hidden"
            >
              {(["sections", "editor", "preview"] as const).map((pane) => (
                <Button
                  key={pane}
                  className="min-w-0 px-2"
                  size="sm"
                  variant={mobilePane === pane ? "default" : "outline"}
                  onClick={() => setMobilePane(pane)}
                >
                  {pane === "sections"
                    ? copy("Sections", "Bölümler")
                    : pane === "editor"
                      ? copy("Edit section", "Bölümü düzenle")
                      : copy("Preview", "Önizleme")}
                </Button>
              ))}
            </nav>
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <aside
                className={`${mobilePane === "sections" ? "flex" : "hidden"} w-full shrink-0 flex-col border-e bg-card lg:flex lg:w-64`}
              >
                <div className="border-b p-3">
                  <h3 className="text-xs font-bold uppercase text-muted-foreground">
                    {copy("Page sections", "Sayfa bölümleri")}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy(
                      "The complete public page structure is shown below. Catalogue sections remain connected to their source; editorial sections are managed here.",
                      "Halka açık sayfanın bütün yapısı aşağıda gösterilir. Katalog bölümleri kaynağına bağlı kalır; editoryal bölümler burada yönetilir.",
                    )}
                  </p>
                </div>
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                  <button
                    type="button"
                    className={`flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-start ${selectedSectionKey === "__seo__" ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
                    onClick={() => {
                      setSelectedSectionKey("__seo__");
                      setMobilePane("editor");
                    }}
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {copy("SEO and social sharing", "SEO ve sosyal paylaşım")}
                    </span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${content.seo ? "bg-emerald-500" : "bg-amber-400"}`} />
                  </button>
                  {layoutSections.map((layoutKey, layoutIndex) => {
                    const key = detailLayoutContentKey(layoutKey);
                    const sectionIndex = content.sections.findIndex(
                      (section) => section.key === key,
                    );
                    const configured = sectionIndex >= 0;
                    return (
                      <div
                        key={layoutKey}
                        className={`group flex items-center gap-1 rounded-lg border p-1 ${selectedSectionKey === key ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-start"
                          onClick={() => {
                            setSelectedSectionKey(key);
                            setMobilePane("editor");
                          }}
                        >
                          <span className="w-5 shrink-0 text-xs text-muted-foreground">
                            {layoutIndex + 1}.
                          </span>
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${configured ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {keyLabel(key)}
                          </span>
                        </button>
                        <>
                            <button
                              type="button"
                              className="rounded p-1 hover:bg-background"
                              disabled={layoutIndex <= 3}
                              aria-label={`${copy("Move up", "Yukarı taşı")}: ${keyLabel(key)}`}
                              onClick={() => moveLayoutSection(layoutIndex, -1)}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 hover:bg-background"
                              disabled={
                                layoutIndex < 3 ||
                                layoutIndex === layoutSections.length - 1
                              }
                              aria-label={`${copy("Move down", "Aşağı taşı")}: ${keyLabel(key)}`}
                              onClick={() => moveLayoutSection(layoutIndex, 1)}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            {configured && (
                            <button
                              type="button"
                              className="rounded p-1 text-destructive hover:bg-background"
                              aria-label={`${copy("Remove", "Kaldır")}: ${keyLabel(key)}`}
                              onClick={() =>
                                requestAction({ type: "remove", key })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            )}
                          </>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-2 border-t p-3">
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={newKey}
                    onChange={(event) => setNewKey(event.target.value)}
                  >
                    <option value="">
                      {copy("Choose a section", "Bölüm seçin")}
                    </option>
                    {availableKeys.map((key) => (
                      <option key={key} value={key}>
                        {keyLabel(key)}
                      </option>
                    ))}
                  </select>
                  <Button
                    className="w-full"
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      !newKey ||
                      content.sections.length >= 30 ||
                      !availableKeys.includes(newKey)
                    }
                    onClick={() => {
                      const key = newKey;
                      change({
                        ...content,
                        sections: [
                          ...content.sections,
                          {
                            key,
                            title: "",
                            reviewedOn: "",
                            sources: [{ label: "", url: "" }],
                          },
                        ],
                      });
                      setSelectedSectionKey(key);
                      setNewKey("");
                      setMobilePane("editor");
                    }}
                  >
                    <Plus className="me-1 h-4 w-4" />
                    {copy("Add section", "Bölüm ekle")}
                  </Button>
                </div>
              </aside>
              <section
                className={`${mobilePane === "editor" ? "flex" : "hidden"} w-full shrink-0 flex-col border-e bg-background lg:flex lg:w-[420px]`}
              >
                <div className="border-b p-3">
                  <h3 className="text-xs font-bold uppercase text-muted-foreground">
                    {selectedSectionKey
                      ? `${copy("Edit", "Düzenle")}: ${keyLabel(selectedSectionKey)}`
                      : copy("Section editor", "Bölüm editörü")}
                  </h3>
                </div>
                <fieldset
                  disabled={busy}
                  className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4"
                  dir={LANGUAGE_META[locale as Language]?.dir ?? "ltr"}
                >
                  {selectedSectionKey === "__seo__" ? (
                    <div className="space-y-4">
                      <div className="flex justify-end">
                        <Badge variant={content.seoMode === "manual" ? "outline" : "secondary"}>
                          {content.seoMode === "manual"
                            ? copy("Page-specific SEO override", "Sayfaya özel SEO düzenlemesi")
                            : copy("Automatic · catalogue linked", "Otomatik · kataloğa bağlı")}
                        </Badge>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
                        {copy(
                          "SEO is regenerated automatically in this page language whenever the full page is regenerated. Editing these fields creates a page-specific override until the next full page regeneration; Shared Detail Templates never change them.",
                          "SEO, sayfanın tamamı yeniden oluşturulduğunda bu sayfanın dilinde otomatik olarak yenilenir. Bu alanları düzenlemek bir sonraki tam sayfa yenilemesine kadar sayfaya özel değer oluşturur; Shared Detail Templates bu değerleri değiştirmez.",
                        )}
                      </div>
                      {([
                        ["title", copy("Search result title", "Arama sonucu başlığı"), 160, false],
                        ["description", copy("Search result description", "Arama sonucu açıklaması"), 320, true],
                        ["ogTitle", copy("Social sharing title", "Sosyal paylaşım başlığı"), 160, false],
                        ["ogDescription", copy("Social sharing description", "Sosyal paylaşım açıklaması"), 320, true],
                        ["twitterTitle", copy("X / Twitter title", "X / Twitter başlığı"), 160, false],
                        ["twitterDescription", copy("X / Twitter description", "X / Twitter açıklaması"), 320, true],
                      ] as const).map(([key, label, maxLength, multiline]) => (
                        <TextField
                          key={key}
                          label={label}
                          value={content.seo?.[key] ?? ""}
                          maxLength={maxLength}
                          multiline={multiline}
                          onChange={(value) => change({
                            ...content,
                            seoMode: "manual",
                            seo: {
                              ...(content.seo ?? ensureDetailSeo(content, aiPageFacts).seo!),
                              [key]: value,
                            } as DetailSeo,
                          })}
                        />
                      ))}
                    </div>
                  ) : selectedSection && selectedSectionIndex >= 0 ? (
                    <SectionFields
                      section={selectedSection}
                      kind={target.kind}
                      onChange={(value) =>
                        changeSection(selectedSectionIndex, value)
                      }
                      copy={copy}
                      heroContext={heroContext}
                      locale={locale}
                      pageTitle={target.title}
                      editorContext={saved?.editorContext ?? null}
                    />
                  ) : selectedSectionKey &&
                    isEditableSection(selectedSectionKey) ? (
                    <div className="space-y-4 rounded-xl border border-dashed p-5 text-center">
                      <Plus className="mx-auto h-7 w-7 text-muted-foreground" />
                      <div>
                        <h4 className="font-semibold">
                          {keyLabel(selectedSectionKey)}
                        </h4>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {DETAIL_GENERATED_CONTENT_KEYS.includes(
                            selectedSectionKey as (typeof DETAIL_GENERATED_CONTENT_KEYS)[number],
                          )
                            ? copy(
                                "Create the editable CMS heading and introduction for this hybrid section. Its catalogue records remain dynamic.",
                                "Bu hibrit bölümün düzenlenebilir CMS başlık ve giriş metnini oluşturun. Katalog kayıtları dinamik kalır.",
                              )
                            : copy(
                                "This static section is part of the page template but has no content for this record yet.",
                                "Bu statik bölüm sayfa şablonunda bulunuyor ancak bu kayıt için henüz içeriği yok.",
                              )}
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={() => {
                          const key = selectedSectionKey;
                          change({
                            ...content,
                            sections: [
                              ...content.sections,
                              {
                                key,
                                title:
                                  key === "hero"
                                    ? heroContext?.title || keyLabel(key)
                                    : keyLabel(key),
                                body:
                                  key === "hero"
                                    ? heroContext?.body
                                    : DETAIL_GENERATED_CONTENT_KEYS.includes(
                                  key as (typeof DETAIL_GENERATED_CONTENT_KEYS)[number],
                                )
                                  ? keyLabel(key)
                                  : undefined,
                                reviewedOn: "",
                                sources: [{ label: "", url: "" }],
                              },
                            ],
                          });
                        }}
                      >
                        {copy("Create CMS section", "CMS bölümünü oluştur")}
                      </Button>
                    </div>
                  ) : selectedSectionKey ? (
                    <div className="space-y-4 rounded-xl border bg-muted/30 p-5">
                      <div className="flex items-center gap-3">
                        <Database className="h-6 w-6 text-primary" />
                        <div>
                          <h4 className="font-semibold">
                            {keyLabel(selectedSectionKey)}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {copy(
                              "Live dynamic section",
                              "Canlı dinamik bölüm",
                            )}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {[
                          "navigation",
                          "mobileActions",
                          "related",
                          "programs",
                          "universities",
                          "cities",
                          "cta",
                        ].includes(selectedSectionKey)
                          ? copy(
                              "This section is generated automatically from navigation, availability and related-record rules.",
                              "Bu bölüm navigasyon, kullanılabilirlik ve ilişkili kayıt kurallarından otomatik üretilir.",
                            )
                          : ["fees", "intakes"].includes(selectedSectionKey)
                            ? copy(
                                "Verified price components and structured intake records feed this section automatically. It intentionally has no duplicate CMS value.",
                                "Bu bölüm doğrulanmış fiyat bileşenleri ve yapılandırılmış intake kayıtlarından otomatik beslenir. Bilerek ikinci bir CMS değeri tutulmaz.",
                              )
                            : copy(
                                "This section is supplied by structured catalogue records.",
                                "Bu bölüm yapılandırılmış katalog kayıtlarından beslenir.",
                              )}
                      </p>
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {copy(
                        "Select a section to inspect or edit.",
                        "İncelemek veya düzenlemek için bir bölüm seçin.",
                      )}
                    </p>
                  )}
                </fieldset>
              </section>
              <section
                className={`${mobilePane === "preview" ? "flex" : "hidden"} min-w-0 flex-1 flex-col overflow-y-auto bg-muted/30 p-3 sm:p-4 lg:flex`}
              >
                <div className="mb-3 rounded-lg border bg-card p-3 text-xs text-muted-foreground">
                  <p>
                    {copy(
                      "Live draft preview combines current catalogue facts, the shared template and your unsaved editorial changes. Nothing is published automatically.",
                      "Canlı taslak önizleme güncel katalog bilgilerini, ortak şablonu ve kaydedilmemiş editoryal değişikliklerinizi birleştirir. Hiçbir şey otomatik yayınlanmaz.",
                    )}
                  </p>
                </div>
                {previewContent && (
                  <Suspense
                    fallback={
                      <p role="status">
                        {copy(
                          "Preparing full preview…",
                          "Tam önizleme hazırlanıyor…",
                        )}
                      </p>
                    }
                  >
                    <DetailFullPreview
                      target={target}
                      content={prepareDetailContentDraft(previewContent, aiPageFacts)}
                      copy={copy}
                      onReady={onPreviewReady}
                      onPayload={onPreviewPayload}
                      payloadOverride={editorPreviewPayload}
                    />
                  </Suspense>
                )}
                {previewContent && (
                  <details className="mt-3 rounded-lg border bg-card p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      {copy("Content references", "İçerik referansları")}
                    </summary>
                    <div className="mt-3">
                      <DetailContentPreview
                        content={previewContent}
                        copy={copy}
                      />
                    </div>
                  </details>
                )}
              </section>
            </div>
          </>
        )}
        <AlertDialog
          open={pendingAction !== null}
          onOpenChange={(open) => {
            if (!open) setPendingAction(null);
          }}
        >
          <AlertDialogContent
            className="w-[calc(100%_-_2rem)] rounded-lg"
            dir={LANGUAGE_META[lang as Language]?.dir ?? "ltr"}
            onCloseAutoFocus={(event) => {
              const focusTarget = confirmationOpener.current?.isConnected
                ? confirmationOpener.current
                : editorSurface.current;
              if (focusTarget?.isConnected) {
                event.preventDefault();
                focusTarget.focus({ preventScroll: true });
              }
            }}
          >
            <AlertDialogHeader className="text-start">
              <AlertDialogTitle>
                {pendingAction?.type === "remove"
                  ? copy("Remove this section?", "Bu bölüm kaldırılsın mı?")
                  : pendingAction?.type === "translation"
                    ? copy("Replace this language draft?", "Bu dildeki taslak değiştirilsin mi?")
                  : copy(
                      "Discard unsaved changes?",
                      "Kaydedilmemiş değişiklikler silinsin mi?",
                    )}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingAction?.type === "remove"
                  ? copy(
                      "This removes the section from the local draft only. Public content changes only after saving and separate publication approval.",
                      "Bu işlem bölümü yalnız yerel taslaktan kaldırır. Yayındaki içerik ancak kaydetme ve ayrı yayın onayından sonra değişir.",
                    )
                  : pendingAction?.type === "translation"
                    ? copy("AI will create a new draft from the English content. The current unsaved text in this language will be replaced, but nothing will be published automatically.", "AI, İngilizce içerikten yeni bir taslak oluşturacak. Bu dildeki mevcut kaydedilmemiş metin değiştirilecek ancak hiçbir şey otomatik yayınlanmayacak.")
                  : copy(
                      "Your unsaved edits will be discarded. The saved draft and published content will not change.",
                      "Kaydedilmemiş düzenlemeleriniz silinir. Kaydedilmiş taslak ve yayın içeriği değişmez.",
                    )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {copy("Keep editing", "Düzenlemeye devam et")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const action = pendingAction;
                  setPendingAction(null);
                  if (action?.type === "translation" && !busy) {
                    void generateLocaleTranslation(true);
                    return;
                  }
                  if (action && !busy) performAction(action);
                }}
              >
                {pendingAction?.type === "remove"
                  ? copy("Remove section", "Bölümü kaldır")
                  : pendingAction?.type === "translation"
                    ? copy("Create replacement draft", "Yeni taslak oluştur")
                  : copy(
                      "Discard and continue",
                      "Değişiklikleri sil ve devam et",
                    )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
