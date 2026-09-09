import {
  PROGRAM_SUPPORTED_LOCALES,
  type ProgramSupportedLocale,
} from "./programTranslationContract";
import {
  parsePublicCatalogRouteKey,
  type PublicCatalogRouteIdentity,
} from "./publicCatalogRouteContract";

export type PublicWebRenderMode = "off" | "allowlist" | "all";

export type PublicCatalogRenderRoute =
  | {
      kind: "program_list";
      locale: ProgramSupportedLocale;
      path: string;
    }
  | {
      kind: "program_detail";
      locale: ProgramSupportedLocale;
      path: string;
      routeKey: string;
      identity: PublicCatalogRouteIdentity | null;
    }
  | {
      kind: "university_detail";
      locale: ProgramSupportedLocale;
      path: string;
      routeKey: string;
      identity: PublicCatalogRouteIdentity | null;
    }
  | {
      kind: "destination_detail";
      locale: ProgramSupportedLocale;
      path: string;
      slug: string;
    }
  | {
      kind: "article_detail";
      locale: ProgramSupportedLocale;
      path: string;
      routeKey: string;
      identity: PublicCatalogRouteIdentity | null;
    };

export type PublicCatalogRenderModel =
  | {
      kind: "not_found";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      indexable: false;
    }
  | {
      kind: "program_list";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      total: number;
      indexable: true;
      programs: Array<{
        id: number;
        name: string;
        universityName: string;
        country: string;
        city: string | null;
        degree: string | null;
        field: string | null;
        duration: string | null;
        language: string | null;
        canonicalPath: string;
      }>;
    }
  | {
      kind: "program_detail";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      indexable: boolean;
      alternatePaths: Partial<Record<ProgramSupportedLocale, string>>;
      program: {
        id: number;
        name: string;
        universityName: string;
        universityPath: string;
        country: string;
        city: string | null;
        degree: string | null;
        field: string | null;
        duration: string | null;
        language: string | null;
        tuitionFee: number | null;
        discountedFee: number | null;
        currency: string | null;
      };
    }
  | {
      kind: "university_detail";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      indexable: boolean;
      alternatePaths: Partial<Record<ProgramSupportedLocale, string>>;
      university: {
        id: number;
        name: string;
        country: string;
        city: string | null;
        universityType: string | null;
        programCount: number;
        programs: Array<{
          id: number;
          name: string;
          degree: string | null;
          field: string | null;
          canonicalPath: string;
        }>;
      };
    }
  | {
      kind: "destination_detail";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      indexable: boolean;
      alternatePaths: Partial<Record<ProgramSupportedLocale, string>>;
      destination: {
        id: number;
        name: string;
        country: string;
        livingCost: string | null;
        climate: string | null;
        language: string | null;
        currency: string | null;
        visaInfo: string | null;
        workPermit: string | null;
        popularCities: string[];
        universityCount: number;
        programCount: number;
        universities: Array<{
          id: number;
          name: string;
          city: string | null;
          universityType: string | null;
          canonicalPath: string;
        }>;
      };
    }
  | {
      kind: "article_detail";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      indexable: boolean;
      alternatePaths: Partial<Record<ProgramSupportedLocale, string>>;
      article: {
        id: number;
        title: string;
        excerpt: string | null;
        body: string;
        publishedAt: string;
        updatedAt: string;
        readTime: number | null;
      };
    };

const MAX_ALLOWLIST_ENTRIES = 64;
const MAX_RENDER_PATH_LENGTH = 512;

type RenderCopy = {
  programs: string;
  countries: string;
  degree: string;
  field: string;
  duration: string;
  language: string;
  location: string;
  tuition: string;
  institutionType: string;
};

