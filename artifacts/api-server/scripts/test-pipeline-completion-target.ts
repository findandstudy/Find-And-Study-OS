import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("pipeline API accepts generic completion targets and returns their key aliases", async () => {
  const source = await readFile(
    new URL("../src/routes/pipeline.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /raw = s\.completionTargetStageKey/);
  assert.match(source, /completionTargetStageId: stage\.missingDocsFulfilledTargetStageId/);
  assert.match(source, /completionTargetStageKey: stage\.missingDocsFulfilledTargetStageId/);
});

test("governed action transitions accept the owning stage completion target", async () => {
  const source = await readFile(
    new URL("../src/routes/applications.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /completionTargetStageId: pipelineStagesTable\.missingDocsFulfilledTargetStageId/);
  assert.match(source, /const configuredTarget = completionTargetStageKey \?\? act\.targetStageKey/);
});

test("missing-document fulfillment still waits for all requested documents", async () => {
  const source = await readFile(
    new URL("../src/lib/missingDocsFulfillment.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(stillOpen\.length > 0\) continue/);
  assert.match(source, /targetId: pipelineStagesTable\.missingDocsFulfilledTargetStageId/);
});
