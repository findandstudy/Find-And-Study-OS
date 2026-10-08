import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getPersonaTeamPreviewMenuLink, getPersonaTeamPreviewReturnTarget, PERSONA_TEAM_PREVIEW_PATH } from "../src/lib/personaTeamPreviewNavigation";

const staging = "https://staging.findandstudy.com";

test("only staging administrators get an explicitly labelled document preview link", () => {
  for (const role of ["admin", "super_admin"]) {
    assert.deepEqual(getPersonaTeamPreviewMenuLink(staging, role, "tr"), {
      title: "Takım Tasarımcısı — Önizleme", url: PERSONA_TEAM_PREVIEW_PATH, externalHref: PERSONA_TEAM_PREVIEW_PATH,
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

test("menu reuses the native external link renderer and login keeps normal SPA returns", () => {
  const menu = readFileSync(new URL("../src/components/layout/DashboardLayout.tsx", import.meta.url), "utf8");
  assert.match(menu, /getPersonaTeamPreviewMenuLink\(origin, role, language\)/);
  assert.match(menu, /\.\.\.teamPreviewLink, icon: Users/);
  assert.match(menu, /href=\{item.externalHref \?\? item.url\}/);
  assert.match(menu, /target: "_blank", rel: "noopener noreferrer"/);
  const login = readFileSync(new URL("../src/pages/auth/Login.tsx", import.meta.url), "utf8");
  assert.match(login, /getPersonaTeamPreviewReturnTarget\(window.location.origin, returnTo\)/);
  assert.match(login, /window.location.replace\(previewTarget\)/);
  assert.match(login, /method: "GET", credentials: "include", cache: "no-store"/);
  assert.match(login, /res.ok && currentUser\?\.id === user.id/);
  assert.match(login, /clearAuthCache\(\);\s+queryClient.setQueryData\(\["\/api\/auth\/me"\], null\)/);
  assert.match(login, /if \(returnTo\) \{\s+setLocation\(returnTo\)/);
});
