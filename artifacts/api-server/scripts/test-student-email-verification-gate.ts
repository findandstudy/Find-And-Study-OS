import { readFileSync } from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Express } from "express";
import { studentEmailVerificationGate } from "../src/middlewares/studentEmailVerificationGate.js";

type TestUser = {
  id: number;
  role: string;
  emailVerified: boolean;
};

function buildApp(user?: TestUser): Express {
  const app = express();
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use(studentEmailVerificationGate);
  app.use((_req, res) => res.json({ ok: true }));
  return app;
}

async function request(app: Express, method: "GET" | "POST", path: string) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listen failed");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method });
    return { status: response.status, body: await response.json() as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const unverifiedStudent = { id: 41, role: "student", emailVerified: false };

test("unverified student can read the current session", async () => {
  const result = await request(buildApp(unverifiedStudent), "GET", "/auth/me");
  assert.equal(result.status, 200);
});

test("unverified student can request and consume email verification", async () => {
  const resend = await request(buildApp(unverifiedStudent), "POST", "/auth/resend-verification-email");
  const verify = await request(buildApp(unverifiedStudent), "GET", "/auth/verify-email-token/example-token");
  assert.equal(resend.status, 200);
  assert.equal(verify.status, 200);
});

test("unverified student cannot access protected student APIs", async () => {
  const result = await request(buildApp(unverifiedStudent), "GET", "/students/me");
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "EMAIL_VERIFICATION_REQUIRED");
});

test("verified students and non-students pass through", async () => {
  const verified = await request(buildApp({ id: 42, role: "student", emailVerified: true }), "GET", "/students/me");
  const staff = await request(buildApp({ id: 43, role: "staff", emailVerified: false }), "GET", "/students/1");
  assert.equal(verified.status, 200);
  assert.equal(staff.status, 200);
});

test("auth middleware preserves unverified student sessions for the central gate", () => {
  const source = readFileSync(
    new URL("../src/middlewares/authMiddleware.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /Email not verified/);
  assert.match(source, /isPublicApplyPendingVerification/);
});
