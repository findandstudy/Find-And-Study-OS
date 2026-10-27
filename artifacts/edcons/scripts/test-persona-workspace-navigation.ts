import assert from "node:assert/strict";
import test from "node:test";
import { isLocalPersonaWorkspaceHost, isPersonaWorkspaceLocation, parsePersonaWorkspaceProjects, personaWorkspacePath } from "../src/lib/personaWorkspaceNavigation";
import { workspaceRequest, WorkspaceRequestError } from "../src/lib/personaTeamWorkspace";
test("local discovery never enables staging/production or suffix spoofing", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) assert.equal(isLocalPersonaWorkspaceHost(host), true);
  for (const host of ["staging.findandstudy.com", "apply.findandstudy.com", "localhost.evil.test", "127.0.0.1.evil.test", ""]) assert.equal(isLocalPersonaWorkspaceHost(host), false);
});
test("persona discovery allows HTTPS staging without widening local-only modules", () => {
  assert.equal(isPersonaWorkspaceLocation("https:", "staging.findandstudy.com"), true);
  assert.equal(isLocalPersonaWorkspaceHost("staging.findandstudy.com"), false);
  assert.equal(isPersonaWorkspaceLocation("http:", "localhost"), true);
  for (const [protocol, hostname] of [
    ["http:", "staging.findandstudy.com"], ["https:", "apply.findandstudy.com"],
    ["https:", "staging.findandstudy.com.evil.test"], ["file:", "localhost"],
  ]) assert.equal(isPersonaWorkspaceLocation(protocol, hostname), false);
});

test("project discovery accepts only validated server entries and no live mode", () => {
  const id = "018f6000-0000-7000-8000-000000000100";
  const project = { id, label: "Find And Study" };
  assert.deepEqual(parsePersonaWorkspaceProjects({ mode: "staging-mock", projects: [project] }), [project]);
  assert.deepEqual(parsePersonaWorkspaceProjects({ mode: "disposable-test", projects: [] }), []);
  for (const data of [
    { mode: "live", projects: [project] },
    { mode: "staging-mock", projects: [{ ...project, id: "../other" }] },
    { mode: "staging-mock", projects: [{ ...project, label: " " }] },
    { mode: "staging-mock", projects: [project, project] },
    { mode: "staging-mock", projects: [{ ...project, label: "x".repeat(201) }] },
    { projects: [project] }, null,
  ]) assert.throws(() => parsePersonaWorkspaceProjects(data), /PROJECT_LIST_INVALID/);
});

test("project list uses the existing same-origin CSRF client and cannot become a write", async () => {
  const csrf = "b".repeat(64);
  let calls = 0;
  const result = await workspaceRequest("/api/persona-workspace/projects", {
    cookie: `csrf_token=${csrf}`,
    fetcher: (async (path, init) => {
      calls++;
      assert.equal(path, "/api/persona-workspace/projects");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("X-CSRF-Token"), csrf);
      return Response.json({ mode: "staging-mock", projects: [] });
    }) as typeof fetch,
  });
  assert.deepEqual(parsePersonaWorkspaceProjects(result), []);
  await assert.rejects(workspaceRequest("/api/persona-workspace/projects", { body: {}, cookie: `csrf_token=${csrf}` }), /PATH_INVALID/);
  await assert.rejects(workspaceRequest("/api/persona-workspace/projects?project=other", { cookie: `csrf_token=${csrf}` }), /PATH_INVALID/);
  assert.equal(calls, 1);
  await assert.rejects(workspaceRequest("/api/persona-workspace/projects", {
    cookie: `csrf_token=${csrf}`,
    fetcher: (async () => Response.json({ error: "PERSONA_WORKSPACE_NOT_CONFIGURED" }, { status: 503 })) as typeof fetch,
  }), (error: unknown) => error instanceof WorkspaceRequestError && error.status === 503 && error.ambiguous === false);
});
test("entry never guesses ownership or accepts paths instead of project ids", () => {
  assert.equal(personaWorkspacePath("018f6000-0000-7000-8000-000000000100"), "/admin/agent-team-workspace/018f6000-0000-7000-8000-000000000100");
  for (const id of ["Find And Study", "1", "../admin", "http://evil", "018f6000-0000-7000-8000-000000000100?admin=true"]) assert.equal(personaWorkspacePath(id), null);
});
