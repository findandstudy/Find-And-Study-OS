import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
