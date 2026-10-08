import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getPersonaTeamPreviewBridgePath, getPersonaTeamPreviewMenuLink, getPersonaTeamPreviewReturnTarget, PERSONA_TEAM_PREVIEW_PATH } from "../src/lib/personaTeamPreviewNavigation";

const staging = "https://staging.findandstudy.com";

test("only staging administrators get an explicitly labelled in-dashboard preview link", () => {
  for (const role of ["admin", "super_admin"]) {
    assert.deepEqual(getPersonaTeamPreviewMenuLink(staging, role, "tr"), {
      title: "Takım Tasarımcısı — Önizleme", url: PERSONA_TEAM_PREVIEW_PATH,
    });
    assert.equal(getPersonaTeamPreviewMenuLink(staging, role, "en")?.title, "Team Designer — Preview");
  }
  for (const role of ["", "manager", "staff", "student", "agent", "sub_agent", "agent_staff", "institution_user"]) {
    assert.equal(getPersonaTeamPreviewMenuLink(staging, role, "tr"), null, role);
  }
  for (const origin of ["", "http://localhost", "https://apply.findandstudy.com", "http://staging.findandstudy.com", `${staging}.example.org`, `${staging}:444`, `${staging}/`]) {
    assert.equal(getPersonaTeamPreviewMenuLink(origin, "admin", "tr"), null, origin);
    assert.equal(getPersonaTeamPreviewReturnTarget(origin, PERSONA_TEAM_PREVIEW_PATH), null, origin);
  }
});

test("login document return is pinned to the exact same-origin preview path", () => {
  for (const target of [PERSONA_TEAM_PREVIEW_PATH, PERSONA_TEAM_PREVIEW_PATH.slice(0, -1)]) {
    assert.equal(getPersonaTeamPreviewReturnTarget(staging, target), PERSONA_TEAM_PREVIEW_PATH);
  }
  for (const target of [null, "", "/admin/dashboard", "/staff/messages", "//evil.example/", "/\\evil.example/", `${staging}${PERSONA_TEAM_PREVIEW_PATH}`, `${PERSONA_TEAM_PREVIEW_PATH}?returnTo=//evil.example`, `${PERSONA_TEAM_PREVIEW_PATH}#x`, `${PERSONA_TEAM_PREVIEW_PATH}../users`, "/admin/agent-team-preview%2f"]) {
    assert.equal(getPersonaTeamPreviewReturnTarget(staging, target), null, String(target));
  }
});

test("document bridge accepts only its exact staging root and fixed workspace hint", () => {
  assert.equal(getPersonaTeamPreviewBridgePath(staging, "/", "?workspace=team-preview"), PERSONA_TEAM_PREVIEW_PATH);
  for (const [origin, pathname, search] of [
    ["https://apply.findandstudy.com", "/", "?workspace=team-preview"],
    ["https://staging.findandstudy.com.evil.invalid", "/", "?workspace=team-preview"],
    ["http://staging.findandstudy.com", "/", "?workspace=team-preview"],
    [staging, "/admin", "?workspace=team-preview"],
    [staging, "/en/login", "?workspace=team-preview"],
    [staging, "/", ""],
    [staging, "/", "?workspace=other"],
    [staging, "/", "?workspace=team-preview&returnTo=//evil.invalid"],
    [staging, "/", "?workspace=team-preview&workspace=team-preview"],
    [staging, "/", "?workspace=team-preview#x"],
    [staging, "/", "?workspace=team%2Dpreview"],
    [staging, "/", "?workspace=team-preview/"],
  ]) {
    assert.equal(getPersonaTeamPreviewBridgePath(origin, pathname, search), null, `${origin}${pathname}${search}`);
  }
});

test("menu reuses normal SPA navigation and login keeps its canonical guarded document return", () => {
  const menu = readFileSync(new URL("../src/components/layout/DashboardLayout.tsx", import.meta.url), "utf8");
  assert.match(menu, /getPersonaTeamPreviewMenuLink\(origin, role, language\)/);
  assert.match(menu, /\.\.\.teamPreviewLink, icon: Users/);
  assert.match(menu, /href=\{item.externalHref \?\? item.url\}/);
  assert.match(menu, /onClick: handleNavClick\(item.url\)/);
  assert.equal(Object.hasOwn(getPersonaTeamPreviewMenuLink(staging, "admin", "en")!, "externalHref"), false);
  const login = readFileSync(new URL("../src/pages/auth/Login.tsx", import.meta.url), "utf8");
  assert.match(login, /getPersonaTeamPreviewReturnTarget\(window.location.origin, returnTo\)/);
  assert.match(login, /window.location.replace\(previewTarget\)/);
  assert.match(login, /method: "GET", credentials: "include", cache: "no-store"/);
  assert.match(login, /res.ok && currentUser\?\.id === user.id/);
  assert.match(login, /clearAuthCache\(\);\s+queryClient.setQueryData\(\["\/api\/auth\/me"\], null\)/);
  assert.match(login, /if \(returnTo\) \{\s+setLocation\(returnTo\)/);
});

test("guarded document bridge is wired into the existing React bootstrap and role-protected route", () => {
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /getPersonaTeamPreviewBridgePath\(\s+window.location.origin, window.location.pathname, window.location.search,/);
  assert.match(main, /if \(_teamPreviewEntry\) window.history.replaceState\(null, "", _teamPreviewEntry\)/);
  assert.match(main, /if \(_teamPreviewEntry\) \{\s+_startPath = _teamPreviewEntry;/);
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /const WEBSITE_ADMIN_ROLES: string\[\] = \["super_admin", "admin"\]/);
  assert.match(app, /<Route path="\/admin\/agent-team-preview\/">\s+<ProtectedRoute allowedRoles=\{WEBSITE_ADMIN_ROLES\}><AdminTeamDesigner \/><\/ProtectedRoute>/);
});
