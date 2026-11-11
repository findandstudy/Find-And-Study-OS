import assert from "node:assert/strict";
import test from "node:test";
import { AiContentService } from "../src/lib/aiService";

function mockOpenAi(result: string | ((prompt: string) => string)) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { input: string };
    const prompt = body.input;
    const content = typeof result === "function" ? result(prompt) : result;
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: content }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const base = {
  action: "improve" as const,
  locale: "en",
  fieldLabel: "Overview body",
  context: "A verified guide for prospective students. https://example.com/guide",
  currentText: '<p>University {{university.name}}: https://example.com/guide</p>',
  instruction: "Make it clearer",
  format: "html" as const,
  maxLength: 1000,
  allowedVariables: ["university.name"],
};

test("field-aware AI writing preserves variables, verified URLs and HTML structure", async () => {
  const restore = mockOpenAi(prompt => {
    const current = prompt.split("CURRENT_TEXT:\n")[1].split("\n\nEXTRA_INSTRUCTION:")[0];
    return current.replace("University", "Explore");
  });
  try {
    const service = new AiContentService({ provider: "openai", apiKey: "test" });
    assert.equal(await service.writeText(base), '<p>Explore {{university.name}}: https://example.com/guide</p>');
  } finally { restore(); }
});
test("field-aware AI writing fails closed if protected content disappears", async () => {
  const restore = mockOpenAi("Explore the university.");
  try {
    const service = new AiContentService({ provider: "openai", apiKey: "test" });
    await assert.rejects(service.writeText(base), /protected content/);
  } finally { restore(); }
});
test("field-aware AI writing rejects unsupported variables and unverified URLs", async () => {
  const service = new AiContentService({ provider: "openai", apiKey: "test" });
  let restore = mockOpenAi("Learn about {{student.secret}}.");
  try {
    await assert.rejects(service.writeText({ ...base, action: "generate", currentText: "" }), /unsupported template variable/);
  } finally { restore(); }
  restore = mockOpenAi("Read https://unverified.example/path");
  try {
    await assert.rejects(service.writeText({ ...base, action: "generate", currentText: "", format: "plain" }), /unverified URL/);
  } finally { restore(); }
});

test("catalogue display terms are localized by AI without a language-specific hard-coded glossary", async () => {
  let capturedPrompt = "";
  const restore = mockOpenAi(prompt => {
    capturedPrompt = prompt;
    return JSON.stringify({
      term_0: "Acıbadem Mehmet Ali Aydınlar Üniversitesi",
      term_1: "Türkiye Cumhuriyeti Dışişleri Bakanlığı",
      term_2: "Türkiye",
    });
  });
  try {
    const service = new AiContentService({ provider: "openai", apiKey: "test" });
    const result = await service.translateTextMap({
      sourceLocale: "en",
      targetLocale: "tr",
      mode: "display_terms",
      texts: {
        term_0: "Acıbadem Mehmet Ali Aydınlar University",
        term_1: "Republic of Türkiye Ministry of Foreign Affairs",
        term_2: "Turkey",
      },
    });
    assert.equal(result.term_0, "Acıbadem Mehmet Ali Aydınlar Üniversitesi");
    assert.equal(result.term_1, "Türkiye Cumhuriyeti Dışişleri Bakanlığı");
    assert.match(capturedPrompt, /public catalogue display terms/i);
    assert.match(capturedPrompt, /translate generic institutional suffixes/i);
    assert.doesNotMatch(capturedPrompt, /TARGET_GLOSSARY|University=Üniversite/);
  } finally { restore(); }
});

test("AI-derived display terms are applied consistently throughout translated page copy", async () => {
  let translatedInput = "";
  const restore = mockOpenAi(prompt => {
    translatedInput = prompt;
    const serialized = prompt.split("INPUT_JSON=")[1].split("\nEditorial guidance")[0];
    const input = JSON.parse(serialized) as Record<string, string>;
    return JSON.stringify(Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.replace("offers study options in", "eğitim seçenekleri sunar:")])));
  });
  try {
    const service = new AiContentService({ provider: "openai", apiKey: "test" });
    const result = await service.translateTextMap({
      sourceLocale: "en",
      targetLocale: "tr",
      texts: { body: "Acıbadem Mehmet Ali Aydınlar University offers study options in Turkey." },
      preferredTerms: {
        "Acıbadem Mehmet Ali Aydınlar University": "Acıbadem Mehmet Ali Aydınlar Üniversitesi",
        Turkey: "Türkiye",
      },
    });
    assert.equal(result.body, "Acıbadem Mehmet Ali Aydınlar Üniversitesi eğitim seçenekleri sunar: Türkiye.");
    assert.match(translatedInput, /__FAS_PROTECTED_/);
    assert.doesNotMatch(translatedInput, /Acıbadem Mehmet Ali Aydınlar University/);
  } finally { restore(); }
});

