import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { countriesTable, db, pool } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { normalizeCatalogSourceMetadata } from "../src/lib/catalogSourceMetadata";

type Manifest = {
  version: number;
  verifiedAt: string;
  sourceName: string;
  countries: Array<{ code: string; catalogName: string; sourceUrl: string }>;
};

const manifestPath = fileURLToPath(new URL("../../../conf/country-source-sheets.json", import.meta.url));
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
const apply = process.argv.includes("--apply");
const expectedDatabase = process.env.COUNTRY_SOURCE_SHEETS_EXPECTED_DATABASE?.trim();
const expectedHost = process.env.COUNTRY_SOURCE_SHEETS_EXPECTED_HOST?.trim();

try {
  if (manifest.version !== 1 || !manifest.countries.length || manifest.countries.length > 64) throw new Error("Invalid country source sheet manifest");
  const identity = (await pool.query("SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port")).rows[0] as { name: string; host: string; port: number };
  if (apply && (!expectedDatabase || !expectedHost)) throw new Error("Apply requires COUNTRY_SOURCE_SHEETS_EXPECTED_DATABASE and COUNTRY_SOURCE_SHEETS_EXPECTED_HOST");
  if (apply && (identity.name !== expectedDatabase || identity.host !== expectedHost)) throw new Error("Database identity does not match the explicit target");

  const codes = manifest.countries.map(country => country.code.toUpperCase());
  if (new Set(codes).size !== codes.length || codes.some(code => !/^[A-Z]{2}$/u.test(code))) throw new Error("Manifest country codes are invalid or duplicated");
  const rows = await db.select({ id: countriesTable.id, name: countriesTable.name, code: countriesTable.code, sourceMetadata: countriesTable.sourceMetadata })
    .from(countriesTable).where(inArray(countriesTable.code, codes));
  const byCode = new Map(rows.map(row => [row.code, row] as const));
  const missing = manifest.countries.filter(country => !byCode.has(country.code)).map(country => ({ code: country.code, name: country.catalogName }));
  const mismatched = manifest.countries.flatMap(country => {
    const row = byCode.get(country.code);
    return row && row.name !== country.catalogName ? [{ code: country.code, expected: country.catalogName, actual: row.name }] : [];
  });
  const summary = { mode: apply ? "apply" : "dry-run", database: identity.name, host: identity.host, port: identity.port, found: rows.length, missing, mismatched };
  if (missing.length) throw new Error(`Country records are missing: ${JSON.stringify(summary)}`);
  if (mismatched.length) throw new Error(`Country names do not match the reviewed manifest: ${JSON.stringify(summary)}`);

  if (apply) await db.transaction(async tx => {
    for (const country of manifest.countries) {
      const row = byCode.get(country.code)!;
      const source = normalizeCatalogSourceMetadata("country", {
        countryGuide: { sourceName: manifest.sourceName, sourceUrl: country.sourceUrl, verifiedAt: manifest.verifiedAt },
      }).countryGuide;
      await tx.update(countriesTable).set({ sourceMetadata: { ...(row.sourceMetadata ?? {}), countryGuide: source } })
        .where(inArray(countriesTable.id, [row.id]));
    }
  });
  console.log(JSON.stringify({ ...summary, updated: apply ? manifest.countries.length : 0 }));
} finally {
  await pool.end();
}
