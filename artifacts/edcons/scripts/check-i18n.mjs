#!/usr/bin/env node
// Build-time i18n key check.
// 1) Every namespaced key used via t("ns.key") in src/ must exist in en.json.
//    (Bare keys without a dot are skipped — some components use local dicts.)
// 2) Every non-en language file must contain every key present in en.json
//    (getTranslation silently falls back to en, hiding missing translations).
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const trDir = join(root, "src/lib/i18n/translations");
const en = JSON.parse(readFileSync(join(trDir, "en.json"), "utf8"));
const expectedLanguages = [
  "en", "tr", "ar", "fr", "ru", "fa", "zh", "hi", "es", "id",
  "ur", "tk", "ky", "kk", "uz", "tg", "bn", "pt", "ne", "vi",
  "ko", "uk", "it",
];

function flatten(obj, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out.add(key);
  }
  return out;
}
const enKeys = flatten(en);

function flattenValues(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flattenValues(v, key, out);
    else out.set(key, String(v ?? ""));
  }
  return out;
}

function interpolationTokens(value) {
  return [...value.matchAll(/\{\{[^{}]+\}\}|\{[a-zA-Z0-9_]+\}|%s/g)]
    .map(([token]) => token.startsWith('{{') ? `{{${token.slice(2, -2).split('|')[0]}}}` : token).sort();
}

const duplicateKeyErrors = [];
const translationArtifactErrors = [];
function inspectDictionary(file, source) {
  const tree = ts.parseJsonText(file, source);
  function visit(node, prefix = '') {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set();
      for (const prop of node.properties) {
        const key = prop.name?.text;
        if (seen.has(key)) duplicateKeyErrors.push(`${file}:${prefix}${key}`);
        seen.add(key);
        if (prop.initializer) visit(prop.initializer, `${prefix}${key}.`);
      }
    } else ts.forEachChild(node, child => visit(child, prefix));
  }
  visit(tree);
  for (const [key, value] of flattenValues(JSON.parse(source))) {
    if (/@\s*(?:info|action|label|title)\b|QDialog|BelizComment|Saytcolor/i.test(value)) {
      translationArtifactErrors.push(`${file}:${key}`);
    }
  }
}

const enValues = flattenValues(en);

// ── 1) scan source for t("ns.key") usages ─────────────────────────────────
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(p);
  }
})(join(root, "src"));

const used = new Set();
const re = /\bt\(\s*["']([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)["']/g;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) used.add(m[1]);
}

const missingInEn = [...used].filter((k) => !enKeys.has(k)).sort();

// ── 2) parity: every lang must contain every en key ───────────────────────
const parityErrors = [];
const placeholderErrors = [];
const emptyValueErrors = [];
const languageFiles = readdirSync(trDir).filter((file) => file.endsWith(".json"));
for (const file of languageFiles) inspectDictionary(file, readFileSync(join(trDir, file), 'utf8'));
const actualLanguages = languageFiles.map((file) => file.replace(/\.json$/, "")).sort();
const expectedSorted = [...expectedLanguages].sort();
const languageSetMismatch = actualLanguages.join("\0") !== expectedSorted.join("\0");
for (const file of languageFiles) {
  if (!file.endsWith(".json") || file === "en.json") continue;
  const parsed = JSON.parse(readFileSync(join(trDir, file), "utf8"));
  const keys = flatten(parsed);
  const values = flattenValues(parsed);
  const missing = [...enKeys].filter((k) => !keys.has(k));
  if (missing.length) parityErrors.push({ file, missing });
  for (const key of enKeys) {
    const translated = values.get(key);
    if (translated === undefined) continue;
    if (!translated.trim()) emptyValueErrors.push({ file, key });
    const expectedTokens = interpolationTokens(enValues.get(key) ?? "");
    const actualTokens = interpolationTokens(translated);
    if (expectedTokens.join("\0") !== actualTokens.join("\0")) {
      placeholderErrors.push({ file, key, expectedTokens, actualTokens });
    }
  }
}

let failed = false;
for (const [label, errors] of [['duplicate JSON keys', duplicateKeyErrors], ['corrupt translation artifacts', translationArtifactErrors]]) {
  if (errors.length) {
    failed = true;
    console.error(`[i18n-check] ${errors.length} ${label}:\n${errors.slice(0, 20).map(e => `  - ${e}`).join('\n')}`);
  }
}
const sidebarSource = readFileSync(join(root, 'src/components/layout/DashboardLayout.tsx'), 'utf8');
if (/title:\s*['"][^'"]*\p{L}[^'"]*['"]/u.test(sidebarSource)) {
  failed = true;
  console.error('[i18n-check] Sidebar menu titles must use the shared translation catalogue.');
}
if (languageSetMismatch) {
  failed = true;
  console.error(`\n[i18n-check] Language files differ from the canonical set.`);
  console.error(`  expected: ${expectedSorted.join(", ")}`);
  console.error(`  actual:   ${actualLanguages.join(", ")}`);
}
if (missingInEn.length) {
  failed = true;
  console.error(`\n[i18n-check] ${missingInEn.length} key(s) used in code but missing from en.json:`);
  for (const k of missingInEn) console.error(`  - ${k}`);
}
for (const { file, missing } of parityErrors) {
  failed = true;
  console.error(`\n[i18n-check] ${file} is missing ${missing.length} key(s) present in en.json:`);
  for (const k of missing.slice(0, 40)) console.error(`  - ${k}`);
  if (missing.length > 40) console.error(`  ... and ${missing.length - 40} more`);
}
if (emptyValueErrors.length) {
  failed = true;
  console.error(`\n[i18n-check] ${emptyValueErrors.length} empty translation value(s):`);
  for (const item of emptyValueErrors.slice(0, 40)) console.error(`  - ${item.file}: ${item.key}`);
}
if (placeholderErrors.length) {
  failed = true;
  console.error(`\n[i18n-check] ${placeholderErrors.length} interpolation-token mismatch(es):`);
  for (const item of placeholderErrors.slice(0, 40)) {
    console.error(`  - ${item.file}: ${item.key} expected=[${item.expectedTokens}] actual=[${item.actualTokens}]`);
  }
}

if (failed) {
  console.error("\n[i18n-check] FAILED — add the missing keys to ALL language files.");
  process.exit(1);
}
console.log(`[i18n-check] OK — ${used.size} used keys, ${enKeys.size} en keys, ${languageFiles.length} languages with key and placeholder parity.`);
