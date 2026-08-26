import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { preventPipelineDialogOutsideDismiss } from "../src/lib/pipelineDialogDismiss";

test("pipeline stage editor ignores outside interactions from portalled selects", () => {
  let prevented = false;

  preventPipelineDialogOutsideDismiss({
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
});

test("pipeline stage editor blocks every automatic dialog dismissal path", async () => {
  const source = await readFile(
    new URL("../src/components/EditStagesDialog.tsx", import.meta.url),
    "utf8",
  );

  for (const handler of [
    "onInteractOutside",
    "onPointerDownOutside",
    "onFocusOutside",
    "onEscapeKeyDown",
  ]) {
    assert.match(
      source,
      new RegExp(`${handler}=\\{preventPipelineDialogOutsideDismiss\\}`),
      `${handler} must prevent the pipeline editor from closing automatically`,
    );
  }
});
