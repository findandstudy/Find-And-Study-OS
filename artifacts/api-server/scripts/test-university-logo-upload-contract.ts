import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../src/routes/universities.ts", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../../edcons/src/pages/admin/Catalog.tsx", import.meta.url), "utf8");

test("university logo editor uploads finalized objects and sends explicit removal", () => {
  assert.match(catalog, /prefix: "branding\/university-logo"/);
  assert.match(catalog, /uploadAndFinalizeObject\(upload\.uploadURL, upload\.objectPath/);
  assert.match(catalog, /setF\(\{ logoUrl: null \}\)/);
  assert.match(catalog, /e\.target\.value = ""/);
  assert.match(catalog, /disabled=\{save\.isPending \|\| logoUploading/);
  assert.doesNotMatch(catalog, /setF\(\{ logoUrl: undefined \}\)/);
});

test("university logo writes validate ownership, bytes and finalized upload grant", () => {
  assert.match(route, /callerOwnsObject\(userId, logoUrl\)/);
  assert.match(route, /objectKey\.startsWith\("branding\/university-logo\/"\)/);
  assert.match(route, /validateUploadedFileBuffer\(`university-logo\.\$\{extension\}`/);
  assert.equal((route.match(/consumeFinalizedUploadGrantInDrizzle\(tx,/g) ?? []).length, 2);
  assert.match(route, /UNIVERSITY_LOGO_UPLOAD_GRANT_NOT_FINALIZED/);
});

test("public university logo endpoint revalidates stable URLs and proxies private objects", () => {
  const start = route.indexOf('router.get("/universities/:id/logo"');
  const end = route.indexOf('router.post("/universities"', start);
  const boundary = route.slice(start, end);
  assert.match(boundary, /max-age=0, must-revalidate/);
  assert.match(boundary, /createHash\("sha256"\)/);
  assert.match(boundary, /if-none-match/);
  assert.match(boundary, /getObjectEntityFile\(`\/objects\/\$\{objectKey\}`\)/);
  assert.match(boundary, /res\.send\(bytes\)/);
  assert.doesNotMatch(boundary, /max-age=86400/);
});
