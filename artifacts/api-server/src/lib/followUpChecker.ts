import { db, followUpsTable } from "@workspace/db";
import { and, eq, isNull, lte } from "drizzle-orm";
import { dispatchNotification } from "./notificationDispatcher";

const CHECK_INTERVAL = 60 * 1000;

let running = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export async function checkFollowUpsDue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const due = await db
      .select({
        id: followUpsTable.id,
        title: followUpsTable.title,
        assignedToId: followUpsTable.assignedToId,
        leadId: followUpsTable.leadId,
        studentId: followUpsTable.studentId,
        resourceType: followUpsTable.resourceType,
      })
      .from(followUpsTable)
      .where(
        and(
          eq(followUpsTable.completed, false),
          isNull(followUpsTable.notifiedAt),
          lte(followUpsTable.scheduledAt, now),
        ),
      );

    if (due.length === 0) return;

    for (const task of due) {
      try {
        const recipientIds: number[] = [];
        if (task.assignedToId) recipientIds.push(task.assignedToId);

        await dispatchNotification({
          event: "lead.follow_up_due",
          title: "Follow-up Due",
          body: task.title,
          actionUrl: task.leadId
            ? `/staff/leads/${task.leadId}`
            : task.studentId
            ? `/staff/students/${task.studentId}`
            : `/staff/leads`,
          icon: "CalendarClock",
          recipientUserIds: recipientIds.length > 0 ? recipientIds : undefined,
          templateVars: { title: task.title },
          data: {
            followUpId: task.id,
            leadId: task.leadId ?? null,
            studentId: task.studentId ?? null,
          },
        });

        await db
          .update(followUpsTable)
          .set({ notifiedAt: now })
          .where(eq(followUpsTable.id, task.id));
      } catch (err) {
        console.error(`[FOLLOW-UP] dispatch error for task ${task.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[FOLLOW-UP] checker error:", err);
  } finally {
    running = false;
  }
}

export function startFollowUpChecker(): void {
  if (intervalHandle) return;
  console.log("[FOLLOW-UP] Checker started, running every 60 seconds");
  checkFollowUpsDue();
  intervalHandle = setInterval(() => {
    checkFollowUpsDue();
  }, CHECK_INTERVAL);
}
