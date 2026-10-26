import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  getPersonaTeamPreviewBridgePath,
  getPersonaTeamPreviewMenuLink,
  getPersonaTeamPreviewReturnTarget,
  PERSONA_TEAM_PREVIEW_PATH,
} from "../src/lib/personaTeamPreviewNavigation";
import {
  isLocalPersonaWorkspaceHost,
  personaWorkspacePath,
} from "../src/lib/personaWorkspaceNavigation";

const staging = "https://staging.findandstudy.com";
const project = "018f6000-0000-7000-8000-000000000100";

test("staging preview and local durable workspace remain separate", () => {
  assert.equal(
    getPersonaTeamPreviewMenuLink(staging, "super_admin", "tr")?.url,
    PERSONA_TEAM_PREVIEW_PATH,
  );
  assert.equal(
    getPersonaTeamPreviewMenuLink("http://localhost:5173", "super_admin", "tr"),
    null,
  );
  assert.equal(isLocalPersonaWorkspaceHost("localhost"), true);
  assert.equal(isLocalPersonaWorkspaceHost("staging.findandstudy.com"), false);
  assert.equal(
    personaWorkspacePath(project),
    `/admin/agent-team-workspace/${project}`,
  );
});

test("staging document handoff accepts only its fixed target", () => {
  assert.equal(
    getPersonaTeamPreviewReturnTarget(staging, PERSONA_TEAM_PREVIEW_PATH),
    PERSONA_TEAM_PREVIEW_PATH,
  );
  assert.equal(
    getPersonaTeamPreviewBridgePath(staging, "/", "?workspace=team-preview"),
    PERSONA_TEAM_PREVIEW_PATH,
  );
  assert.equal(
    getPersonaTeamPreviewBridgePath(staging, "/", "?workspace=team-preview&next=/admin"),
    null,
  );
});

test("application composition keeps both experiences wired", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const menu = readFileSync(
    new URL("../src/components/layout/DashboardLayout.tsx", import.meta.url),
    "utf8",
  );
  const api = readFileSync(
    new URL("../../api-server/src/app.ts", import.meta.url),
    "utf8",
  );

  assert.match(app, /agent-team-preview/);
  assert.match(app, /agent-team-workspace/);
  assert.match(menu, /getPersonaTeamPreviewMenuLink/);
  assert.match(menu, /Takım çalışma alanı/);
  assert.match(menu, /isAdmin && isPersonaWorkspaceLocation/);
  assert.match(app, /agent-team-workspace\/\:project[^\n]+ProtectedRoute allowedRoles=\{WEBSITE_ADMIN_ROLES\}/);
  assert.match(api, /createPersonaTeamPreview/);
  assert.match(api, /createPersonaWorkspaceFromEnvironment/);
});
