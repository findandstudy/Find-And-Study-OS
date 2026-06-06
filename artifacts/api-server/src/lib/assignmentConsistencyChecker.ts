import { db, leadsTable, studentsTable, applicationsTable, usersTable } from "@workspace/db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { logAudit } from "./auth";
import { dispatchNotification } from "./notificationDispatcher";

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const INITIAL_DELAY = 30 * 1000;

export interface AssignmentInconsistency {
  studentId: number;
  studentName: string;
  studentAssignedToId: number | null;
  leadId?: number;
  leadAssignedToId?: number | null;
  applicationId?: number;
  applicationAssignedToId?: number | null;
  type: "lead_mismatch" | "application_mismatch";
}

export async function checkAssignmentConsistency(): Promise<AssignmentInconsistency[]> {
  try {
    const students = await db
      .select({
        id: studentsTable.id,
        firstName: studentsTable.firstName,
        lastName: studentsTable.lastName,
        assignedToId: studentsTable.assignedToId,
      })
      .from(studentsTable)
      .where(isNull(studentsTable.deletedAt));

    if (students.length === 0) return [];

    const studentIds = students.map(s => s.id);
    const studentMap = new Map(students.map(s => [s.id, s]));

    const leads = await db
      .select({
        id: leadsTable.id,
        convertedStudentId: leadsTable.convertedStudentId,
        assignedToId: leadsTable.assignedToId,
      })
      .from(leadsTable)
      .where(
        and(
          isNull(leadsTable.deletedAt),
          inArray(leadsTable.convertedStudentId, studentIds)
        )
      );

    const apps = await db
      .select({
        id: applicationsTable.id,
        studentId: applicationsTable.studentId,
        assignedToId: applicationsTable.assignedToId,
      })
      .from(applicationsTable)
      .where(
        and(
          isNull(applicationsTable.deletedAt),
          inArray(applicationsTable.studentId, studentIds)
        )
      );

    const inconsistencies: AssignmentInconsistency[] = [];

    for (const lead of leads) {
      if (!lead.convertedStudentId) continue;
      const student = studentMap.get(lead.convertedStudentId);
      if (!student) continue;
      if (lead.assignedToId !== student.assignedToId) {
        inconsistencies.push({
          studentId: student.id,
          studentName: [student.firstName, student.lastName].filter(Boolean).join(" ") || `Student #${student.id}`,
          studentAssignedToId: student.assignedToId,
          leadId: lead.id,
          leadAssignedToId: lead.assignedToId,
          type: "lead_mismatch",
        });
      }
    }

    for (const app of apps) {
      const student = studentMap.get(app.studentId);
      if (!student) continue;
      if (app.assignedToId !== student.assignedToId) {
        inconsistencies.push({
          studentId: student.id,
          studentName: [student.firstName, student.lastName].filter(Boolean).join(" ") || `Student #${student.id}`,
          studentAssignedToId: student.assignedToId,
          applicationId: app.id,
          applicationAssignedToId: app.assignedToId,
          type: "application_mismatch",
        });
      }
    }

    return inconsistencies;
  } catch (err: any) {
    console.error("[assignmentConsistencyChecker] query error:", err?.message || err);
    return [];
  }
}

async function resolveUserName(id: number | null): Promise<string | null> {
  if (!id) return null;
  try {
    const [u] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!u) return `User #${id}`;
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || `User #${id}`;
  } catch {
    return `User #${id}`;
  }
}

export async function runAssignmentConsistencyCheck(): Promise<void> {
  try {
    const inconsistencies = await checkAssignmentConsistency();

    if (inconsistencies.length === 0) {
      console.log("[assignmentConsistencyChecker] No assignment inconsistencies found.");
      return;
    }

    console.warn(`[assignmentConsistencyChecker] Found ${inconsistencies.length} assignment inconsistency(ies).`);

    for (const inc of inconsistencies) {
      if (inc.type === "lead_mismatch") {
        const studentName = await resolveUserName(inc.studentAssignedToId);
        const leadName = await resolveUserName(inc.leadAssignedToId ?? null);
        logAudit(null, "assignment.inconsistency", "student", inc.studentId, {
          type: inc.type,
          studentAssignedToId: inc.studentAssignedToId,
          studentAssignedToName: studentName,
          leadId: inc.leadId,
          leadAssignedToId: inc.leadAssignedToId,
          leadAssignedToName: leadName,
          studentName: inc.studentName,
        });
      } else {
        const studentName = await resolveUserName(inc.studentAssignedToId);
        const appName = await resolveUserName(inc.applicationAssignedToId ?? null);
        logAudit(null, "assignment.inconsistency", "student", inc.studentId, {
          type: inc.type,
          studentAssignedToId: inc.studentAssignedToId,
          studentAssignedToName: studentName,
          applicationId: inc.applicationId,
          applicationAssignedToId: inc.applicationAssignedToId,
          applicationAssignedToName: appName,
          studentName: inc.studentName,
        });
      }
    }

    const leadMismatches = inconsistencies.filter(i => i.type === "lead_mismatch").length;
    const appMismatches = inconsistencies.filter(i => i.type === "application_mismatch").length;

    const parts: string[] = [];
    if (leadMismatches > 0) parts.push(`${leadMismatches} lead–student`);
    if (appMismatches > 0) parts.push(`${appMismatches} application–student`);
    const summary = parts.join(", ");

    await dispatchNotification({
      event: "assignment.inconsistency",
      title: "Assignment Inconsistencies Detected",
      body: `${inconsistencies.length} assignment inconsistency(ies) detected: ${summary}. Check the Assignment Inconsistencies report in the Audit section.`,
      actionUrl: "/settings/audit?action=assignment.inconsistency",
      icon: "⚠️",
      data: {
        count: inconsistencies.length,
        leadMismatches,
        appMismatches,
      },
    });
  } catch (err: any) {
    console.error("[assignmentConsistencyChecker] run error:", err?.message || err);
  }
}

export function startAssignmentConsistencyChecker(): void {
  setTimeout(async () => {
    await runAssignmentConsistencyCheck();
    setInterval(runAssignmentConsistencyCheck, CHECK_INTERVAL);
  }, INITIAL_DELAY);
}
