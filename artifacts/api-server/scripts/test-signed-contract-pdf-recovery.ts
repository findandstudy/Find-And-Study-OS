import { test } from "node:test";
import assert from "node:assert/strict";
import { decideMissingPdfRecovery, MISSING_PDF_LEASE_RESET, PDF_LEASE_MS } from "../src/lib/signedContractPdfRecovery";

const now = new Date("2026-11-25T18:00:00Z");
const row = { pdfObjectKey: null, evidenceHash: null, deliveryClaimedAt: null, emailedAt: null, signedAt: new Date(now.getTime() - 60_000) };
const workers = { delivery: true, pdfOnly: false };
test("finalized PDF or evidence is never eligible for regeneration", () => {
  for (const artifact of [{ pdfObjectKey: "/objects/final.pdf" }, { evidenceHash: "frozen-evidence" }]) {
    const result = decideMissingPdfRecovery({ ...row, ...artifact }, workers, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SIGNED_ARTIFACT_IMMUTABLE");
  }
  assert.deepEqual(Object.keys(MISSING_PDF_LEASE_RESET), ["deliveryClaimedAt"]);
});
test("an active or exact-boundary lease cannot be stolen", () => {
  for (const age of [0, PDF_LEASE_MS]) {
    const result = decideMissingPdfRecovery({ ...row, deliveryClaimedAt: new Date(now.getTime() - age) }, workers, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PDF_WORK_IN_PROGRESS");
  }
  assert.equal(decideMissingPdfRecovery({ ...row, deliveryClaimedAt: new Date(now.getTime() - PDF_LEASE_MS - 1) }, workers, now).ok, true);
});
test("disabled workers cannot be presented as a queued render", () => {
  const result = decideMissingPdfRecovery(row, { delivery: false, pdfOnly: false }, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
});
test("historical unemailed rows are not silently enrolled in a delivery sweep", () => {
  const historical = { ...row, signedAt: new Date(now.getTime() - 3 * 24 * 60 * 60_000) };
  for (const enabled of [workers, { delivery: false, pdfOnly: true }]) {
    const result = decideMissingPdfRecovery(historical, enabled, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONTROLLED_PDF_RECOVERY_REQUIRED");
  }
  assert.equal(decideMissingPdfRecovery({ ...historical, emailedAt: new Date(now.getTime() - 1_000) }, workers, now).ok, true);
  assert.equal(decideMissingPdfRecovery({ ...historical, emailedAt: now }, { delivery: false, pdfOnly: true }, now).ok, false);
});
test("recent missing PDF can use existing email or render-only worker without status changes", () => {
  assert.equal(decideMissingPdfRecovery(row, workers, now).ok, true);
  assert.equal(decideMissingPdfRecovery(row, { delivery: false, pdfOnly: true }, now).ok, true);
  assert.deepEqual(row, { pdfObjectKey: null, evidenceHash: null, deliveryClaimedAt: null, emailedAt: null, signedAt: new Date(now.getTime() - 60_000) });
});
