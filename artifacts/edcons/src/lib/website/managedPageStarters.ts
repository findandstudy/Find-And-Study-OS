import type { PageBlock } from "./blockTypes";
import englishTranslations from "../i18n/translations/en.json";
import { getTranslation, loadLanguage, SUPPORTED_LANGUAGES, type Language } from "../i18n/index";

type ManagedTemplate = "home" | "about" | "countries" | "programs" | "blog" | "contact";

export type ManagedHomeCopy = {
  badge: string;
  title: string;
  subtitle: string;
  primaryLabel: string;
  secondaryLabel: string;
  visaRate: string;
  universities: string;
  countries: string;
  scholarships: string;
  featuresTitle: string;
  featuresSubtitle: string;
  universityTitle: string;
  universityDescription: string;
  applicationTitle: string;
  applicationDescription: string;
  visaTitle: string;
  visaDescription: string;
};

export const MANAGED_HOME_BLOCK_TYPES = new Set([
  "home_fallback_hero",
  "home_fallback_stats",
  "home_fallback_features",
  "catalog_grid",
  "process_steps",
  "feature_cards",
  "faq",
  "cta_banner",
]);

function block(blockType: string, content: Record<string, unknown>): PageBlock {
  return { blockType, content, settings: { useThemeColors: true }, sortOrder: 0, isVisible: true };
}

const DEFAULT_HOME_COPY: ManagedHomeCopy = {
  badge: englishTranslations.hero.badge,
  title: englishTranslations.hero.title,
  subtitle: englishTranslations.hero.subtitle,
  primaryLabel: englishTranslations.hero.cta,
  secondaryLabel: englishTranslations.hero.browse,
  visaRate: englishTranslations.stats.visaRate,
  universities: englishTranslations.stats.universities,
  countries: englishTranslations.stats.countries,
  scholarships: englishTranslations.stats.scholarships,
  featuresTitle: englishTranslations.features.title,
  featuresSubtitle: englishTranslations.features.subtitle,
  universityTitle: englishTranslations.features.university,
  universityDescription: englishTranslations.features.universityDesc,
  applicationTitle: englishTranslations.features.application,
  applicationDescription: englishTranslations.features.applicationDesc,
  visaTitle: englishTranslations.features.visa,
  visaDescription: englishTranslations.features.visaDesc,
};

/**
 * The Home editor and the public Home route intentionally consume this exact
 * section contract. Keeping the factory here prevents the editor preview from
 * becoming a second, approximate page implementation.
 */
