import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bindDetailPreviewLayout, bindDetailPreviewPayload, bindPreviewUniversityPrograms, detailPreviewRoute, readDetailPreviewJson, PREVIEW_READ_BYTES } from "../src/pages/admin/website/detailFullPreviewContract";
import { defaultDetailLayout } from "../src/lib/website/detailLayoutContract";
import type { DetailContent, DetailContentKind } from "../src/lib/website/detailContentContract";

const collections = { destination: "countries", city: "cities", university: "universities", program: "programs" };
const draft = (kind: DetailContentKind = "program", locale = "en"): DetailContent => ({ version: 1, kind, entityId: 42, locale, sections: [{ key: "faq", title: "Unsaved draft", body: "Draft body", reviewedOn: "2026-01-01", sources: [{ label: "Evidence", url: "https://example.org/reference" }] }] });
const target = (kind: DetailContentKind = "program") => ({ kind, entityId: 42, locale: "en", canonicalPath: `/en/${collections[kind]}/sample-42` });
const facts = (kind: DetailContentKind = "program", locale = "en") => {
  const meta = { canonicalPath: `/${locale}/${collections[kind]}/sample-42`, locale, indexable: false };
  const data = { id: 42, catalogCountryId: 42, name: "Canonical name", canonicalPath: meta.canonicalPath, universities: [], programs: [] };
  return { data, destination: data, meta, universities: [], programs: [], cities: [], intakes: [], prices: [], related: [], stats: { universityCount: 0, programCount: 0 }, editorial: "old content" };
};

test("each existing public API route binds the exact entity and locale without changing canonical facts", () => {
  for (const kind of Object.keys(collections) as DetailContentKind[]) for (const locale of ["en", "tr", "ar"]) {
    const content = draft(kind, locale), expected = target(kind), payload = facts(kind, locale);
    const route = detailPreviewRoute(expected, content);
    assert.ok(route?.readPath.startsWith("/api/public/"));
    assert.ok(route.readPath.endsWith(`?locale=${locale}`));
    const merged = bindDetailPreviewPayload(payload, expected, content);
    assert.deepEqual(merged.editorial, content);
    assert.equal((merged.data as { name: string }).name, "Canonical name");
    assert.equal(payload.editorial, "old content");
    assert.equal((merged.meta as { indexable: boolean }).indexable, false);
  }
});

test("identity, kind, locale, canonical path and missing source ambiguity fail closed", () => {
  for (const kind of Object.keys(collections) as DetailContentKind[]) {
    for (const patch of [{ entityId: 99 }, { canonicalPath: null }, { canonicalPath: "https://evil.example/data" }, { canonicalPath: `/en/${collections[kind]}/../private` }, { canonicalPath: `/tr/${collections[kind]}/sample-42` }, { canonicalPath: `/en/${collections[kind]}/sample-42?token=secret` }]) assert.equal(detailPreviewRoute({ ...target(kind), ...patch }, draft(kind)), null);
    const wrongId = facts(kind); wrongId.data.id = 99; wrongId.destination.catalogCountryId = 99;
    assert.throws(() => bindDetailPreviewPayload(wrongId, target(kind), draft(kind)));
    const wrongLocale = facts(kind, "tr"); assert.throws(() => bindDetailPreviewPayload(wrongLocale, target(kind), draft(kind)));
    const wrongKind = facts(kind); wrongKind.meta.canonicalPath = "/en/unknown/sample-42";
    assert.throws(() => bindDetailPreviewPayload(wrongKind, target(kind), draft(kind)));
    const metadataMismatch = facts(kind); metadataMismatch.meta.locale = "ar";
    assert.throws(() => bindDetailPreviewPayload(metadataMismatch, target(kind), draft(kind)));
    const malformed = facts(kind); (malformed as unknown as { programs: unknown }).programs = "not an array";
    if (["university", "destination"].includes(kind)) assert.throws(() => bindDetailPreviewPayload(malformed, target(kind), draft(kind)));
  }
  const incomplete = draft(); incomplete.sections[0].sources = [];
  assert.equal(detailPreviewRoute(target(), incomplete), null);
});

