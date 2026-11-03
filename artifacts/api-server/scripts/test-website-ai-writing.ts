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

test("city key facts generation asks for decision-useful copy without repeating live counters", async () => {
  let capturedPrompt = "";
  const body = "Ankara combines a continental climate with a multi-mode public transport network. Students should compare the exact teaching site, the daily route and suitable housing together before deciding where to live.";
  const restore = mockOpenAi(prompt => {
    capturedPrompt = prompt;
    return JSON.stringify({ facts: { title: "Key facts", body } });
  });
  try {
    const service = new AiContentService({ provider: "openai", apiKey: "test" });
    const result = await service.generateDetailSections({
      kind: "city",
      entityName: "Ankara",
      facts: { city: "Ankara", country: "Türkiye", transportModes: ["Metro", "Bus"] },
      sections: [{ key: "facts", title: "Key facts", templateBody: "", instruction: "Use verified city facts." }],
    });
    assert.equal(result.facts.body, body);
    assert.match(capturedPrompt, /90–160 word introduction/);
    assert.match(capturedPrompt, /do not repeat or narrate those counters/);
  } finally { restore(); }
});
