import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, portalAdapterSpecsTable, usersTable } from "@workspace/db";
import portalAutomationRouter from "../src/routes/portalAutomation.js";

const RUN = `spec_admin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const KEY = `spec_${Date.now().toString(36)}`;
let userId = 0;
let currentRole = "super_admin";
let server: http.Server;

function spec(): Record<string, unknown> {
  return {
    specVersion: 1,
    ignoredSecret: "must-not-be-stored",
    meta: {
      key: KEY,
      name: `Adapter Spec Admin ${RUN}`,
      baseUrl: "https://apply.spec-admin.example",
      matches: ["spec admin university"],
    },
    auth: {
      loginUrl: "https://apply.spec-admin.example/login",
      loginSteps: [
        { action: "fill", selector: "#email", valueFrom: "profile.email" },
        { action: "click", selector: "button[type=submit]" },
      ],
    },
    steps: [
      { action: "navigate", url: "https://apply.spec-admin.example/apply" },
      { action: "jsHook", script: "window.scrollTo(0, 0)" },
      { action: "click", selector: "button[type=submit]", final: true },
    ],
    success: { successText: "submitted" },
  };
}

function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: unknown }).user = {
      id: userId,
      role: currentRole,
      isActive: true,
      emailVerified: true,
    };
    next();
  });
  app.use("/api", portalAutomationRouter);
  return app;
}

async function request(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server is not listening");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

before(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${RUN}@spec-admin.test`,
      role: "super_admin",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  userId = user.id;
  server = http.createServer(buildApp() as unknown as http.RequestListener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(portalAdapterSpecsTable).where(eq(portalAdapterSpecsTable.key, KEY));
  if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

test("adapter spec admin workflow is inert, canonical, version-bound, and fail-closed", async () => {
  const validation = await request(
    "POST",
    "/api/portal-automation/adapter-specs/validate",
    { spec: spec() },
  );
  assert.equal(validation.status, 200, JSON.stringify(validation.body));
  assert.equal(validation.body.ok, true);
  assert.equal(validation.body.sha256.length, 64);
  assert.deepEqual(validation.body.activationBlockers, [
    "PRIVILEGED_APPROVAL_REQUIRED",
    "JSHOOK_APPROVAL_REQUIRED",
  ]);
  assert.equal(validation.body.activationRequiresSeparateStep, true);

  const uploadWithActivation = await request(
    "POST",
    "/api/portal-automation/adapter-specs",
    { spec: spec(), enable: true },
  );
  assert.equal(uploadWithActivation.status, 400);

  const createdV1 = await request(
    "POST",
    "/api/portal-automation/adapter-specs",
    { spec: spec() },
  );
  assert.equal(createdV1.status, 201, JSON.stringify(createdV1.body));
  assert.equal(createdV1.body.version, 1);
  assert.equal(createdV1.body.enabled, false);
  assert.equal(createdV1.body.sha256, validation.body.sha256);

  const [storedV1] = await db
    .select()
    .from(portalAdapterSpecsTable)
    .where(
      and(
        eq(portalAdapterSpecsTable.key, KEY),
        eq(portalAdapterSpecsTable.version, 1),
      ),
    );
  assert.ok(storedV1);
  assert.equal("ignoredSecret" in storedV1.spec, false);
  assert.equal(storedV1.enabled, false);
  assert.equal(storedV1.privilegedApproved, false);
  assert.equal(storedV1.jsHookApproved, false);

  currentRole = "admin";
  const forbiddenApproval = await request(
    "PATCH",
    `/api/portal-automation/adapter-specs/${KEY}`,
    { approvalVersion: 1, privilegedApproved: true },
  );
  assert.equal(forbiddenApproval.status, 403);
  currentRole = "super_admin";

  const privilegedApproval = await request(
    "PATCH",
    `/api/portal-automation/adapter-specs/${KEY}`,
    { approvalVersion: 1, privilegedApproved: true },
  );
  assert.equal(privilegedApproval.status, 200, JSON.stringify(privilegedApproval.body));

  const blockedEnable = await request(
    "PATCH",
    `/api/portal-automation/adapter-specs/${KEY}`,
    { enableVersion: 1 },
  );
  assert.equal(blockedEnable.status, 409);
  assert.equal(blockedEnable.body.error, "JSHOOK_APPROVAL_REQUIRED");

  const jsHookApproval = await request(
    "PATCH",
    `/api/portal-automation/adapter-specs/${KEY}`,
    { approvalVersion: 1, jsHookApproved: true },
  );
  assert.equal(jsHookApproval.status, 200, JSON.stringify(jsHookApproval.body));

  const createdV2 = await request(
    "POST",
    "/api/portal-automation/adapter-specs",
    { spec: spec() },
  );
  assert.equal(createdV2.status, 201, JSON.stringify(createdV2.body));
  assert.equal(createdV2.body.version, 2);
  assert.deepEqual(createdV2.body.activationBlockers, [
    "PRIVILEGED_APPROVAL_REQUIRED",
    "JSHOOK_APPROVAL_REQUIRED",
  ]);

  const versions = await request(
    "GET",
    `/api/portal-automation/adapter-specs/${KEY}/versions`,
  );
  assert.equal(versions.status, 200, JSON.stringify(versions.body));
  const v1 = versions.body.versions.find((row: { version: number }) => row.version === 1);
  const v2 = versions.body.versions.find((row: { version: number }) => row.version === 2);
  assert.equal(v1.privilegedApproved, true);
  assert.equal(v1.jsHookApproved, true);
  assert.equal(v2.privilegedApproved, false);
  assert.equal(v2.jsHookApproved, false);

  const enabled = await request(
    "PATCH",
    `/api/portal-automation/adapter-specs/${KEY}`,
    { enableVersion: 1 },
  );
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  assert.equal(enabled.body.enabledVersion, 1);

  const revoked = await request(
    "PATCH",
    `/api/portal-automation/adapter-specs/${KEY}`,
    { approvalVersion: 1, privilegedApproved: false },
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.enabledVersion, null);
});