export function managedHomePageBlocks(
  copy: ManagedHomeCopy = DEFAULT_HOME_COPY,
  programsPath = "/en/programs",
): PageBlock[] {
  const localeRoot = programsPath.replace(/\/programs\/?$/, "") || "/en";
  const countriesPath = `${localeRoot}/countries`;
  const contactPath = `${localeRoot}/contact`;
  return [
    block("home_fallback_hero", {
      badge: copy.badge,
      title: copy.title,
      subtitle: copy.subtitle,
      ctaLabel: copy.primaryLabel,
      ctaUrl: programsPath,
      secondaryLabel: copy.secondaryLabel,
      secondaryUrl: programsPath,
      signalTitle: "One connected journey",
      signalSubtitle: "Research, preparation and progress stay in context from your first search onward.",
      signals: [
        { label: "Explore", detail: "Destinations and programs" },
        { label: "Prepare", detail: "Requirements and documents" },
        { label: "Progress", detail: "Milestones and next actions" },
      ],
    }),
    block("home_fallback_stats", {
      stats: [
        { value: "98%", label: copy.visaRate },
        { value: "500+", label: copy.universities },
        { value: "30+", label: copy.countries },
        { value: "$2M+", label: copy.scholarships },
      ],
    }),
    block("home_fallback_features", {
      title: copy.featuresTitle,
      subtitle: copy.featuresSubtitle,
      cards: [
        { icon: "Globe2", title: copy.universityTitle, description: copy.universityDescription },
        { icon: "FileText", title: copy.applicationTitle, description: copy.applicationDescription },
        { icon: "ShieldCheck", title: copy.visaTitle, description: copy.visaDescription },
      ],
    }),
    block("catalog_grid", {
      title: "Explore current study opportunities",
      subtitle: "Start with live catalogue data, then open each destination or program to review the details that shape your decision.",
      source: "destinations",
      limit: 6,
      country: "",
      city: "",
      layout: "grid",
      columns: "3",
      fallbackItems: [
        { id: "destinations", title: "Study destinations", description: "Compare countries and cities before narrowing your study options.", canonicalPath: countriesPath },
        { id: "programs", title: "Programs", description: "Browse the current catalogue and open each program for its available details.", canonicalPath: programsPath },
        { id: "advice", title: "Adviser support", description: "Bring your shortlist and questions together for a more practical next step.", canonicalPath: contactPath },
      ],
    }),
    block("process_steps", {
      title: "From first idea to a clear next step",
      subtitle: "A connected journey that helps you research, prepare and move forward without losing the context behind each decision.",
      steps: [
        { number: "01", title: "Explore with context", description: "Compare destinations, universities and programs around your goals, preferred location and study plans." },
        { number: "02", title: "Prepare with confidence", description: "Bring your information, documents and questions together before an application is submitted." },
        { number: "03", title: "Follow every milestone", description: "Keep application progress, document requests and the next action visible throughout your journey." },
      ],
    }),
    block("feature_cards", {
      title: "Start with the decision in front of you",
      subtitle: "Use the route that matches where you are today. You can explore independently and ask for guidance when you need it.",
      columns: "3",
      cards: [
        { icon: "Map", title: "Choose a destination", description: "Understand countries and cities before narrowing your university and program options.", linkUrl: countriesPath, linkLabel: "Compare destinations" },
        { icon: "Search", title: "Find a program", description: "Browse the current catalogue and focus your search around the study options that fit your plans.", linkUrl: programsPath, linkLabel: "Browse programs" },
        { icon: "MessageCircle", title: "Speak with an adviser", description: "Turn a shortlist, budget or unanswered question into a more practical study plan.", linkUrl: contactPath, linkLabel: "Contact an adviser" },
      ],
    }),
    block("faq", {
      title: "Questions students often ask before starting",
      subtitle: "Short answers to help you understand the next step before sharing any information or beginning an application.",
      source: "manual",
      items: [
        { question: "Where should I begin?", answer: "Start by comparing destinations and programs around your academic goals, preferred location and budget. If your shortlist is still broad, an adviser can help you identify the questions that matter most." },
        { question: "Can I compare different study options?", answer: "Yes. Use the destination and program pages to compare location, institution and study details, then keep the strongest options on your shortlist." },
        { question: "What happens after I choose a program?", answer: "The next step is to confirm the current entry requirements, intake details and required documents before an application is prepared." },
        { question: "Can I follow my application progress?", answer: "Signed-in students can use the portal to follow application milestones, document requests and the next action assigned to their journey." },
      ],
    }),
    block("cta_banner", {
      title: "Turn your research into a clear study plan",
      subtitle: "Explore current options first, then speak with an adviser when you are ready to review your shortlist and next steps.",
      ctaLabel: "Browse Programs",
      ctaUrl: programsPath,
      secondaryLabel: "Talk to an Adviser",
      secondaryUrl: contactPath,
      bgStyle: "gradient",
      bgImage: "",
    }),
  ].map((entry, index) => ({ ...entry, sortOrder: index }));
}

/**
 * Older managed Home records contain only the original hero, statistics and
 * services sections. Complete that exact legacy shape without replacing any
 * edited content. Custom Home compositions are intentionally left untouched.
 */
type ManagedHomeBlockInput = Omit<PageBlock, "isVisible"> & { isVisible?: boolean };

export function enrichManagedHomePageBlocks(
  blocks: ManagedHomeBlockInput[],
  programsPath = "/en/programs",
  options: { completeSystemFallback?: boolean } = {},
): PageBlock[] {
  const visibleTypes = blocks.map(block => block.blockType);
  const systemFallbackTypes = ["home_fallback_hero"];
  const legacyTypes = ["home_fallback_hero", "home_fallback_stats", "home_fallback_features"];
  const previousTypes = ["home_fallback_hero", "home_fallback_stats", "home_fallback_features", "process_steps", "feature_cards", "faq", "cta_banner"];
  const matches = (types: string[]) => blocks.length === types.length && types.every((type, index) => visibleTypes[index] === type);
  const isSystemFallback = options.completeSystemFallback === true && matches(systemFallbackTypes);
  if (!isSystemFallback && !matches(legacyTypes) && !matches(previousTypes)) return blocks.map((entry, index) => ({ ...entry, isVisible: entry.isVisible ?? true, sortOrder: index }));
  const current = new Map(blocks.map(entry => [entry.blockType, { ...entry, isVisible: entry.isVisible ?? true }]));
  return managedHomePageBlocks(DEFAULT_HOME_COPY, programsPath).map((starter, index) => ({
    ...(current.get(starter.blockType) || starter),
    sortOrder: index,
  }));
}