test("published layout keeps actual order and hidden sections and rejects wrong kinds", () => {
  const layout = defaultDetailLayout("program"); layout.hidden = ["editorial-faq"];
  assert.deepEqual(bindDetailPreviewLayout(layout, "program"), layout);
  assert.throws(() => bindDetailPreviewLayout(layout, "city"));
  assert.throws(() => bindDetailPreviewLayout({ ...layout, hidden: ["hero"] }, "program"));
});

test("university discovery cannot mix another university or exceed the existing 24-row page", () => {
  const facets = { countries: [], cities: [], universities: [], universityTypes: [], degrees: [], languages: [], fields: [], feeRange: null };
  const result = { data: [{ id: 8, universityId: 42 }], meta: { total: 1, totalPages: 1 } };
  assert.equal(bindPreviewUniversityPrograms(result, facets, 42).result, result);
  assert.throws(() => bindPreviewUniversityPrograms(result, facets, 43));
  assert.throws(() => bindPreviewUniversityPrograms({ ...result, data: Array.from({ length: 25 }, () => result.data[0]) }, facets, 42));
  assert.throws(() => bindPreviewUniversityPrograms(result, {}, 42));
});

test("reads are GET-only, cookie-free, redirect-denying and abortable without a draft body", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "omit"); assert.equal(options?.redirect, "error");
      assert.equal(options?.cache, "no-store"); assert.equal(options?.body, undefined); assert.equal(options?.signal, controller.signal);
      return Response.json({ ok: true });
    };
    assert.deepEqual(await readDetailPreviewJson("/api/public/catalog/programs/sample-42?locale=en", controller.signal), { ok: true });
    await assert.rejects(readDetailPreviewJson("https://evil.example/api/public/data", controller.signal));
    await assert.rejects(readDetailPreviewJson("/api/website/detail-content/publish", controller.signal));
    controller.abort(); await assert.rejects(readDetailPreviewJson("/api/public/catalog/programs/sample-42", controller.signal));
  } finally { globalThis.fetch = original; }
});

test("read budgets reject oversized declarations and chunked bodies, non-JSON and non-200", async () => {
  const original = globalThis.fetch;
  const signal = new AbortController().signal;
  try {
    for (const response of [new Response("{}", { status: 201, headers: { "content-type": "application/json" } }), new Response("{}"), new Response("{}", { headers: { "content-type": "application/json", "content-length": String(PREVIEW_READ_BYTES + 1) } }), new Response(" ".repeat(PREVIEW_READ_BYTES + 1), { headers: { "content-type": "application/json" } })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(readDetailPreviewJson("/api/public/catalog/programs/sample-42", signal));
    }
  } finally { globalThis.fetch = original; }
});

test("static preview uses the real renderers, no public route and no executable frame", () => {
  const render = readFileSync(new URL("../src/pages/admin/website/detailFullPreviewRender.tsx", import.meta.url), "utf8");
  const preview = readFileSync(new URL("../src/pages/admin/website/DetailFullPreview.tsx", import.meta.url), "utf8");
  for (const page of ["CountryDetail", "CityDetail", "UniversityDetail", "ProgramDetail"]) assert.ok(render.includes(`@/pages/public/${page}`));
  assert.match(render, /renderToReadableStream/); assert.match(render, /stream\.allReady/);
  assert.match(render, /script-src 'none'/); assert.match(render, /connect-src 'none'/); assert.match(render, /form-action 'none'/);
  assert.match(render, /template\.content\.querySelectorAll/); assert.match(render, /element\.setAttribute\("disabled", ""\)/);
  assert.match(preview, /sandbox="" referrerPolicy="no-referrer" srcDoc=/);
  assert.match(preview, /if \(!current \|\| controller\.signal\.aborted\) return/);
  assert.doesNotMatch(render + preview, /localStorage|sessionStorage|dangerouslySetInnerHTML|method: "(?:POST|PUT|PATCH|DELETE)"/);
});