const RENDER_COPY: Record<ProgramSupportedLocale, RenderCopy> = {
  en: { programs: "Programs", countries: "Countries", degree: "Degree", field: "Field", duration: "Duration", language: "Language", location: "Location", tuition: "Tuition", institutionType: "Institution type" },
  tr: { programs: "Programlar", countries: "Ülkeler", degree: "Derece", field: "Alan", duration: "Süre", language: "Eğitim dili", location: "Konum", tuition: "Öğrenim ücreti", institutionType: "Kurum türü" },
  ar: { programs: "البرامج", countries: "الدول", degree: "الدرجة", field: "المجال", duration: "المدة", language: "لغة الدراسة", location: "الموقع", tuition: "الرسوم الدراسية", institutionType: "نوع المؤسسة" },
  fr: { programs: "Programmes", countries: "Pays", degree: "Diplôme", field: "Domaine", duration: "Durée", language: "Langue", location: "Lieu", tuition: "Frais de scolarité", institutionType: "Type d’établissement" },
  ru: { programs: "Программы", countries: "Страны", degree: "Степень", field: "Направление", duration: "Продолжительность", language: "Язык", location: "Местоположение", tuition: "Стоимость обучения", institutionType: "Тип учреждения" },
  fa: { programs: "برنامه‌ها", countries: "کشورها", degree: "مقطع", field: "رشته", duration: "مدت", language: "زبان", location: "مکان", tuition: "شهریه", institutionType: "نوع مؤسسه" },
  zh: { programs: "课程", countries: "国家", degree: "学位", field: "专业领域", duration: "学制", language: "授课语言", location: "地点", tuition: "学费", institutionType: "院校类型" },
  hi: { programs: "कार्यक्रम", countries: "देश", degree: "डिग्री", field: "विषय क्षेत्र", duration: "अवधि", language: "भाषा", location: "स्थान", tuition: "शिक्षण शुल्क", institutionType: "संस्थान का प्रकार" },
  es: { programs: "Programas", countries: "Países", degree: "Título", field: "Área", duration: "Duración", language: "Idioma", location: "Ubicación", tuition: "Matrícula", institutionType: "Tipo de institución" },
  id: { programs: "Program", countries: "Negara", degree: "Gelar", field: "Bidang", duration: "Durasi", language: "Bahasa", location: "Lokasi", tuition: "Biaya kuliah", institutionType: "Jenis institusi" },
  ur: { programs: "پروگرام", countries: "ممالک", degree: "ڈگری", field: "شعبہ", duration: "مدت", language: "زبان", location: "مقام", tuition: "ٹیوشن فیس", institutionType: "ادارے کی قسم" },
  tk: { programs: "Maksatnamalar", countries: "Ýurtlar", degree: "Dereje", field: "Ugyr", duration: "Dowamlylygy", language: "Dil", location: "Ýerleşýän ýeri", tuition: "Okuw tölegi", institutionType: "Edaranyň görnüşi" },
  ky: { programs: "Программалар", countries: "Өлкөлөр", degree: "Даража", field: "Багыт", duration: "Узактыгы", language: "Тил", location: "Жайгашкан жери", tuition: "Окуу акысы", institutionType: "Мекеменин түрү" },
  kk: { programs: "Бағдарламалар", countries: "Елдер", degree: "Дәреже", field: "Сала", duration: "Ұзақтығы", language: "Тіл", location: "Орналасуы", tuition: "Оқу ақысы", institutionType: "Мекеме түрі" },
  uz: { programs: "Dasturlar", countries: "Mamlakatlar", degree: "Daraja", field: "Yo‘nalish", duration: "Davomiyligi", language: "Til", location: "Joylashuv", tuition: "O‘qish to‘lovi", institutionType: "Muassasa turi" },
  tg: { programs: "Барномаҳо", countries: "Кишварҳо", degree: "Дараҷа", field: "Соҳа", duration: "Давомнокӣ", language: "Забон", location: "Ҷойгиршавӣ", tuition: "Ҳаққи таҳсил", institutionType: "Навъи муассиса" },
  bn: { programs: "প্রোগ্রাম", countries: "দেশ", degree: "ডিগ্রি", field: "বিষয়", duration: "সময়কাল", language: "ভাষা", location: "অবস্থান", tuition: "টিউশন ফি", institutionType: "প্রতিষ্ঠানের ধরন" },
  pt: { programs: "Programas", countries: "Países", degree: "Grau", field: "Área", duration: "Duração", language: "Idioma", location: "Localização", tuition: "Mensalidade", institutionType: "Tipo de instituição" },
  ne: { programs: "कार्यक्रमहरू", countries: "देशहरू", degree: "डिग्री", field: "विषय", duration: "अवधि", language: "भाषा", location: "स्थान", tuition: "शिक्षण शुल्क", institutionType: "संस्थाको प्रकार" },
  vi: { programs: "Chương trình", countries: "Quốc gia", degree: "Bằng cấp", field: "Lĩnh vực", duration: "Thời lượng", language: "Ngôn ngữ", location: "Địa điểm", tuition: "Học phí", institutionType: "Loại hình cơ sở" },
  ko: { programs: "프로그램", countries: "국가", degree: "학위", field: "전공 분야", duration: "기간", language: "언어", location: "위치", tuition: "학비", institutionType: "기관 유형" },
  uk: { programs: "Програми", countries: "Країни", degree: "Ступінь", field: "Галузь", duration: "Тривалість", language: "Мова", location: "Розташування", tuition: "Вартість навчання", institutionType: "Тип закладу" },
  it: { programs: "Programmi", countries: "Paesi", degree: "Titolo", field: "Area", duration: "Durata", language: "Lingua", location: "Località", tuition: "Retta", institutionType: "Tipo di istituzione" },
};

