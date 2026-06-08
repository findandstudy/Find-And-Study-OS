import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSignatureImage, MAX_SIGNATURE_BYTES } from "../src/lib/signContract";
import { MAIN_AGENCY_SIGNATURE_DATA_URL } from "../src/lib/mainAgencySignature";
import {
  renderTemplate,
  buildAgentContext,
  cleanupSignatureImages,
  toSignatureDataUrl,
  SIG_PLACEHOLDER,
} from "../src/lib/contractRenderer";

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

// --- Render path: a stored bare-base64 signature must become a real
// data:image/png;base64 <img src> so it renders inside the signature box of the
// generated PDF (regression guard for the "broken image icon" prod incident,
// where the renderer received bare base64 without the data: prefix). ---

const SIG_TEMPLATE =
  `<p>Signer: {{signer_name}}</p><img src="{{signature}}" alt="signer signature">`;

function renderWithSignature(storedSig: string): string {
  const ctx = buildAgentContext(null, null, { signerName: "Test Agent" });
  ctx.signature = toSignatureDataUrl(storedSig);
  return cleanupSignatureImages(renderTemplate(SIG_TEMPLATE, ctx), SIG_PLACEHOLDER.en);
}

test("renders a bare-base64 signature as a data:image/png;base64 <img src>", () => {
  const html = renderWithSignature(VALID_PNG_BASE64);
  assert.ok(
    html.includes(`src="data:image/png;base64,${VALID_PNG_BASE64}"`),
    `expected a wrapped data-URL src, got: ${html}`,
  );
  // The filled signature must NOT be downgraded to the unfilled placeholder box.
  assert.equal(html.includes(SIG_PLACEHOLDER.en), false);
});

test("renders a legacy data-URL signature unchanged (idempotent wrap, no double prefix)", () => {
  const html = renderWithSignature(`data:image/png;base64,${VALID_PNG_BASE64}`);
  assert.ok(html.includes(`src="data:image/png;base64,${VALID_PNG_BASE64}"`));
  assert.equal((html.match(/data:image\/png;base64,/g) || []).length, 1);
});

test("an unfilled signature falls back to the styled placeholder box (no <img>)", () => {
  const ctx = buildAgentContext(null, null, { signerName: "Test Agent" });
  // signature left as "" (unsigned preview render). Use an alt-less <img> so the
  // placeholder box uses the per-language placeholder text (an alt attribute, if
  // present, would be reused as the box label instead — see cleanupSignatureImages).
  const html = cleanupSignatureImages(renderTemplate(`<img src="{{signature}}">`, ctx), SIG_PLACEHOLDER.en);
  assert.equal(html.includes("<img"), false);
  assert.ok(html.includes(SIG_PLACEHOLDER.en));
});

// --- Main-agency seal: the final, post-signature PDF render must stamp the
// Find And Study seal into the {{main_agency_signature}} box, while the
// preview / signing-screen render (which never sets ctx.main_agency_signature)
// must leave that box empty -- no broken image, no leaked seal before signing.
// {{signature}} -> Alt Acente; {{main_agency_signature}} -> Ana Acente. ---

const DUAL_SIG_TEMPLATE =
  `<img src="{{signature}}" alt="Alt Acente İmzası">` +
  `<img src="{{main_agency_signature}}" alt="Ana Acente İmzası">`;

test("final render stamps the main-agency seal into {{main_agency_signature}}", () => {
  const ctx = buildAgentContext(null, null, { signerName: "Test Agent" });
  ctx.signature = toSignatureDataUrl(VALID_PNG_BASE64);
  // Mirror ensureSignedContractPdf's final-render injection.
  ctx.main_agency_signature = MAIN_AGENCY_SIGNATURE_DATA_URL;
  const html = cleanupSignatureImages(renderTemplate(DUAL_SIG_TEMPLATE, ctx), SIG_PLACEHOLDER.en);
  assert.ok(
    html.includes(`src="${MAIN_AGENCY_SIGNATURE_DATA_URL}"`),
    "expected the main-agency seal data URL in the final render",
  );
  assert.ok(MAIN_AGENCY_SIGNATURE_DATA_URL.startsWith("data:image/png;base64,"));
  // The two signature boxes must carry DIFFERENT images (sub vs main agency).
  assert.ok(html.includes(`src="data:image/png;base64,${VALID_PNG_BASE64}"`));
  assert.notEqual(MAIN_AGENCY_SIGNATURE_DATA_URL, toSignatureDataUrl(VALID_PNG_BASE64));
});

test("preview render leaves {{main_agency_signature}} empty (no seal, no <img>)", () => {
  const ctx = buildAgentContext(null, null, { signerName: "Test Agent" });
  ctx.signature = toSignatureDataUrl(VALID_PNG_BASE64);
  // Preview path never sets main_agency_signature -> buildAgentContext default "".
  const html = cleanupSignatureImages(renderTemplate(DUAL_SIG_TEMPLATE, ctx), SIG_PLACEHOLDER.en);
  assert.equal(html.includes(MAIN_AGENCY_SIGNATURE_DATA_URL), false);
  // The Ana Acente box collapses to the styled placeholder using its alt label,
  // so there is exactly ONE real <img> (the sub-agent's signature) in preview.
  assert.equal((html.match(/<img/g) || []).length, 1);
});

// NOTE: the "second sign -> 409" case is enforced by finalizeSign's session
// status guard (a session already in status "signed" returns 409) and is
// exercised end-to-end by scripts/test-contract-sign-smoke.ts; it requires a
// live DB session fixture so it is intentionally not duplicated as a unit test
// here, which targets the pure signature validation/normalization logic.
