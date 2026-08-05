import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCredentialedCorsOriginAllowed } from "../src/lib/requestOrigin";
import { getDatabaseName, isSafeE2eDatabaseUrl } from "./e2e-database-safety";

const appSource = readFileSync(
  new URL("../src/app.ts", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);
const lifecycleSource = readFileSync(
  new URL("../src/lib/portalLifecycleContract.ts", import.meta.url),
  "utf8",
);
const staffSettingsSource = readFileSync(
  new URL("../../edcons/src/pages/staff/Settings.tsx", import.meta.url),
  "utf8",
);
const agentAccountSource = readFileSync(
  new URL("../../edcons/src/pages/agent/Account.tsx", import.meta.url),
  "utf8",
);
const inboxRouteSource = readFileSync(
  new URL("../src/routes/inbox.ts", import.meta.url),
  "utf8",
);
const messagesUiSource = readFileSync(
  new URL("../../edcons/src/pages/staff/Messages.tsx", import.meta.url),
  "utf8",
);

test("authenticated course-finder writes are not exempt from CSRF", () => {
  assert.doesNotMatch(
    appSource,
    /startsWith\(["']\/api\/course-finder["']\)/,
  );
  assert.match(appSource, /const CSRF_SAFE_METHODS/);
  assert.match(appSource, /cookieToken !== headerToken/);
});

test("the SPA fallback does not issue a second conflicting CSRF cookie", () => {
  assert.match(appSource, /csrfCookieIssued/);
  assert.match(indexSource, /cookies\?\.csrf_token/);
  assert.match(indexSource, /csrfCookieIssued\?: boolean/);
});

test("browser permissions keep sensitive sensors blocked", () => {
  // Scan and voice-note are intentional first-party features. They may use
  // same-origin camera/microphone only; geolocation stays unavailable.
  assert.match(appSource, /camera=\(self\)/);
  assert.match(appSource, /geolocation=\(\)/);
  assert.match(appSource, /microphone=\(self\)/);
});

test("database retries never classify a WITH statement as read-only", () => {
  const dbSource = readFileSync(
    new URL("../../../lib/db/src/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(dbSource, /\(select\|with\|/i);
  assert.match(dbSource, /\(select\|show\|explain\|values\|table\|fetch\)/i);
});

test("generated widget JavaScript is parsed without dynamic Function compilation", () => {
  const embedSource = readFileSync(
    new URL("../src/routes/embed.ts", import.meta.url),
    "utf8",
  );
  assert.match(embedSource, /parseJavaScript/);
  assert.doesNotMatch(embedSource, /new Function\(/);
});

test("portal diagnostics do not log raw applicant fields or permit production capture", () => {
  const topkapiSource = readFileSync(
    new URL("../../../lib/portal-adapters/src/universities/topkapi/adapter.ts", import.meta.url),
    "utf8",
  );
  const altinbasSource = readFileSync(
    new URL("../../../lib/portal-adapters/src/universities/altinbas/adapter.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(topkapiSource, /field values — email/);
  assert.doesNotMatch(topkapiSource, /request body:/);
  assert.match(altinbasSource, /process\.env\.NODE_ENV !== "production"/);
  assert.match(altinbasSource, /LOCAL_REDACTED_CAPTURE_ONLY/);
  assert.match(altinbasSource, /safeBody = redactAltinbasLog/);
  assert.match(altinbasSource, /bodySha256/);
  assert.doesNotMatch(altinbasSource, /url: safeUrl, body: safeBody/);
  assert.match(altinbasSource, /mode: 0o600/);
});

test("production frontend does not emit source maps into the public root", () => {
  const viteSource = readFileSync(
    new URL("../../edcons/vite.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(viteSource, /sourcemap: !isProd/);
});

test("portal lifecycle planning can never authorize a portal mutation", () => {
  assert.match(lifecycleSource, /allowPortalMutation:\s*false/);
  assert.doesNotMatch(lifecycleSource, /allowPortalMutation:\s*true/);
});

test("credentialed CORS is fail-closed in production", () => {
  assert.match(appSource, /corsError\.status = 403/);
  const sameOrigin = "https://apply.findandstudy.com";
  assert.equal(
    isCredentialedCorsOriginAllowed(undefined, sameOrigin, [], "production"),
    true,
  );
  assert.equal(
    isCredentialedCorsOriginAllowed(sameOrigin, sameOrigin, [], "production"),
    true,
  );
  assert.equal(
    isCredentialedCorsOriginAllowed(
      "https://trusted.example",
      sameOrigin,
      ["https://trusted.example"],
      "production",
    ),
    true,
  );
  assert.equal(
    isCredentialedCorsOriginAllowed("https://evil.example", sameOrigin, [], "production"),
    false,
  );
  assert.equal(
    isCredentialedCorsOriginAllowed("http://localhost:25197", sameOrigin, [], "production"),
    false,
  );
  assert.equal(
    isCredentialedCorsOriginAllowed("http://localhost:25197", sameOrigin, [], "test"),
    true,
  );
});

test("generated form previews execute in sandboxed iframes", () => {
  for (const source of [staffSettingsSource, agentAccountSource]) {
    assert.doesNotMatch(source, /dangerouslySetInnerHTML=\{\{\s*__html:\s*formCode/);
    assert.match(source, /srcDoc=\{formCode\}/);
    assert.match(source, /sandbox=""/);
    assert.match(source, /referrerPolicy="no-referrer"/);
  }
});

test("permanent conversation deletion is admin-only and explicitly confirmed", () => {
  assert.match(inboxRouteSource, /\/inbox\/conversations\/bulk-archive/);
  assert.match(inboxRouteSource, /\/inbox\/conversations\/bulk-unarchive/);
  assert.match(inboxRouteSource, /\/inbox\/conversations\/bulk-delete/);
  assert.match(inboxRouteSource, /requireRole\("super_admin", "admin"\)/);
  assert.match(inboxRouteSource, /z\.literal\("DELETE_CONVERSATIONS"\)/);
  assert.match(inboxRouteSource, /delete_inbox_conversations/);
  assert.match(messagesUiSource, /button-bulk-delete/);
  assert.match(messagesUiSource, /button-internal-bulk-delete/);
  assert.match(messagesUiSource, /confirm: "DELETE_CONVERSATIONS"/);
  assert.match(messagesUiSource, /"delete-final"/);
});

test("E2E database mutations accept only explicit test database names", () => {
  assert.equal(
    isSafeE2eDatabaseUrl("postgresql://user:pass@localhost:5432/fasos_codex_e2e_20260730"),
    true,
  );
  assert.equal(
    isSafeE2eDatabaseUrl("postgresql://user:pass@localhost:5432/findandstudy_test"),
    true,
  );
  assert.equal(
    isSafeE2eDatabaseUrl("postgresql://user:pass@localhost:5432/findandstudy"),
    false,
  );
  assert.equal(
    isSafeE2eDatabaseUrl("postgresql://user:pass@localhost:5432/production"),
    false,
  );
  assert.equal(getDatabaseName("not-a-database-url"), null);
});
