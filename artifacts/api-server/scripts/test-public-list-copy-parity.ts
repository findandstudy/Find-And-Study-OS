import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PROGRAM_SUPPORTED_LOCALES } from "../src/lib/programTranslationContract";

type TranslationFile = {
  programs: { title: string; titleHighlight: string; subtitle: string };
  countries: { title: string; titleHighlight: string; subtitle: string };
};

test("SSR list copy matches the existing React translation source in every locale", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
  const { publicCatalogListCopy } = await import("../src/lib/publicCatalogRenderReadModel");
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  for (const locale of PROGRAM_SUPPORTED_LOCALES) {
    const translationPath = fileURLToPath(new URL(
      `../../edcons/src/lib/i18n/translations/${locale}.json`,
      import.meta.url,
    ));
    const translation = JSON.parse(readFileSync(translationPath, "utf8")) as TranslationFile;
    assert.deepEqual(publicCatalogListCopy(locale), {
      programTitle: `${translation.programs.title} ${translation.programs.titleHighlight}`,
      programDescription: translation.programs.subtitle,
      countryTitle: `${translation.countries.title} ${translation.countries.titleHighlight}`,
      countryDescription: translation.countries.subtitle,
    }, locale);
  }
});
