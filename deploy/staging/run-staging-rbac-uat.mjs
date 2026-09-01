#!/usr/bin/env node
import { fileURLToPath } from "node:url";

const EXACT_STAGING_ORIGIN = "https://staging.srv1110168.hstgr.cloud";
const ROLE_EMAILS = {
  super_admin: "audit-superadmin@audit.test",
  admin: "audit-admin@audit.test",
  manager: "audit-manager@audit.test",
  staff: "audit-staff@audit.test",
  consultant: "audit-consultant@audit.test",
  editor: "audit-editor@audit.test",
  accountant: "audit-accountant@audit.test",
  agent: "audit-agent@audit.test",
  sub_agent: "audit-subagent@audit.test",
  agent_staff: "audit-agentstaff@audit.test",
  student: "audit-student@audit.test",
};

const ROLE_CHECKS = {
  super_admin: [
    ["/api/finance/university-receivables", 200],
    ["/api/ai-personas", 200],
    ["/api/notification-rules", 200],
    ["/api/conversations", 200],
    ["/api/broadcasts", 200],
    ["/api/message-templates", 200],
    ["/api/leads", 200],
    ["/api/students", 200],
    ["/api/applications", 200],
  ],
  admin: [
    ["/api/finance/university-receivables", 200],
    ["/api/ai-personas", 200],
    ["/api/notification-rules", 200],
    ["/api/conversations", 200],
    ["/api/broadcasts", 200],
    ["/api/message-templates", 200],
    ["/api/leads", 200],
    ["/api/students", 200],
    ["/api/applications", 200],
  ],
  manager: [
    ["/api/finance/university-receivables", 403],
    ["/api/ai-personas", 200],
    ["/api/notification-rules", 200],
    ["/api/conversations", 200],
    ["/api/broadcasts", 200],
    ["/api/leads", 200],
  ],
  staff: [
    ["/api/finance/university-receivables", 403],
    ["/api/ai-personas", 403],
    ["/api/notification-rules", 403],
    ["/api/conversations", 200],
    ["/api/broadcasts", 403],
    ["/api/message-templates", 200],
    ["/api/leads", 200],
    ["/api/students", 200],
    ["/api/applications", 200],
    ["/api/agents/me", [403, 404]],
  ],
  consultant: [
    ["/api/finance/university-receivables", 403],
    ["/api/ai-personas", 403],
    ["/api/conversations", 200],
    ["/api/leads", 200],
  ],
  editor: [
    ["/api/finance/university-receivables", 403],
    ["/api/ai-personas", 403],
    ["/api/conversations", 200],
    ["/api/leads", 200],
  ],
  accountant: [
    ["/api/finance/university-receivables", 200],
    ["/api/ai-personas", 403],
    ["/api/notification-rules", 403],
    ["/api/conversations", 200],
    ["/api/broadcasts", 403],
    ["/api/message-templates", 200],
    ["/api/leads", 200],
  ],
  agent: [
    ["/api/finance/university-receivables", 403],
    ["/api/ai-personas", 403],
    ["/api/notification-rules", 403],
    ["/api/conversations", 403],
    ["/api/broadcasts", 403],
    ["/api/message-templates", 403],
    ["/api/agents/me", 200],
    ["/api/agents/me/sub-agents", 200],
    ["/api/commissions", 403],
  ],
  sub_agent: [
    ["/api/finance/university-receivables", 403],
    ["/api/ai-personas", 403],
    ["/api/conversations", 403],
    ["/api/agents/me", 200],
    ["/api/leads", 200],
  ],
  agent_staff: [
    ["/api/finance/university-receivables", 403],
    ["/api/ai-personas", 403],
    ["/api/conversations", 403],
    ["/api/agents/me", 200],
    ["/api/leads", 200],
    ["/api/students", 200],
    ["/api/applications", 200],
    ["/api/commissions", 403],
  ],
  student: [
    ["/api/finance/university-receivables", 403],
    ["/api/ai-personas", 403],
    ["/api/notification-rules", 403],
    ["/api/conversations", 403],
    ["/api/broadcasts", 403],
    ["/api/message-templates", 403],
    ["/api/leads", 403],
    ["/api/students", 200],
    ["/api/applications", 200],
    ["/api/agents/me", [403, 404]],
  ],
};

function fail(message) {
  throw new Error(`[staging-rbac-uat] BLOCKED: ${message}`);
}

function parseSetCookies(headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]);
}

