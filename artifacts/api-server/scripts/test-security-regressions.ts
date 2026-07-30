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
  assert.match(appSource, /camera=\(\)/);
  assert.match(appSource, /geolocation=\(\)/);
  assert.match(appSource, /microphone=\(self\)/);
});

test("portal lifecycle planning can never authorize a portal mutation", () => {
  assert.match(lifecycleSource, /allowPortalMutation:\s*false/);
  assert.doesNotMatch(lifecycleSource, /allowPortalMutation:\s*true/);
});

test("credentialed CORS is fail-closed in production", () => {
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