function localized(locale: Language, key: string, fallback: string): string {
  const value = getTranslation(locale, key);
  return value && value !== key ? value : fallback;
}

function route(locale: Language, path: string): string {
  return `/${locale}${path.startsWith("/") ? path : `/${path}`}`;
}

function joinedTitle(locale: Language, group: string, fallback: string): string {
  const title = localized(locale, `${group}.title`, fallback);
  const highlight = localized(locale, `${group}.titleHighlight`, "");
  return [title, highlight].filter(Boolean).join(" ");
}

function aboutStarter(locale: Language): PageBlock[] {
  const contactPath = route(locale, "/contact");
  const programsPath = route(locale, "/programs");
  return [
    block("hero", { badge: localized(locale, "about.badge", "About Us"), title: joinedTitle(locale, "about", "We Make Global Education Accessible"), subtitle: localized(locale, "about.description", "Responsible guidance for every stage of the international education journey."), ctaLabel: localized(locale, "about.bookConsultation", "Book Free Consultation"), ctaUrl: contactPath, secondaryLabel: localized(locale, "about.browsePrograms", "Browse Programs"), secondaryUrl: programsPath, backgroundImage: "", overlay: true }),
    block("counter_grid", { title: localized(locale, "about.getStarted", "Guidance with a clear purpose"), subtitle: localized(locale, "about.description", "A transparent support model from first research to the next verified step."), columns: "4", items: [
      { value: "01", label: localized(locale, "countries.explore", "Discover"), description: "Clarify destination, subject, budget and timing before building a shortlist." },
      { value: "02", label: "Compare", description: "Review current catalogue facts and the trade-offs behind each option." },
      { value: "03", label: "Prepare", description: "Check requirements and documents before an application is submitted." },
      { value: "04", label: "Progress", description: "Keep milestones, requests and the next action visible in one journey." },
    ] }),
    block("media_text", { eyebrow: localized(locale, "about.missionTitle", "Our mission"), title: localized(locale, "about.missionTitle", "Our mission"), body: `${localized(locale, "about.missionP1", "Every motivated student deserves access to world-class education.")}\n\n${localized(locale, "about.missionP2", "We support each step from the first enquiry to graduation.")}`, imageUrl: "", altText: "", imagePosition: "right", ctaLabel: localized(locale, "about.getStarted", "Get started today"), ctaUrl: contactPath }),
    block("grid_box", { eyebrow: localized(locale, "about.missionTitle", "What guides us"), title: localized(locale, "about.getStarted", "Built around student success"), subtitle: localized(locale, "about.description", "Principles used across every student journey."), columns: "3", cards: [
      { title: localized(locale, "about.studentFirst", "Student first"), description: localized(locale, "about.studentFirstDesc", "Every decision centres on student success and wellbeing.") },
      { title: localized(locale, "about.excellence", "Excellence"), description: localized(locale, "about.excellenceDesc", "We maintain high standards in guidance and support.") },
      { title: localized(locale, "about.globalReach", "Global reach"), description: localized(locale, "about.globalReachDesc", "Partnerships across countries and institutions.") },
      { title: localized(locale, "about.innovation", "Innovation"), description: localized(locale, "about.innovationDesc", "Technology streamlines the application journey.") },
      { title: localized(locale, "about.community", "Community"), description: localized(locale, "about.communityDesc", "Connections between students and institutions.") },
      { title: localized(locale, "about.integrity", "Integrity"), description: localized(locale, "about.integrityDesc", "Honest and transparent advice.") },
    ] }),
    block("process_steps", { title: "What working with us looks like", subtitle: "Advice starts with your situation, not a pre-selected institution.", steps: [
      { number: "01", title: "Understand the brief", description: "We begin with your academic background, goals, preferred destinations, timing and practical constraints." },
      { number: "02", title: "Build a reasoned shortlist", description: "Options are compared with current catalogue information and the questions you should verify." },
      { number: "03", title: "Prepare the next step", description: "Requirements, documents and ownership are made clear before anything moves forward." },
      { number: "04", title: "Stay informed", description: "Progress and outstanding actions remain visible throughout the journey." },
    ] }),
    block("team_grid", { title: localized(locale, "about.teamTitle", "Meet our team"), subtitle: localized(locale, "about.teamSubtitle", "Experienced international education specialists."), source: "collection", members: [] }),
    block("logo_marquee", { title: localized(locale, "about.partnerUniversities", "Partner universities"), subtitle: localized(locale, "about.globalReachDesc", "A global network of education partners."), items: [] }),
    block("office_list", { title: localized(locale, "contact.ourOffices", "Our offices"), subtitle: localized(locale, "contact.subtitle", "Find the right team for your next step."), source: "collection", offices: [] }),
    block("faq", { title: "How our guidance works", subtitle: "A transparent starting point before you share documents or begin an application.", source: "manual", items: [
      { question: "Will I be shown only one option?", answer: "No. A useful shortlist should show the relevant alternatives and explain why each option may or may not fit your priorities." },
      { question: "Are entry and visa outcomes guaranteed?", answer: "No. Decisions belong to institutions and the relevant authorities. Guidance can improve preparation, but it cannot guarantee an external decision." },
      { question: "Which information should I verify?", answer: "Always verify current tuition, intake, scholarship, entry and visa information before making a final decision or payment." },
    ] }),
    block("cta_banner", { title: localized(locale, "about.ctaTitle", "Ready to start your journey?"), subtitle: localized(locale, "about.ctaSubtitle", "Book a free consultation with an expert adviser."), ctaLabel: localized(locale, "about.bookConsultation", "Book Free Consultation"), ctaUrl: contactPath, secondaryLabel: localized(locale, "about.browsePrograms", "Browse Programs"), secondaryUrl: programsPath, bgStyle: "gradient", bgImage: "" }),
  ];
}

