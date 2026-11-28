/**
 * Student Photo Endpoint — regression tests (photo-doc-avatar bug).
 *
 * SP-1  No photo document for student → 404.
 * SP-2  Photo doc with valid http fileUrl and no fileKey → 302 + Location header.
 * SP-3  Photo doc with invalid (data:) fileUrl → 422.
 * SP-4  Photo doc with deleted record (deletedAt set) → 404 (soft-deleted ignored).
 * SP-5  Photo doc with type "photograph" (alias) → also resolved (302 redirect).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:student-photo
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { buildSignedStudentPhotoPath } from "@workspace/portal-adapters";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { agentsTable, db, documentsTable, studentsTable, usersTable } from "@workspace/db";

import studentsRouter from "../src/routes/students.js";
import { recomputeStudentPhoto } from "../src/lib/studentPhoto.js";

after(() => {
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

const RUN_ID = `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

let currentUser: { id: number; role: string; isActive: boolean } | undefined = {
  id: 1,
  role: "super_admin",
  isActive: true,
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    if (!("cookies" in req)) (req as any).cookies = {};
    next();
  });
  app.use("/api", studentsRouter);
  return app;
}

const app = buildApp();

function apiReq(
  method: "GET",
  path: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const opts: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: { "Content-Type": "application/json", ...extraHeaders },
      };
      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode!, body: data, headers: res.headers });
          }
        });
      });
      req.on("error", (err) => { server.close(); reject(err); });
      req.end();
    });
    server.on("error", reject);
  });
}

// ── DB fixtures ──────────────────────────────────────────────────────────────

let studentId = 0;
let docIds: number[] = [];

async function setup() {
  const [student] = await db
    .insert(studentsTable)
    .values({ firstName: "Photo", lastName: `Test_${RUN_ID}`, email: `phototest_${RUN_ID}@test.invalid` })
    .returning({ id: studentsTable.id });
  studentId = student.id;
}

async function teardown() {
  if (docIds.length) await db.delete(documentsTable).where(eq(documentsTable.studentId, studentId));
  if (studentId) await db.delete(studentsTable).where(eq(studentsTable.id, studentId));
}

async function insertDoc(overrides: Partial<{
  type: string;
  fileKey: string | null;
  fileData: string | null;
  fileUrl: string | null;
  mimeType: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}> = {}) {
  const [doc] = await db
    .insert(documentsTable)
    .values({
      studentId,
      name: `Photo_${RUN_ID}`,
      type: overrides.type ?? "photo",
      status: "pending",
      fileKey: overrides.fileKey ?? null,
      fileData: overrides.fileData ?? null,
      fileUrl: overrides.fileUrl ?? null,
      mimeType: overrides.mimeType ?? null,
      deletedAt: overrides.deletedAt ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    })
    .returning({ id: documentsTable.id });
  docIds.push(doc.id);
  return doc.id;
}

async function readFlags() {
  const [s] = await db
    .select({ hasPhoto: studentsTable.hasPhoto, photoUrl: studentsTable.photoUrl })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId));
  return s;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("SP-1: no photo document → 404", async () => {
  await setup();
  try {
    const r = await apiReq("GET", `/api/students/${studentId}/photo`);
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "No photo");
  } finally {
    await teardown();
  }
});

test("SP-2: photo doc with valid http fileUrl → 302 redirect", async () => {
  await setup();
  try {
    const photoUrl = "https://example.com/student-photo.jpg";
    await insertDoc({ fileUrl: photoUrl, mimeType: "image/jpeg" });

    const r = await apiReq("GET", `/api/students/${studentId}/photo`);
    assert.equal(r.status, 302, `expected 302 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.headers.location, photoUrl);
  } finally {
    await teardown();
  }
});

test("SP-3: photo doc with data: fileUrl → 422 (SSRF guard)", async () => {
  await setup();
  try {
    await insertDoc({ fileUrl: "data:image/jpeg;base64,/9j/ABC123", mimeType: "image/jpeg" });

    const r = await apiReq("GET", `/api/students/${studentId}/photo`);
    assert.equal(r.status, 422, `expected 422 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.error, "should have error message");
  } finally {
    await teardown();
  }
});

test("SP-4: soft-deleted photo doc ignored → 404", async () => {
  await setup();
  try {
    await insertDoc({ fileUrl: "https://example.com/photo.jpg", deletedAt: new Date() });

    const r = await apiReq("GET", `/api/students/${studentId}/photo`);
    assert.equal(r.status, 404, `expected 404 got ${r.status}: ${JSON.stringify(r.body)}`);
  } finally {
    await teardown();
  }
});

test("SP-5: type=photograph alias also resolves → 302", async () => {
  await setup();
  try {
    const photoUrl = "https://cdn.example.com/img/photograph.png";
    await insertDoc({ type: "photograph", fileUrl: photoUrl, mimeType: "image/png" });

    const r = await apiReq("GET", `/api/students/${studentId}/photo`);
    assert.equal(r.status, 302, `expected 302 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.headers.location, photoUrl);
  } finally {
    await teardown();
  }
});

// ── recomputeStudentPhoto — denormalized has_photo/photo_url sync ─────────────
// Guards the self-healing helper that every write path (upload, delete,
// public-apply, embed, lead-convert/merge) calls. Must mirror the endpoint:
// latest doc only, servable = fileKey || fileData || http(s) fileUrl.

test("SP-6: recompute sets has_photo=true + photo_url for an http fileUrl photo", async () => {
  await setup();
  try {
    await insertDoc({ fileUrl: "https://example.com/p.jpg", mimeType: "image/jpeg" });
    await recomputeStudentPhoto(studentId);
    const f = await readFlags();
    assert.equal(f.hasPhoto, true);
    assert.equal(f.photoUrl, `/api/students/${studentId}/photo`);
  } finally {
    await teardown();
  }
});

test("SP-7: recompute sets has_photo=true for a fileData-only photo (legacy upload)", async () => {
  await setup();
  try {
    await insertDoc({ fileData: "/9j/ABCfakebase64", mimeType: "image/jpeg" });
    await recomputeStudentPhoto(studentId);
    const f = await readFlags();
    assert.equal(f.hasPhoto, true);
    assert.equal(f.photoUrl, `/api/students/${studentId}/photo`);
  } finally {
    await teardown();
  }
});

test("SP-8: recompute leaves has_photo=false for a data:-only fileUrl (endpoint 422s)", async () => {
  await setup();
  try {
    await insertDoc({ fileUrl: "data:image/jpeg;base64,/9j/ABC", mimeType: "image/jpeg" });
    await recomputeStudentPhoto(studentId);
    const f = await readFlags();
    assert.equal(f.hasPhoto, false);
    assert.equal(f.photoUrl, null);
  } finally {
    await teardown();
  }
});

test("SP-9: recompute follows LATEST doc — newer unservable data: hides older http photo", async () => {
  await setup();
  try {
    await insertDoc({ fileUrl: "https://example.com/old.jpg", createdAt: new Date(Date.now() - 60_000) });
    await insertDoc({ fileUrl: "data:image/jpeg;base64,/9j/NEW", createdAt: new Date() });
    await recomputeStudentPhoto(studentId);
    const f = await readFlags();
    // Endpoint serves only the latest doc, which is the unservable data: URI.
    assert.equal(f.hasPhoto, false);
    assert.equal(f.photoUrl, null);
  } finally {
    await teardown();
  }
});

test("SP-10: valid inline PDF uses the protected source if both server renderers are unavailable", async () => {
  await setup();
  const realPath = process.env.PATH;
  const noRenderers = await mkdtemp(join(tmpdir(), "photo-no-renderers-"));
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage([140, 180]).drawRectangle({ x: 0, y: 0, width: 140, height: 180, color: rgb(0.7, 0.2, 0.1) });
    await insertDoc({ mimeType: "application/pdf", fileData: Buffer.from(await pdf.save()).toString("base64") });
    const base = "/api/students/" + studentId + "/photo";
    process.env.PATH = noRenderers;
    const legacy = await apiReq("GET", base + "/thumbnail");
    assert.equal(legacy.status, 200);
    assert.equal(legacy.headers["content-type"], "image/jpeg");
    assert.equal(legacy.headers["cache-control"], "private, no-store");
    const optIn = await apiReq("GET", base + "/thumbnail?v=12&fallback=source");
    assert.equal(optIn.status, 302);
    assert.equal(optIn.headers.location, base + "?v=12");
    assert.equal(optIn.headers["cache-control"], "private, no-store");
    assert.equal(optIn.headers.etag, undefined);
    const raw = await apiReq("GET", optIn.headers.location!);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers["content-type"], "application/pdf");
    assert.ok(String(raw.body).startsWith("%PDF-"));

    const previousUser = currentUser;
    const previousSigningSecret = process.env.ASSET_URL_SIGNING_SECRET;
    try {
      currentUser = { id: 987654, role: "student", isActive: true };
      for (const path of [base, base + "/thumbnail?fallback=source"]) {
        const denied = await apiReq("GET", path);
        assert.equal(denied.status, 403);
        assert.equal(denied.headers.location, undefined);
      }
      process.env.ASSET_URL_SIGNING_SECRET = "synthetic-photo-test-key-only";
      const signed = buildSignedStudentPhotoPath(studentId);
      assert.ok(signed);
      const signedThumbnail = signed.replace("/photo?", "/photo/thumbnail?") + "&fallback=source";
      const signedRedirect = await apiReq("GET", signedThumbnail);
      assert.equal(signedRedirect.status, 302);
      assert.equal(signedRedirect.headers.location, signed);
      const wrongStudent = signedThumbnail.replace("/" + studentId + "/photo", "/" + (studentId + 100000) + "/photo");
      assert.ok([403, 404].includes((await apiReq("GET", wrongStudent)).status));
    } finally {
      currentUser = previousUser;
      if (previousSigningSecret === undefined) delete process.env.ASSET_URL_SIGNING_SECRET;
      else process.env.ASSET_URL_SIGNING_SECRET = previousSigningSecret;
    }
  } finally {
    if (realPath === undefined) delete process.env.PATH;
    else process.env.PATH = realPath;
    await rm(noRenderers, { recursive: true, force: true });
    await teardown();
  }
});

test("SP-11: the opt-in URL still returns a cacheable JPEG for a PNG or JPEG photograph", async () => {
  await setup();
  try {
    for (const format of ["png", "jpeg"] as const) {
      const image = await sharp({
        create: { width: 48, height: 52, channels: 3, background: "#ff3300" },
      }).toFormat(format).toBuffer();
      await insertDoc({ mimeType: "image/" + format, fileData: image.toString("base64") });
      const r = await apiReq("GET", "/api/students/" + studentId + "/photo/thumbnail?fallback=source");
      assert.equal(r.status, 200);
      assert.equal(r.headers["content-type"], "image/jpeg");
      assert.equal(r.headers["cache-control"], "private, max-age=300");
      assert.ok(r.headers.etag);
      assert.equal(r.headers.location, undefined);
    }
  } finally {
    await teardown();
  }
});

test("SP-12: an absent or deleted photo cannot redirect to a source", async () => {
  await setup();
  const base = "/api/students/" + studentId + "/photo/thumbnail?fallback=source";
  try {
    assert.equal((await apiReq("GET", base)).status, 404);
    await insertDoc({ fileUrl: "https://example.invalid/deleted-photo.jpg", deletedAt: new Date() });
    assert.equal((await apiReq("GET", base)).status, 404);
    await insertDoc({ fileUrl: "https://example.invalid/official-photo.jpg", mimeType: "image/jpeg" });
    const result = await apiReq("GET", base);
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, "/api/students/" + studentId + "/photo");
    const external = await apiReq("GET", result.headers.location!);
    assert.equal(external.headers.location, "https://example.invalid/official-photo.jpg");
  } finally {
    await teardown();
  }
});

test("SP-13: a fileKey photo uses object storage and stays on the guarded route", async () => {
  await setup();
  const directory = await mkdtemp(join(tmpdir(), "student-photo-object-test-"));
  const previous = { driver: process.env.STORAGE_DRIVER, directory: process.env.STORAGE_LOCAL_DIR };
  try {
    process.env.STORAGE_DRIVER = "local";
    process.env.STORAGE_LOCAL_DIR = directory;
    const key = "student-photo-fixture.jpg";
    await writeFile(join(directory, key), await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#338844" },
    }).jpeg().toBuffer());
    await insertDoc({ fileKey: "/objects/" + key, mimeType: "image/jpeg" });
    const base = "/api/students/" + studentId + "/photo";
    for (const endpoint of [base, base + "/thumbnail?fallback=source"]) {
      const response = await apiReq("GET", endpoint);
      assert.equal(response.status, 200);
      assert.equal(response.headers["content-type"], "image/jpeg");
      assert.equal(response.headers.location, undefined);
    }
  } finally {
    if (previous.driver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = previous.driver;
    if (previous.directory === undefined) delete process.env.STORAGE_LOCAL_DIR;
    else process.env.STORAGE_LOCAL_DIR = previous.directory;
    await rm(directory, { recursive: true, force: true });
    await teardown();
  }
});

test("SP-14: a photo source is available to its agency and denied to unrelated agencies and anonymous users", async () => {
  const previousUser = currentUser;
  let agencyIds: number[] = [];
  let userIds: number[] = [];
  await setup();
  try {
    const [owner, unrelated] = await db.insert(usersTable).values([
      { email: `photo-owner-${RUN_ID}@test.invalid`, role: "agent" },
      { email: `photo-unrelated-${RUN_ID}@test.invalid`, role: "agent" },
    ]).returning({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive });
    userIds = [owner.id, unrelated.id];
    const [ownerAgency, unrelatedAgency] = await db.insert(agentsTable).values([
      { userId: owner.id, firstName: "Photo", lastName: "Owner agency" },
      { userId: unrelated.id, firstName: "Photo", lastName: "Unrelated agency" },
    ]).returning({ id: agentsTable.id });
    agencyIds = [ownerAgency.id, unrelatedAgency.id];
    await db.update(studentsTable).set({ agentId: ownerAgency.id }).where(eq(studentsTable.id, studentId));
    await insertDoc({ fileUrl: "https://example.invalid/agency-photo.jpg", mimeType: "image/jpeg" });

    const original = "/api/students/" + studentId + "/photo";
    const thumbnail = original + "/thumbnail?fallback=source";
    currentUser = owner;
    const allowed = await apiReq("GET", thumbnail);
    assert.equal(allowed.status, 302);
    assert.equal(allowed.headers.location, original);
    assert.equal(allowed.headers["cache-control"], "private, no-store");
    assert.equal((await apiReq("GET", original)).status, 302);

    currentUser = unrelated;
    for (const path of [thumbnail, original]) {
      const denied = await apiReq("GET", path);
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.location, undefined);
    }

    currentUser = undefined;
    for (const path of [thumbnail, original]) {
      const denied = await apiReq("GET", path);
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.location, undefined);
    }
  } finally {
    currentUser = previousUser;
    await teardown();
    if (agencyIds.length) await db.delete(agentsTable).where(inArray(agentsTable.id, agencyIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});
