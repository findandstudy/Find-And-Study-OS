import assert from "node:assert/strict";
import test from "node:test";
import {
  localizedCityName,
  localizedCountryName,
  localizedDuration,
  localizedFieldName,
  localizedInstitutionName,
  localizedProgramDisplayName,
  localizedUniversityType,
} from "../src/pages/public/detailPresentation";

test("Turkish catalogue display values use verified deterministic localisation", () => {
  assert.equal(localizedCountryName("Turkey", null, "tr"), "Türkiye");
  assert.equal(localizedCityName("Istanbul", "Turkey", "tr"), "İstanbul");
  assert.equal(localizedCityName("Izmir", "Turkey", "tr"), "İzmir");
  assert.equal(localizedInstitutionName("Anadolu University", "Turkey", "tr"), "Anadolu Üniversitesi");
  assert.equal(localizedInstitutionName("Duzce University", "Turkey", "tr"), "Düzce Üniversitesi");
  assert.equal(localizedUniversityType("private", "tr"), "Özel");
  assert.equal(localizedUniversityType("foundation", "tr"), "Vakıf");
  assert.equal(localizedFieldName("Engineering", "tr"), "Mühendislik");
  assert.equal(localizedDuration("24 Months", "tr"), "24 Ay");
});

test("program display name keeps the canonical title beside the Turkish display title", () => {
  assert.equal(
    localizedProgramDisplayName("Associate of Anesthesia (Turkish)", "tr"),
    "Anestezi Ön Lisans Programı (Associate of Anesthesia)",
  );
  assert.equal(
    localizedProgramDisplayName("Bachelor of Computer Engineering (English)", "tr"),
    "Bilgisayar Mühendisliği Lisans Programı (Bachelor of Computer Engineering)",
  );
  assert.equal(localizedProgramDisplayName("Unverified Custom Programme", "tr"), "Unverified Custom Programme");
  assert.equal(localizedProgramDisplayName("Associate of Anesthesia (Turkish)", "en"), "Associate of Anesthesia (Turkish)");
});

test("foreign institution identities are not blindly translated", () => {
  assert.equal(localizedInstitutionName("University of Latvia", "Latvia", "tr"), "University of Latvia");
});
