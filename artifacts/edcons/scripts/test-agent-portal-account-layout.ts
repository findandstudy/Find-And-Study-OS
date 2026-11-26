import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SUPPORTED_LANGUAGES } from "../src/lib/i18n/index";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const account = source("../src/pages/agent/Account.tsx");
const subAgents = source("../src/pages/agent/SubAgents.tsx");
const team = source("../src/pages/agent/Team.tsx");
const routes = source("../src/App.tsx");

test("agent account pages use the shared full-width dashboard shell", () => {
  for (const page of [account, subAgents, team]) {
    assert.match(page, /mx-auto w-full max-w-7xl/);
  }
  assert.doesNotMatch(account, /max-w-4xl/);
  assert.doesNotMatch(subAgents, /max-w-5xl/);
});

test("account tabs and page actions remain usable on small screens", () => {
  assert.match(account, /overflow-x-auto/);
  assert.match(account, /w-max min-w-full/);
  for (const page of [subAgents, team]) {
    assert.match(page, /flex-col items-stretch gap-4 sm:flex-row/);
    assert.match(page, /w-full gap-2 sm:w-auto/);
  }
});

test("sub-agent and team search controls use logical RTL positioning", () => {
  for (const page of [subAgents, team]) {
    assert.match(page, /const \{ t, isRTL \} = useI18n\(\)/);
    assert.match(page, /dir=\{isRTL \? "rtl" : "ltr"\}/);
    assert.match(page, /absolute start-3/);
    assert.match(page, /className="h-9 ps-9"/);
  }
});

test("account profile and security copy is resolved through i18n", () => {
  for (const fixedCopy of [
    "Personal Information",
    "Change Password",
    "Current Password",
    "Confirm Password",
    "Account Status",
    "Account Security",
  ]) {
    assert.doesNotMatch(account, new RegExp(`>${fixedCopy}<`));
  }
  assert.match(account, /t\("agentAccount\.accountStatus"\)/);
});

test("account status is translated in every supported locale", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const pack = JSON.parse(source(`../src/lib/i18n/translations/${lang}.json`));
    assert.equal(typeof pack.agentAccount?.accountStatus, "string", `${lang}:agentAccount.accountStatus`);
    assert.ok(pack.agentAccount.accountStatus.trim(), `${lang}:agentAccount.accountStatus is blank`);
  }
});

test("role access rules remain unchanged", () => {
  assert.match(routes, /path="\/agent\/account" component=\{AgentAccount\}/);
  assert.match(routes, /allowedRoles=\{\["agent"\]\}><AgentSubAgents/);
  assert.match(routes, /allowedRoles=\{\["agent", "sub_agent"\]\}><AgentTeam/);
});
