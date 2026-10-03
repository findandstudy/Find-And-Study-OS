import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailContentPreview, prepareDetailContentDraft } from "../src/pages/admin/website/DetailContentEditor";
import { DETAIL_CONTENT_KEYS, DETAIL_CONTENT_KINDS, DETAIL_CONTENT_LOCALES, parseDetailContent, type DetailContent } from "../src/lib/website/detailContentContract";

const editor = readFileSync(new URL("../src/pages/admin/website/DetailContentEditor.tsx", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../src/pages/admin/website/CatalogPagesInventory.tsx", import.meta.url), "utf8");
const fixture = (): DetailContent => ({
  version: 1, kind: "university", entityId: 42, locale: "en", sections: [{
    key: "highlights", title: "Synthetic editorial title", body: "Sourced editorial text.", reviewedOn: "2026-09-01",
    cards: [{ title: "Card", body: "Card detail", href: "" }], steps: [{ title: "Step", body: "Step detail" }],
    table: { columns: ["Topic", "Notes"], rows: [["Synthetic topic", "Synthetic notes"]] },
    images: [{ src: "/media/synthetic.jpg", alt: "Synthetic campus", caption: "" }],
    questions: [{ question: "Synthetic question?", answer: "Source-backed answer." }],
    sources: [{ label: "Synthetic official source", url: "https://example.org/reference" }],
  }],
});
function render(content: DetailContent) {
  const before = Reflect.get(globalThis, "React");
  const existed = Object.hasOwn(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try { return renderToStaticMarkup(createElement(DetailContentPreview, { content, copy: (en: string) => en })); }
  finally { if (existed) Reflect.set(globalThis, "React", before); else Reflect.deleteProperty(globalThis, "React"); }
}

test("every inventory kind opens the editor without remapping country IDs to destination IDs", () => {
  assert.match(inventory, /kind: item\.kind === "country" \? "destination" : item\.kind, entityId: item\.sourceId, locale: item\.locale/);
  assert.match(inventory, /<DetailContentEditor key=/);
  assert.match(inventory, /sourceEditPath: item\.sourceEditPath/);
  assert.doesNotMatch(inventory, /method: "(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(editor, /parsed\.kind !== target\.kind \|\| parsed\.entityId !== target\.entityId \|\| parsed\.locale !== locale/);
  assert.match(editor, /entry\.published\.entityId !== target\.entityId/);
});

test("draft preparation retains all structured content and entity identity without mutating inputs", () => {
  const initial = fixture();
  const before = JSON.stringify(initial);
  const prepared = prepareDetailContentDraft(initial);
  assert.equal(JSON.stringify(initial), before);
  assert.ok(parseDetailContent(prepared, "2026-09-19"));
  assert.equal(Object.hasOwn(prepared.sections[0].cards![0], "href"), false);
  assert.equal(Object.hasOwn(prepared.sections[0].images![0], "caption"), false);
  assert.deepEqual([prepared.kind, prepared.entityId, prepared.locale], ["university", 42, "en"]);
  for (const prop of ["body", "cards", "steps", "table", "images", "questions", "sources", "reviewedOn"] as const) assert.ok(prepared.sections[0][prop]);
});

test("section choices and content languages use the same bounded server contract", () => {
  assert.match(editor, /DETAIL_CONTENT_KEYS\[target\.kind\]\.filter/);
  assert.match(editor, /DETAIL_CONTENT_LOCALES\.map/);
  for (const kind of DETAIL_CONTENT_KINDS) for (const key of DETAIL_CONTENT_KEYS[kind]) {
    assert.ok(parseDetailContent({ version: 1, kind, entityId: 1, locale: "en", sections: [{ key, title: "A title", body: "Sourced text", reviewedOn: "2026-09-01", sources: [{ label: "Source", url: "https://example.org" }] }] }, "2026-09-19"), `${kind}/${key}`);
  }
  for (const locale of DETAIL_CONTENT_LOCALES) assert.ok(parseDetailContent({ version: 1, kind: "city", entityId: 1, locale, sections: [] }));
  assert.match(editor, /limit=\{12\}/);
  assert.match(editor, /limit=\{8\} minimum=\{1\}/);
  assert.match(editor, /value\.columns\.length >= 6/);
  assert.match(editor, /value\.rows\.length >= 20/);
  assert.match(editor, /content\.sections\.length >= 14/);
});

test("all added entries need real sources, past review dates and valid structured fields", () => {
  const valid = prepareDetailContentDraft(fixture());
  const reject = (patch: Record<string, unknown>) => assert.equal(parseDetailContent({ ...valid, sections: [{ ...valid.sections[0], ...patch }] }, "2026-09-19"), null);
  reject({ sources: [] }); reject({ sources: [{ label: "Source", url: "javascript:alert(1)" }] });
  reject({ reviewedOn: "2026-09-20" }); reject({ reviewedOn: "2026-02-31" });
  reject({ table: { columns: ["One", "Two"], rows: [["Missing cell"]] } });
  reject({ cards: [{ title: "Title", body: "" }] });
  reject({ images: [{ src: "//unsafe.example/image.jpg", alt: "Image" }] });
  reject({ questions: [{ question: "Question?", answer: "<script>alert(1)</script>" }] });
  assert.match(editor, /if \(!parseDetailContent\(next\)\)/);
});

test("local preview is text-only, escaped and accessible including RTL", () => {
  const content = prepareDetailContentDraft(fixture());
  content.locale = "ar";
  content.sections[0].title = "<script>alert('title')</script>";
  content.sections[0].cards![0].href = "javascript:alert('link')";
  const html = render(content);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<img|<iframe|<a\s|dangerouslySetInnerHTML/);
  assert.match(html, /role="region"/); assert.match(html, /tabindex="0"/); assert.match(html, /scope="col"/);
  for (const text of ["Card detail", "Step detail", "Synthetic topic", "Synthetic campus", "Source-backed answer.", "2026-09-01", "https://example.org/reference"]) assert.ok(html.includes(text), text);
  assert.match(render({ ...content, sections: [] }), /removes previously published supplemental sections only/);
});

test("close, locale switch and page unload protect unsaved work and async loads are cancelled", () => {
  assert.match(editor, /const close = \(\) => requestAction\(\{ type: "close" \}\)/);
  assert.match(editor, /requestAction\(\{ type: "locale", locale: event\.target\.value \}\)/);
  assert.match(editor, /requestAction\(\{ type: "reload" \}\)/);
  assert.match(editor, /requestAction\(\{ type: "remove", key: section\.key \}\)/);
  assert.match(editor, /if \(busy \|\| pendingAction\) return/);
  assert.match(editor, /if \(dirty \|\| action\.type === "remove"\)/);
  assert.match(editor, /<AlertDialog open=\{pendingAction !== null\}/);
  assert.match(editor, /<AlertDialogCancel>/);
  assert.match(editor, /if \(action && !busy\) performAction\(action\)/);
  assert.doesNotMatch(editor, /window\.(?:confirm|alert|prompt)\(/);
  assert.match(editor, /window\.addEventListener\("beforeunload", warn\)/);
  assert.match(editor, /window\.removeEventListener\("beforeunload", warn\)/);
  assert.match(editor, /return \(\) => controller\.abort\(\)/);
  assert.match(editor, /if \(!controller\.signal\.aborted\) accept\(entry\)/);
  assert.match(editor, /opener\.current\?\.isConnected/);
});

test("save and publish stay explicit, version-bound and separate with no automatic approval", () => {
  assert.match(editor, /JSON\.stringify\(\{ content: next, expectedUpdatedAt: saved\.updatedAt \}\)/);
  assert.match(editor, /JSON\.stringify\(\{ pageId: saved\.pageId, digest: saved\.digest, approved: true \}\)/);
  assert.match(editor, /dirty \|\| busy \|\| !approved \|\| reloadRequired \|\| savedIsPublished/);
  assert.match(editor, /setApproved\(false\)/);
  assert.match(editor, /dirty \|\| busy \|\| reloadRequired \|\| !preview \|\| showPublished/);
  assert.match(editor, /status === 409/); assert.match(editor, /status === 403/);
  assert.match(editor, /setReloadRequired\(true\)/);
  assert.match(editor, /different authorized administrator/);
  assert.doesNotMatch(editor, /dangerouslySetInnerHTML|localStorage|sessionStorage|\/api\/public\/.*preview/);
});