function countriesStarter(locale: Language): PageBlock[] {
  const programsPath = route(locale, "/programs");
  const contactPath = route(locale, "/contact");
  return [
    block("hero", { badge: localized(locale, "countries.badge", "Study destinations"), title: joinedTitle(locale, "countries", "Explore study destinations"), subtitle: localized(locale, "countries.subtitle", "Compare countries and find the destination that fits your plans."), ctaLabel: localized(locale, "countries.explore", "Explore"), ctaUrl: "#destination-list", secondaryLabel: localized(locale, "countries.freeCounseling", "Get free counselling"), secondaryUrl: contactPath, backgroundImage: "", overlay: true }),
    block("counter_grid", { title: localized(locale, "countries.featured", "Compare destinations with context"), subtitle: localized(locale, "countries.subtitle", "Use the same four lenses before narrowing your destination list."), columns: "4", items: [
      { value: "01", label: "Academic fit", description: "Programs, entry requirements and progression routes." },
      { value: "02", label: "Total cost", description: "Tuition, accommodation and realistic day-to-day expenses." },
      { value: "03", label: "Student life", description: "City scale, campus setting, transport and support." },
      { value: "04", label: "Next steps", description: "Application, visa and arrival tasks that need planning." },
    ] }),
    block("catalog_grid", { title: localized(locale, "countries.featured", "Featured destinations"), subtitle: localized(locale, "countries.subtitle", "Destination pages generated from the live catalogue."), source: "destinations", limit: 12, country: "", city: "", layout: "grid", columns: "3" }),
    block("scroll_box", { title: localized(locale, "countries.more", "More destinations"), subtitle: localized(locale, "countries.noDestinationsDesc", "Explore current destinations and compare the details that matter."), cardSize: "standard", items: [
      { title: localized(locale, "countries.universities", "Universities"), description: localized(locale, "about.globalReachDesc", "Review institutions and their locations."), linkLabel: localized(locale, "countries.explore", "Explore"), linkUrl: programsPath },
      { title: localized(locale, "countries.programs", "Programs"), description: localized(locale, "programs.subtitle", "Browse current study programs."), linkLabel: localized(locale, "programs.viewDetails", "View details"), linkUrl: programsPath },
      { title: localized(locale, "countries.notSure", "Not sure where to study?"), description: localized(locale, "countries.notSureDesc", "An adviser can help compare your goals, budget and preferences."), linkLabel: localized(locale, "countries.freeCounseling", "Get free counselling"), linkUrl: contactPath },
    ] }),
    block("column_layout", { title: localized(locale, "countries.notSure", "Compare with context"), subtitle: localized(locale, "countries.notSureDesc", "Use the catalogue and adviser support together."), columns: "3", items: [
      { eyebrow: "01", title: localized(locale, "countries.explore", "Explore"), body: localized(locale, "countries.subtitle", "Discover study destinations and their opportunities.") },
      { eyebrow: "02", title: localized(locale, "countries.universities", "Universities"), body: localized(locale, "about.globalReachDesc", "Compare institutions across the global partner network.") },
      { eyebrow: "03", title: localized(locale, "countries.programs", "Programs"), body: localized(locale, "programs.subtitle", "Narrow the results around your study goals."), linkLabel: localized(locale, "programs.viewDetails", "View details"), linkUrl: programsPath },
    ] }),
    block("grid_box", { eyebrow: "DECISION LENSES", title: "Look beyond the destination name", subtitle: "A stronger comparison combines academic, financial and everyday-life information.", columns: "3", cards: [
      { title: "Academic route", description: "Compare available study levels, fields, entry expectations and progression options." },
      { title: "Budget reality", description: "Review current tuition together with accommodation, transport and living costs." },
      { title: "Location and lifestyle", description: "Consider city scale, climate, campus geography and how you will travel each day." },
      { title: "Application timing", description: "Check intake dates, preparation time and the documents required for the next step." },
      { title: "Student support", description: "Understand the support available from the institution and in the destination." },
      { title: "Future fit", description: "Keep academic progression and career goals in view without relying on guarantees." },
    ] }),
    block("faq", { title: "Questions to ask before choosing a country", subtitle: "Use these prompts when comparing destination pages and speaking with an adviser.", source: "manual", items: [
      { question: "What is the realistic total budget?", answer: "Combine current tuition with housing, transport, insurance and everyday costs. Treat estimates as a starting point and verify them before committing." },
      { question: "How do I compare cities within one country?", answer: "Compare campus location, housing supply, transport, climate and the availability of your preferred programs—not only the country average." },
      { question: "When should I start preparing?", answer: "Work backwards from the intake and allow time for requirements, documents, institution review and any visa process that applies." },
    ] }),
    block("cta_banner", { title: localized(locale, "countries.notSure", "Not sure where to study?"), subtitle: localized(locale, "countries.notSureDesc", "Our advisers can help you compare the strongest options."), ctaLabel: localized(locale, "countries.freeCounseling", "Get free counselling"), ctaUrl: contactPath, secondaryLabel: localized(locale, "about.browsePrograms", "Browse Programs"), secondaryUrl: programsPath, bgStyle: "gradient", bgImage: "" }),
  ];
}

