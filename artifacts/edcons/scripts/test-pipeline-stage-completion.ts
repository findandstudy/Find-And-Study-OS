import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolveStageCompletionTargetKey } from "../src/lib/pipelineStageCompletion";

const stages = [
  { id: 1, entityType: "application", key: "documents", label: "Documents", sortOrder: 0 },
  { id: 2, entityType: "application", key: "submitted", label: "Submitted", sortOrder: 1 },
];

test("generic stage completion key is preferred", () => {
  assert.equal(resolveStageCompletionTargetKey({
    ...stages[0],
    completionTargetStageKey: "submitted",
    missingDocsFulfilledTargetStageKey: "legacy_target",
  }, stages), "submitted");
});

test("legacy completion id remains backwards compatible", () => {
  assert.equal(resolveStageCompletionTargetKey({
    ...stages[0],
    missingDocsFulfilledTargetStageId: 2,
  }, stages), "submitted");
});

test("stage editor exposes one stage-level target and no per-action target selector", async () => {
  const source = await readFile(
    new URL("../src/components/EditStagesDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /stage\.completionTargetStageKey/);
  assert.match(source, /editStages\.changeStageOnComplete/);
  assert.doesNotMatch(source, /missingDocsFulfilledTarget\"\)/);
  assert.doesNotMatch(source, /value=\{action\.targetStageKey/);
});