export function parsePublicWebRenderMode(value: unknown): PublicWebRenderMode {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return normalized === "allowlist" || normalized === "all"
    ? normalized
    : "off";
}

export function parsePublicWebRenderAllowlist(value: unknown): Set<string> {
  const entries = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) =>
      item.length >= 4
      && item.length <= MAX_RENDER_PATH_LENGTH
      && item.startsWith("/")
      && !item.includes("//")
      && !item.includes("?")
      && !item.includes("#")
      && !item.includes(".."),
    )
    .slice(0, MAX_ALLOWLIST_ENTRIES);
  return new Set(entries);
}

export function matchPublicCatalogRenderPath(
  rawPath: unknown,
): PublicCatalogRenderRoute | null {
  const path = String(rawPath ?? "");
  if (path.length > MAX_RENDER_PATH_LENGTH || path.includes("//")) return null;
  const segments = path.split("/").filter(Boolean);
  const locale = segments[0] as ProgramSupportedLocale;
  if (!PROGRAM_SUPPORTED_LOCALES.includes(locale)) return null;
  if (segments.length === 2 && segments[1] === "programs") {
    return { kind: "program_list", locale, path };
  }
  if (segments.length === 3 && segments[1] === "programs") {
    return {
      kind: "program_detail",
      locale,
      path,
      routeKey: segments[2],
      identity: parsePublicCatalogRouteKey(segments[2]),
    };
  }
  if (segments.length === 3 && segments[1] === "universities") {
    return {
      kind: "university_detail",
      locale,
      path,
      routeKey: segments[2],
      identity: parsePublicCatalogRouteKey(segments[2]),
    };
  }
  if (
    segments.length === 3
    && (segments[1] === "destinations" || segments[1] === "countries")
    && segments[2].length <= 180
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segments[2])
  ) {
    return {
      kind: "destination_detail",
      locale,
      path,
      slug: segments[2],
    };
  }
  if (segments.length === 3 && segments[1] === "guides") {
    return {
      kind: "article_detail",
      locale,
      path,
      routeKey: segments[2],
      identity: parsePublicCatalogRouteKey(segments[2]),
    };
  }
  return null;
}