function programsStarter(locale: Language): PageBlock[] {
  const programsPath = route(locale, "/programs");
  const contactPath = route(locale, "/contact");
  const countriesPath = route(locale, "/countries");
  return [
    block("hero", { badge: localized(locale, "programs.badge", "Find your program"), title: joinedTitle(locale, "programs", "Discover programs"), subtitle: localized(locale, "programs.subtitle", "Browse programs from universities worldwide."), ctaLabel: localized(locale, "programs.viewDetails", "View programs"), ctaUrl: "#program-list", secondaryLabel: localized(locale, "programs.talkToAdvisor", "Talk to an adviser"), secondaryUrl: contactPath, backgroundImage: "", overlay: true }),
    block("progress_bars", { title: localized(locale, "about.getStarted", "Build a stronger shortlist"), subtitle: localized(locale, "programs.cantFindDesc", "Use live filters and adviser support to find the right fit."), items: [
      { label: localized(locale, "programs.filterCountry", "Country"), value: 25, note: localized(locale, "countries.subtitle", "Start with destination context.") },
      { label: localized(locale, "programs.filterUniversity", "University"), value: 50, note: localized(locale, "about.globalReachDesc", "Compare institutions and locations.") },
      { label: localized(locale, "programs.filterLevel", "Study level"), value: 75, note: localized(locale, "programs.requirements", "Review requirements and study details.") },
      { label: localized(locale, "programs.apply", "Apply now"), value: 100, note: localized(locale, "programs.talkToAdvisor", "Talk to an adviser before the next step.") },
    ] }),
    block("catalog_grid", { title: localized(locale, "programs.titleHighlight", "Current programs"), subtitle: localized(locale, "programs.subtitle", "Program information comes from the live catalogue."), source: "programs", limit: 12, country: "", city: "", layout: "grid", columns: "3" }),
    block("counter_grid", { title: localized(locale, "programs.moreFilters", "Search from every angle"), subtitle: localized(locale, "programs.noResultsDesc", "Refine the catalogue around the details that matter."), columns: "4", items: [
      { value: "01", label: localized(locale, "programs.filterCountry", "Country"), description: localized(locale, "programs.allCountries", "All countries") },
      { value: "02", label: localized(locale, "programs.filterUniversity", "University"), description: localized(locale, "programs.allUniversities", "All universities") },
      { value: "03", label: localized(locale, "programs.filterLevel", "Study level"), description: localized(locale, "programs.allLevels", "All levels") },
      { value: "04", label: localized(locale, "programs.filterLanguage", "Language"), description: localized(locale, "programs.allLanguages", "All languages") },
    ] }),
    block("scroll_box", { title: localized(locale, "programs.moreFilters", "Explore more filters"), subtitle: localized(locale, "programs.noResultsDesc", "Use a focused route into the live catalogue."), cardSize: "compact", items: [
      { title: localized(locale, "programs.filterCountry", "Country"), description: localized(locale, "countries.subtitle", "Compare study destinations."), linkLabel: localized(locale, "countries.explore", "Explore"), linkUrl: countriesPath },
      { title: localized(locale, "programs.filterCity", "City"), description: localized(locale, "countries.notSureDesc", "Consider location, budget and daily life."), linkLabel: localized(locale, "common.viewAll", "View all"), linkUrl: countriesPath },
      { title: localized(locale, "programs.filterUniversity", "University"), description: localized(locale, "about.globalReachDesc", "Review partner institutions."), linkLabel: localized(locale, "programs.viewDetails", "View details"), linkUrl: programsPath },
      { title: localized(locale, "programs.filterField", "Field"), description: localized(locale, "programs.subtitle", "Find the study route that fits your goals."), linkLabel: localized(locale, "common.search", "Search"), linkUrl: programsPath },
    ] }),
    block("cta_banner", { title: localized(locale, "programs.cantFind", "Can't find the right program?"), subtitle: localized(locale, "programs.cantFindDesc", "An adviser can help you build a shortlist."), ctaLabel: localized(locale, "programs.talkToAdvisor", "Talk to an adviser"), ctaUrl: contactPath, secondaryLabel: localized(locale, "countries.explore", "Explore destinations"), secondaryUrl: countriesPath, bgStyle: "gradient", bgImage: "" }),
  ];
}

