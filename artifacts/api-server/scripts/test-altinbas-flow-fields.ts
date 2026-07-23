/**
 * test-altinbas-flow-fields.ts — unit tests for flow-fields.ts (mapCountry)
 *
 * Run: pnpm --filter @workspace/api-server run test:altinbas-flow-fields
 *
 * Covers:
 *  - mapCountry: empty/null → null (no silent Turkey fallback)
 *  - mapCountry: adjective form → canonical portal name
 *  - mapCountry: country name form (as stored in prod DB) → canonical name
 *  - mapCountry: ISO alpha-2 code → canonical name
 *  - mapCountry: unknown value → title-cased raw (not null, not "Turkey")
 *  - buildPersonalFields: throws MISSING_NATIONALITY when nationality absent
 *  - buildPersonalFields: succeeds with a valid nationality
 *  - browser.ts MEM_ARGS: --no-zygote and --disable-setuid-sandbox present
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapCountry,
  buildPersonalFields,
} from "../../../lib/portal-adapters/src/universities/altinbas/flow-fields.js";

// ---------------------------------------------------------------------------
// mapCountry — null on empty input
// ---------------------------------------------------------------------------

describe("mapCountry — empty / missing input → null", () => {
  it("undefined → null", () => assert.equal(mapCountry(undefined), null));
  it("empty string → null", () => assert.equal(mapCountry(""), null));
  it("whitespace-only → null", () => assert.equal(mapCountry("   "), null));
});

// ---------------------------------------------------------------------------
// mapCountry — adjective / demonym forms (legacy CRM convention)
// ---------------------------------------------------------------------------

describe("mapCountry — adjective forms", () => {
  const cases: [string, string][] = [
    ["Pakistani",    "Pakistan"],
    ["afghan",       "Afghanistan"],
    ["Nigerian",     "Nigeria"],
    ["TURKISH",      "Turkey"],
    ["turk",         "Turkey"],
    ["moroccan",     "Morocco"],
    ["uzbek",        "Uzbekistan"],
    ["kazakh",       "Kazakhstan"],
    ["azerbaijani",  "Azerbaijan"],
    ["british",      "United Kingdom"],
    ["saudi",        "Saudi Arabia"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => assert.equal(mapCountry(input), expected));
  }
});

// ---------------------------------------------------------------------------
// mapCountry — country name forms (as stored in prod DB, lowercase)
// ---------------------------------------------------------------------------

describe("mapCountry — country name forms (prod DB convention)", () => {
  const cases: [string, string][] = [
    ["pakistan",         "Pakistan"],
    ["afghanistan",      "Afghanistan"],
    ["nigeria",          "Nigeria"],
    ["morocco",          "Morocco"],
    ["uzbekistan",       "Uzbekistan"],
    ["tanzania",         "Tanzania"],
    ["kazakhstan",       "Kazakhstan"],
    ["azerbaijan",       "Azerbaijan"],
    ["ethiopia",         "Ethiopia"],
    ["rwanda",           "Rwanda"],
    ["vietnam",          "Vietnam"],
    ["libya",            "Libya"],
    ["sudan",            "Sudan"],
    ["india",            "India"],
    ["kenya",            "Kenya"],
    ["algeria",          "Algeria"],
    ["somalia",          "Somalia"],
    ["turkey",           "Turkey"],
    ["france",           "France"],
    ["germany",          "Germany"],
    ["bangladesh",       "Bangladesh"],
    ["tunisia",          "Tunisia"],
    ["indonesia",        "Indonesia"],
    ["ghana",            "Ghana"],
    ["south africa",     "South Africa"],
    ["syria",            "Syria"],
    ["lebanon",          "Lebanon"],
    ["palestine",        "Palestine"],
    ["united kingdom",   "United Kingdom"],
    ["iran",             "Iran"],
    ["germany",          "Germany"],
    ["kyrgyzstan",       "Kyrgyzstan"],
    ["ivory coast",      "Ivory Coast"],
    ["democratic republic of the congo", "Democratic Republic of the Congo"],
    ["united states",    "United States"],
    ["united states of america", "United States"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => assert.equal(mapCountry(input), expected));
  }
});

// ---------------------------------------------------------------------------
// mapCountry — ISO alpha-2 codes seen in prod
// ---------------------------------------------------------------------------

describe("mapCountry — ISO alpha-2 codes", () => {
  const cases: [string, string][] = [
    ["tr", "Turkey"],
    ["pk", "Pakistan"],
    ["af", "Afghanistan"],
    ["ng", "Nigeria"],
    ["gb", "United Kingdom"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => assert.equal(mapCountry(input), expected));
  }
});

// ---------------------------------------------------------------------------
// mapCountry — unknown value → title-cased raw (NOT null, NOT "Turkey")
// ---------------------------------------------------------------------------

describe("mapCountry — unknown nationality → title-cased raw, not Turkey", () => {
  it("unknown nationality returns title-cased raw, not null", () => {
    const result = mapCountry("freedonia");
    assert.ok(result !== null, "should not return null for a non-empty unknown value");
    assert.ok(result !== "Turkey", "should NOT fall back to Turkey for unknown nationality");
    assert.equal(result, "Freedonia", "should title-case the raw value");
  });

  it("already title-cased unknown still works", () => {
    const result = mapCountry("Ruritania");
    assert.equal(result, "Ruritania");
  });
});

// ---------------------------------------------------------------------------
// buildPersonalFields — throws when nationality is missing
// ---------------------------------------------------------------------------

describe("buildPersonalFields — throws MISSING_NATIONALITY when nationality absent", () => {
  const base = {
    firstName: "Ali",
    lastName: "Hassan",
    dateOfBirth: "1995-03-15",
    passportNumber: "AB1234567",
    passportIssueDate: "2020-01-01",
    passportExpiryDate: "2030-01-01",
    phone: "5321234567",
    gender: "male",
    address: "123 Main St, Istanbul",
  };

  it("throws when nationality is undefined", () => {
    assert.throws(
      () => buildPersonalFields({ ...base, nationality: undefined }),
      (err: Error) => {
        assert.ok(err.message.includes("MISSING_NATIONALITY"), `expected MISSING_NATIONALITY, got: ${err.message}`);
        return true;
      },
    );
  });

  it("throws when nationality is empty string", () => {
    assert.throws(
      () => buildPersonalFields({ ...base, nationality: "" }),
      (err: Error) => {
        assert.ok(err.message.includes("MISSING_NATIONALITY"), `expected MISSING_NATIONALITY, got: ${err.message}`);
        return true;
      },
    );
  });

  it("does NOT throw for 'pakistan' (country name form)", () => {
    assert.doesNotThrow(() => buildPersonalFields({ ...base, nationality: "pakistan" }));
  });

  it("does NOT throw for 'Pakistani' (adjective form)", () => {
    assert.doesNotThrow(() => buildPersonalFields({ ...base, nationality: "Pakistani" }));
  });

  it("does NOT throw for 'tr' (ISO code)", () => {
    assert.doesNotThrow(() => buildPersonalFields({ ...base, nationality: "tr" }));
  });

  it("country field in output matches canonical name for 'pakistan'", () => {
    const fields = buildPersonalFields({ ...base, nationality: "pakistan" });
    const birthCountryField = fields.find(
      (f) => typeof f.field === "string" && f.field.startsWith("Country_of_Birth.CountryList."),
    );
    assert.ok(birthCountryField, "Country_of_Birth picklist field should be present");
    assert.ok(
      String(birthCountryField.field).includes(".Pakistan."),
      `expected Pakistan in field name, got: ${birthCountryField.field}`,
    );
  });
});

// ---------------------------------------------------------------------------
// browser.ts MEM_ARGS — --no-zygote and --disable-setuid-sandbox present
// ---------------------------------------------------------------------------

describe("browser.ts MEM_ARGS — SIGBUS mitigation flags present", () => {
  it("--no-zygote is in MEM_ARGS (prevents zygote shm IPC SIGBUS)", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../../../lib/portal-adapters/src/browser.ts", import.meta.url),
        "utf8",
      ),
    );
    assert.ok(src.includes('"--no-zygote"'), "browser.ts MEM_ARGS must contain --no-zygote");
  });

  it("--disable-setuid-sandbox is in MEM_ARGS (belt-and-suspenders for containers)", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../../../lib/portal-adapters/src/browser.ts", import.meta.url),
        "utf8",
      ),
    );
    assert.ok(
      src.includes('"--disable-setuid-sandbox"'),
      "browser.ts MEM_ARGS must contain --disable-setuid-sandbox",
    );
  });

  it("--disable-dev-shm-usage is still present (not accidentally removed)", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../../../lib/portal-adapters/src/browser.ts", import.meta.url),
        "utf8",
      ),
    );
    assert.ok(
      src.includes('"--disable-dev-shm-usage"'),
      "browser.ts MEM_ARGS must still contain --disable-dev-shm-usage",
    );
  });
});
