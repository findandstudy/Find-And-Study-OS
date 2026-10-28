import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cityHeroEditorContext,
  detailHeroEditorContext,
  detailLayoutContentKey,
  DetailContentPreview,
  hydrateDetailContentForEditor,
  prepareDetailContentDraft,
  retainBoundPreviewPayload,
} from "../src/pages/admin/website/DetailContentEditor";
import {
  DETAIL_CONTENT_KEYS,
  DETAIL_CONTENT_KINDS,
  DETAIL_CONTENT_LOCALES,
  parseDetailContent,
  type DetailContent,
} from "../src/lib/website/detailContentContract";

const editor = readFileSync(
  new URL(
    "../src/pages/admin/website/DetailContentEditor.tsx",
    import.meta.url,
  ),
  "utf8",
);
const compactEditor = editor.replace(/\s+/g, " ");
const inventory = readFileSync(
  new URL(
    "../src/pages/admin/website/CatalogPagesInventory.tsx",
    import.meta.url,
  ),
  "utf8",
);
const compactInventory = inventory.replace(/\s+/g, " ");
const fixture = (): DetailContent => ({
  version: 1,
  kind: "university",
  entityId: 42,
  locale: "en",
  sections: [
    {
      key: "highlights",
      title: "Synthetic editorial title",
      body: "Sourced editorial text.",
      reviewedOn: "2026-09-01",
      cards: [{ title: "Card", body: "Card detail", href: "" }],
      steps: [{ title: "Step", body: "Step detail" }],
      table: {
        columns: ["Topic", "Notes"],
        rows: [["Synthetic topic", "Synthetic notes"]],
      },
      images: [
        { src: "/media/synthetic.jpg", alt: "Synthetic campus", caption: "" },
      ],
      questions: [
        { question: "Synthetic question?", answer: "Source-backed answer." },
      ],
      sources: [
        {
          label: "Synthetic official source",
          url: "https://example.org/reference",
        },
      ],
    },
  ],
});
function render(content: DetailContent) {
  const before = Reflect.get(globalThis, "React");
  const existed = Object.hasOwn(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    return renderToStaticMarkup(
      createElement(DetailContentPreview, {
        content,
        copy: (en: string) => en,
      }),
    );
  } finally {
    if (existed) Reflect.set(globalThis, "React", before);
    else Reflect.deleteProperty(globalThis, "React");
  }
}

test("every inventory kind opens the editor without remapping country IDs to destination IDs", () => {
  assert.match(
    compactInventory,
    /kind: item\.kind === "country" \? "destination" : item\.kind, entityId: item\.sourceId, locale: item\.locale/,
  );
  assert.match(compactInventory, /<DetailContentEditor key=/);
  assert.match(compactInventory, /sourceEditPath: item\.sourceEditPath/);
  assert.doesNotMatch(inventory, /entityId:\s*item\.(?:destination|catalogCountry|mapped)/);
  assert.match(
    compactEditor,
    /parsed\.kind !== target\.kind \|\| parsed\.entityId !== target\.entityId \|\| parsed\.locale !== locale/,
  );
  assert.match(
    compactEditor,
    /entry\.published\.entityId !== target\.entityId/,
  );
});

test("detail regeneration creates a review draft before the normal publication corridor", () => {
  assert.match(inventory, /Generate content \+ SEO \+ image draft/);
  assert.match(inventory, /Nothing was auto-published/);
  assert.doesNotMatch(editor, /Regenerate from page content/);
  assert.match(editor, /Save changes/);
});

test("draft preparation retains all structured content and entity identity without mutating inputs", () => {
  const initial = fixture();
  const before = JSON.stringify(initial);
  const prepared = prepareDetailContentDraft(initial);
  assert.equal(JSON.stringify(initial), before);
  assert.ok(parseDetailContent(prepared, "2026-09-19"));
  assert.equal(Object.hasOwn(prepared.sections[0].cards![0], "href"), false);
  assert.equal(
    Object.hasOwn(prepared.sections[0].images![0], "caption"),
    false,
  );
  assert.deepEqual(
    [prepared.kind, prepared.entityId, prepared.locale],
    ["university", 42, "en"],
  );
  for (const prop of [
    "body",
    "cards",
    "steps",
    "table",
    "images",
    "questions",
    "sources",
    "reviewedOn",
  ] as const)
    assert.ok(prepared.sections[0][prop]);
});

