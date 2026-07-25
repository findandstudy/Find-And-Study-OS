import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveAltinbasPassportDates,
  selectFirstDocumentPerMappedSlot,
} from "../src/altinbasLegacyPolicy.js";

test("ALP1: valid passport dates are preserved", () => {
  assert.deepEqual(
    resolveAltinbasPassportDates({
      dateOfBirth: "2000-01-01",
      passportIssueDate: "2024-05-10",
      passportExpiryDate: "2029-05-10",
      now: new Date("2026-07-25T12:00:00Z"),
    }),
    {
      issueDate: "2024-05-10",
      expiryDate: "2029-05-10",
      fallbackFields: [],
    },
  );
});

test("ALP2: future historical issue date is made portal-valid without DB writes", () => {
  assert.deepEqual(
    resolveAltinbasPassportDates({
      dateOfBirth: "2008-01-09",
      passportIssueDate: "2026-10-05",
      passportExpiryDate: "2031-10-05",
      now: new Date("2026-07-25T12:00:00Z"),
    }),
    {
      issueDate: "2026-07-24",
      expiryDate: "2031-10-05",
      fallbackFields: ["passportIssueDate"],
    },
  );
});

test("ALP3: missing dates receive one deterministic five-year contract", () => {
  assert.deepEqual(
    resolveAltinbasPassportDates({
      dateOfBirth: "2000-01-01",
      now: new Date("2026-07-25T12:00:00Z"),
    }),
    {
      issueDate: "2025-07-24",
      expiryDate: "2030-07-24",
      fallbackFields: ["passportIssueDate", "passportExpiryDate"],
    },
  );
});

test("ALP4: Altınbaş document normalization selects one writer per slot", () => {
  const docs = [
    { id: 20, type: "passport" },
    { id: 19, type: "passport" },
    { id: 18, type: "transcript" },
    { id: 17, type: null },
  ];
  assert.deepEqual(
    selectFirstDocumentPerMappedSlot(
      docs,
      (doc) => doc.type,
    ).map((doc) => doc.id),
    [20, 18],
  );
});
