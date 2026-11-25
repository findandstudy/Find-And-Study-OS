import assert from "node:assert/strict";
import test from "node:test";
import { renderContractHtmlToPdf } from "../src/lib/contractPdf";

function fixture(failure?: Error) {
  const calls: string[] = [];
  let routeHandler: ((route: any) => Promise<void>) | undefined;
  const page = {
    async route(_pattern: string, handler: typeof routeHandler) { routeHandler = handler; },
    async setContent(html: string, options: any) {
      calls.push("content");
      assert.equal(html, "<h1>TEST ONLY</h1>");
      assert.deepEqual(options, { waitUntil: "networkidle", timeout: 15000 });
      if (failure) throw failure;
    },
    async pdf(options: any) {
      calls.push("pdf");
      assert.deepEqual(options, { printBackground: true, preferCSSPageSize: true });
      return Buffer.from("%PDF-TEST");
    },
    async close() { calls.push("close"); },
  };
  return { calls, browser: { async newPage() { return page; } }, route: () => routeHandler! };
}

test("contract PDF refuses partial output after a failed or timed-out content load", async () => {
  for (const message of ["setContent timed out", "Target page has been closed", "Document load failed"]) {
    const failed = fixture(new Error(message));
    await assert.rejects(renderContractHtmlToPdf(failed.browser, "<h1>TEST ONLY</h1>"), { message });
    assert.deepEqual(failed.calls, ["content", "close"], "no PDF is created after a failed load");
  }
});

test("successful contract load prints backgrounds and honors designed page sizing", async () => {
  const successful = fixture();
  assert.equal(Buffer.from(await renderContractHtmlToPdf(successful.browser, "<h1>TEST ONLY</h1>")).toString(), "%PDF-TEST");
  assert.deepEqual(successful.calls, ["content", "pdf", "close"]);
});

test("contract rendering remains network isolated for styles, logos and local network targets", async () => {
  const successful = fixture();
  await renderContractHtmlToPdf(successful.browser, "<h1>TEST ONLY</h1>");
  for (const url of ["https://brand.example/logo.png", "http://127.0.0.1/private", "file:///private", "https://fonts.example/font.css"]) {
    let result = "";
    await successful.route()({ request: () => ({ url: () => url }), abort: async () => { result = "blocked"; }, continue: async () => { result = "allowed"; } });
    assert.equal(result, "blocked");
  }
  for (const url of ["data:image/png;base64,VEVTVA==", "about:blank", "blob:synthetic-test"]) {
    let result = "";
    await successful.route()({ request: () => ({ url: () => url }), abort: async () => { result = "blocked"; }, continue: async () => { result = "allowed"; } });
    assert.equal(result, "allowed");
  }
});
