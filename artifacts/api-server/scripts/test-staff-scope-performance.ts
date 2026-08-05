import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPermissionOverrides,
  getAssignmentVisibility,
  getEffectivePermissionSet,
} from "../src/lib/permissions";
import { getVisibleBranchIds } from "../src/lib/branchScope";

test("pre-resolved request permissions preserve grants and revocations without a DB lookup", async () => {
  const permissions = await getEffectivePermissionSet({
    id: 42,
    role: "staff",
    effectivePermissions: ["students.view", "records.view_unassigned"],
  });

  assert.deepEqual(
    [...permissions].sort(),
    ["records.view_unassigned", "students.view"],
  );
});

test("permission overrides remain authoritative over role permissions", () => {
  const permissions = applyPermissionOverrides(
    ["students.view", "records.view_others"],
    {
      "records.view_others": false,
      "documents.view": true,
    },
  );

  assert.equal(permissions.has("students.view"), true);
  assert.equal(permissions.has("records.view_others"), false);
  assert.equal(permissions.has("documents.view"), true);
});

test("record visibility grants remain independent", () => {
  assert.equal(getAssignmentVisibility(new Set()), "own");
  assert.equal(
    getAssignmentVisibility(new Set(["records.view_unassigned"])),
    "own_or_unassigned",
  );
  assert.equal(
    getAssignmentVisibility(new Set(["records.view_others"])),
    "assigned",
  );
  assert.equal(
    getAssignmentVisibility(new Set([
      "records.view_others",
      "records.view_unassigned",
    ])),
    "all",
  );
});

test("request branch context avoids re-reading the user row", async () => {
  assert.deepEqual(
    await getVisibleBranchIds(42, "staff", {
      branchId: 7,
      managingAgentId: null,
    }),
    [7],
  );
  assert.deepEqual(
    await getVisibleBranchIds(42, "staff", {
      branchId: null,
      managingAgentId: null,
    }),
    [],
  );
  assert.equal(await getVisibleBranchIds(1, "super_admin"), null);
});
