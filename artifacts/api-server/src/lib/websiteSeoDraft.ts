type SeoBlock = {
  isVisible?: boolean;
  content?: unknown;
};

export type WebsiteSeoDraft = {
  metaTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;
};

const DESCRIPTION_COPY: Record<string, (title: string) => string> = {
  en: title => `Explore ${title}, compare study options and get clear guidance for your next step with Find & Study.`,
  tr: title => `${title} hakkında bilgi alın, eğitim seçeneklerini karşılaştırın ve Find & Study ile sonraki adımınızı planlayın.`,
  ar: title => `اكتشف ${title} وقارن خيارات الدراسة وخطط لخطوتك التالية مع Find & Study.`,
  fr: title => `Découvrez ${title}, comparez les options d’études et préparez votre prochaine étape avec Find & Study.`,
  ru: title => `Узнайте больше о ${title}, сравните варианты обучения и спланируйте следующий шаг с Find & Study.`,
  fa: title => `${title} را بررسی کنید، گزینه‌های تحصیل را مقایسه کنید و گام بعدی خود را با Find & Study برنامه‌ریزی کنید.`,
  zh: title => `了解${title}，比较留学选择，并与 Find & Study 一起规划下一步。`,
  hi: title => `${title} के बारे में जानें, अध्ययन विकल्पों की तुलना करें और Find & Study के साथ अगला कदम तय करें।`,
  es: title => `Descubre ${title}, compara opciones de estudio y planifica tu próximo paso con Find & Study.`,
  id: title => `Jelajahi ${title}, bandingkan pilihan studi, dan rencanakan langkah berikutnya bersama Find & Study.`,
  ur: title => `${title} کے بارے میں جانیں، تعلیمی اختیارات کا موازنہ کریں اور Find & Study کے ساتھ اگلا قدم طے کریں۔`,
  tk: title => `${title} barada öwreniň, okuw mümkinçiliklerini deňeşdiriň we indiki ädimiňizi Find & Study bilen meýilleşdiriň.`,
  ky: title => `${title} тууралуу билип, окуу мүмкүнчүлүктөрүн салыштырып, кийинки кадамыңызды Find & Study менен пландаңыз.`,
  kk: title => `${title} туралы біліп, оқу нұсқаларын салыстырыңыз және келесі қадамыңызды Find & Study көмегімен жоспарлаңыз.`,
  uz: title => `${title} haqida bilib oling, ta’lim variantlarini solishtiring va keyingi qadamingizni Find & Study bilan rejalashtiring.`,
  tg: title => `Дар бораи ${title} маълумот гиред, имконоти таҳсилро муқоиса кунед ва қадами навбатиро бо Find & Study ба нақша гиред.`,
  bn: title => `${title} সম্পর্কে জানুন, পড়াশোনার বিকল্প তুলনা করুন এবং Find & Study-এর সঙ্গে পরবর্তী পদক্ষেপ পরিকল্পনা করুন।`,
  pt: title => `Conheça ${title}, compare opções de estudo e planeje seu próximo passo com a Find & Study.`,
  ne: title => `${title} बारे जान्नुहोस्, अध्ययन विकल्पहरू तुलना गर्नुहोस् र Find & Study सँग आफ्नो अर्को कदम योजना बनाउनुहोस्।`,
  vi: title => `Khám phá ${title}, so sánh các lựa chọn học tập và lên kế hoạch cho bước tiếp theo cùng Find & Study.`,
  ko: title => `${title} 정보를 확인하고 학업 옵션을 비교하여 Find & Study와 다음 단계를 계획하세요.`,
  uk: title => `Дізнайтеся більше про ${title}, порівняйте варіанти навчання та сплануйте наступний крок із Find & Study.`,
  it: title => `Scopri ${title}, confronta le opzioni di studio e pianifica il prossimo passo con Find & Study.`,
};

function plainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function firstEditorialText(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  const direct = plainText(value);
  if (direct && direct.length >= 40 && !/^(?:https?:\/\/|\/)/i.test(direct)) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = firstEditorialText(item, depth + 1);
      if (result) return result;
    }
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["description", "subtitle", "body", "text", "content", "excerpt", "summary"]) {
      const result = firstEditorialText(record[key], depth + 1);
      if (result) return result;
    }
  }
  return null;
}

function limit(value: string, max: number): string {
  if (value.length <= max) return value;
  const slice = value.slice(0, max + 1);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > max * 0.6 ? boundary : max).replace(/[\s,;:.!?-]+$/u, "")}…`;
}

export function buildWebsiteSeoDraft(input: { title: string; locale: string; blocks?: SeoBlock[] }): WebsiteSeoDraft {
  const title = plainText(input.title) || "Find & Study";
  const metaTitle = limit(`${title} | Find & Study`, 60);
  const body = input.blocks
    ?.filter(block => block.isVisible !== false)
    .map(block => firstEditorialText(block.content))
    .find((value): value is string => Boolean(value));
  const fallback = (DESCRIPTION_COPY[input.locale] ?? DESCRIPTION_COPY.en)(title);
  const metaDescription = limit(body || fallback, 160);
  return {
    metaTitle,
    metaDescription,
    ogTitle: metaTitle,
    ogDescription: metaDescription,
    twitterTitle: metaTitle,
    twitterDescription: metaDescription,
  };
}

export function applyGeneratedSeoFields(
  current: Record<string, unknown>,
  previousGenerated: WebsiteSeoDraft,
  nextGenerated: WebsiteSeoDraft,
): WebsiteSeoDraft {
  const result = { ...nextGenerated };
  for (const key of Object.keys(nextGenerated) as Array<keyof WebsiteSeoDraft>) {
    const value = current[key];
    if (typeof value === "string" && value.trim() && value !== previousGenerated[key]) result[key] = value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function translationParts(value: unknown): { container: Record<string, unknown>; fields: Record<string, unknown>; blocks: SeoBlock[] } | null {
  if (!isRecord(value)) return null;
  const hasEnvelope = isRecord(value.fields) || Array.isArray(value.blocks);
  const fields = hasEnvelope && isRecord(value.fields) ? value.fields : hasEnvelope ? {} : value;
  return {
    container: value,
    fields,
    blocks: Array.isArray(value.blocks) ? value.blocks as SeoBlock[] : [],
  };
}

function translatedPageTitle(fields: Record<string, unknown>, blocks: SeoBlock[], fallback: string): string {
  const explicit = plainText(fields.title);
  if (explicit) return explicit;
  for (const block of blocks) {
    if (block.isVisible === false || !isRecord(block.content)) continue;
    for (const key of ["title", "heading", "headline", "name"]) {
      const candidate = plainText(block.content[key]);
      if (candidate) return candidate;
    }
  }
  return fallback;
}

/**
 * Completes managed-page translation SEO without overwriting human edits.
 * Existing translation envelopes and blocks are preserved byte-for-byte apart
 * from the generated fields added under `fields`.
 */
export function enrichWebsiteTranslationSeo(
  nextTranslations: unknown,
  previousTranslations: unknown,
  sourceTitle: string,
): Record<string, unknown> {
  if (!isRecord(nextTranslations)) return {};
  const previous = isRecord(previousTranslations) ? previousTranslations : {};
  return Object.fromEntries(Object.entries(nextTranslations).map(([locale, value]) => {
    const next = translationParts(value);
    if (!next) return [locale, value];
    const before = translationParts(previous[locale]);
    const title = translatedPageTitle(next.fields, next.blocks, sourceTitle);
    const oldTitle = before ? translatedPageTitle(before.fields, before.blocks, sourceTitle) : title;
    const previousGenerated = buildWebsiteSeoDraft({ title: oldTitle, locale, blocks: before?.blocks ?? next.blocks });
    const nextGenerated = buildWebsiteSeoDraft({ title, locale, blocks: next.blocks });
    const seo = applyGeneratedSeoFields(next.fields, previousGenerated, nextGenerated);
    const fields = { ...next.fields, title, ...seo };
    return [locale, { ...next.container, fields }];
  }));
}
