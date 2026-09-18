import type { OperationsQueueItem } from "@/lib/operationsQueue";

export type OperationsTaskAction = "complete" | "snooze";

/**
 * Operations work items deliberately keep their canonical id opaque to the
 * UI. Task rows use a stable, server-generated `task:<id>:<reason>` shape;
 * only that shape is accepted for an inline action.
 */
export function taskIdFromQueueRow(row: OperationsQueueItem): number | null {
  if (row.source !== "task") return null;
  const match = /^task:(\d+):(overdue|due-soon)$/.exec(row.id);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function canActOnTask(
  row: OperationsQueueItem,
  isAdmin: boolean,
): boolean {
  return taskIdFromQueueRow(row) !== null && (isAdmin || row.isMine);
}

/** Return a local YYYY-MM-DD date without allowing timezone shifts. */
export function addDaysToDueDate(
  value: string | null | undefined,
  days: number,
): string | null {
  if (!value || !Number.isSafeInteger(days)) return null;
  const datePart = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  const date = datePart
    ? new Date(`${datePart}T12:00:00`)
    : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
