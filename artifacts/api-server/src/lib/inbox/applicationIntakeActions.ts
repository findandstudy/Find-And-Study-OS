import {
  applicationsTable,
  conversationsTable,
  db,
  documentsTable,
  externalContactsTable,
  leadsTable,
  programsTable,
  studentsTable,
  universitiesTable,
} from "@workspace/db";
import { syncApplicationFinance } from "@workspace/portal-runner";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { normalizePhoneField } from "../textNormalize";
import { toE164 } from "./phone";
import {
  readApplicationIntakeState,
  syncApplicationIntakeState,
  type ApplicationIntakeState,
} from "./applicationIntakeOrchestrator";
import type { CaptureResult, StructuredLeadFields } from "./leadCapture";

const ACTION_LOCK_NS = 7314;

export type ApplicationIntakeActionResult = {
  state: ApplicationIntakeState;
  createdStudentId: number | null;
  createdApplicationId: number | null;
};

export function isApplicationIntakeAutoCommitEnabled(): boolean {
  return process.env.AI_APPLICATION_INTAKE_AUTO_COMMIT === "true";
}

export function isApplicationIntakeActionsEnabled(): boolean {
  return isApplicationIntakeAutoCommitEnabled()
    || process.env.AI_APPLICATION_INTAKE_ACTIONS_ENABLED === "true";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

const EMPTY_FIELDS: StructuredLeadFields = {
  firstName: null, lastName: null, email: null, motherName: null, fatherName: null,
  program: null, language: null, country: null, city: null, university: null,
  department: null, campus: null, gender: null, checkInDate: null, duration: null,
  budget: null, level: null, dateOfBirth: null, nationality: null,
  passportNumber: null, passportIssueDate: null, passportExpiry: null,
  address: null, addressCity: null, postalCode: null, highSchool: null,
  universityBachelor: null, universityMaster: null, graduationYear: null, gpa: null,
};

function captureFromState(state: ApplicationIntakeState): CaptureResult {
  return {
    leadId: state.leadId,
    studentId: state.studentId,
    created: false,
    stage: null,
    level: state.level,
    capturedFields: { ...EMPTY_FIELDS },
  };
}

async function createStudentFromReadyLead(state: ApplicationIntakeState): Promise<number> {
  if (!state.leadId) throw new Error("AI intake has no linked lead");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ACTION_LOCK_NS}, ${state.leadId})`);
    const [lead] = await tx.select().from(leadsTable).where(and(
      eq(leadsTable.id, state.leadId!),
      isNull(leadsTable.deletedAt),
    ));
    if (!lead) throw new Error("Linked lead no longer exists");
    if (lead.convertedStudentId) return lead.convertedStudentId;
    if (!lead.firstName?.trim() || !lead.lastName?.trim() || !lead.email?.trim() || !lead.phone?.trim()) {
      throw new Error("Lead identity is incomplete");
    }

    const profile = objectValue(objectValue(lead.educationData).applicationIntake);
    const normalizedEmail = lead.email.trim().toLowerCase();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${normalizedEmail}, 0))`);
    const matchingStudents = await tx.select().from(studentsTable).where(and(
      sql`lower(trim(${studentsTable.email})) = ${normalizedEmail}`,
      isNull(studentsTable.deletedAt),
    )).orderBy(asc(studentsTable.id)).limit(2);
    if (matchingStudents.length > 1) throw new Error("Multiple active students match the intake email");

    const passportNumber = text(profile.passportNumber)?.toUpperCase() ?? null;
    if (passportNumber) {
      const passportMatches = await tx.select({ id: studentsTable.id }).from(studentsTable).where(and(
        sql`upper(trim(${studentsTable.passportNumber})) = ${passportNumber}`,
        isNull(studentsTable.deletedAt),
      )).limit(2);
      if (passportMatches.length > 1 || (passportMatches[0] && passportMatches[0].id !== matchingStudents[0]?.id)) {
        throw new Error("Passport identity conflicts with an existing student");
      }
    }

    let student = matchingStudents[0] ?? null;
    const values = {
      branchId: lead.branchId,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: normalizedEmail,
      phone: normalizePhoneField(lead.phone),
      phoneE164: lead.phoneE164 || toE164(normalizePhoneField(lead.phone)),
      nationality: lead.nationality || text(profile.nationality),
      dateOfBirth: text(profile.dateOfBirth),
      gender: text(profile.gender)?.toLowerCase() ?? null,
      passportNumber,
      passportIssueDate: text(profile.passportIssueDate),
      passportExpiry: text(profile.passportExpiry),
      motherName: lead.motherName || text(profile.motherName),
      fatherName: lead.fatherName || text(profile.fatherName),
      address: text(profile.address),
      addressCity: text(profile.addressCity),
      postalCode: text(profile.postalCode),
      highSchool: text(profile.highSchool),
      universityBachelor: text(profile.universityBachelor),
      universityMaster: text(profile.universityMaster),
      graduationYear: text(profile.graduationYear)
        ? Number.parseInt(text(profile.graduationYear)!, 10) || null
        : null,
      gpa: text(profile.gpa),
      interestedLevel: lead.interestedLevel,
      season: lead.season,
      status: "active",
      agentId: lead.agentId,
      assignedToId: lead.assignedToId,
      originType: lead.originType || "direct",
      originEntityType: lead.originEntityType,
      originEntityId: lead.originEntityId,
      originDisplayName: lead.originDisplayName || "Find And Study",
      originLocked: true,
      originLeadId: lead.id,
    };

    if (student) {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        if (value != null && value !== "" && !(student as Record<string, unknown>)[key]) patch[key] = value;
      }
      if (Object.keys(patch).length > 0) {
        [student] = await tx.update(studentsTable).set(patch)
          .where(eq(studentsTable.id, student.id)).returning();
      }
    } else {
      [student] = await tx.insert(studentsTable).values(values).returning();
    }
    if (!student) throw new Error("Student could not be created");

    await tx.update(documentsTable).set({ studentId: student.id })
      .where(and(eq(documentsTable.leadId, lead.id), isNull(documentsTable.studentId)));
    await tx.update(leadsTable).set({
      status: "converted",
      convertedStudentId: student.id,
    }).where(eq(leadsTable.id, lead.id));
    await tx.update(externalContactsTable).set({ studentId: student.id })
      .where(eq(externalContactsTable.leadId, lead.id));
    return student.id;
  });
}

