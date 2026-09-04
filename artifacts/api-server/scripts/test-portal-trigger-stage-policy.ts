import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPortalTriggerStageSnapshot,
  isPortalTriggerStageEligible,
  normalizePortalTriggerStageKeys,
} from "../src/lib/portalTriggerStagePolicy.js";

const stages = [
  { key: "inquiry", label: "Inquiry", sortOrder: 0, variant: null },
  { key: "documents", label: "Documents", sortOrder: 1, variant: null },
  { key: "enrolled", label: "Enrolled", sortOrder: 2, variant: "won" },
  {
    key: "rejected",
    label: "Rejected",
    sortOrder: 3,
    variant: "lost",
    isCaseClose: true,
  },
];

test("normalizes trigger keys without inventing aliases", () => {
  assert.deepEqual(
    normalizePortalTriggerStageKeys([
      " inquiry ",
      "documents",
      "inquiry",
      "",
      "UNKNOWN",
    ]),
    ["inquiry", "documents", "UNKNOWN"],
  );
});

test("terminal and won/lost stages cannot trigger external submission", () => {
  assert.equal(
    isPortalTriggerStageEligible({ variant: null, isCaseClose: false }),
    true,
  );
  assert.equal(
    isPortalTriggerStageEligible({ variant: "won", isCaseClose: false }),
    false,
  );
  assert.equal(
    isPortalTriggerStageEligible({ variant: "lost", isCaseClose: false }),
    false,
  );
  assert.equal(
    isPortalTriggerStageEligible({ variant: null, isCaseClose: true }),
    false,
  );
});

test("joins live stages with saved configuration and fails closed on drift", () => {
  const snapshot = buildPortalTriggerStageSnapshot(stages, [
    "documents",
    "removed_stage",
    "enrolled",
  ]);
  assert.deepEqual(snapshot.validConfiguredKeys, ["documents"]);
  assert.deepEqual(snapshot.staleConfiguredKeys, ["removed_stage"]);
  assert.deepEqual(snapshot.ineligibleConfiguredKeys, ["enrolled"]);
  assert.equal(
    snapshot.stages.find((stage) => stage.key === "inquiry")?.eligible,
    true,
  );
  assert.equal(
    snapshot.stages.find((stage) => stage.key === "rejected")?.eligible,
    false,
  );
});

test("new pipeline stages appear but are not selected automatically", () => {
  const snapshot = buildPortalTriggerStageSnapshot(
    [
      ...stages,
      {
        key: "ready_for_portal",
        label: "Ready for portal",
        sortOrder: 2,
        variant: null,
      },
    ],
    ["inquiry"],
  );
  assert.equal(
    snapshot.stages.some((stage) => stage.key === "ready_for_portal"),
    true,
  );
  assert.deepEqual(snapshot.validConfiguredKeys, ["inquiry"]);
});
