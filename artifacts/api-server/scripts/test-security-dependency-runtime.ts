/** Real parsers/transports, synthetic fixtures; no database or provider sends. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import nodemailer from "nodemailer";

const require = createRequire(import.meta.url);
function atLeast(actual: string, minimum: string): boolean {
  const a = actual.split(".").map(Number), b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isSafeInteger(a[i])) return false;
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

test("API and portal runner both resolve patched sharp; mailer is patched", async () => {
  const portalRequire = createRequire(new URL("../../../lib/portal-runner/package.json", import.meta.url));
  assert.ok(atLeast(sharp.versions.sharp, "0.35.4"));
  assert.ok(atLeast(portalRequire("sharp").versions.sharp, "0.35.4"));
  assert.ok(atLeast(require("nodemailer/package.json").version, "9.1.1"));
  assert.ok(atLeast(sharp.versions.heif, "1.23.2"));
});

test("patched sharp still normalizes generated PNG to bounded JPEG", async () => {
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#173b92" } }).png().toBuffer();
  const jpeg = await sharp(png, { limitInputPixels: 16_000_000 }).resize(128, 128).jpeg().toBuffer();
  const metadata = await sharp(jpeg).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
});

test("patched nodemailer compiles synthetic mail without opening SMTP", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix", disableFileAccess: true, disableUrlAccess: true });
  const result = await transport.sendMail({ from: "sender@example.test", to: "recipient@example.test", subject: "Regression fixture", text: "No delivery", attachments: [{ filename: "fixture.txt", content: Buffer.from("synthetic") }] });
  assert.match(result.message.toString(), /Subject: Regression fixture/);
  assert.match(result.message.toString(), /filename=fixture.txt/);
});

test("mailer refuses file and URL attachment access under existing safety options", async () => {
  for (const path of ["/not-a-real-file/synthetic.txt", "https://example.invalid/never-requested.txt"]) {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, disableFileAccess: true, disableUrlAccess: true });
    await assert.rejects(transport.sendMail({ from: "sender@example.test", to: "recipient@example.test", subject: "Fixture", text: "Test", attachments: [{ path }] }), /access rejected/i);
  }
  const source = await readFile(new URL("../src/lib/email.ts", import.meta.url), "utf8");
  assert.ok(source.includes("disableFileAccess: true") && source.includes("disableUrlAccess: true"), "runtime transport retains I/O restrictions");
});
