import assert from "node:assert/strict";
import test from "node:test";
import type { SubmitProfile } from "../../types.js";
import {
  buildOkanProgramSearchQueries,
  chooseOkanDraftHref,
  chooseOkanProgramIndex,
  chooseOkanSubmissionEvidence,
  extractOkanApplicationRef,
  normalizeOkanProgramIdentity,
  resolveOkanDegreeValue,
  resolveOkanRequiredFields,
  verifyOkanSubmissionEvidence,
} from "./adapter.js";

const baseProfile = {
  addressCity: "Istanbul",
  cityOfBirth: "Dushanbe",
  schoolName: "Example School",
  educationRecords: [
    {
      level: "High School",
      schoolName: "Example School",
      city: "Khujand",
    },
  ],
} as SubmitProfile;

test("Okan uses dedicated residence, birth and education city fields", () => {
  assert.deepEqual(resolveOkanRequiredFields(baseProfile), {
    city: "Istanbul",
    birthplace: "Dushanbe",
    secondarySchoolCity: "Khujand",
    missing: [],
    policyFallbacks: [],
  });
});

test("Okan never parses city or birthplace from a free-text address", () => {
  const resolved = resolveOkanRequiredFields({
    ...baseProfile,
    address: "COUNTRY REGION STREET 12",
    addressCity: undefined,
    cityOfBirth: undefined,
    educationRecords: [],
  });
  assert.equal(resolved.city, "");
  assert.equal(resolved.birthplace, "");
  assert.deepEqual(resolved.missing, [
    "addressCity",
    "cityOfBirth",
    "secondarySchoolCity",
  ]);
});

test("Okan legacy policy may reuse explicit residence city for school city", () => {
  const resolved = resolveOkanRequiredFields({
    ...baseProfile,
    educationRecords: [],
  });
  assert.equal(resolved.secondarySchoolCity, "Istanbul");
  assert.deepEqual(resolved.policyFallbacks, [
    "secondarySchoolCity<-addressCity",
  ]);
});

test("Okan degree mapping fails closed for unknown levels", () => {
  assert.equal(resolveOkanDegreeValue("Associate"), "1");
  assert.equal(resolveOkanDegreeValue("Bachelor"), "2");
  assert.equal(resolveOkanDegreeValue("Master"), "3");
  assert.equal(resolveOkanDegreeValue("PhD"), "4");
  assert.equal(resolveOkanDegreeValue("Something New"), null);
});

test("Okan program selection chooses a proven match and refuses ambiguity", () => {
  assert.equal(
    chooseOkanProgramIndex(
      ["Software Engineering (English)", "Civil Engineering (English)"],
      "Software Engineering (English)",
    ),
    0,
  );
  assert.equal(
    chooseOkanProgramIndex(
      ["Business Administration (Thesis)", "Business Administration (Non-Thesis)"],
      "Business Administration",
    ),
    null,
  );
});

test("Okan resolves the live MBA alias while preserving thesis and language", () => {
  const crmName =
    "Master of MBA - Business Administration (Non-Thesis) (English)";
  assert.equal(
    normalizeOkanProgramIdentity(crmName),
    "business administration non thesis english",
  );
  assert.equal(
    chooseOkanProgramIndex(
      [
        "Master of Business Administration (Non-Thesis) (Turkish)",
        "Master of Business Administration (Thesis) (English)",
        "Master of Business Administration (Non-Thesis) (English)",
      ],
      crmName,
    ),
    2,
  );
  assert.equal(
    chooseOkanProgramIndex(["MBA (Non-Thesis) (English)"], crmName),
    0,
  );
});

test("Okan MBA alias matching fails closed on duplicate semantic results", () => {
  assert.equal(
    chooseOkanProgramIndex(
      [
        "Master of Business Administration (Non-Thesis) (English)",
        "MBA (Non-Thesis) (English)",
      ],
      "Master of MBA - Business Administration (Non-Thesis) (English)",
    ),
    null,
  );
});

test("Okan progressively searches the CRM-only degree and MBA label", () => {
  assert.deepEqual(
    buildOkanProgramSearchQueries(
      "Master of MBA - Business Administration (Non-Thesis) (English)",
    ),
    [
      "MBA - Business Administration",
      "Business Administration",
      "MBA",
      "Master of MBA - Business Administration",
    ],
  );
});

test("Okan resumes the newly created draft for the exact applicant", () => {
  const profile = {
    firstName: "Lise Vanessa",
    lastName: "Abaga Diongo",
    passportNumber: "P1234567",
    email: "lise@example.com",
  };
  assert.equal(
    chooseOkanDraftHref(
      [
        {
          href: "/Agency/trackwizard?id=110",
          externalRef: "110",
          rowText: "Another Student P0000000",
        },
        {
          href: "/Agency/trackwizard?id=111",
          externalRef: "111",
          rowText: "LISE VANESSA ABAGA DIONGO P1234567 lise@example.com",
        },
        {
          href: "/Agency/trackwizard?id=109",
          externalRef: "109",
          rowText: "LISE VANESSA ABAGA DIONGO P1234567 lise@example.com",
        },
      ],
      new Set(["109", "110"]),
      profile,
    ),
    "/Agency/trackwizard?id=111",
  );
});

