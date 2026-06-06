/**
 * One-shot backfill: synchronise assignedToId across the Lead → Student →
 * Application triplet for every student that exists in the database.
 *
 * Priority rule (highest wins):
 *   student.assignedToId > lead.assignedToId > first non-null application.assignedToId
 *
 * If the canonical value is null for an entire triplet, the triplet is skipped
 * (nothing to sync). Otherwise the canonical value is written to every record
 * in the triplet that currently differs from it.
 *
 * Idempotent: re-running after a fully-consistent DB is a no-op (no rows
 * differ from canonical, so no updates are issued).
 *
 * Dry-run: DRY_RUN=1 prints what would change without writing anything.
 */
import { db, leadsTable, studentsTable, applicationsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logAudit } from "../src/lib/auth";

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

async function main() {
  console.log(`[sync-assignment-backfill] starting (DRY_RUN=${DRY_RUN})`);

  const students = await db
    .select({ id: studentsTable.id, assignedToId: studentsTable.assignedToId })
    .from(studentsTable)
    .where(isNull(studentsTable.deletedAt));

  let updatedStudents = 0;
  let updatedLeads = 0;
  let updatedApps = 0;

  for (const student of students) {
    const leads = await db
      .select({ id: leadsTable.id, assignedToId: leadsTable.assignedToId })
      .from(leadsTable)
      .where(and(eq(leadsTable.convertedStudentId, student.id), isNull(leadsTable.deletedAt)));

    const apps = await db
      .select({ id: applicationsTable.id, assignedToId: applicationsTable.assignedToId })
      .from(applicationsTable)
      .where(and(eq(applicationsTable.studentId, student.id), isNull(applicationsTable.deletedAt)));

    let canonical: number | null = student.assignedToId ?? null;
    if (canonical === null) {
      for (const lead of leads) {
        if (lead.assignedToId !== null && lead.assignedToId !== undefined) {
          canonical = lead.assignedToId;
          break;
        }
      }
    }
    if (canonical === null) {
      for (const app of apps) {
        if (app.assignedToId !== null && app.assignedToId !== undefined) {
          canonical = app.assignedToId;
          break;
        }
      }
    }

    if (canonical === null) continue;

    if ((student.assignedToId ?? null) !== canonical) {
      console.log(`  student id=${student.id}: ${student.assignedToId ?? "null"} → ${canonical}`);
      if (!DRY_RUN) {
        await db.update(studentsTable)
          .set({ assignedToId: canonical })
          .where(eq(studentsTable.id, student.id));
        logAudit(null, "assignment.backfill", "student", student.id, { from: student.assignedToId ?? null, to: canonical });
      }
      updatedStudents++;
    }

    for (const lead of leads) {
      if ((lead.assignedToId ?? null) !== canonical) {
        console.log(`  lead id=${lead.id}: ${lead.assignedToId ?? "null"} → ${canonical}`);
        if (!DRY_RUN) {
          await db.update(leadsTable)
            .set({ assignedToId: canonical })
            .where(eq(leadsTable.id, lead.id));
          logAudit(null, "assignment.backfill", "lead", lead.id, { from: lead.assignedToId ?? null, to: canonical });
        }
        updatedLeads++;
      }
    }

    for (const app of apps) {
      if ((app.assignedToId ?? null) !== canonical) {
        console.log(`  application id=${app.id}: ${app.assignedToId ?? "null"} → ${canonical}`);
        if (!DRY_RUN) {
          await db.update(applicationsTable)
            .set({ assignedToId: canonical })
            .where(eq(applicationsTable.id, app.id));
          logAudit(null, "assignment.backfill", "application", app.id, { from: app.assignedToId ?? null, to: canonical });
        }
        updatedApps++;
      }
    }
  }

  console.log(
    `[sync-assignment-backfill] done.` +
    ` students=${updatedStudents} leads=${updatedLeads} apps=${updatedApps}` +
    (DRY_RUN ? " (DRY RUN — no writes)" : "")
  );

  await new Promise(r => setTimeout(r, 500));
}

main().catch(e => {
  console.error("[sync-assignment-backfill] FATAL:", e?.message || e);
  process.exit(1);
});
