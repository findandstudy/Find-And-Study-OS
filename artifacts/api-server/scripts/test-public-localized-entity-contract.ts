import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveLocalizedCityFields,
  resolveLocalizedDestinationFields,
  resolveLocalizedUniversityFields,
  type PublicLocalizedEntitySnapshot,
} from "../src/lib/publicLocalizedEntityContract";

test("city translations require a governed snapshot outside the English source locale", () => {
  assert.deepEqual(resolveLocalizedCityFields({
    locale: "tr",
    delivery: {
      mode: "published",
      snapshot: {
        canonicalPath: "/tr/cities/istanbul-34",
        title: "İstanbul",
        summary: "Uluslararası öğrenciler için doğrulanmış şehir özeti",
        content: { country: "Türkiye", body: "Doğrulanmış şehir rehberi" },
        indexState: "INDEX",
      },
    },
    base: { name: "Istanbul", country: "Turkey", description: null },
  }), {
    available: true,
    name: "İstanbul",
    country: "Türkiye",
    description: "Doğrulanmış şehir rehberi",
    contentPolicy: "PUBLISHED_REVISION",
  });
  assert.equal(resolveLocalizedCityFields({
    locale: "tr",
    delivery: { mode: "published", snapshot: null },
    base: { name: "Istanbul", country: "Turkey", description: null },
  }).available, false);
});

const trSnapshot: PublicLocalizedEntitySnapshot = {
  canonicalPath: "/tr/universities/ornek-universite-1",
  title: "Örnek Üniversitesi",
  summary: "Doğrulanmış Türkçe özet",
  content: {
    description: "Doğrulanmış Türkçe açıklama",
    universityType: "Vakıf",
  },
  indexState: "INDEX",
};

test("published university snapshot replaces only governed display fields", () => {
  assert.deepEqual(resolveLocalizedUniversityFields({
    locale: "tr",
    delivery: { mode: "published", snapshot: trSnapshot },
    base: {
      name: "Example University",
      description: "English description",
      universityType: "Private",
    },
  }), {
    available: true,
    name: "Örnek Üniversitesi",
    description: "Doğrulanmış Türkçe açıklama",
    universityType: "Vakıf",
    contentPolicy: "PUBLISHED_REVISION",
  });
});

test("missing governed translation fails closed while rollout is published", () => {
  const translated = resolveLocalizedUniversityFields({
    locale: "tr",
    delivery: { mode: "published", snapshot: null },
    base: { name: "Example University", description: "English", universityType: "Private" },
  });
  assert.equal(translated.available, false);
  assert.equal(translated.contentPolicy, "LEGACY_SOURCE_ONLY");

  const legacy = resolveLocalizedUniversityFields({
    locale: "tr",
    delivery: { mode: "off", snapshot: null },
    base: { name: "Example University", description: "English", universityType: "Private" },
  });
  assert.equal(legacy.available, true);
  assert.equal(legacy.contentPolicy, "LEGACY_SOURCE_ONLY");
});

test("non-English destination snapshot never leaks untranslated optional prose", () => {
  const localized = resolveLocalizedDestinationFields({
    locale: "tr",
    delivery: {
      mode: "published",
      snapshot: {
        canonicalPath: "/tr/destinations/turkiye",
        title: "Türkiye",
        summary: "Doğrulanmış destinasyon özeti",
        content: {
          body: "Doğrulanmış destinasyon içeriği",
          popularCities: ["İstanbul", "Ankara", ""],
        },
        indexState: "NOINDEX",
      },
    },
    base: {
      name: "Turkey",
      shortDescription: "English summary",
      description: "English body",
      whyStudyHere: "English why",
      livingCost: "Affordable",
      climate: "Mediterranean",
      language: "Turkish",
      currency: "TRY",
      visaInfo: "English visa details",
      workPermit: "English work details",
      popularCities: ["Istanbul"],
    },
  });
  assert.equal(localized.name, "Türkiye");
  assert.equal(localized.shortDescription, "Doğrulanmış destinasyon özeti");
  assert.equal(localized.description, "Doğrulanmış destinasyon içeriği");
  assert.deepEqual(localized.popularCities, ["İstanbul", "Ankara"]);
  assert.equal(localized.visaInfo, null);
  assert.equal(localized.livingCost, null);
});

test("oversized or structurally invalid snapshot values are not delivered", () => {
  const localized = resolveLocalizedDestinationFields({
    locale: "tr",
    delivery: {
      mode: "published",
      snapshot: {
        canonicalPath: "/tr/destinations/ornek",
        title: "Örnek",
        summary: null,
        content: {
          body: "x".repeat(200_001),
          popularCities: { unsafe: true },
        },
        indexState: "INDEX",
      },
    },
    base: {
      name: "Example",
      shortDescription: null,
      description: "English body",
      whyStudyHere: null,
      livingCost: null,
      climate: null,
      language: null,
      currency: null,
      visaInfo: null,
      workPermit: null,
      popularCities: ["English City"],
    },
  });
  assert.equal(localized.description, null);
  assert.deepEqual(localized.popularCities, []);
});
