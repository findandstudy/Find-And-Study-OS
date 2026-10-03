import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "src", "lib", "i18n", "translations");
const outputDir = path.join(root, "dist", "public", "i18n-critical");
const namespaces = [
  "a11y", "nav", "footer", "cookie", "hero", "stats", "features",
  "countries", "countryDetail", "catalogDetail", "programs",
  "courseFinderPage", "studentJourney", "common", "seo", "apply",
];

fs.mkdirSync(outputDir, { recursive: true });
const files = fs.readdirSync(sourceDir).filter((name) => /^[a-z]{2}\.json$/.test(name)).sort();
if (files.length !== 23) throw new Error(`expected 23 translation files, found ${files.length}`);

for (const file of files) {
  const source = JSON.parse(fs.readFileSync(path.join(sourceDir, file), "utf8"));
  const critical = Object.fromEntries(namespaces.map((key) => {
    if (!source[key] || typeof source[key] !== "object" || Array.isArray(source[key])) {
      throw new Error(`${file} is missing public namespace ${key}`);
    }
    return [key, source[key]];
  }));
  fs.writeFileSync(path.join(outputDir, file), `${JSON.stringify(critical)}\n`, "utf8");
}

console.log(`[public-i18n] emitted ${files.length} bounded critical dictionaries`);
