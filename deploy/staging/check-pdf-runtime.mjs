// Synthetic, DB-free candidate-image gate. Run only with --network none,
// --read-only, non-root UID, and the same /tmp restrictions as staging Compose.
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { networkInterfaces } from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

assert.equal(process.platform, "linux", "this gate verifies the deployed Linux image");
assert.notEqual(process.getuid(), 0, "runtime probe must execute as the non-root app user");
assert.ok(Object.keys(networkInterfaces()).every(name => name === "lo"), "run with --network none");
const mounts = (await readFile("/proc/self/mountinfo", "utf8")).trim().split("\n").map(line => line.split(" "));
assert.ok(mounts.some(parts => parts[4] === "/" && parts[5].split(",").includes("ro")), "run with --read-only");
const tmp = mounts.find(parts => parts[4] === "/tmp");
assert.ok(tmp && ["rw", "noexec", "nosuid", "nodev"].every(flag => tmp[5].split(",").includes(flag)), "preserve the staging /tmp security options");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium";
await access(executablePath, constants.X_OK);
// Exercise fontconfig as the runtime user; the browser must not need to write
// cache data into the read-only image or fetch missing web fonts.
for (const family of ["Noto Sans", "Noto Sans Arabic", "Noto Sans CJK SC"]) {
  const matched = execFileSync("fc-match", ["--format=%{family}", family], { encoding: "utf8", timeout: 10_000 });
  assert.match(matched, /Noto/, `required Unicode font family unavailable: ${family}`);
}
const requireApi = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { chromium } = requireApi("playwright-core");
// Same constrained launch switches used by contractPdf.ts; in particular,
// no executable is extracted into /tmp, so noexec remains enabled.
const browser = await chromium.launch({ executablePath, headless: true, timeout: 30_000, args: [
  "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none",
  "--single-process", "--no-zygote", "--disable-gpu", "--disable-software-rasterizer", "--disable-extensions",
  "--disable-background-networking", "--mute-audio", "--js-flags=--max-old-space-size=256 --max-semi-space-size=64",
] });
try {
  const page = await browser.newPage();
  let externalRequests = 0;
  await page.route("**/*", route => { externalRequests++; return route.abort(); });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font-family:"Noto Sans",sans-serif}h1{color:#143591}section{border:2px solid #143591;padding:16px}</style></head><body><h1>TEST — PDF runtime</h1><section>SENTETİK TEST · İMZALI BELGE DEĞİLDİR<p dir="rtl" lang="ar">اختبار المستند</p><p lang="zh">测试文件</p><p lang="hi">परीक्षण दस्तावेज़</p></section></body></html>', { waitUntil: "load", timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: "A4", printBackground: true, timeout: 30_000 });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 5_000, "expected a real font-embedded PDF");
  assert.equal(externalRequests, 0);
  console.log(JSON.stringify({ result: "STAGING_PDF_RUNTIME_PASS", uid: process.getuid(), readOnlyRoot: true, tmpNoexec: true, network: "none", pdfBytes: pdf.length, externalRequests }));
} finally {
  await browser.close();
}
