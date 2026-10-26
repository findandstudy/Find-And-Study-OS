export interface BlockFieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "richtext" | "html" | "image" | "url" | "number" | "select" | "toggle" | "color" | "items";
  placeholder?: string;
  options?: { label: string; value: string }[];
  itemFields?: BlockFieldDef[];
  defaultValue?: unknown;
}

export interface BlockTypeDef {
  type: string;
  label: string;
  icon: string;
  category: "content" | "media" | "layout" | "data" | "reference";
  fields: BlockFieldDef[];
  defaultContent: Record<string, unknown>;
}

export const SECTION_STYLE_FIELDS: BlockFieldDef[] = [
  { key: "useThemeColors", label: "Use Theme Builder Colors", type: "toggle", defaultValue: true },
  { key: "sectionBackgroundColor", label: "Section Background", type: "color" },
  { key: "sectionTextColor", label: "Section Text", type: "color" },
  { key: "sectionAccentColor", label: "Accent / Link Color", type: "color" },
  { key: "cardBackgroundColor", label: "Card Background", type: "color" },
  { key: "sectionBorderColor", label: "Border Color", type: "color" },
  { key: "sectionButtonColor", label: "Button Background", type: "color" },
  { key: "sectionButtonTextColor", label: "Button Text", type: "color" },
  { key: "sectionWidth", label: "Content Width", type: "select", options: [{ label: "Narrow", value: "760px" }, { label: "Medium", value: "960px" }, { label: "Wide", value: "1260px" }, { label: "Full", value: "100%" }] },
  { key: "sectionPadding", label: "Vertical Spacing (px)", type: "number", defaultValue: 72 },
];
export const SECTION_STYLE_KEYS = new Set(SECTION_STYLE_FIELDS.map(field => field.key));
export const BLOCK_APPEARANCE_KEYS = new Set([
  ...SECTION_STYLE_KEYS,
  "overlay", "backgroundColor", "gradientColor", "textColor", "overlayColor", "overlayOpacity",
  "primaryButtonColor", "primaryButtonTextColor",
]);
const SECTION_STYLE_BLOCKS = new Set(["hero", "home_fallback_hero", "home_fallback_stats", "home_fallback_features", "rich_text", "html_content", "stats_strip", "catalog_grid", "feature_cards", "icon_cards", "cta_banner", "faq", "team_grid", "office_list", "logo_grid", "testimonials", "grid_box", "scroll_box", "carousel_box", "column_layout", "progress_bars", "counter_grid", "logo_marquee", "section_title", "media_text", "image_gallery", "process_steps", "quote_banner"]);

