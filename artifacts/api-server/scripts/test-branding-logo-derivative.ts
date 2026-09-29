import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { createHeaderLogoDerivative } from "../src/lib/brandingLogoDerivative";

test("header branding derivative is bounded, responsive and stable", async () => {
  const source = await sharp({
    create: { width: 1800, height: 400, channels: 4, background: "#123456" },
  }).png().toBuffer();
  const first = await createHeaderLogoDerivative(source);
  const second = await createHeaderLogoDerivative(source);
  const metadata = await sharp(first.bytes).metadata();
  assert.equal(first.contentType, "image/webp");
  assert.equal(metadata.width, 360);
  assert.equal(metadata.height, 80);
  assert.ok(first.bytes.length < source.length);
  assert.equal(first.etag, second.etag);
  assert.deepEqual(first.bytes, second.bytes);
});

test("header branding derivative rejects empty and oversized sources", async () => {
  await assert.rejects(() => createHeaderLogoDerivative(Buffer.alloc(0)), /SOURCE_SIZE_INVALID/);
  await assert.rejects(() => createHeaderLogoDerivative(Buffer.alloc(5 * 1024 * 1024 + 1)), /SOURCE_SIZE_INVALID/);
});
