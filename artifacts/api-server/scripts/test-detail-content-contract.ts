import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDetailContent, safeDetailContentUrl } from "../src/lib/websiteDetailContentContract";
const fixture = () => ({ version: 1, kind: "program", entityId: 7, locale: "en", sections: [{ key: "faq", title: "Questions", questions: [{ question: "How?", answer: "Contact the institution." }], sources: [{ label: "Institution", url: "https://example.org/info" }], reviewedOn: "2026-09-01" }] });
test("editorial mirrors and valid human-reviewed structured content", () => {
  assert.ok(parseDetailContent(fixture(), "2026-09-19"));
  assert.equal(readFileSync(new URL("../src/lib/websiteDetailContentContract.ts", import.meta.url), "utf8"), readFileSync(new URL("../../edcons/src/lib/website/detailContentContract.ts", import.meta.url), "utf8"));
});
test("editorial rejects identity/coercion/unknown fact keys and duplicate sections", () => {
  for (const patch of [{ entityId: "7" }, { locale: "EN" }, { tuition: 500 }, { kind: ["program"] }, { sections: [{ ...fixture().sections[0], key: ["faq"] }] }, { sections: [...fixture().sections, ...fixture().sections] }]) assert.equal(parseDetailContent({ ...fixture(), ...patch }), null);
});
test("editorial requires provenance and bounded safe text/media/date", () => {
  for (const patch of [{ sources: [] }, { reviewedOn: "2999-01-01" }, { reviewedOn: "2026-02-30" }, { title: "<script>x</script>" }, { body: "x".repeat(6001) }, { images: [{ src: "javascript:alert(1)", alt: "Image" }] }, { table: { columns: ["A"], rows: [["A", "B"]] } }]) assert.equal(parseDetailContent({ ...fixture(), sections: [{ ...fixture().sections[0], ...patch }] }), null);
  for (const url of ["javascript:alert(1)", "//evil.test", "https://user:pass@example.org", "/../private", "data:image/svg+xml,x"]) assert.equal(safeDetailContentUrl(url), false);
  assert.equal(safeDetailContentUrl("/uploads/public/example.jpg"), true);
  assert.equal(parseDetailContent({ ...fixture(), sections: [] })?.sections.length, 0);
});
