import type { Request, Response } from "express";
import { auditLogsTable, db, leadsTable, studentsTable, applicationsTable, agentsTable, commissionsTable, universitiesTable, usersTable, followUpsTable } from "@workspace/db";
import { eq, sql, and, inArray, type SQL } from "drizzle-orm";
import { getEffectivePermissionSet } from "./permissions";
import * as XLSX from "xlsx";

type CrmExportKind = "leads" | "students" | "applications";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Parse a comma-separated `ids` query param into a list of numeric ids. When a
// selection is present the export is narrowed to exactly those rows; when empty
// the caller exports the full (season-filtered) set.
export function crmExportSelection(req: Request, res: Response): number[] | null {
  const raw = req.query.ids;
  if (raw === undefined) return [];
  if (typeof raw !== "string" || !/^[1-9]\d*(,[1-9]\d*)*$/.test(raw)) {
    res.status(400).json({ error: "Invalid export selection" });
    return null;
  }
  const ids = [...new Set(raw.split(",").map(Number))];
  if (ids.some(id => !Number.isSafeInteger(id) || id > 2_147_483_647)) {
    res.status(400).json({ error: "Invalid export selection" });
    return null;
  }
  return ids;
}

async function sendExcel(req: Request, res: Response, rows: Record<string, unknown>[], kind: CrmExportKind, sheetName: string) {
  const data = rows.length ? rows : [{ "No Data": `No ${kind} found` }];
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = Object.keys(data[0]).map(key => {
    let width = key.length + 2;
    for (const row of data) {
      width = Math.max(width, String(row[key] ?? "").length + 2);
      if (width >= 40) break;
    }
    return { wch: Math.min(width, 40) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await db.insert(auditLogsTable).values({
    userId: req.user!.id, action: "crm.export", resource: kind,
    changes: JSON.stringify({ rows: rows.length, selected: req.query.ids !== undefined }),
    ipAddress: req.ip ?? null,
  });
  const season = typeof req.query.season === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(req.query.season) ? req.query.season : "all";
  const filename = `${kind}_${season}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf));
}

export async function exportLeads(req: Request, res: Response, where: SQL | undefined, order: SQL[]) {
  const permissions = await getEffectivePermissionSet(req.user!);

  const rows = await db
    .select({
      lead: leadsTable,
      agentName: agentsTable.companyName,
      assignedFirstName: usersTable.firstName,
      assignedLastName: usersTable.lastName,
    })
    .from(leadsTable)
    .leftJoin(agentsTable, eq(leadsTable.agentId, agentsTable.id))
    .leftJoin(usersTable, eq(leadsTable.assignedToId, usersTable.id))
    .where(where)
    .orderBy(...order);

  const leadIds = rows.map(r => r.lead.id);
  let nextFollowupMap = new Map<number, string>();
  if (leadIds.length > 0) {
    const fuRows = await db
      .select({
        leadId: followUpsTable.leadId,
        nextDate: sql<string>`min(${followUpsTable.scheduledAt})`,
      })
      .from(followUpsTable)
      .where(and(
        inArray(followUpsTable.leadId, leadIds),
        eq(followUpsTable.completed, false),
      ))
      .groupBy(followUpsTable.leadId);
    fuRows.forEach(r => { if (r.leadId) nextFollowupMap.set(r.leadId, r.nextDate); });
  }

  const data = rows.map(r => ({
    "ID": r.lead.id,
    "First Name": r.lead.firstName || "",
    "Last Name": r.lead.lastName || "",
    "Email": r.lead.email || "",
    "Phone": r.lead.phone || "",
    "Nationality": r.lead.nationality || "",
    "Country": r.lead.country || "",
    "Status": r.lead.status || "",
    "Source": r.lead.source || "",
    "Interested Program": r.lead.interestedProgram || "",
    "Interested University": r.lead.interestedUniversity || "",
    "Interested Country": r.lead.interestedCountry || "",
    ...(permissions.has("leads.view_commission") ? { "Estimated Value": r.lead.estimatedValue ?? "" } : {}),
    "Agent": r.agentName || "",
    "Assigned To": [r.assignedFirstName, r.assignedLastName].filter(Boolean).join(" ") || "",
    "Season": r.lead.season || "",
    "Next Follow-up": nextFollowupMap.get(r.lead.id) ? formatDate(nextFollowupMap.get(r.lead.id)) : "",
    "Notes": r.lead.notes || "",
    "Created": formatDate(r.lead.createdAt),
    "Updated": formatDate(r.lead.updatedAt),
  }));

  await sendExcel(req, res, data, "leads", "Leads");
}

export async function exportStudents(req: Request, res: Response, where: SQL | undefined, order: SQL[]) {
  const permissions = await getEffectivePermissionSet(req.user!);
  const canDownloadDocuments = permissions.has("documents.download");

  const rows = await db
    .select({
      student: studentsTable,
      agentName: agentsTable.companyName,
      assignedFirstName: usersTable.firstName,
      assignedLastName: usersTable.lastName,
    })
    .from(studentsTable)
    .leftJoin(agentsTable, eq(studentsTable.agentId, agentsTable.id))
    .leftJoin(usersTable, eq(studentsTable.assignedToId, usersTable.id))
    .where(where)
    .orderBy(...order);

  const data = rows.map(r => ({
    "ID": r.student.id,
    "First Name": r.student.firstName || "",
    "Last Name": r.student.lastName || "",
    "Email": r.student.email || "",
    "Phone": r.student.phone || "",
    "Nationality": r.student.nationality || "",
    ...(canDownloadDocuments ? {
      "Date of Birth": r.student.dateOfBirth || "",
      "Passport Number": r.student.passportNumber || "",
      "Passport Issue Date": r.student.passportIssueDate || "",
      "Passport Expiry": r.student.passportExpiry || "",
      "Mother Name": r.student.motherName || "",
      "Father Name": r.student.fatherName || "",
      "Address": r.student.address || "",
    } : {}),
    "Status": r.student.status || "",
    "High School": r.student.highSchool || "",
    "University (Bachelor)": r.student.universityBachelor || "",
    "University (Master)": r.student.universityMaster || "",
    "Graduation Year": r.student.graduationYear ?? "",
    "GPA": r.student.gpa || "",
    "Language Score": r.student.languageScore || "",
    "Agent": r.agentName || "",
    "Assigned To": [r.assignedFirstName, r.assignedLastName].filter(Boolean).join(" ") || "",
    "Season": r.student.season || "",
    "Notes": r.student.notes || "",
    "Created": formatDate(r.student.createdAt),
    "Updated": formatDate(r.student.updatedAt),
  }));

  await sendExcel(req, res, data, "students", "Students");
}

export async function exportApplications(req: Request, res: Response, where: SQL | undefined, order: SQL[], canExposeCommission: boolean) {
  const permissions = await getEffectivePermissionSet(req.user!);

  const rows = await db
    .select({
      app: applicationsTable,
      studentFirstName: studentsTable.firstName,
      studentLastName: studentsTable.lastName,
      studentEmail: studentsTable.email,
      studentPhone: studentsTable.phone,
      studentNationality: studentsTable.nationality,
      studentPassport: studentsTable.passportNumber,
      universityCommissionAmount: commissionsTable.universityCommissionAmount,
      commissionStatus: commissionsTable.status,
      universityType: universitiesTable.universityType,
      agentName: agentsTable.companyName,
      assignedFirstName: usersTable.firstName,
      assignedLastName: usersTable.lastName,
    })
    .from(applicationsTable)
    .leftJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
    .leftJoin(commissionsTable, eq(applicationsTable.id, commissionsTable.applicationId))
    .leftJoin(universitiesTable, eq(applicationsTable.universityId, universitiesTable.id))
    .leftJoin(agentsTable, eq(applicationsTable.agentId, agentsTable.id))
    .leftJoin(usersTable, eq(applicationsTable.assignedToId, usersTable.id))
    .where(where)
    .orderBy(...order);

  const data = rows.map(r => ({
    "ID": r.app.id,
    "Student": [r.studentFirstName, r.studentLastName].filter(Boolean).join(" ") || "",
    "Student Email": r.studentEmail || "",
    "Student Phone": r.studentPhone || "",
    "Student Nationality": r.studentNationality || "",
    ...(permissions.has("documents.download") ? { "Passport": r.studentPassport || "" } : {}),
    "Stage": r.app.stage || "",
    "University": r.app.universityName || "",
    "University Type": r.universityType || "",
    "Program": r.app.programName || "",
    "Country": r.app.country || "",
    "Level": r.app.level || "",
    "Intake": r.app.intake || "",
    "Instruction Language": r.app.instructionLanguage || "",
    "Deadline": r.app.deadline || "",
    "Tuition Fee": r.app.tuitionFee ?? "",
    "Discounted Fee": r.app.discountedFee ?? "",
    "Scholarship": r.app.scholarship ?? "",
    ...(canExposeCommission ? {
      "Commission Rate (%)": r.app.commissionRate ?? "",
      "Commission Amount": r.universityCommissionAmount ?? "",
      "Commission Status": r.commissionStatus || "",
    } : {}),
    ...(permissions.has("finance.service_fees_view") ? { "Service Fee": r.app.serviceFeeAmount ?? "" } : {}),
    "Application Fee": r.app.applicationFee ?? "",
    "Enrolment Fee": r.app.enrollmentFee ?? "",
    "Deposit Fee": r.app.depositFee ?? "",
    "Advanced Fee": r.app.advancedFee ?? "",
    "Language Fee": r.app.languageFee ?? "",
    "Currency": r.app.currency || "",
    "Agent": r.agentName || "",
    "Assigned To": [r.assignedFirstName, r.assignedLastName].filter(Boolean).join(" ") || "",
    "Season": r.app.season || "",
    "Notes": r.app.notes || "",
    "Created": formatDate(r.app.createdAt),
    "Updated": formatDate(r.app.updatedAt),
  }));

  await sendExcel(req, res, data, "applications", "Applications");
}
