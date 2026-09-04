import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildPortalStatusArtifact } from "@workspace/portal-adapters";
import { ObjectStorageService } from "../src/lib/objectStorage.js";
import { validatePortalArtifactForStorage } from "../src/lib/portalArtifactIntake.js";

const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "ascii");

test("portal artifacts require bounded bytes whose magic matches the MIME type", () => {
  const artifact = buildPortalStatusArtifact({
    kind: "offer_letter",
    fileName: "../../Offer Letter.pdf",
    contentType: "application/pdf; charset=binary",
    bytes: pdfBytes,
    sourceLabel: "Offer download control",
    maxBytes: 1024,
  });
  assert.equal(artifact.fileName, "Offer_Letter.pdf");
  const validated = validatePortalArtifactForStorage(artifact);
  assert.equal(validated.stage, "offer_received");
  assert.equal(validated.extension, ".pdf");
  assert.equal(validated.sha256, createHash("sha256").update(pdfBytes).digest("hex"));

  assert.throws(
    () => buildPortalStatusArtifact({
      kind: "offer_letter",
      contentType: "image/png",
      bytes: pdfBytes,
      sourceLabel: "Offer download control",
      maxBytes: 1024,
    }),
    /content_mismatch/,
  );
});

test("content-addressed storage is retry-idempotent and does not duplicate bytes", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "fas-portal-artifact-"));
  const previousDriver = process.env.STORAGE_DRIVER;
  const previousDir = process.env.STORAGE_LOCAL_DIR;
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = tempRoot;
  try {
    const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
    const storage = new ObjectStorageService();
    const input = {
      subdir: "portal-artifacts/application-42",
      contentSha256: sha256,
      buffer: pdfBytes,
      contentType: "application/pdf",
      extension: ".pdf" as const,
    };
    const first = await storage.uploadContentAddressedBuffer(input);
    const second = await storage.uploadContentAddressedBuffer(input);
    assert.equal(first, second);
    assert.equal(first, `/objects/portal-artifacts/application-42/${sha256}.pdf`);
    assert.deepEqual(
      await readFile(join(tempRoot, "portal-artifacts", "application-42", `${sha256}.pdf`)),
      pdfBytes,
    );
  } finally {
    if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = previousDriver;
    if (previousDir === undefined) delete process.env.STORAGE_LOCAL_DIR;
    else process.env.STORAGE_LOCAL_DIR = previousDir;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
