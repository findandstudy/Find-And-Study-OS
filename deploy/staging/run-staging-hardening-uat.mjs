import assert from "node:assert/strict";
import { ROLE_EMAILS, parseSetCookies } from "./run-staging-rbac-uat.mjs";

const origin = "https://staging.findandstudy.com";
const release = process.env.STAGING_EXPECTED_RELEASE_ID ?? "";
const commit = process.env.STAGING_EXPECTED_SOURCE_COMMIT ?? "";
const password = process.env.RBAC_E2E_PASSWORD ?? "";
assert.equal(process.env.STAGING_BASE_URL, origin);
assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
assert.equal(process.env.EMAIL_DELIVERY_DISABLED, "true");
assert.match(commit, /^[a-f0-9]{40}$/);
assert.ok(release.startsWith("staging-") && release.endsWith(commit.slice(0, 12)));
assert.ok(password.length >= 20 && password.length <= 128, "Synthetic role password is missing");

let checks = 0;
async function request(jar, endpoint, expected, options = {}) {
  const url = new URL(endpoint, origin);
  assert.equal(url.origin, origin);
  const headers = new Headers(options.headers);
  if (jar.size) headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
  if (options.method === "POST") {
    headers.set("content-type", "application/json");
    headers.set("x-csrf-token", jar.get("csrf_token") ?? "");
  }
  const result = await fetch(url, { ...options, headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
  assert.ok([expected].flat().includes(result.status), `${options.method ?? "GET"} ${url.pathname} returned HTTP ${result.status}`);
  assert.match(result.headers.get("x-robots-tag") ?? "", /noindex/i);
  for (const cookie of parseSetCookies(result.headers)) {
    const split = cookie.indexOf("=");
    if (split < 1) continue;
    const key = cookie.slice(0, split);
    const value = cookie.slice(split + 1);
    if (value) jar.set(key, value);
    else jar.delete(key);
  }
  checks++;
  return result;
}

const health = await (await request(new Map(), "/api/health", 200)).json();
assert.equal(health.releaseId, release);
assert.equal(health.dbConnected, true);

const syntheticSearch = "staging-hardening-uat-unmatched-8d21c7";
const crm = ["leads", "students", "applications"];
for (const role of ["super_admin", "staff", "agent", "student"]) {
  const jar = new Map();
  await request(jar, "/api/auth/me", 401);
  await request(jar, "/api/auth/login", 200, {
    method: "POST",
    body: JSON.stringify({ email: ROLE_EMAILS[role], password }),
  });
  const me = await (await request(jar, "/api/auth/me", 200)).json();
  assert.equal(me.role, role);
  assert.equal(me.isImpersonating, false);
  try {
    if (role === "super_admin") {
      for (const table of crm) {
        const response = await request(jar, `/api/${table}?search=${syntheticSearch}&includeFacets=0`, 200);
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : payload.data;
        assert.deepEqual(rows, [], "Synthetic search unexpectedly matched catalogue data");
        const excel = await request(jar, `/api/export/${table}?search=${syntheticSearch}`, 200);
        assert.match(excel.headers.get("content-type") ?? "", /spreadsheetml\.sheet/);
        assert.match(excel.headers.get("cache-control") ?? "", /no-store/);
        assert.equal(Buffer.from(await excel.arrayBuffer()).subarray(0, 2).toString(), "PK");
      }
      for (const kind of ["lead", "student", "application"]) {
        const stages = await (await request(jar, `/api/pipeline-stages/${kind}?includeHidden=1`, 200)).json();
        assert.ok(Array.isArray(stages) && stages.length > 0);
      }
      await request(jar, "/api/work-pipelines/feature", 200);
      await request(jar, "/api/portal-automation/settings", 200);
    } else {
      const denied = await request(jar, "/api/export/leads", 403);
      assert.doesNotMatch(denied.headers.get("content-type") ?? "", /spreadsheetml/);
      await request(jar, "/api/students?includeFacets=0", 200);
    }
  } finally {
    await request(jar, "/api/auth/logout", 204, { method: "POST" });
    assert.equal(jar.has("sid"), false);
  }
}

console.log(`[staging-hardening-uat] PASS: ${checks} checks, 4 roles, release=${release}`);
