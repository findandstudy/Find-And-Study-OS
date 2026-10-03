import test from "node:test";
import assert from "node:assert/strict";
import { projectPublicTuition, publicCurrency, publicMinorAmount } from "../src/lib/publicCatalogTuition";

const legacy = { tuitionFee: 30000, discountedFee: null, currency: "gbp" };
const verified = { componentType: "TUITION", amountMinor: "2200000", currencyCode: "GBP", frequency: "YEARLY" };
test("verified tuition takes priority; source is explicit", () => {
  assert.deepEqual(projectPublicTuition(legacy, [verified]), { amount: 22000, currency: "GBP", verified: true, source: "verified", frequency: "YEARLY", isFrom: false });
});
test("legacy fallback is labelled unverified, not a verified offer", () => {
  assert.equal(projectPublicTuition(legacy, [])?.amount, 30000);
  assert.equal(projectPublicTuition(legacy, [])?.verified, false);
  assert.equal(projectPublicTuition({ ...legacy, discountedFee: 0 }, [])?.amount, 0);
});
test("missing or invalid currency never assumes USD", () => {
  for (const currency of [null, "", "   ", "AAA", "javascript:usd"]) assert.equal(projectPublicTuition({ ...legacy, currency }, []), null);
  assert.equal(publicCurrency(" try "), "TRY");
});
test("nondecimal and three-decimal currencies use ISO minor units", () => {
  assert.equal(publicMinorAmount("12000", "JPY"), 12000);
  assert.equal(publicMinorAmount("12000", "KWD"), 12);
  assert.equal(publicMinorAmount("12000", "GBP"), 120);
});
test("multiple comparable prices expose a from-price; mixed periods/currencies fail closed", () => {
  assert.equal(projectPublicTuition(legacy, [verified, { ...verified, amountMinor: "1900000" }])?.isFrom, true);
  assert.equal(projectPublicTuition(legacy, [verified, { ...verified, currencyCode: "USD" }]), null);
  assert.equal(projectPublicTuition(legacy, [verified, { ...verified, frequency: "MONTHLY" }]), null);
});
test("malformed verified prices do not silently fall back to a legacy advertised amount", () => {
  for (const amountMinor of ["", "-1", "1.2", "9007199254740993", "NaN"]) assert.equal(projectPublicTuition(legacy, [{ ...verified, amountMinor }]), null);
  assert.equal(projectPublicTuition({ ...legacy, tuitionFee: Number.NaN }, []), null);
});
test("bounded overflow never advertises an incomplete set of prices", () => {
  assert.equal(projectPublicTuition(legacy, Object.assign([verified], { truncated: true })), null);
});