export function shouldRenderPublicCatalogPath(input: {
  path: unknown;
  mode: unknown;
  allowlist: unknown;
}): PublicCatalogRenderRoute | null {
  const route = matchPublicCatalogRenderPath(input.path);
  if (!route) return null;
  const mode = parsePublicWebRenderMode(input.mode);
  if (mode === "off") return null;
  if (mode === "allowlist") {
    const allowlist = parsePublicWebRenderAllowlist(input.allowlist);
    if (!allowlist.has(route.path)) return null;
  }
  return route;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function replaceMeta(
  html: string,
  attribute: "name" | "property",
  key: string,
  value: string,
): string {
  const escaped = escapeHtml(value);
  const pattern = new RegExp(`<meta\\s+${attribute}=["']${key}["'][^>]*>`, "i");
  const tag = `<meta ${attribute}="${key}" content="${escaped}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace("</head>", `  ${tag}\n</head>`);
}

function renderProgramList(model: Extract<PublicCatalogRenderModel, { kind: "program_list" }>): string {
  const copy = RENDER_COPY[model.locale];
  const cards = model.programs.map((program) => `
      <article class="rounded-2xl border border-border bg-card p-5">
        <p class="text-sm text-primary">${escapeHtml(program.universityName)}</p>
        <h2 class="mt-2 text-xl font-bold"><a href="${escapeHtml(program.canonicalPath)}">${escapeHtml(program.name)}</a></h2>
        <p class="mt-2 text-muted-foreground">${escapeHtml([program.degree, program.field, program.duration, program.language].filter(Boolean).join(" · "))}</p>
        <p class="mt-2 text-sm text-muted-foreground">${escapeHtml([program.city, program.country].filter(Boolean).join(", "))}</p>
      </article>`).join("");
  return `<main data-public-render-shell="program-list" class="mx-auto max-w-7xl px-4 py-24">
    <header><h1 class="text-4xl font-bold">${escapeHtml(model.title)}</h1><p class="mt-3 text-muted-foreground">${escapeHtml(model.description)}</p><p class="mt-2 text-sm">${model.total.toLocaleString(model.locale)} ${escapeHtml(copy.programs.toLocaleLowerCase(model.locale))}</p></header>
    <section class="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">${cards}</section>
  </main>`;
}

function renderProgramDetail(model: Extract<PublicCatalogRenderModel, { kind: "program_detail" }>): string {
  const program = model.program;
  const copy = RENDER_COPY[model.locale];
  const price = program.discountedFee ?? program.tuitionFee;
  return `<main data-public-render-shell="program-detail" class="mx-auto max-w-7xl px-4 py-24">
    <nav aria-label="Breadcrumb"><a href="/${escapeHtml(model.locale)}/programs">${escapeHtml(copy.programs)}</a> / <span>${escapeHtml(program.name)}</span></nav>
    <article class="mt-8">
      <p class="text-sm text-primary"><a href="${escapeHtml(program.universityPath)}">${escapeHtml(program.universityName)}</a></p>
      <h1 class="mt-3 text-4xl font-bold">${escapeHtml(program.name)}</h1>
      <p class="mt-4 text-muted-foreground">${escapeHtml(model.description)}</p>
      <dl class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt>${escapeHtml(copy.degree)}</dt><dd>${escapeHtml(program.degree || "—")}</dd></div>
        <div><dt>${escapeHtml(copy.field)}</dt><dd>${escapeHtml(program.field || "—")}</dd></div>
        <div><dt>${escapeHtml(copy.duration)}</dt><dd>${escapeHtml(program.duration || "—")}</dd></div>
        <div><dt>${escapeHtml(copy.language)}</dt><dd>${escapeHtml(program.language || "—")}</dd></div>
        <div><dt>${escapeHtml(copy.location)}</dt><dd>${escapeHtml([program.city, program.country].filter(Boolean).join(", "))}</dd></div>
        <div><dt>${escapeHtml(copy.tuition)}</dt><dd>${price === null ? "—" : `${escapeHtml(String(price))} ${escapeHtml(program.currency || "USD")}`}</dd></div>
      </dl>
    </article>
  </main>`;
}

function renderUniversityDetail(model: Extract<PublicCatalogRenderModel, { kind: "university_detail" }>): string {
  const university = model.university;
  const copy = RENDER_COPY[model.locale];
  const programs = university.programs.map((program) => `
      <article class="rounded-2xl border border-border bg-card p-5">
        <h2 class="text-lg font-bold"><a href="${escapeHtml(program.canonicalPath)}">${escapeHtml(program.name)}</a></h2>
        <p class="mt-2 text-muted-foreground">${escapeHtml([program.degree, program.field].filter(Boolean).join(" · "))}</p>
      </article>`).join("");
  return `<main data-public-render-shell="university-detail" class="mx-auto max-w-7xl px-4 py-24">
    <nav aria-label="Breadcrumb"><a href="/${escapeHtml(model.locale)}/countries">${escapeHtml(copy.countries)}</a> / <span>${escapeHtml(university.name)}</span></nav>
    <article class="mt-8">
      <p class="text-sm text-primary">${escapeHtml([university.city, university.country].filter(Boolean).join(", "))}</p>
      <h1 class="mt-3 text-4xl font-bold">${escapeHtml(university.name)}</h1>
      <p class="mt-4 text-muted-foreground">${escapeHtml(model.description)}</p>
      <dl class="mt-8 grid gap-4 sm:grid-cols-3">
        <div><dt>${escapeHtml(copy.institutionType)}</dt><dd>${escapeHtml(university.universityType || "—")}</dd></div>
        <div><dt>${escapeHtml(copy.location)}</dt><dd>${escapeHtml([university.city, university.country].filter(Boolean).join(", "))}</dd></div>
        <div><dt>${escapeHtml(copy.programs)}</dt><dd>${escapeHtml(String(university.programCount))}</dd></div>
      </dl>
    </article>
    <section class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">${programs}</section>
  </main>`;
}

function renderDestinationDetail(model: Extract<PublicCatalogRenderModel, { kind: "destination_detail" }>): string {
  const destination = model.destination;
  const copy = RENDER_COPY[model.locale];
  const universities = destination.universities.map((university) => `
      <article class="rounded-2xl border border-border bg-card p-5">
        <h2 class="text-lg font-bold"><a href="${escapeHtml(university.canonicalPath)}">${escapeHtml(university.name)}</a></h2>
        <p class="mt-2 text-muted-foreground">${escapeHtml([university.universityType, university.city].filter(Boolean).join(" · "))}</p>
      </article>`).join("");
  const cities = destination.popularCities.map((city) => `<li>${escapeHtml(city)}</li>`).join("");
  return `<main data-public-render-shell="destination-detail" class="mx-auto max-w-7xl px-4 py-24">
    <nav aria-label="Breadcrumb"><a href="/${escapeHtml(model.locale)}/countries">${escapeHtml(copy.countries)}</a> / <span>${escapeHtml(destination.name)}</span></nav>
    <article class="mt-8">
      <p class="text-sm text-primary">${escapeHtml(destination.country)}</p>
      <h1 class="mt-3 text-4xl font-bold">${escapeHtml(model.title)}</h1>
      <p class="mt-4 text-muted-foreground">${escapeHtml(model.description)}</p>
      <dl class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt>${escapeHtml(copy.location)}</dt><dd>${escapeHtml(destination.country)}</dd></div>
        <div><dt>${escapeHtml(copy.programs)}</dt><dd>${escapeHtml(String(destination.programCount))}</dd></div>
        <div><dt>${escapeHtml(copy.language)}</dt><dd>${escapeHtml(destination.language || "—")}</dd></div>
        <div><dt>${escapeHtml(copy.tuition)}</dt><dd>${escapeHtml(destination.currency || "—")}</dd></div>
      </dl>
      ${cities ? `<ul class="mt-8 flex flex-wrap gap-3" aria-label="${escapeHtml(copy.location)}">${cities}</ul>` : ""}
    </article>
    <section class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="${escapeHtml(destination.name)}">${universities}</section>
  </main>`;
}

function articlePlainText(value: string): string {
  return value
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function renderArticleDetail(model: Extract<PublicCatalogRenderModel, { kind: "article_detail" }>): string {
  const article = model.article;
  const body = articlePlainText(article.body);
  return `<main data-public-render-shell="article-detail" class="mx-auto max-w-3xl px-4 py-24">
    <nav aria-label="Breadcrumb"><a href="/${escapeHtml(model.locale)}/blog">Blog</a> / <span>${escapeHtml(article.title)}</span></nav>
    <article class="mt-8">
      <header>
        <h1 class="text-4xl font-bold">${escapeHtml(article.title)}</h1>
        <p class="mt-3 text-sm text-muted-foreground"><time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(article.publishedAt.slice(0, 10))}</time>${article.readTime ? ` · ${article.readTime} min` : ""}</p>
        ${article.excerpt ? `<p class="mt-5 text-lg text-muted-foreground">${escapeHtml(article.excerpt)}</p>` : ""}
      </header>
      <div class="mt-10 whitespace-pre-line leading-7">${escapeHtml(body)}</div>
    </article>
  </main>`;
}

function renderNotFound(model: Extract<PublicCatalogRenderModel, { kind: "not_found" }>): string {
  return `<main data-public-render-shell="not-found" class="mx-auto max-w-3xl px-4 py-32 text-center"><h1 class="text-3xl font-bold">${escapeHtml(model.title)}</h1><p class="mt-3 text-muted-foreground">${escapeHtml(model.description)}</p></main>`;
}

function structuredData(model: PublicCatalogRenderModel, siteUrl: string): unknown {
  if (model.kind === "program_detail") {
    const program = model.program;
    const price = program.discountedFee ?? program.tuitionFee;
    return {
      "@context": "https://schema.org",
      "@type": "Course",
      name: program.name,
      description: model.description,
      url: `${siteUrl}${model.canonicalPath}`,
      provider: {
        "@type": "CollegeOrUniversity",
        name: program.universityName,
        url: `${siteUrl}${program.universityPath}`,
      },
      ...(program.language ? { inLanguage: program.language } : {}),
      ...(program.duration ? { timeRequired: program.duration } : {}),
      ...(price !== null ? {
        offers: {
          "@type": "Offer",
          price,
          priceCurrency: program.currency || "USD",
        },
      } : {}),
    };
  }
  if (model.kind === "program_list") {
    return {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: model.title,
      description: model.description,
      url: `${siteUrl}${model.canonicalPath}`,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: model.total,
        itemListElement: model.programs.map((program, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${siteUrl}${program.canonicalPath}`,
          name: program.name,
        })),
      },
    };
  }
  if (model.kind === "university_detail") {
    const university = model.university;
    return {
      "@context": "https://schema.org",
      "@type": "CollegeOrUniversity",
      name: university.name,
      description: model.description,
      url: `${siteUrl}${model.canonicalPath}`,
      address: {
        "@type": "PostalAddress",
        ...(university.city ? { addressLocality: university.city } : {}),
        addressCountry: university.country,
      },
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        numberOfItems: university.programCount,
        itemListElement: university.programs.map((program, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${siteUrl}${program.canonicalPath}`,
          name: program.name,
        })),
      },
    };
  }
  if (model.kind === "destination_detail") {
    const destination = model.destination;
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "TouristDestination",
          "@id": `${siteUrl}${model.canonicalPath}#destination`,
          name: destination.name,
          description: model.description,
          url: `${siteUrl}${model.canonicalPath}`,
          touristType: {
            "@type": "Audience",
            audienceType: "International students",
          },
        },
        {
          "@type": "ItemList",
          numberOfItems: destination.universityCount,
          itemListElement: destination.universities.map((university, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: `${siteUrl}${university.canonicalPath}`,
            name: university.name,
          })),
        },
      ],
    };
  }
  if (model.kind === "article_detail") {
    return {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: model.article.title,
      description: model.description,
      url: `${siteUrl}${model.canonicalPath}`,
      datePublished: model.article.publishedAt,
      dateModified: model.article.updatedAt,
      inLanguage: model.locale,
      publisher: {
        "@type": "EducationalOrganization",
        name: "Find And Study",
        url: siteUrl,
      },
    };
  }
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: model.title,
    url: `${siteUrl}${model.canonicalPath}`,
  };
}

