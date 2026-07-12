// Unit tests for the shared @workspace/phone util (country-aware validation).
// Run: pnpm --filter @workspace/api-server run test:phone
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, isValidPhone, toValidE164 } from "@workspace/phone";
import { toE164 } from "../src/lib/inbox/phone";

test("TR mobile with spaces is valid and normalizes to E.164 (10 national digits)", () => {
  const n = normalizePhone("+90 505 558 51 81");
  assert.equal(n.isValid, true);
  assert.equal(n.e164, "+905055585181");
  assert.equal(n.country, "TR");
});

test("UZ mobile is valid with 9 national digits (not 10)", () => {
  const n = normalizePhone("+998 33 092 92 17");
  assert.equal(n.isValid, true);
  assert.equal(n.e164, "+998330929217");
  assert.equal(n.country, "UZ");
});

test("UZ number with an extra digit is INVALID (fixed 10-digit rules are wrong)", () => {
  assert.equal(isValidPhone("+9988330929217"), false);
  assert.equal(toValidE164("+9988330929217"), null);
});

test("national TR input parses with defaultCountry", () => {
  const n = normalizePhone("0505 558 51 81", "TR");
  assert.equal(n.isValid, true);
  assert.equal(n.e164, "+905055585181");
});

test("parenthesized/spaced US input is valid", () => {
  const n = normalizePhone("(212) 555-0175", "US");
  assert.equal(n.isValid, true);
  assert.equal(n.e164, "+12125550175");
});

test("empty / blank / garbage inputs are invalid, never throw", () => {
  for (const raw of ["", "   ", null, undefined, "+", "abc", "+90"]) {
    const n = normalizePhone(raw as string | null | undefined);
    assert.equal(n.isValid, false);
    assert.equal(isValidPhone(raw as string | null | undefined), false);
  }
});

test("api-server toE164 delegate keeps its contract (valid → E.164, invalid → null)", () => {
  assert.equal(toE164("+90 505 558 51 81"), "+905055585181");
  assert.equal(toE164("0505 558 51 81"), "+905055585181"); // TR default
  assert.equal(toE164("+9988330929217"), null);
  assert.equal(toE164(""), null);
  assert.equal(toE164(null), null);
});