test("city key facts generation asks for decision-useful copy without repeating live counters", async () => {
  let capturedPrompt = "";
  const body = "Ankara combines a continental climate with a multi-mode public transport network. Students should compare the exact teaching site, the daily route and suitable housing together before deciding where to live.";
  const restore = mockOpenAi(prompt => {
    capturedPrompt = prompt;
    return JSON.stringify({ facts: { title: "Key facts", body } });
  });
  try {
    const service = new AiContentService({ provider: "openai", apiKey: "test" });
    const plan = {
      version: 1 as const, kind: "city" as const, entityName: "Ankara", audience: "prospective international students" as const,
      primaryIntent: "Help students compare Ankara.", catalogEntities: { universities: [], programs: [] }, pageRules: [], skippedSections: [],
      sections: [{ key: "facts", title: "Key facts", templateBody: "", instruction: "Use verified city facts.", objective: "Explain facts.", searchIntent: "What matters?", minCharacters: 140, maxCharacters: 900, readiness: "authoritative" as const, evidenceKeys: ["transportModes"], allocatedEntities: [] }],
    };
    const result = await service.generateDetailSections({
      kind: "city",
      entityName: "Ankara",
      facts: { city: "Ankara", country: "Türkiye", transportModes: ["Metro", "Bus"] },
      sections: plan.sections,
      plan,
    });
    assert.equal(result.facts.body, body);
    assert.match(capturedPrompt, /90–160 word introduction/);
    assert.match(capturedPrompt, /do not repeat or narrate those counters/);
    assert.match(capturedPrompt, /city sections whose key is campus or housing/);
    assert.match(capturedPrompt, /8–14 words/);
    assert.match(capturedPrompt, /under 96 characters/);
    assert.match(capturedPrompt, /CATALOG_ENTITIES=/);
    assert.match(capturedPrompt, /complete allowlist for university and programme names/i);
    assert.match(capturedPrompt, /no more than two titles may begin with the same action verb/i);
  } finally { restore(); }
});

test("source-backed editorial sections generate structured cards instead of preserving prose only", async () => {
  let capturedPrompt = "";
  const body = "Students can compare the verified teaching setting, transport links and accommodation routes as connected parts of the same study decision. Each point below explains a distinct practical consideration supported by the linked city evidence.";
  const cards = [
    { title: "Teaching setting", body: "Compare the documented teaching languages with the language requirements of your intended programme." },
    { title: "Daily connections", body: "Use the verified transport network to assess realistic travel between housing and the teaching site." },
    { title: "Housing choice", body: "Compare the documented accommodation formats by location, routine and the support each route provides." },
  ];
  const restore = mockOpenAi(prompt => {
    capturedPrompt = prompt;
    return JSON.stringify({ highlights: { title: "Build a practical shortlist", body, cards } });
  });
  try {
    const service = new AiContentService({ provider: "openai", apiKey: "test" });
    const plan = {
      version: 1 as const, kind: "city" as const, entityName: "Example City", audience: "prospective international students" as const,
      primaryIntent: "Help students compare Example City.", catalogEntities: { universities: [], programs: [] }, pageRules: [], skippedSections: [],
      sections: [{ key: "highlights", title: "Highlights", templateBody: "", instruction: "Use verified city evidence.", objective: "Explain strengths.", searchIntent: "What matters?", minCharacters: 180, maxCharacters: 900, readiness: "authoritative" as const, evidenceKeys: ["sourceTopics"], allocatedEntities: [], contentShape: "cards" as const, minItems: 3, maxItems: 4 }],
    };
    const result = await service.generateDetailSections({
      kind: "city", entityName: "Example City",
      facts: { city: "Example City", sourceTopics: [{ topicTitle: "Highlights", verifiedContent: "Teaching, transport and housing evidence." }] },
      sections: plan.sections, plan,
    });
    assert.deepEqual(result.highlights.cards, cards);
    assert.match(capturedPrompt, /RESPONSE_SHAPES=/);
    assert.match(capturedPrompt, /derive every item from the verified evidence/i);
    assert.match(capturedPrompt, /"contentShape":"cards"/);
  } finally { restore(); }
});

test("structured section length is evaluated across its introduction and cards", async () => {
  const body = "Compare these verified points before you shortlist this destination.";
  const cards = [
    { title: "Teaching setting", body: "Compare documented teaching languages with the language requirements of your intended programme." },
    { title: "Daily connections", body: "Assess realistic travel between accommodation and the teaching location using verified transport evidence." },
    { title: "Housing choice", body: "Compare documented accommodation formats by location, routine and the support attached to each route." },
  ];
  const restore = mockOpenAi(JSON.stringify({ highlights: { title: "Build a practical shortlist", body, cards } }));
  try {
    const service = new AiContentService({ provider: "openai", apiKey: "test" });
    const plan = {
      version: 1 as const, kind: "destination" as const, entityName: "Example Country", audience: "prospective international students" as const,
      primaryIntent: "Help students compare Example Country.", catalogEntities: { universities: [], programs: [] }, pageRules: [], skippedSections: [],
      sections: [{ key: "highlights", title: "Highlights", templateBody: "", instruction: "Use verified evidence.", objective: "Explain strengths.", searchIntent: "What matters?", minCharacters: 260, maxCharacters: 900, readiness: "authoritative" as const, evidenceKeys: ["sourceTopics"], allocatedEntities: [], contentShape: "cards" as const, minItems: 3, maxItems: 4 }],
    };
    const result = await service.generateDetailSections({
      kind: "destination", entityName: "Example Country",
      facts: { destination: "Example Country", sourceTopics: [{ topicTitle: "Highlights", verifiedContent: "Teaching, transport and housing evidence." }] },
      sections: plan.sections, plan,
    });
    assert.equal(result.highlights.body, body);
    assert.deepEqual(result.highlights.cards, cards);
  } finally { restore(); }
});
