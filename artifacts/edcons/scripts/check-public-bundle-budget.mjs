import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(packageRoot, "dist", "public");
const html = await readFile(path.join(publicRoot, "index.html"), "utf8");

function localAssetPath(urlPath) {
  assert.match(urlPath, /^\/(?:assets\/[A-Za-z0-9._-]+|bootstrap\.js)$/);
  const absolute = path.resolve(publicRoot, `.${urlPath}`);
  assert.ok(absolute.startsWith(`${publicRoot}${path.sep}`));
  return absolute;
}

async function gzipBytes(urlPath) {
  return gzipSync(await readFile(localAssetPath(urlPath)), { level: 9 }).byteLength;
}

const mainModule = html.match(/<script type="module"[^>]+src="([^"]+)"/)?.[1];
assert.ok(mainModule, "built index must contain one module entry");
const modulePreloads = [...html.matchAll(/<link rel="modulepreload"[^>]+href="([^"]+)"/g)]
  .map((match) => match[1]);
const stylesheets = [...html.matchAll(/<link rel="stylesheet"[^>]+href="([^"]+)"/g)]
  .map((match) => match[1]);
assert.ok(html.includes('<script src="/bootstrap.js"></script>'));

const initialJavascript = [mainModule, ...modulePreloads];
assert.equal(new Set(initialJavascript).size, initialJavascript.length);
const initialJavascriptGzipBytes = (
  await Promise.all(initialJavascript.map(gzipBytes))
).reduce((total, size) => total + size, 0);
const initialCssGzipBytes = (
  await Promise.all(stylesheets.map(gzipBytes))
).reduce((total, size) => total + size, 0);
const bootstrapBytes = (await stat(path.join(publicRoot, "bootstrap.js"))).size;

assert.ok(
  initialJavascriptGzipBytes <= 300 * 1024,
  `initial JavaScript exceeds 300 KiB gzip: ${initialJavascriptGzipBytes}`,
);
assert.ok(
  initialCssGzipBytes <= 60 * 1024,
  `initial CSS exceeds 60 KiB gzip: ${initialCssGzipBytes}`,
);
assert.ok(bootstrapBytes <= 4 * 1024, `bootstrap exceeds 4 KiB: ${bootstrapBytes}`);

const localeCodes = [
  "en", "tr", "ar", "fr", "ru", "fa", "zh", "hi", "es", "id", "ur",
  "tk", "ky", "kk", "uz", "tg", "bn", "pt", "ne", "vi", "ko", "uk", "it",
];
const assetNames = await readdir(path.join(publicRoot, "assets"));
const localeChunkSizes = {};
for (const locale of localeCodes) {
  const matches = assetNames.filter((name) => new RegExp(`^${locale}-[A-Za-z0-9_-]+\\.js$`).test(name));
  assert.equal(matches.length, 1, `expected exactly one lazy chunk for locale ${locale}`);
  const urlPath = `/assets/${matches[0]}`;
  assert.ok(!initialJavascript.includes(urlPath), `${locale} locale was eagerly preloaded`);
  const compressed = await gzipBytes(urlPath);
  assert.ok(compressed <= 120 * 1024, `${locale} locale exceeds 120 KiB gzip: ${compressed}`);
  localeChunkSizes[locale] = compressed;
}

const sourceMaps = assetNames.filter((name) => name.endsWith(".map"));
assert.deepEqual(sourceMaps, [], "production public assets must not contain source maps");

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  initialJavascriptGzipBytes,
  initialCssGzipBytes,
  bootstrapBytes,
  localeChunkMaxGzipBytes: Math.max(...Object.values(localeChunkSizes)),
  localeChunks: Object.keys(localeChunkSizes).length,
})}\n`);