function mergeCookies(cookieJar, response) {
  for (const cookie of parseSetCookies(response.headers)) {
    const separator = cookie.indexOf("=");
    if (separator <= 0) continue;
    const name = cookie.slice(0, separator);
    const value = cookie.slice(separator + 1);
    if (value) cookieJar.set(name, value);
    else cookieJar.delete(name);
  }
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function request(origin, cookieJar, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const cookies = cookieHeader(cookieJar);
  if (cookies) headers.set("cookie", cookies);
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  mergeCookies(cookieJar, response);
  return response;
}

async function json(response, context) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    fail(`${context} did not return application/json`);
  }
  try {
    return await response.json();
  } catch {
    fail(`${context} returned malformed JSON`);
  }
}

async function runRole(origin, role, email, password) {
  const cookieJar = new Map();
  const initial = await request(origin, cookieJar, "/api/auth/me");
  if (initial.status !== 401 || !cookieJar.get("csrf_token")) {
    fail(`${role} CSRF preflight contract failed`);
  }

  const csrf = cookieJar.get("csrf_token");
  const login = await request(origin, cookieJar, "/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf,
    },
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200 || !cookieJar.get("sid")) {
    fail(`${role} login contract failed with HTTP ${login.status}`);
  }
  const loginBody = await json(login, `${role} login`);
  if (loginBody?.user?.role !== role || loginBody?.user?.email !== email) {
    fail(`${role} login identity mismatch`);
  }

  const me = await request(origin, cookieJar, "/api/auth/me");
  if (me.status !== 200) fail(`${role} auth/me returned HTTP ${me.status}`);
  const meBody = await json(me, `${role} auth/me`);
  if (
    meBody?.role !== role ||
    meBody?.email !== email ||
    meBody?.isImpersonating !== false ||
    meBody?.isActive !== true
  ) {
    fail(`${role} auth/me identity or impersonation state mismatch`);
  }

  let checks = 2;
  const unread = await request(
    origin,
    cookieJar,
    "/api/notifications/unread-count",
  );
  if (unread.status !== 200) {
    fail(`${role} unread-count returned HTTP ${unread.status}`);
  }
  checks += 1;

  for (const [path, expectedStatus] of ROLE_CHECKS[role]) {
    const response = await request(origin, cookieJar, path);
    const allowedStatuses = Array.isArray(expectedStatus)
      ? expectedStatus
      : [expectedStatus];
    if (!allowedStatuses.includes(response.status)) {
      fail(
        `${role} GET ${path} expected ${allowedStatuses.join(" or ")}, received ${response.status}`,
      );
    }
    checks += 1;
  }

  const logout = await request(origin, cookieJar, "/api/auth/logout", {
    method: "POST",
    headers: { "x-csrf-token": csrf },
  });
  if (logout.status !== 204 || cookieJar.has("sid")) {
    fail(`${role} logout contract failed with HTTP ${logout.status}`);
  }
  checks += 1;
  return checks;
}

async function run() {
  if (process.env.ALLOW_STAGING_RBAC_UAT !== "true") {
    fail("ALLOW_STAGING_RBAC_UAT=true is required");
  }
  if (process.env.ALLOW_LIVE_INTEGRATIONS !== "false") {
    fail("ALLOW_LIVE_INTEGRATIONS=false is required");
  }
  const origin = (process.env.STAGING_BASE_URL ?? "").replace(/\/$/, "");
  if (origin !== EXACT_STAGING_ORIGIN) {
    fail(`STAGING_BASE_URL must be exact ${EXACT_STAGING_ORIGIN}`);
  }
  const password = process.env.RBAC_E2E_PASSWORD ?? "";
  if (password.length < 20 || password.length > 128) {
    fail("RBAC_E2E_PASSWORD must contain 20-128 characters");
  }
  const expectedCommit = process.env.STAGING_EXPECTED_SOURCE_COMMIT ?? "";
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    fail("STAGING_EXPECTED_SOURCE_COMMIT must be exact");
  }
  const expectedReleaseId = process.env.STAGING_EXPECTED_RELEASE_ID ?? "";
  if (
    !/^staging-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/.test(expectedReleaseId) ||
    !expectedReleaseId.endsWith(expectedCommit.slice(0, 12))
  ) {
    fail("STAGING_EXPECTED_RELEASE_ID must bind the exact source commit");
  }

  const health = await fetch(`${origin}/api/health`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (health.status !== 200) fail(`health returned HTTP ${health.status}`);
  const healthBody = await json(health, "health");
  if (
    healthBody?.dbConnected !== true ||
    healthBody?.releaseId !== expectedReleaseId
  ) {
    fail("health release or database identity mismatch");
  }

  let checks = 1;
  for (const [role, email] of Object.entries(ROLE_EMAILS)) {
    checks += await runRole(origin, role, email, password);
  }
  console.log(
    `[staging-rbac-uat] PASS: roles=${Object.keys(ROLE_EMAILS).length} checks=${checks} release=${expectedReleaseId}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { ROLE_CHECKS, ROLE_EMAILS, parseSetCookies, run };