test("legacy catalogue-qualified count labels are removed from saved detail templates", () => {
  const input: DetailContent = {
    ...fixture(),
    sections: [{
      key: "hero",
      title: "University profile",
      hero: { universityCountLabel: "Universities in this catalogue", programCountLabel: "Katalogdaki programlar", countryLabel: "Country" },
      reviewedOn: "2026-09-01",
      sources: [{ label: "Official source", url: "https://example.org/reference" }],
    }],
  };
  const parsed = parseDetailContent(input, "2026-09-19");
  assert.ok(parsed);
  assert.equal(parsed.sections[0].hero?.universityCountLabel, undefined);
  assert.equal(parsed.sections[0].hero?.programCountLabel, undefined);
  assert.equal(parsed.sections[0].hero?.countryLabel, "Country");
});

test("draft preparation trims card links and keeps safe same-page anchors", () => {
  const initial = fixture();
  initial.sections[0].cards = [
    { title: "Card", body: "Card detail", href: "  #editorial-climate  " },
  ];
  const prepared = prepareDetailContentDraft(initial);
  assert.equal(prepared.sections[0].cards?.[0].href, "#editorial-climate");
  assert.ok(parseDetailContent(prepared, "2026-09-19"));
});

test("gallery image URLs remain saveable when the editor leaves alternative text empty", () => {
  const initial = fixture();
  initial.sections[0].title = "Istanbul in focus";
  initial.sections[0].images = [
    { src: "https://images.example.org/istanbul.jpg", alt: "" },
  ];
  const prepared = prepareDetailContentDraft(initial);
  assert.equal(prepared.sections[0].images?.[0].alt, "Istanbul in focus 1");
  assert.ok(parseDetailContent(prepared, "2026-09-19"));
  assert.equal(initial.sections[0].images?.[0].alt, "");
  assert.match(editor, /alternative text is left empty/);
});

test("section choices and content languages use the same bounded server contract", () => {
  assert.match(compactEditor, /DETAIL_CONTENT_KEYS\[target\.kind\]\.filter/);
  assert.match(compactEditor, /DETAIL_CONTENT_LOCALES\.map/);
  for (const kind of DETAIL_CONTENT_KINDS)
    for (const key of DETAIL_CONTENT_KEYS[kind]) {
      assert.ok(
        parseDetailContent(
          {
            version: 1,
            kind,
            entityId: 1,
            locale: "en",
            sections: [
              {
                key,
                title: "A title",
                body: "Sourced text",
                reviewedOn: "2026-09-01",
                sources: [{ label: "Source", url: "https://example.org" }],
              },
            ],
          },
          "2026-09-19",
        ),
        `${kind}/${key}`,
      );
    }
  for (const locale of DETAIL_CONTENT_LOCALES)
    assert.ok(
      parseDetailContent({
        version: 1,
        kind: "city",
        entityId: 1,
        locale,
        sections: [],
      }),
    );
  assert.match(compactEditor, /limit=\{12\}/);
  assert.match(compactEditor, /limit=\{8\} minimum=\{1\}/);
  assert.match(editor, /value\.columns\.length >= 6/);
  assert.match(editor, /value\.rows\.length >= 20/);
  assert.match(editor, /content\.sections\.length >= 30/);
  assert.match(editor, /Create the editable CMS heading and introduction for this hybrid section/);
  assert.match(
    editor,
    /Verified price components and structured intake records feed this section automatically/,
  );
  assert.doesNotMatch(editor, /Edit source record/);
});