export const BLOCK_TYPES: BlockTypeDef[] = [
  {
    type: "hero",
    label: "Hero",
    icon: "🏠",
    category: "content",
    fields: [
      { key: "badge", label: "Badge Text", type: "text", placeholder: "e.g. #1 Education Consultancy" },
      { key: "title", label: "Title", type: "text", placeholder: "Your headline" },
      { key: "subtitle", label: "Subtitle", type: "textarea", placeholder: "Supporting text" },
      { key: "ctaLabel", label: "CTA Button Label", type: "text", placeholder: "Get Started" },
      { key: "ctaUrl", label: "CTA Button URL", type: "url", placeholder: "/contact" },
      { key: "secondaryLabel", label: "Secondary Button Label", type: "text" },
      { key: "secondaryUrl", label: "Secondary Button URL", type: "url" },
      { key: "backgroundImage", label: "Background Image", type: "image" },
      { key: "overlay", label: "Show Overlay", type: "toggle", defaultValue: true },
      { key: "useThemeColors", label: "Use Theme Builder Colors", type: "toggle", defaultValue: true },
      { key: "backgroundColor", label: "Hero Start Color", type: "color" },
      { key: "gradientColor", label: "Hero End Color", type: "color" },
      { key: "textColor", label: "Hero Text Color", type: "color" },
      { key: "overlayColor", label: "Overlay Color", type: "color" },
      { key: "overlayOpacity", label: "Overlay Opacity (0–100)", type: "number", defaultValue: 28 },
      { key: "primaryButtonColor", label: "Primary Button Color", type: "color" },
      { key: "primaryButtonTextColor", label: "Primary Button Text Color", type: "color" },
    ],
    defaultContent: { badge: "", title: "Welcome", subtitle: "", ctaLabel: "Get Started", ctaUrl: "/contact", secondaryLabel: "", secondaryUrl: "", backgroundImage: "", overlay: true, useThemeColors: true, backgroundColor: "", gradientColor: "", textColor: "", overlayColor: "", overlayOpacity: 28, primaryButtonColor: "", primaryButtonTextColor: "" },
  },
  {
    type: "rich_text",
    label: "Rich Text",
    icon: "📝",
    category: "content",
    fields: [
      { key: "content", label: "Content (HTML)", type: "richtext", placeholder: "Enter rich text content..." },
      { key: "maxWidth", label: "Max Width", type: "select", options: [{ label: "Narrow", value: "narrow" }, { label: "Medium", value: "medium" }, { label: "Wide", value: "wide" }, { label: "Full", value: "full" }] },
    ],
    defaultContent: { content: "<p>Enter your content here...</p>", maxWidth: "medium" },
  },
  {
    type: "html_content",
    label: "HTML Content",
    icon: "</>",
    category: "content",
    fields: [
      { key: "title", label: "Section Title", type: "text", placeholder: "Optional section title" },
      { key: "html", label: "HTML Markup", type: "html", placeholder: "<section>...</section>" },
    ],
    defaultContent: {
      title: "Custom content",
      html: "<div class=\"html-content-grid\"><article class=\"html-content-card\"><h3>Editable HTML card</h3><p>Add semantic HTML here. Scripts, inline styles, embeds and forms are removed for safety.</p><a class=\"html-content-button\" href=\"/en/contact\">Learn more</a></article></div>",
    },
  },
  {
    type: "stats_strip",
    label: "Stats Strip",
    icon: "📊",
    category: "data",
    fields: [
      { key: "bgColor", label: "Background", type: "select", options: [{ label: "Primary", value: "primary" }, { label: "Card", value: "card" }, { label: "Transparent", value: "transparent" }] },
      {
        key: "stats", label: "Stats", type: "items",
        itemFields: [
          { key: "value", label: "Value", type: "text", placeholder: "500+" },
          { key: "label", label: "Label", type: "text", placeholder: "Universities" },
        ],
      },
    ],
    defaultContent: { bgColor: "card", stats: [{ value: "500+", label: "Universities" }, { value: "30+", label: "Countries" }, { value: "98%", label: "Visa Rate" }, { value: "$2M+", label: "Scholarships" }] },
  },
  {
    type: "catalog_grid",
    label: "Live Catalog Grid",
    icon: "🔄",
    category: "data",
    fields: [
      { key: "title", label: "Section Title", type: "text", placeholder: "Explore our catalogue" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      {
        key: "source",
        label: "Catalogue Source",
        type: "select",
        options: [
          { label: "Programs", value: "programs" },
          { label: "Universities", value: "universities" },
          { label: "Destinations", value: "destinations" },
          { label: "Cities", value: "cities" },
        ],
      },
      { key: "limit", label: "Items to show", type: "number", defaultValue: 6 },
      { key: "country", label: "Country filter (optional)", type: "text" },
      { key: "city", label: "City filter (optional)", type: "text" },
    ],
    defaultContent: {
      title: "Explore our catalogue",
      subtitle: "Browse current options from the live catalogue.",
      source: "programs",
      limit: 6,
      country: "",
      city: "",
    },
  },
  {
    type: "feature_cards",
    label: "Feature Cards",
    icon: "🃏",
    category: "content",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "columns", label: "Columns", type: "select", options: [{ label: "2", value: "2" }, { label: "3", value: "3" }, { label: "4", value: "4" }] },
      {
        key: "cards", label: "Cards", type: "items",
        itemFields: [
          { key: "icon", label: "Icon Name", type: "text", placeholder: "Globe2" },
          { key: "title", label: "Title", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "linkUrl", label: "Link URL", type: "url" },
          { key: "linkLabel", label: "Link Label", type: "text" },
        ],
      },
    ],
    defaultContent: { title: "Our Services", subtitle: "", columns: "3", cards: [{ icon: "Globe2", title: "University Matching", description: "Find your ideal university.", linkUrl: "", linkLabel: "" }] },
  },
  {
    type: "icon_cards",
    label: "Icon Cards",
    icon: "🔲",
    category: "content",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      {
        key: "cards", label: "Cards", type: "items",
        itemFields: [
          { key: "icon", label: "Icon Name", type: "text" },
          { key: "title", label: "Title", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
        ],
      },
    ],
    defaultContent: { title: "Why Choose Us", subtitle: "", cards: [{ icon: "Star", title: "Expert Guidance", description: "Professional consultants." }] },
  },
  {
    type: "media_text",
    label: "Image + Text",
    icon: "🖼️",
    category: "media",
    fields: [
      { key: "eyebrow", label: "Upper Label", type: "text", placeholder: "Student support" },
      { key: "title", label: "Section Title", type: "text" },
      { key: "body", label: "Supporting Text", type: "textarea" },
      { key: "imageUrl", label: "Image URL", type: "image" },
      { key: "altText", label: "Image Alt Text", type: "text" },
      { key: "imagePosition", label: "Image Position", type: "select", options: [{ label: "Left", value: "left" }, { label: "Right", value: "right" }] },
      { key: "ctaLabel", label: "Button Label", type: "text" },
      { key: "ctaUrl", label: "Button URL", type: "url" },
    ],
    defaultContent: { eyebrow: "Student support", title: "Guidance at every step", body: "Add a concise explanation that helps visitors understand this part of the journey.", imageUrl: "", altText: "", imagePosition: "left", ctaLabel: "Learn more", ctaUrl: "/contact" },
  },
  {
    type: "image_gallery",
    label: "Image Gallery",
    icon: "▦",
    category: "media",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "columns", label: "Columns", type: "select", options: [{ label: "2", value: "2" }, { label: "3", value: "3" }, { label: "4", value: "4" }] },
      {
        key: "images", label: "Gallery Images", type: "items",
        itemFields: [
          { key: "imageUrl", label: "Image URL", type: "image" },
          { key: "altText", label: "Alt Text", type: "text" },
          { key: "caption", label: "Caption", type: "text" },
          { key: "linkUrl", label: "Link URL", type: "url" },
        ],
      },
    ],
    defaultContent: { title: "Life at a glance", subtitle: "Show the campus, city or student experience.", columns: "3", images: [{ imageUrl: "", altText: "", caption: "", linkUrl: "" }] },
  },
  {
    type: "process_steps",
    label: "Process Steps",
    icon: "①",
    category: "content",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      {
        key: "steps", label: "Steps", type: "items",
        itemFields: [
          { key: "number", label: "Step Number", type: "text" },
          { key: "title", label: "Title", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
        ],
      },
    ],
    defaultContent: { title: "How it works", subtitle: "A clear path from discovery to enrolment.", steps: [{ number: "01", title: "Discover", description: "Explore suitable study options." }, { number: "02", title: "Prepare", description: "Build a complete application." }, { number: "03", title: "Apply", description: "Submit and track every milestone." }] },
  },
  {
    type: "quote_banner",
    label: "Featured Quote",
    icon: "❝",
    category: "content",
    fields: [
      { key: "quote", label: "Quote", type: "textarea" },
      { key: "author", label: "Author", type: "text" },
      { key: "role", label: "Role / Context", type: "text" },
      { key: "imageUrl", label: "Portrait URL", type: "image" },
    ],
    defaultContent: { quote: "The right guidance turns a complex application into a clear next step.", author: "Find And Study", role: "Student advisory team", imageUrl: "" },
  },
  {
    type: "cta_banner",
    label: "CTA Banner",
    icon: "📢",
    category: "content",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "subtitle", label: "Subtitle", type: "textarea" },
      { key: "ctaLabel", label: "Button Label", type: "text" },
      { key: "ctaUrl", label: "Button URL", type: "url" },
      { key: "secondaryLabel", label: "Secondary Button", type: "text" },
      { key: "secondaryUrl", label: "Secondary URL", type: "url" },
      { key: "bgStyle", label: "Background Style", type: "select", options: [{ label: "Gradient", value: "gradient" }, { label: "Solid Primary", value: "solid" }, { label: "Image", value: "image" }] },
      { key: "bgImage", label: "Background Image", type: "image" },
    ],
    defaultContent: { title: "Ready to Start?", subtitle: "Get in touch today.", ctaLabel: "Contact Us", ctaUrl: "/contact", secondaryLabel: "", secondaryUrl: "", bgStyle: "gradient", bgImage: "" },
  },
  {
    type: "faq",
    label: "FAQ",
    icon: "❓",
    category: "data",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "source", label: "Source", type: "select", options: [{ label: "Manual", value: "manual" }, { label: "From Collections", value: "collection" }] },
      {
        key: "items", label: "FAQ Items", type: "items",
        itemFields: [
          { key: "question", label: "Question", type: "text" },
          { key: "answer", label: "Answer", type: "textarea" },
        ],
      },
    ],
    defaultContent: { title: "Frequently Asked Questions", subtitle: "", source: "manual", items: [{ question: "How do I apply?", answer: "Contact our team to get started." }] },
  },
  {
    type: "team_grid",
    label: "Team Grid",
    icon: "👥",
    category: "data",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "source", label: "Source", type: "select", options: [{ label: "From Collections", value: "collection" }, { label: "Manual", value: "manual" }] },
      {
        key: "members", label: "Team Members", type: "items",
        itemFields: [
          { key: "name", label: "Name", type: "text" },
          { key: "role", label: "Role", type: "text" },
          { key: "photo", label: "Photo URL", type: "image" },
          { key: "bio", label: "Bio", type: "textarea" },
        ],
      },
    ],
    defaultContent: { title: "Our Team", subtitle: "", source: "collection", members: [] },
  },
  {
    type: "office_list",
    label: "Office List",
    icon: "🏢",
    category: "data",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "source", label: "Source", type: "select", options: [{ label: "From Collections", value: "collection" }, { label: "Manual", value: "manual" }] },
      {
        key: "offices", label: "Offices", type: "items",
        itemFields: [
          { key: "name", label: "Name", type: "text" },
          { key: "city", label: "City", type: "text" },
          { key: "address", label: "Address", type: "textarea" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "email", label: "Email", type: "text" },
        ],
      },
    ],
    defaultContent: { title: "Our Offices", subtitle: "", source: "collection", offices: [] },
  },
  {
    type: "logo_grid",
    label: "Logo Grid",
    icon: "🏷️",
    category: "media",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      {
        key: "logos", label: "Logos", type: "items",
        itemFields: [
          { key: "name", label: "Name", type: "text" },
          { key: "imageUrl", label: "Logo URL", type: "image" },
          { key: "linkUrl", label: "Link URL", type: "url" },
        ],
      },
    ],
    defaultContent: { title: "Partner Universities", subtitle: "", logos: [] },
  },
  {
    type: "testimonials",
    label: "Testimonials",
    icon: "💬",
    category: "data",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "source", label: "Source", type: "select", options: [{ label: "From Collections", value: "collection" }, { label: "Manual", value: "manual" }] },
      { key: "layout", label: "Layout", type: "select", options: [{ label: "Carousel", value: "carousel" }, { label: "Grid", value: "grid" }] },
      {
        key: "items", label: "Testimonials", type: "items",
        itemFields: [
          { key: "name", label: "Name", type: "text" },
          { key: "role", label: "Role", type: "text" },
          { key: "content", label: "Content", type: "textarea" },
          { key: "photo", label: "Photo URL", type: "image" },
          { key: "rating", label: "Rating (1-5)", type: "number" },
        ],
      },
    ],
    defaultContent: { title: "What Students Say", subtitle: "", source: "collection", layout: "carousel", items: [] },
  },
  {
    type: "grid_box",
    label: "Grid Boxes",
    icon: "▦",
    category: "layout",
    fields: [
      { key: "eyebrow", label: "Eyebrow", type: "text" },
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "columns", label: "Columns", type: "select", options: [{ label: "2 Columns", value: "2" }, { label: "3 Columns", value: "3" }, { label: "4 Columns", value: "4" }] },
      {
        key: "cards", label: "Cards", type: "items",
        itemFields: [
          { key: "imageUrl", label: "Image URL", type: "image" },
          { key: "title", label: "Title", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "linkLabel", label: "Link Label", type: "text" },
          { key: "linkUrl", label: "Link URL", type: "url" },
        ],
      },
    ],
    defaultContent: { eyebrow: "Explore", title: "A flexible content grid", subtitle: "", columns: "3", cards: [] },
  },
  {
    type: "scroll_box",
    label: "Horizontal Scroll Boxes",
    icon: "↔",
    category: "layout",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "cardSize", label: "Card Size", type: "select", options: [{ label: "Compact", value: "compact" }, { label: "Standard", value: "standard" }, { label: "Wide", value: "wide" }] },
      {
        key: "items", label: "Scrollable Cards", type: "items",
        itemFields: [
          { key: "imageUrl", label: "Image URL", type: "image" },
          { key: "title", label: "Title", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "linkLabel", label: "Link Label", type: "text" },
          { key: "linkUrl", label: "Link URL", type: "url" },
        ],
      },
    ],
    defaultContent: { title: "Browse the collection", subtitle: "Swipe or scroll to explore.", cardSize: "standard", items: [] },
  },
  {
    type: "carousel_box",
    label: "Visual Carousel",
    icon: "▤",
    category: "media",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      {
        key: "slides", label: "Slides", type: "items",
        itemFields: [
          { key: "imageUrl", label: "Image URL", type: "image" },
          { key: "eyebrow", label: "Eyebrow", type: "text" },
          { key: "title", label: "Title", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "linkLabel", label: "Link Label", type: "text" },
          { key: "linkUrl", label: "Link URL", type: "url" },
        ],
      },
    ],
    defaultContent: { title: "Featured stories", subtitle: "", slides: [] },
  },
  {
    type: "column_layout",
    label: "Text Columns",
    icon: "▥",
    category: "layout",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "columns", label: "Columns", type: "select", options: [{ label: "2 Columns", value: "2" }, { label: "3 Columns", value: "3" }, { label: "4 Columns", value: "4" }] },
      {
        key: "items", label: "Columns", type: "items",
        itemFields: [
          { key: "eyebrow", label: "Eyebrow", type: "text" },
          { key: "title", label: "Title", type: "text" },
          { key: "body", label: "Body", type: "textarea" },
          { key: "linkLabel", label: "Link Label", type: "text" },
          { key: "linkUrl", label: "Link URL", type: "url" },
        ],
      },
    ],
    defaultContent: { title: "Built around your journey", subtitle: "", columns: "3", items: [] },
  },
  {
    type: "progress_bars",
    label: "Progress Bars",
    icon: "▰",
    category: "data",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      {
        key: "items", label: "Progress Items", type: "items",
        itemFields: [
          { key: "label", label: "Label", type: "text" },
          { key: "value", label: "Progress (0–100)", type: "number" },
          { key: "note", label: "Supporting Note", type: "text" },
        ],
      },
    ],
    defaultContent: { title: "Progress at a glance", subtitle: "", items: [{ label: "Example milestone", value: 72, note: "72% complete" }] },
  },
  {
    type: "counter_grid",
    label: "Counter Grid",
    icon: "123",
    category: "data",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      { key: "columns", label: "Columns", type: "select", options: [{ label: "2 Columns", value: "2" }, { label: "3 Columns", value: "3" }, { label: "4 Columns", value: "4" }] },
      {
        key: "items", label: "Counters", type: "items",
        itemFields: [
          { key: "prefix", label: "Prefix", type: "text" },
          { key: "value", label: "Value", type: "text" },
          { key: "suffix", label: "Suffix", type: "text" },
          { key: "label", label: "Label", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
        ],
      },
    ],
    defaultContent: { title: "Impact in numbers", subtitle: "", columns: "4", items: [] },
  },
  {
    type: "logo_marquee",
    label: "Logo Marquee",
    icon: "∞",
    category: "media",
    fields: [
      { key: "title", label: "Section Title", type: "text" },
      { key: "subtitle", label: "Section Subtitle", type: "textarea" },
      {
        key: "items", label: "Logos", type: "items",
        itemFields: [
          { key: "name", label: "Name", type: "text" },
          { key: "imageUrl", label: "Logo URL", type: "image" },
          { key: "linkUrl", label: "Link URL", type: "url" },
        ],
      },
    ],
    defaultContent: { title: "Trusted partners", subtitle: "", items: [] },
  },
  {
    type: "section_title",
    label: "Section Title + Subtitle",
    icon: "📌",
    category: "layout",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "subtitle", label: "Subtitle", type: "textarea" },
      { key: "alignment", label: "Alignment", type: "select", options: [{ label: "Left", value: "left" }, { label: "Center", value: "center" }, { label: "Right", value: "right" }] },
      { key: "size", label: "Size", type: "select", options: [{ label: "Small", value: "sm" }, { label: "Medium", value: "md" }, { label: "Large", value: "lg" }] },
    ],
    defaultContent: { title: "Section Title", subtitle: "", alignment: "center", size: "md" },
  },
  {
    type: "spacer_divider",
    label: "Spacer / Divider",
    icon: "➖",
    category: "layout",
    fields: [
      { key: "height", label: "Height (px)", type: "number", defaultValue: 48 },
      { key: "showDivider", label: "Show Divider Line", type: "toggle" },
      { key: "dividerColor", label: "Divider Color", type: "color" },
    ],
    defaultContent: { height: 48, showDivider: false, dividerColor: "#e5e7eb" },
  },
  {
    type: "global_block",
    label: "Reusable Global Block",
    icon: "🔗",
    category: "reference",
    fields: [
      { key: "globalComponentId", label: "Global Component ID", type: "number" },
      { key: "globalComponentSlug", label: "Component Slug", type: "text" },
    ],
    defaultContent: { globalComponentId: null, globalComponentSlug: "" },
  },
];

