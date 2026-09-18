import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysToDueDate,
  canActOnTask,
  taskIdFromQueueRow,
} from "../src/lib/operationsWorkActions";
import type { OperationsQueueItem } from "../src/lib/operationsQueue";

function row(overrides: Partial<OperationsQueueItem> = {}): OperationsQueueItem {
  return {
    id: "task:42:overdue",
    source: "task",
    severity: "critical",
    reasonCode: "TASK_OVERDUE",
    identity: "Prepare documents",
    state: "todo",
    nextAction: "Complete the task",
    owner: "User #7",
    dueAt: "2026-09-12",
    blocker: "1 day overdue",
    lastActivityAt: null,
    href: "/staff/tasks",
    score: 400,
    isMine: true,
    ...overrides,
  };
}

test("only canonical task row ids resolve to a positive safe task id", () => {
  assert.equal(taskIdFromQueueRow(row()), 42);
  assert.equal(taskIdFromQueueRow(row({ id: "task:42:unknown" })), null);
  assert.equal(taskIdFromQueueRow(row({ source: "application", id: "task:42:overdue" })), null);
});

test("task actions require ownership or an admin principal", () => {
  assert.equal(canActOnTask(row(), false), true);
  assert.equal(canActOnTask(row({ isMine: false }), false), false);
  assert.equal(canActOnTask(row({ isMine: false }), true), true);
});

test("snooze preserves calendar date semantics", () => {
  assert.equal(addDaysToDueDate("2026-09-12", 3), "2026-09-15");
  assert.equal(addDaysToDueDate("2026-12-30T23:00:00.000Z", 3), "2027-01-02");
  assert.equal(addDaysToDueDate("not-a-date", 3), null);
});
