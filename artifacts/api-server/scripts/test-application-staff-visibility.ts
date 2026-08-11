import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const routeSource = readFileSync(
  fileURLToPath(new URL("../src/routes/applications.ts", import.meta.url)),
  "utf8",
);

test("staff application list has no implicit assignment, source or branch scope", () => {
  const listStart = routeSource.indexOf('router.get("/applications"');
  const detailStart = routeSource.indexOf('router.get("/applications/:id"');
  assert.ok(listStart >= 0 && detailStart > listStart);
  const listRoute = routeSource.slice(listStart, detailStart);

  const staffScopeStart = listRoute.indexOf("if (isStaff)");
  const studentScopeStart = listRoute.indexOf('} else if (user.role === "student")');
  assert.ok(staffScopeStart >= 0 && studentScopeStart > staffScopeStart);
  const staffScope = listRoute.slice(staffScopeStart, studentScopeStart);

  assert.doesNotMatch(staffScope, /getAssignmentVisibility|records\.view_others|applicationsTable\.agentId/);
  assert.match(listRoute, /if \(!isStaff && user\.role !== "student"\)/);
});

test("staff application detail is not hidden by source or branch", () => {
  const detailStart = routeSource.indexOf('router.get("/applications/:id"');
  const patchStart = routeSource.indexOf('router.patch("/applications/:id"');
  assert.ok(detailStart >= 0 && patchStart > detailStart);
  const detailRoute = routeSource.slice(detailStart, patchStart);

  assert.doesNotMatch(detailRoute, /isAgentSourcedAndBlockedForStaff|isInBranchScope|records\.view_others/);
  assert.match(detailRoute, /if \(!isStaff\)/);
});

test("staff application notes use the same global read visibility", () => {
  const notesStart = routeSource.indexOf('router.get("/applications/:id/notes"');
  const notesEnd = routeSource.indexOf('router.post("/applications/:id/notes"');
  assert.ok(notesStart >= 0 && notesEnd > notesStart);
  const notesRoute = routeSource.slice(notesStart, notesEnd);

  assert.doesNotMatch(notesRoute, /isAgentSourcedAndBlockedForStaff|isInBranchScope|records\.view_others/);
  assert.match(notesRoute, /Application not found/);
});