export function renderPublicCatalogHtml(input: {
  indexHtml: string;
  model: PublicCatalogRenderModel;
  siteUrl: string;
  nonce: string;
}): string {
  const siteUrl = input.siteUrl.replace(/\/$/, "");
  const canonicalUrl = `${siteUrl}${input.model.canonicalPath}`;
  let html = input.indexHtml
    .replace(/<html\s+lang=["'][^"']+["']([^>]*)>/i, `<html lang="${input.model.locale}"${["ar", "fa", "ur"].includes(input.model.locale) ? " dir=\"rtl\"" : ""}$1>`)
    .replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(input.model.title)}</title>`)
    .replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`)
    .replace(/<script\b/g, `<script nonce="${escapeHtml(input.nonce)}"`);

  html = html.replace(/\s*<link\s+[^>]*rel=["']alternate["'][^>]*hreflang=["'][^"']+["'][^>]*>/gi, "");

  html = replaceMeta(html, "name", "description", input.model.description);
  html = replaceMeta(html, "name", "robots", input.model.indexable ? "index, follow" : "noindex, follow");
  html = replaceMeta(html, "property", "og:title", input.model.title);
  html = replaceMeta(html, "property", "og:description", input.model.description);
  html = replaceMeta(html, "property", "og:url", canonicalUrl);
  html = replaceMeta(html, "name", "twitter:title", input.model.title);
  html = replaceMeta(html, "name", "twitter:description", input.model.description);

  const shell = input.model.kind === "program_list"
    ? renderProgramList(input.model)
    : input.model.kind === "program_detail"
      ? renderProgramDetail(input.model)
      : input.model.kind === "university_detail"
        ? renderUniversityDetail(input.model)
        : input.model.kind === "destination_detail"
          ? renderDestinationDetail(input.model)
          : input.model.kind === "article_detail"
            ? renderArticleDetail(input.model)
      : renderNotFound(input.model);
  const alternatePaths = (
    input.model.kind === "program_detail"
    || input.model.kind === "university_detail"
    || input.model.kind === "destination_detail"
    || input.model.kind === "article_detail"
  ) && input.model.indexable
    ? input.model.alternatePaths
    : {};
  const hreflangLinks = PROGRAM_SUPPORTED_LOCALES.flatMap((locale) => {
    const path = alternatePaths[locale];
    return path
      ? [`  <link rel="alternate" hreflang="${locale}" href="${escapeHtml(`${siteUrl}${path}`)}" />`]
      : [];
  });
  if (alternatePaths.en) {
    hreflangLinks.push(`  <link rel="alternate" hreflang="x-default" href="${escapeHtml(`${siteUrl}${alternatePaths.en}`)}" />`);
  }
  const extraHead = `  <meta name="csp-nonce" content="${escapeHtml(input.nonce)}" />\n  <meta name="public-render" content="ssr-isr-pilot" />\n${hreflangLinks.join("\n")}${hreflangLinks.length ? "\n" : ""}  <script nonce="${escapeHtml(input.nonce)}" type="application/ld+json">${safeJson(structuredData(input.model, siteUrl))}</script>\n`;
  return html
    .replace("</head>", `${extraHead}</head>`)
    .replace(/<div\s+id=["']root["']\s*><\/div>/i, `<div id="root" data-public-render-shell-root="true">${shell}</div>`);
}

export function publicCatalogCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