async function createApplicationFromReadyIntake(state: ApplicationIntakeState): Promise<number> {
  if (!state.studentId || !state.programCandidate) {
    throw new Error("AI intake does not have a confirmed Student and programme");
  }
  const applicationId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ACTION_LOCK_NS}, ${state.studentId})`);
    const [existing] = await tx.select({ id: applicationsTable.id }).from(applicationsTable).where(and(
      eq(applicationsTable.studentId, state.studentId!),
      eq(applicationsTable.programId, state.programCandidate!.programId),
      isNull(applicationsTable.deletedAt),
    ));
    if (existing) return existing.id;
    const [student] = await tx.select().from(studentsTable).where(and(
      eq(studentsTable.id, state.studentId!),
      isNull(studentsTable.deletedAt),
    ));
    if (!student) throw new Error("Linked student no longer exists");
    const [program] = await tx.select().from(programsTable).where(and(
      eq(programsTable.id, state.programCandidate!.programId),
      eq(programsTable.isActive, true),
    ));
    if (!program) throw new Error("Confirmed programme is no longer active");
    const [university] = await tx.select().from(universitiesTable).where(eq(
      universitiesTable.id,
      program.universityId,
    ));
    if (!university) throw new Error("Confirmed university no longer exists");

    const [application] = await tx.insert(applicationsTable).values({
      studentId: student.id,
      leadId: state.leadId,
      programId: program.id,
      universityId: university.id,
      programName: program.name,
      universityName: university.name,
      country: university.country,
      level: program.degree,
      instructionLanguage: program.language,
      intake: program.intakes,
      tuitionFee: program.tuitionFee,
      discountedFee: program.discountedFee,
      scholarship: program.scholarship,
      commissionRate: program.commissionRate,
      serviceFeeAmount: program.serviceFeeAmount,
      applicationFee: program.applicationFee,
      depositFee: program.depositFee,
      advancedFee: program.advancedFee,
      languageFee: program.languageFee,
      currency: program.currency,
      stage: "inquiry",
      season: student.season,
      agentId: student.agentId,
      assignedToId: student.assignedToId,
      branchId: student.branchId,
      createdSource: "automation",
      originType: student.originType,
      originEntityType: student.originEntityType,
      originEntityId: student.originEntityId,
      originDisplayName: student.originDisplayName,
      originLocked: true,
      originStudentId: student.id,
    }).returning({ id: applicationsTable.id });
    return application.id;
  });
  await syncApplicationFinance(applicationId);
  return applicationId;
}

/**
 * Execute at most the two guarded CRM commits in order: Lead -> Student, then
 * Student -> exact Application. Re-running is safe; locks and exact duplicate
 * checks return the existing canonical rows.
 *
 * This deliberately does NOT submit an application to a university portal.
 * Portal submission remains a separate reviewed action with its own preflight.
 */
export async function executeApplicationIntakePendingActions(opts: {
  conversationId: number;
  inboundMessageId: number;
}): Promise<ApplicationIntakeActionResult> {
  if (!isApplicationIntakeActionsEnabled()) {
    throw new Error("AI application intake actions are disabled");
  }
  let [conversation] = await db.select({ metadata: conversationsTable.metadata })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, opts.conversationId));
  let state = readApplicationIntakeState(conversation?.metadata);
  if (!state) throw new Error("Application intake state is not initialized");
  let createdStudentId: number | null = null;
  let createdApplicationId: number | null = null;

  if (state.pendingAction === "create_student" && state.phase === "ready_for_student") {
    createdStudentId = await createStudentFromReadyLead(state);
    state = await syncApplicationIntakeState({
      conversationId: opts.conversationId,
      inboundMessageId: opts.inboundMessageId,
      capture: { ...captureFromState(state), studentId: createdStudentId },
    });
  }
  if (state.pendingAction === "create_application" && state.phase === "ready_for_application") {
    createdApplicationId = await createApplicationFromReadyIntake(state);
    state = await syncApplicationIntakeState({
      conversationId: opts.conversationId,
      inboundMessageId: opts.inboundMessageId,
      capture: captureFromState(state),
    });
  }
  return { state, createdStudentId, createdApplicationId };
}