test("every shared layout section maps to an editable CMS content key", () => {
  assert.equal(detailLayoutContentKey("editorial-gallery"), "gallery");
  assert.equal(detailLayoutContentKey("programs"), "programs");
  assert.match(editor, /layoutSections\.map\(\(layoutKey, layoutIndex\)/);
  assert.match(editor, /content\?\.sectionOrder \?\? DETAIL_CONTENT_LAYOUT_KEYS\[target\.kind\]/);
  assert.match(editor, /moveLayoutSection\(layoutIndex, -1\)/);
  assert.match(editor, /change\(\{ \.\.\.content, sectionOrder \}\)/);
  assert.doesNotMatch(editor, /moveSection\(sectionIndex/);
  assert.doesNotMatch(editor, /<LockKeyhole/);
  assert.match(editor, /DETAIL_GENERATED_CONTENT_KEYS\.includes/);
});

test("every catalogue page receives a complete static editor model without overwriting saved copy", () => {
  const payloads: Record<DetailContent["kind"], Record<string, unknown>> = {
    destination: {
      destination: {
        name: "Canada",
        description: "Study options across Canada.",
      },
      stats: { universityCount: 4, programCount: 18 },
    },
    city: {
      data: {
        id: 9,
        name: "Toronto",
        country: "Canada",
        description: "A large Canadian student city.",
      },
    },
    university: {
      data: {
        id: 10,
        name: "Example University",
        description: "A catalogue university profile.",
        website: "https://university.example.edu/",
      },
      meta: { programCount: 3 },
    },
    program: {
      data: {
        id: 11,
        name: "Computer Science",
        description: "A catalogue programme profile.",
        universityId: 10,
      },
      intakes: [],
    },
  };
  for (const kind of DETAIL_CONTENT_KINDS) {
    const original: DetailContent = {
      version: 1,
      kind,
      entityId: kind === "city" ? 9 : kind === "university" ? 10 : kind === "program" ? 11 : 8,
      locale: "en",
      sections: [
        {
          key: "overview",
          title: "Saved overview",
          body: "This exact editor copy must remain unchanged.",
          reviewedOn: "2026-09-01",
          sources: [{ label: "Saved source", url: "https://example.org/saved" }],
        },
      ],
    };
    const hydrated = hydrateDetailContentForEditor(
      original,
      payloads[kind],
      "Fallback title",
    );
    assert.equal(hydrated.sections.length, DETAIL_CONTENT_KEYS[kind].length);
    assert.deepEqual(
      hydrated.sections.map((section) => section.key),
      [...DETAIL_CONTENT_KEYS[kind]],
    );
    assert.equal(
      hydrated.sections.find((section) => section.key === "overview")?.title,
      "Saved overview",
    );
    assert.ok(hydrated.sections.every((section) => section.title && section.body));
    assert.ok(parseDetailContent(hydrated));
    assert.equal(original.sections.length, 1);
  }
  assert.match(editor, /hydrateDetailContentForEditor/);
});

test("all added entries need real sources, past review dates and valid structured fields", () => {
  const valid = prepareDetailContentDraft(fixture());
  const reject = (patch: Record<string, unknown>) =>
    assert.equal(
      parseDetailContent(
        { ...valid, sections: [{ ...valid.sections[0], ...patch }] },
        "2026-09-19",
      ),
      null,
    );
  reject({ sources: [] });
  reject({ sources: [{ label: "Source", url: "javascript:alert(1)" }] });
  reject({ reviewedOn: "2026-09-20" });
  reject({ reviewedOn: "2026-02-31" });
  reject({ table: { columns: ["One", "Two"], rows: [["Missing cell"]] } });
  reject({ cards: [{ title: "Title", body: "" }] });
  reject({ images: [{ src: "//unsafe.example/image.jpg", alt: "Image" }] });
  reject({
    questions: [{ question: "Question?", answer: "<script>alert(1)</script>" }],
  });
  assert.match(editor, /if \(!parseDetailContent\(next\)\)/);
});

test("hero editor keeps presentation overrides bounded while catalogue facts stay outside CMS", () => {
  const content = fixture();
  content.kind = "city";
  content.sections = [
    {
      key: "hero",
      title: "Study in Istanbul",
      body: "A reviewed city introduction.",
      hero: {
        eyebrow: "Student city",
        primaryCtaLabel: "View city programmes",
        primaryCtaHref: "/en/programs?city=Istanbul",
        secondaryCtaLabel: "Talk to an adviser",
        secondaryCtaHref: "/en/contact",
        countryLabel: "Country",
        universityCountLabel: "Universities",
        programCountLabel: "Programmes",
        programLanguagesLabel: "Teaching languages",
        climateLabel: "Climate",
        transportLabel: "Transport",
        campusGeographyLabel: "Campus geography",
        housingLabel: "Housing formats",
        backgroundColor: "#102B48",
        overlayColor: "#040A16",
        overlayOpacity: 72,
        textColor: "#FFFFFF",
        accentColor: "#6EA8FF",
      },
      images: [{ src: "/images/istanbul.jpg", alt: "Istanbul skyline" }],
      reviewedOn: "2026-09-01",
      sources: [{ label: "Source", url: "https://example.org" }],
    },
  ];
  assert.ok(parseDetailContent(content, "2026-09-19"));
  assert.equal(
    parseDetailContent(
      {
        ...content,
        sections: [
          {
            ...content.sections[0],
            hero: { ...content.sections[0].hero, overlayOpacity: 101 },
          },
        ],
      },
      "2026-09-19",
    ),
    null,
  );
  assert.equal(
    parseDetailContent(
      {
        ...content,
        sections: [
          {
            ...content.sections[0],
            hero: { ...content.sections[0].hero, backgroundColor: "red" },
          },
        ],
      },
      "2026-09-19",
    ),
    null,
  );
  assert.equal(
    parseDetailContent(
      {
        ...content,
        sections: [
          {
            ...content.sections[0],
            hero: {
              ...content.sections[0].hero,
              primaryCtaHref: "javascript:alert(1)",
            },
          },
        ],
      },
      "2026-09-19",
    ),
    null,
  );
  assert.match(editor, /Hero content/);
  assert.match(editor, /Information box labels/);
  assert.match(editor, /Live catalogue values remain connected/);
});

test("city hero editor shows the effective frontend defaults and current live facts", () => {
  const content: DetailContent = {
    version: 1,
    kind: "city",
    entityId: 1,
    locale: "en",
    sections: [
      {
        key: "education",
        title: "Teaching in Istanbul",
        reviewedOn: "2026-09-01",
        sources: [{ label: "Source", url: "https://example.org" }],
      },
      {
        key: "climate",
        title: "Istanbul climate",
        reviewedOn: "2026-09-01",
        sources: [{ label: "Source", url: "https://example.org" }],
      },
    ],
  };
  const context = cityHeroEditorContext(
    {
      data: {
        id: 1,
        name: "Istanbul",
        country: "Türkiye",
        filterCountry: "Türkiye",
        filterCity: "Istanbul",
        universityCount: 63,
        programCount: 142,
        programLanguages: ["English", "Turkish"],
        transportModes: ["Metro", "Ferry"],
        campusGeography: "Across the European and Asian sides",
        externalFacts: {
          climateSummary: "Mild, wet winters and warm summers",
          climateAnnualAverageC: 15,
          housingSummary: null,
          housingFormats: [{ name: "Private dorm" }, { name: "Shared flat" }],
        },
      },
    },
    content,
    "en",
  );
  assert.ok(context);
  assert.equal(context.effective.eyebrow, "Student city");
  assert.equal(
    context.effective.primaryCtaHref,
    "/en/programs?country=T%C3%BCrkiye&city=Istanbul",
  );
  assert.equal(context.effective.programLanguagesLabel, "Teaching in Istanbul");
  assert.equal(context.effective.climateLabel, "Istanbul climate");
  assert.deepEqual(
    context.facts.map((fact) => fact.value),
    [
      "Türkiye",
      "63",
      "142",
      "English · Turkish",
      "Mild, wet winters and warm summers",
      "Metro · Ferry",
      "Across the European and Asian sides",
      "Private dorm · Shared flat",
    ],
  );
  assert.equal(Object.hasOwn(content.sections[0], "hero"), false);
  assert.match(editor, /Current frontend\/template value/);
  assert.match(editor, /Live values shown on this page/);
});

test("every detail kind hydrates hero controls from its bound public facts", () => {
  const empty = (kind: DetailContent["kind"], entityId: number): DetailContent => ({
    version: 1,
    kind,
    entityId,
    locale: "en",
    sections: [],
  });
  const destination = detailHeroEditorContext(
    "destination",
    {
      destination: {
        catalogCountryId: 1,
        name: "Türkiye",
        country: "Türkiye",
        filterCountry: "Türkiye",
        shortDescription: "Study across Türkiye.",
        language: "Turkish · English",
        currency: "TRY",
        climate: "Varied",
      },
      stats: { universityCount: 16, programCount: 54 },
      cities: [{ id: 1, name: "Istanbul" }],
    },
    empty("destination", 1),
    "en",
  );
  assert.ok(destination);
  assert.equal(destination.effective.primaryCtaHref, "/en/programs?country=T%C3%BCrkiye");
  assert.equal(destination.effective.universityCountLabel, "Universities");
  assert.ok(destination.facts.some((fact) => fact.value === "54"));

  const university = detailHeroEditorContext(
    "university",
    {
      data: {
        id: 3120,
        name: "Acıbadem University",
        country: "Türkiye",
        city: "Istanbul",
        website: "https://www.acibadem.edu.tr/",
        description: "Health sciences university.",
        universityType: "Private",
        qsRanking: 801,
        timesRanking: null,
      },
      programs: [],
      meta: { programCount: 12 },
    },
    empty("university", 3120),
    "en",
  );
  assert.ok(university);
  assert.equal(university.effective.eyebrow, "University profile");
  assert.equal(university.effective.secondaryCtaHref, "https://www.acibadem.edu.tr/");
  assert.ok(university.facts.some((fact) => fact.value === "Istanbul · Türkiye"));

  const program = detailHeroEditorContext(
    "program",
    {
      data: {
        id: 145793,
        name: "A-Level",
        universityId: 3120,
        universityName: "Acıbadem University",
        universityCountry: "Türkiye",
        universityCity: "Istanbul",
        degree: "A-Level",
        field: "Social Sciences",
        language: "English",
        duration: "2 years",
      },
      intakes: [{ id: "one" }, { id: "two" }],
      prices: [],
      related: [],
    },
    empty("program", 145793),
    "en",
  );
  assert.ok(program);
  assert.equal(program.effective.primaryCtaHref, "/en/programs?programId=145793");
  assert.equal(program.effective.eyebrow, "Program guide");
  assert.ok(program.facts.some((fact) => fact.value === "English"));
});

test("editor retains verified preview facts only for the same page and locale", () => {
  const payload = { data: { id: 1, name: "Istanbul" } };
  const binding = "city:1:en";
  const loaded = retainBoundPreviewPayload(null, binding, payload);
  assert.deepEqual(loaded, { binding, payload });
  assert.equal(retainBoundPreviewPayload(loaded, binding, null), loaded);
  assert.equal(retainBoundPreviewPayload(loaded, "city:1:tr", null), null);
  assert.deepEqual(
    retainBoundPreviewPayload(loaded, "city:2:en", {
      data: { id: 2, name: "Ankara" },
    }),
    {
      binding: "city:2:en",
      payload: { data: { id: 2, name: "Ankara" } },
    },
  );
  assert.match(editor, /DETAIL_LAYOUT_SECTIONS\[target\.kind\]\.some/);
  assert.doesNotMatch(editor, /setPreviewPayload\(null\)/);
});

test("local preview is text-only, escaped and accessible including RTL", () => {
  const content = prepareDetailContentDraft(fixture());
  content.locale = "ar";
  content.sections[0].title = "<script>alert('title')</script>";
  content.sections[0].cards![0].href = "javascript:alert('link')";
  const html = render(content);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(
    html,
    /<script|<img|<iframe|<a\s|dangerouslySetInnerHTML/,
  );
  assert.match(html, /role="region"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /scope="col"/);
  for (const text of [
    "Card detail",
    "Step detail",
    "Synthetic topic",
    "Synthetic campus",
    "Source-backed answer.",
    "2026-09-01",
    "https://example.org/reference",
  ])
    assert.ok(html.includes(text), text);
  assert.match(
    render({ ...content, sections: [] }),
    /removes previously published supplemental sections only/,
  );
});

test("close, locale switch and page unload protect unsaved work and async loads are cancelled", () => {
  assert.match(
    compactEditor,
    /const close = \(\) => requestAction\(\{ type: "close" \}\)/,
  );
  assert.match(
    compactEditor,
    /requestAction\(\{ type: "locale", locale: event\.target\.value \}\)/,
  );
  assert.match(editor, /requestAction\(\{ type: "reload" \}\)/);
  assert.match(
    editor,
    /requestAction\(\{ type: "remove", key(?:\s*:\s*key)? \}\)/,
  );
  assert.match(editor, /if \(busy \|\| pendingAction\) return/);
  assert.match(editor, /if \(dirty \|\| action\.type === "remove"\)/);
  assert.match(compactEditor, /<AlertDialog open=\{pendingAction !== null\}/);
  assert.match(editor, /<AlertDialogCancel>/);
  assert.match(editor, /if \(action && !busy\) performAction\(action\)/);
  assert.doesNotMatch(editor, /window\.(?:confirm|alert|prompt)\(/);
  assert.match(editor, /window\.addEventListener\("beforeunload", warn\)/);
  assert.match(editor, /window\.removeEventListener\("beforeunload", warn\)/);
  assert.match(editor, /return \(\) => controller\.abort\(\)/);
  assert.match(editor, /if \(!controller\.signal\.aborted\) accept\(entry\)/);
  assert.match(editor, /opener\.current\?\.isConnected/);
});

test("Save changes publishes the exact saved draft without a second approval step", () => {
  assert.match(
    compactEditor,
    /JSON\.stringify\(\{ content: next, expectedUpdatedAt: saved\.updatedAt,? \}\)/,
  );
  assert.match(
    compactEditor,
    /JSON\.stringify\(\{ pageId: draftEntry\.pageId, digest: draftEntry\.digest, approved: true,? \}\)/,
  );
  assert.match(
    compactEditor,
    /canSelfPublish && draftEntry\.pageId && draftEntry\.digest/,
  );
  assert.match(
    compactEditor,
    /const canSaveOrPublish =\s*dirty \|\|\s*\(!!saved\?\.pageId && canSelfPublish && !savedIsPublished\)/,
  );
  assert.match(compactEditor, /reloadRequired \|\|\s*!canSaveOrPublish/);
  assert.match(editor, /Changes saved and published\. They are now live\./);
  assert.match(editor, /Save changes publishes immediately/);
  assert.match(editor, /status === 409/);
  assert.match(editor, /status === 403/);
  assert.match(editor, /setReloadRequired\(status === 409\)/);
  assert.match(editor, /response\?: \{ status\?: number \}/);
  assert.match(editor, /different authorized administrator/);
  assert.doesNotMatch(editor, /Review and publish|Publish changes|Publish reviewed draft|Save draft/);
  assert.doesNotMatch(editor, /const publish = async/);
  assert.doesNotMatch(editor, /I checked the preview|Önizlemeyi kontrol ettim ve/);
  assert.doesNotMatch(editor, /setApproved|checked=\{approved\}|!approved/);
  assert.doesNotMatch(editor, />\s*\{saved\.digest\}\s*</);
  assert.doesNotMatch(
    editor,
    /dangerouslySetInnerHTML|localStorage|sessionStorage|\/api\/public\/.*preview/,
  );
});