function blogStarter(locale: Language): PageBlock[] {
  const programsPath = route(locale, "/programs");
  const contactPath = route(locale, "/contact");
  return [
    block("hero", { badge: localized(locale, "blog.badge", "The Blog"), title: joinedTitle(locale, "blog", "Insights & advice"), subtitle: localized(locale, "blog.subtitle", "Expert guidance for studying abroad."), ctaLabel: localized(locale, "about.browsePrograms", "Browse Programs"), ctaUrl: programsPath, secondaryLabel: localized(locale, "nav.contact", "Contact"), secondaryUrl: contactPath, backgroundImage: "", overlay: true }),
    block("carousel_box", { title: localized(locale, "blog.readMore", "Featured guidance"), subtitle: localized(locale, "blog.subtitle", "Explore practical guidance for each stage of the journey."), slides: [
      { eyebrow: localized(locale, "blog.universityGuide", "University guide"), title: localized(locale, "blog.universityGuide", "University guide"), description: localized(locale, "programs.subtitle", "Compare programs and universities with current catalogue context."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: programsPath },
      { eyebrow: localized(locale, "blog.visaTips", "Visa tips"), title: localized(locale, "blog.visaTips", "Visa tips"), description: localized(locale, "features.visaDesc", "Expert guidance for the visa journey."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
      { eyebrow: localized(locale, "blog.scholarships", "Scholarships"), title: localized(locale, "blog.scholarships", "Scholarships"), description: localized(locale, "blog.subtitle", "Research funding, applications and student life."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
    ] }),
    block("scroll_box", { title: localized(locale, "blog.filterByCategory", "Browse by category"), subtitle: localized(locale, "blog.tryAdjusting", "Choose a topic to focus your research."), cardSize: "compact", items: [
      { title: localized(locale, "blog.universityGuide", "University guide"), description: localized(locale, "countries.subtitle", "Compare destinations and institutions."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
      { title: localized(locale, "blog.visaTips", "Visa tips"), description: localized(locale, "features.visaDesc", "Prepare with clearer document guidance."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
      { title: localized(locale, "blog.scholarships", "Scholarships"), description: localized(locale, "about.excellenceDesc", "Review opportunities with verified details."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
      { title: localized(locale, "blog.studentLife", "Student life"), description: localized(locale, "about.communityDesc", "Understand life beyond the application."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
      { title: localized(locale, "blog.careerAdvice", "Career advice"), description: localized(locale, "about.studentFirstDesc", "Keep long-term goals in the decision."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
    ] }),
    block("grid_box", { eyebrow: localized(locale, "blog.badge", "The Blog"), title: localized(locale, "blog.title", "Insights"), subtitle: localized(locale, "blog.subtitle", "Guidance organised around real student decisions."), columns: "3", cards: [
      { title: localized(locale, "blog.universityGuide", "University guide"), description: localized(locale, "programs.subtitle", "Research current study options."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
      { title: localized(locale, "blog.scholarships", "Scholarships"), description: localized(locale, "about.innovationDesc", "Use current information to prepare."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
      { title: localized(locale, "blog.studentLife", "Student life"), description: localized(locale, "about.communityDesc", "Build context around the destination."), linkLabel: localized(locale, "blog.readMore", "Read more"), linkUrl: "#articles" },
    ] }),
    block("cta_banner", { title: localized(locale, "programs.cantFind", "Turn research into a study plan"), subtitle: localized(locale, "programs.cantFindDesc", "Discuss your shortlist with an education adviser."), ctaLabel: localized(locale, "programs.talkToAdvisor", "Talk to an adviser"), ctaUrl: contactPath, secondaryLabel: localized(locale, "about.browsePrograms", "Browse Programs"), secondaryUrl: programsPath, bgStyle: "gradient", bgImage: "" }),
  ];
}

function contactStarter(locale: Language): PageBlock[] {
  const programsPath = route(locale, "/programs");
  const countriesPath = route(locale, "/countries");
  return [
    block("hero", { badge: localized(locale, "contact.badge", "We're here to help"), title: joinedTitle(locale, "contact", "Contact us"), subtitle: localized(locale, "contact.subtitle", "Book a free consultation or ask us anything."), ctaLabel: localized(locale, "about.browsePrograms", "Browse Programs"), ctaUrl: programsPath, secondaryLabel: localized(locale, "countries.explore", "Explore destinations"), secondaryUrl: countriesPath, backgroundImage: "", overlay: true }),
    block("counter_grid", { title: localized(locale, "contact.quickContact", "Quick contact"), subtitle: localized(locale, "contact.formSubtitle", "Choose the channel that works best for you."), columns: "3", items: [
      { value: "2h", label: localized(locale, "contact.emailLabel", "Email"), description: localized(locale, "contact.successMessage", "An adviser will respond shortly.") },
      { value: "☎", label: localized(locale, "contact.phoneLabel", "Phone"), description: localized(locale, "contact.hoursValue", "Monday to Saturday") },
      { value: "6d", label: localized(locale, "contact.hoursLabel", "Hours"), description: localized(locale, "contact.hoursValue", "Monday to Saturday") },
    ] }),
    block("grid_box", { eyebrow: localized(locale, "contact.badge", "We're here to help"), title: localized(locale, "contact.formTitle", "Send us a message"), subtitle: localized(locale, "contact.formSubtitle", "Share your plans and we will get back to you."), columns: "3", cards: [
      { title: localized(locale, "contact.emailLabel", "Email"), description: localized(locale, "contact.successMessage", "An adviser will contact you shortly."), linkLabel: localized(locale, "contact.send", "Send message"), linkUrl: "mailto:info@findandstudy.com" },
      { title: localized(locale, "contact.phoneLabel", "Phone"), description: localized(locale, "contact.hoursValue", "Monday to Saturday"), linkLabel: "", linkUrl: "" },
      { title: localized(locale, "contact.ourOffices", "Our offices"), description: localized(locale, "contact.subtitle", "Contact the Find And Study team for support."), linkLabel: localized(locale, "countries.explore", "Explore"), linkUrl: "#offices" },
    ] }),
    block("office_list", { title: localized(locale, "contact.ourOffices", "Our offices"), subtitle: localized(locale, "contact.subtitle", "Office details are loaded from the managed collection."), source: "collection", offices: [] }),
    block("column_layout", { title: localized(locale, "contact.formTitle", "Start a conversation"), subtitle: localized(locale, "contact.formSubtitle", "A clear three-step path to the right support."), columns: "3", items: [
      { eyebrow: "01", title: localized(locale, "contact.send", "Send message"), body: localized(locale, "contact.messagePlaceholder", "Tell us about your education goals.") },
      { eyebrow: "02", title: localized(locale, "contact.successTitle", "Message received"), body: localized(locale, "contact.successMessage", "An adviser will contact you shortly.") },
      { eyebrow: "03", title: localized(locale, "about.getStarted", "Plan the next step"), body: localized(locale, "programs.cantFindDesc", "Build a shortlist around your goals and budget."), linkLabel: localized(locale, "about.browsePrograms", "Browse Programs"), linkUrl: programsPath },
    ] }),
    block("cta_banner", { title: localized(locale, "countries.notSure", "Explore before you enquire"), subtitle: localized(locale, "countries.notSureDesc", "Compare current destinations and programs."), ctaLabel: localized(locale, "countries.explore", "Explore destinations"), ctaUrl: countriesPath, secondaryLabel: localized(locale, "about.browsePrograms", "Browse Programs"), secondaryUrl: programsPath, bgStyle: "gradient", bgImage: "" }),
  ];
}

function starterFor(template: ManagedTemplate, locale: Language): PageBlock[] {
  if (template === "home") return managedHomePageBlocks(DEFAULT_HOME_COPY, route(locale, "/programs"));
  if (template === "about") return aboutStarter(locale);
  if (template === "countries") return countriesStarter(locale);
  if (template === "programs") return programsStarter(locale);
  if (template === "blog") return blogStarter(locale);
  return contactStarter(locale);
}

export function managedPageStarterBlocks(template: string | null | undefined, locale: Language = "en"): PageBlock[] {
  const normalized = String(template || "").toLowerCase() as ManagedTemplate;
  if (!(["home", "about", "countries", "programs", "blog", "contact"] as string[]).includes(normalized)) return [];
  return starterFor(normalized, locale).map((entry, index) => ({
    ...entry,
    content: structuredClone(entry.content),
    settings: structuredClone(entry.settings),
    sortOrder: index,
  }));
}

const LEGACY_MANAGED_TYPES: Record<Exclude<ManagedTemplate, "home">, string[][]> = {
  about: [
    ["hero", "stats_strip", "rich_text", "icon_cards", "team_grid", "office_list", "cta_banner"],
    ["hero", "counter_grid", "media_text", "grid_box", "team_grid", "logo_marquee", "office_list", "cta_banner"],
    ["global_block", "team_grid", "catalog_grid", "section_title"],
  ],
  countries: [
    ["hero", "catalog_grid", "cta_banner"],
    ["hero", "counter_grid", "catalog_grid", "scroll_box", "column_layout", "cta_banner"],
  ],
  programs: [
    ["hero", "catalog_grid", "cta_banner"],
    ["hero", "progress_bars", "catalog_grid", "counter_grid", "scroll_box", "cta_banner"],
  ],
  blog: [
    ["hero", "rich_text", "cta_banner"],
    ["hero", "carousel_box", "scroll_box", "grid_box", "cta_banner"],
  ],
  contact: [
    ["hero", "office_list", "rich_text", "cta_banner"],
    ["hero", "counter_grid", "grid_box", "office_list", "column_layout", "cta_banner"],
  ],
};

export function enrichManagedPageBlocks(template: string | null | undefined, blocks: ManagedHomeBlockInput[], locale: Language = "en"): PageBlock[] {
  const normalized = String(template || "").toLowerCase() as ManagedTemplate;
  if (normalized === "home") return enrichManagedHomePageBlocks(blocks, route(locale, "/programs"));
  if (!(normalized in LEGACY_MANAGED_TYPES)) return blocks.map((entry, index) => ({ ...entry, isVisible: entry.isVisible ?? true, sortOrder: index }));
  const types = blocks.map(entry => entry.blockType);
  const legacy = LEGACY_MANAGED_TYPES[normalized as Exclude<ManagedTemplate, "home">].some(signature => signature.length === types.length && signature.every((type, index) => type === types[index]));
  if (!legacy) return blocks.map((entry, index) => ({ ...entry, isVisible: entry.isVisible ?? true, sortOrder: index }));
  const existing = new Map(blocks.map(entry => [entry.blockType, { ...entry, isVisible: entry.isVisible ?? true }]));
  return managedPageStarterBlocks(normalized, locale).map((entry, index) => ({
    ...(existing.get(entry.blockType) || entry),
    sortOrder: index,
  }));
}

export async function managedPageStarterTranslations(template: string | null | undefined, sourceLocale: Language): Promise<Record<string, { blocks: PageBlock[] }>> {
  if (String(template || "").toLowerCase() === "home") return {};
  await Promise.all(SUPPORTED_LANGUAGES.map(locale => loadLanguage(locale)));
  return Object.fromEntries(SUPPORTED_LANGUAGES
    .filter(locale => locale !== sourceLocale)
    .map(locale => [locale, { blocks: managedPageStarterBlocks(template, locale) }]));
}
