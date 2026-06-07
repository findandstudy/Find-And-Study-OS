import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSignatureImage, MAX_SIGNATURE_BYTES } from "../src/lib/signContract";

// A real 1x1 transparent PNG (starts with the PNG magic 89 50 4E 47 0D 0A 1A 0A).
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("accepts a valid bare-base64 PNG and returns no data: prefix", () => {
  const r = validateSignatureImage(VALID_PNG_BASE64);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.base64.includes("data:"), false);
    assert.equal(r.base64, VALID_PNG_BASE64);
  }
});

test("accepts a legacy data-URL PNG and strips the data: prefix (normalize)", () => {
  const r = validateSignatureImage(`data:image/png;base64,${VALID_PNG_BASE64}`);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.base64, VALID_PNG_BASE64);
    assert.equal(r.base64.includes("data:"), false);
  }
});

test('rejects non-PNG garbage ("AAAA") with 400 Invalid PNG', () => {
  const r = validateSignatureImage("AAAA");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.equal(r.error, "Invalid PNG");
  }
});

test("rejects an empty string with 400 Invalid PNG", () => {
  const r = validateSignatureImage("");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("rejects an oversized (>2 MB decoded) PNG with 400", () => {
  // PNG magic followed by enough filler to exceed the decoded size cap.
  const big = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(MAX_SIGNATURE_BYTES + 1),
  ]);
  const r = validateSignatureImage(big.toString("base64"));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.equal(r.error, "Signature image too large");
  }
});

// NOTE: the "second sign -> 409" case is enforced by finalizeSign's session
// status guard (a session already in status "signed" returns 409) and is
// exercised end-to-end by scripts/test-contract-sign-smoke.ts; it requires a
// live DB session fixture so it is intentionally not duplicated as a unit test
// here, which targets the pure signature validation/normalization logic.