export function getBlockTypeDef(type: string): BlockTypeDef | undefined {
  const managedHomeAliases: Record<string, { base: string; label: string }> = {
    home_fallback_hero: { base: "hero", label: "Hero" },
    home_fallback_stats: { base: "stats_strip", label: "Statistics" },
    home_fallback_features: { base: "feature_cards", label: "Services" },
  };
  const alias = managedHomeAliases[type];
  const baseDefinition = BLOCK_TYPES.find(bt => bt.type === (alias?.base || type));
  let definition = baseDefinition && alias
    ? { ...baseDefinition, type, label: alias.label }
    : baseDefinition;
  if (definition && type === "home_fallback_hero") {
    definition = {
      ...definition,
      fields: [
        ...definition.fields,
        { key: "signalTitle", label: "Journey Panel Title", type: "text" },
        { key: "signalSubtitle", label: "Journey Panel Text", type: "textarea" },
        {
          key: "signals",
          label: "Journey Steps",
          type: "items",
          itemFields: [
            { key: "label", label: "Step", type: "text" },
            { key: "detail", label: "Description", type: "text" },
          ],
        },
      ],
      defaultContent: {
        ...definition.defaultContent,
        signalTitle: "One connected journey",
        signalSubtitle: "Keep each decision in context.",
        signals: [
          { label: "Explore", detail: "Destinations and programs" },
          { label: "Prepare", detail: "Requirements and documents" },
          { label: "Progress", detail: "Milestones and next actions" },
        ],
      },
    };
  }
  if (!definition || !SECTION_STYLE_BLOCKS.has(type)) return definition;
  const existing = new Set(definition.fields.map(field => field.key));
  return { ...definition, fields: [...definition.fields, ...SECTION_STYLE_FIELDS.filter(field => !existing.has(field.key))] };
}

export function getDefaultContent(type: string): Record<string, unknown> {
  const def = getBlockTypeDef(type);
  return def ? { ...def.defaultContent } : {};
}

export interface PageBlock {
  id?: number;
  blockType: string;
  content: Record<string, unknown>;
  settings: Record<string, unknown>;
  sortOrder: number;
  isVisible: boolean;
}