test("Okan never falls back to another applicant's first draft", () => {
  assert.equal(
    chooseOkanDraftHref(
      [
        {
          href: "/Agency/trackwizard?id=110",
          externalRef: "110",
          rowText: "Another Student P0000000 other@example.com",
        },
      ],
      new Set(),
      {
        firstName: "Lise Vanessa",
        lastName: "Abaga Diongo",
        passportNumber: "P1234567",
        email: "lise@example.com",
      },
    ),
    null,
  );
});

test("Okan submission success requires an exact durable Track Applications row", () => {
  const profile = {
    firstName: "Ada",
    lastName: "Lovelace",
    programName: "Software Engineering (English)",
  };
  assert.equal(
    verifyOkanSubmissionEvidence(profile, {
      externalRef: "10234",
      applicantName: "Ada Lovelace",
      programName: "Software Engineering (English)",
      status: "Submitted",
      completed: "Yes",
      stage: "Completed",
    }),
    true,
  );
  assert.equal(
    verifyOkanSubmissionEvidence(profile, {
      externalRef: "10234",
      applicantName: "Ada Lovelace",
      programName: "Software Engineering (English)",
      status: "Pending",
      completed: "No",
      stage: "Documents",
    }),
    false,
  );
  assert.equal(
    verifyOkanSubmissionEvidence(profile, {
      externalRef: "",
      applicantName: "Ada Lovelace",
      programName: "Software Engineering (English)",
      status: "Submitted",
      completed: "Yes",
      stage: "Completed",
    }),
    false,
  );
});

test("Okan verifies durable evidence when the portal uses its MBA alias", () => {
  assert.equal(
    verifyOkanSubmissionEvidence(
      {
        firstName: "Lise Vanessa",
        lastName: "Abaga Diongo",
        programName:
          "Master of MBA - Business Administration (Non-Thesis) (English)",
      },
      {
        externalRef: "2270",
        applicantName: "Lise Vanessa Abaga Diongo",
        programName:
          "Master of Business Administration (Non-Thesis) (English)",
        status: "Submitted",
        completed: "Yes",
        stage: "Completed",
      },
    ),
    true,
  );
});

test("Okan extracts the application number from official report links", () => {
  assert.equal(
    extractOkanApplicationRef([
      "/report/conditionalletter?applicationNo=OKN2026-29236 ",
      "/report/finalletter?applicationNo=OKN2026-29236 ",
    ]),
    "OKN2026-29236",
  );
  assert.equal(
    extractOkanApplicationRef([
      "/report/finalletter?applicationNo=OKN2026-1",
      "/report/finalletter?applicationNo=OKN2026-2",
    ]),
    "",
  );
});

test("Okan safely reuses the exact completed application instead of creating a duplicate", () => {
  const profile = {
    firstName: "Lise Vanessa",
    lastName: "Abaga Diongo",
    programName:
      "Master of MBA - Business Administration (Non-Thesis) (English)",
  };
  assert.deepEqual(
    chooseOkanSubmissionEvidence(profile, [
      {
        externalRef: "OKN2026-29235",
        applicantName: "Another Student",
        programName: "Master of Business Administration (English) non-thesis",
        status: "-",
        completed: "Yes",
        stage: "Evalution",
      },
      {
        externalRef: "OKN2026-29236",
        applicantName: "LISE VANESSA ABAGA DIONGO",
        programName: "Master of Business Administration (English) non-thesis",
        status: "-",
        completed: "Yes",
        stage: "Evalution",
      },
    ]),
    {
      externalRef: "OKN2026-29236",
      applicantName: "LISE VANESSA ABAGA DIONGO",
      programName: "Master of Business Administration (English) non-thesis",
      status: "-",
      completed: "Yes",
      stage: "Evalution",
    },
  );
});

test("Okan fails closed when completed evidence is ambiguous", () => {
  const profile = {
    firstName: "Lise Vanessa",
    lastName: "Abaga Diongo",
    programName:
      "Master of MBA - Business Administration (Non-Thesis) (English)",
  };
  assert.equal(
    chooseOkanSubmissionEvidence(profile, [
      {
        externalRef: "OKN2026-29236",
        applicantName: "LISE VANESSA ABAGA DIONGO",
        programName: "Master of Business Administration (English) non-thesis",
        status: "-",
        completed: "Yes",
        stage: "Evalution",
      },
      {
        externalRef: "OKN2026-29237",
        applicantName: "LISE VANESSA ABAGA DIONGO",
        programName: "Master of Business Administration (English) non-thesis",
        status: "-",
        completed: "Yes",
        stage: "Evalution",
      },
    ]),
    null,
  );
});
