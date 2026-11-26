// Actual built UI, synthetic API replies only. No live sessions, writes or mail.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { chromium } = requireApi("playwright-core");
const { PDFDocument, StandardFonts } = requireApi("pdf-lib");
const pdf = await PDFDocument.create();
const pdfPage = pdf.addPage();
pdfPage.drawText("TEST ONLY - synthetic contract download", { x: 40, y: 760, size: 16, font: await pdf.embedFont(StandardFonts.Helvetica) });
const pdfBytes = Buffer.from(await pdf.save());
const root = fileURLToPath(new URL("../dist/public/", import.meta.url));
const output = process.env.AGENT_CONTRACT_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.startsWith("/api/")) throw new Error("API requests must be intercepted by the test");
    const target = path.resolve(root, path.extname(pathname) ? pathname.slice(1) : "index.html");
    if (!target.startsWith(path.resolve(root) + path.sep)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", mime[path.extname(target)] || "text/html");
    res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" }) });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [lang, width] of [["en", 1440], ["tr", 390], ["ar", 390]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    const errors = [];
    const writes = [];
    let profileReads = 0;
    let ready = false;
    let emailState = 'pending';
    let pdfPending = false;
    let downloadCount = 0;
    let adminMode = false;
    const words = lang === "tr" ? {
      title: "İmzalı sözleşme", signed: "İmzalandı", pending: "İmzanız kaydedildi.", refresh: "Durumu yenile", download: "İmzalı PDF'yi indir", approval: "Sözleşmeniz imzalandı; yönetici onayı bekleniyor",
    } : {
      title: "Signed contract", signed: "Signed", pending: "Your signature is saved.", refresh: "Refresh status", download: "Download signed PDF", approval: "Contract signed — awaiting staff approval",
    };
    page.on("pageerror", error => errors.push(error.message));
    page.on("download", () => { downloadCount++; });
    await page.addInitScript(locale => localStorage.setItem("edcons_lang", locale), lang);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { await route.abort(); return; }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
      const method = route.request().method();
      if (method !== "GET") writes.push(`${method} ${url.pathname}`);
      let body = { data: [], total: 0 };
      if (url.pathname === "/api/auth/me") body = { id: 987654, firstName: "TEST", lastName: "Agency", role: adminMode ? "super_admin" : "agent", language: lang, isActive: true, emailVerified: true, email: "synthetic@example.invalid", permissions: [], createdAt: "2026-01-01T00:00:00Z" };
      else if (url.pathname === "/api/agents/me") {
        profileReads++;
        body = { id: 765432, userId: 987654, businessName: "TEST ONLY Agency", firstName: "TEST", lastName: "Agency", country: "Turkey", city: "Istanbul", status: "provisional", accessTier: "provisional", effectiveFeatures: { web_to_lead: false }, signedContract: { status: "signed", signedAt: "2026-11-25T17:00:00Z", pdfStatus: ready ? "ready" : "pending", downloadUrl: ready ? "/api/contracts/me/pdf" : null, emailDelivery:{state:emailState} }, contractUrl: ready ? "/api/contracts/me/pdf" : null };
      } else if (url.pathname === "/api/contracts/me/pdf") {
        if (pdfPending) { await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "pending" }) }); return; }
        await route.fulfill({ status: 200, contentType: "application/pdf", body: pdfBytes }); return;
      } else if (url.pathname === "/api/agents/me/onboarding-status") body = { required: false, signed: true, hasSignedContract: true, contractStatus: "signed" };
      else if (url.pathname === "/api/public/sign/SYNTHETIC-NOT-A-REAL-TOKEN") body = { data: { sessionId: 72, mode: "admin_driven", status: "signed", signerName: "TEST Only", signerEmail: "synthetic@example.invalid", verifiedEmail: "synthetic@example.invalid", expired: false, emailDelivery:{state:emailState}, template: { name: "TEST Only Agreement", language: lang, intakeSchema: [] } } };
      else if (url.pathname === "/api/public/sign/SYNTHETIC-NOT-A-REAL-TOKEN/pdf") { await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "pending" }) }); return; }
      else if (url.pathname === "/api/contracts/me") body = { data: { status: "signed" } };
      else if (url.pathname === "/api/contracts/signed") body = { data: [
        { id: 41, signingSessionId: 71, templateId: 4, signerName: "TEST Pending", signerEmail: "pending@example.invalid", signedAt: "2026-11-25T17:00:00Z", pdfObjectKey: null, evidenceHash: null },
        { id: 42, signingSessionId: 72, templateId: 4, signerName: "TEST Final", signerEmail: "final@example.invalid", signedAt: "2026-11-25T17:00:00Z", pdfObjectKey: "/objects/synthetic-final.pdf", evidenceHash: "a".repeat(64) },
      ] };
      else if (url.pathname === "/api/settings/available-years") body = { years: [2026] };
      else if (["/api/stats/growth", "/api/follow-ups/upcoming", "/api/applications/offer-letter-deadlines"].includes(url.pathname) || url.pathname.startsWith("/api/pipeline-stages/") || url.pathname.includes("popup")) body = [];
      if (url.pathname.endsWith("/events")) { await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": synthetic\n\n" }); return; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/agent/account`);
    await page.getByRole("tab", { name: "Agency", exact: true }).click();
    const contract = page.locator("div.space-y-2").filter({ has: page.locator("label").getByText(words.title, { exact: true }) });
    await contract.getByText(words.signed, { exact: true }).waitFor();
    await contract.getByTestId('contract-email-status').filter({hasText:lang==='tr'?'gönderilmeyi bekliyor':'waiting to be sent'}).waitFor();
    await contract.getByRole("status").filter({ hasText: words.pending }).waitFor();
    assert.equal(await contract.getByText("Not uploaded", { exact: true }).count(), 0);
    assert.equal(await contract.getByRole("button", { name: words.download, exact: true }).count(), 0);
    assert.ok(await contract.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${lang}: contract content fits its card`);
    if (output) await contract.screenshot({ path: path.join(output, `signed-pdf-pending-${lang}.png`) });

    const beforeRefresh = profileReads;
    ready = true;
    emailState = 'sent';
    await contract.getByRole("button", { name: words.refresh, exact: true }).click();
    const downloadButton = contract.getByRole("button", { name: words.download, exact: true });
    await downloadButton.waitFor();
    await contract.getByTestId('contract-email-status').filter({hasText:lang==='tr'?'posta sunucusu tarafından kabul edildi':'accepted by the mail server'}).waitFor();
    assert.ok(profileReads > beforeRefresh, "refresh loads the server-projected PDF status");
    const downloading = page.waitForEvent("download");
    await downloadButton.click();
    const downloaded = await downloading;
    assert.equal(downloaded.suggestedFilename(), "signed-contract.pdf");
    assert.deepEqual(await readFile(await downloaded.path()), pdfBytes);

    // A stale ready projection can return 202; it must not download JSON or
    // erase the signed status. Its automatic refresh must recover even if the
    // profile still says ready, without sticking on local pending state.
    pdfPending = true;
    emailState = 'attention';
    const readyRefresh = page.waitForResponse(response => response.url() === `${base}/api/agents/me`);
    await downloadButton.click();
    await readyRefresh;
    await downloadButton.waitFor();
    await contract.getByText(words.signed, { exact: true }).waitFor();
    await contract.getByTestId('contract-email-status').filter({hasText:lang==='tr'?'gönderildiği doğrulanamadı':'could not be confirmed'}).waitFor();
    assert.equal(downloadCount, 1, "a 202 response is not downloaded as a PDF");
    pdfPending = false;
    const recoveredDownload = page.waitForEvent("download");
    await downloadButton.click();
    assert.deepEqual(await readFile(await (await recoveredDownload).path()), pdfBytes);

    await page.goto(`${base}/agent`);
    try { await page.getByText(words.approval, { exact: true }).waitFor({ timeout: 10000 }); }
    catch (error) {
      const details = page.getByText("Technical details", { exact: true });
      if (await details.isVisible()) await details.click();
      console.error({ stage: "dashboard", lang, errors, text: (await page.locator("body").innerText()).slice(0, 3000) }); throw error;
    }
    if (output) await page.screenshot({ path: path.join(output, `signed-awaiting-approval-${lang}.png`) });

    await page.goto(`${base}/sign/SYNTHETIC-NOT-A-REAL-TOKEN`);
    const locale = JSON.parse(await readFile(new URL(`../src/lib/i18n/translations/${lang}.json`, import.meta.url), "utf8"));
    await page.getByRole("heading", { name: locale.sign.signed, exact: true }).waitFor();
    await page.getByText(locale.sign.signedBody, { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /A copy of the signed PDF has been sent to your email/);
    await page.getByRole("button", { name: locale.sign.downloadPdf, exact: true }).click();
    await page.getByText(locale.signedContract.pdfPending, { exact: true }).waitFor();
    if (output) await page.screenshot({ path: path.join(output, `signed-success-pdf-pending-${lang}.png`) });

    adminMode = true;
    // Switch the synthetic actor as a fresh session. The real app persists
    // its previously authenticated agent for reloads; it must not be reused.
    await page.evaluate(() => localStorage.removeItem("edcons_auth_v2"));
    await page.goto(`${base}/admin/contracts`);
    try { await page.getByRole("button", { name: `${locale.contracts.tabSigned} (2)`, exact: true }).click({ timeout: 10000 }); }
    catch (error) {
      const details = page.getByRole("button", { name: /Technical details|errorBoundary.details/ });
      if (await details.isVisible()) await details.click();
      console.error({ stage: "admin", lang, errors, text: (await page.locator("body").innerText()).slice(0, 3000) }); throw error;
    }
    const pendingRow = page.getByRole("row").filter({ hasText: "TEST Pending" });
    const finalRow = page.getByRole("row").filter({ hasText: "TEST Final" });
    await pendingRow.getByRole("button", { name: locale.signedContract.regenerate, exact: true }).waitFor();
    await finalRow.getByRole("button", { name: locale.signedContract.download, exact: true }).waitFor();
    assert.equal(await finalRow.getByRole("button", { name: locale.signedContract.regenerate, exact: true }).count(), 0, "final artifacts cannot be reset from the UI");
    assert.deepEqual(errors, [], `${lang}: no uncaught UI errors`);
    assert.equal(writes.filter(value => !/^POST \/api\/(activity|notifications\/section\/)/.test(value)).length, 0, `${lang}: no business mutations`);
    console.log(`PASS ${lang}/${width}: signed/pending card, refresh, PDF download, stale-202 recovery, final-approval dashboard, truthful signing success, immutable admin PDF controls`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
