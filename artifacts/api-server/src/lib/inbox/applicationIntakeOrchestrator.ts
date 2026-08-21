import {
  applicationsTable,
  conversationsTable,
  db,
  leadsTable,
  programsTable,
  studentsTable,
  universitiesTable,
} from "@workspace/db";
import type { DocEquivalenceGroupId } from "@workspace/doc-equivalence";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  computeMissingDocGroups,
  type CaptureResult,
  type StructuredLeadFields,
} from "./leadCapture";

export type ApplicationIntakePhase =
  | "collecting_identity"
  | "collecting_documents"
  | "collecting_profile"
  | "ready_for_student"
  | "ready_for_application"
  | "application_created"
  | "needs_review";

export interface ApplicationIntakeProgramCandidate {
  programId: number;
  universityId: number | null;
  programName: string;
  universityName: string | null;
}

export interface ApplicationIntakeState {
  version: 1;
  phase: ApplicationIntakePhase;
  lastProcessedInboundMessageId: number | null;
  leadId: number | null;
  studentId: number | null;
  applicationId: number | null;
  level: string | null;
  missingIdentityFields: string[];
  missingProfileFields: string[];
  missingDocumentGroups: DocEquivalenceGroupId[];
  currentDocumentGroup: DocEquivalenceGroupId | null;
  currentDocumentType: string | null;
  programCandidate: ApplicationIntakeProgramCandidate | null;
  pendingAction: "create_student" | "create_application" | null;
  reviewReason: string | null;
  updatedAt: string;
}

const GROUP_TO_DOCUMENT_TYPE: Partial<Record<DocEquivalenceGroupId, string>> = {
  passport: "passport",
  photo: "photo",
  hs_certificate: "class_12th_hsc_certificate",
  hs_transcript: "class_12th_hsc_marks_sheet",
  ssc_marks_sheet: "class_10th_ssc_marks_sheet",
  bachelors_certificate: "bachelors_certificate",
  bachelors_transcript: "bachelors_transcript",
  masters_certificate: "masters_certificate",
  masters_transcript: "masters_transcript",
  language_proof: "ielts_pte_gre_gmat_toefl_duolingo",
  cv: "cv",
  sop: "sop",
  equivalency_letter: "diploma_recognition",
  diploma_certificate: "diploma_certificate",
  diploma_transcript: "diploma_transcript",
  lor: "lor",
  essay: "essay",
  experience_letters: "experience_letters",
  other_certificates_documents: "other_certificates_documents",
};

const DOCUMENT_LABELS: Partial<Record<DocEquivalenceGroupId, string>> = {
  passport: "passport",
  photo: "passport-style photograph",
  hs_certificate: "high-school diploma",
  hs_transcript: "high-school transcript",
  ssc_marks_sheet: "secondary-school marks sheet",
  bachelors_certificate: "bachelor's diploma",
  bachelors_transcript: "bachelor's transcript",
  masters_certificate: "master's diploma",
  masters_transcript: "master's transcript",
  language_proof: "language certificate",
  cv: "CV / resume",
  sop: "statement of purpose",
  equivalency_letter: "recognition document",
  diploma_certificate: "diploma certificate",
  diploma_transcript: "diploma transcript",
  lor: "letter of recommendation",
  essay: "essay",
  experience_letters: "experience letter",
  other_certificates_documents: "supporting document",
};

const FIELD_LABELS: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  email: "email address",
  phone: "phone number with country code",
  level: "study level",
  university: "preferred university",
  program: "preferred programme",
  motherName: "mother's full name",
  fatherName: "father's full name",
  gender: "gender",
  nationality: "nationality",
  dateOfBirth: "date of birth",
  passportNumber: "passport number",
  passportIssueDate: "passport issue date",
  passportExpiry: "passport expiry date",
  highSchool: "high-school name",
  universityBachelor: "bachelor's university",
  universityMaster: "master's university",
  graduationYear: "graduation year",
  gpa: "GPA and grading scale",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonBlank(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function readApplicationIntakeState(metadata: unknown): ApplicationIntakeState | null {
  if (!isObject(metadata) || !isObject(metadata.aiApplicationIntake)) return null;
  const value = metadata.aiApplicationIntake as Partial<ApplicationIntakeState>;
  if (value.version !== 1 || typeof value.phase !== "string") return null;
  return value as ApplicationIntakeState;
}

export function expectedApplicationDocumentType(metadata: unknown): string | null {
  return readApplicationIntakeState(metadata)?.currentDocumentType ?? null;
}

function profileFromLeadEducationData(value: unknown): Record<string, unknown> {
  if (!isObject(value) || !isObject(value.applicationIntake)) return {};
  return value.applicationIntake;
}

function missingKeys(values: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((key) => !nonBlank(values[key]));
}

function requiredAcademicKeys(level: string | null): string[] {
  const normalized = (level ?? "").toLowerCase().replace(/[\s._'-]+/g, "");
  if (normalized.includes("phd") || normalized.includes("doctor")) {
    return ["universityBachelor", "universityMaster", "graduationYear", "gpa"];
  }
  if (normalized.includes("master") || normalized.includes("mba")) {
    return ["universityBachelor", "graduationYear", "gpa"];
  }
  return ["highSchool", "graduationYear", "gpa"];
}

function fieldValue(fields: StructuredLeadFields, key: keyof StructuredLeadFields): string | null {
  return nonBlank(fields[key]);
}

async function resolveProgramCandidate(opts: {
  university: string | null;
  program: string | null;
}): Promise<{
  candidate: ApplicationIntakeProgramCandidate | null;
  ambiguous: boolean;
  notFound: boolean;
}> {
  if (!opts.university || !opts.program) {
    return { candidate: null, ambiguous: false, notFound: false };
  }
  const rows = await db
    .select({
      programId: programsTable.id,
      universityId: programsTable.universityId,
      programName: programsTable.name,
      universityName: universitiesTable.name,
    })
    .from(programsTable)
    .leftJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(and(
      eq(programsTable.isActive, true),
      sql`lower(trim(${programsTable.name})) = lower(trim(${opts.program}))`,
      sql`lower(trim(${universitiesTable.name})) = lower(trim(${opts.university}))`,
    ))
    .limit(2);
  if (rows.length !== 1) {
    return { candidate: null, ambiguous: rows.length > 1, notFound: rows.length === 0 };
  }
  return { candidate: rows[0], ambiguous: false, notFound: false };
}

export function buildApplicationIntakeInstruction(state: ApplicationIntakeState): string {
  const header = [
    "## Persistent admissions intake state (server-owned)",
    `- Phase: ${state.phase}`,
    "- Follow this state instead of reconstructing the checklist from prose history.",
    "- Ask for exactly ONE missing item per reply. Never ask again for an item not listed as missing.",
    "- Never claim that a Student or Application was created unless the state contains its id.",
  ];

  if (state.missingIdentityFields.length > 0) {
    const key = state.missingIdentityFields[0];
    return [...header, `- Ask only for the student's ${FIELD_LABELS[key] ?? key}.`].join("\n");
  }
  if (state.currentDocumentGroup) {
    return [
      ...header,
      `- Ask only for the ${DOCUMENT_LABELS[state.currentDocumentGroup] ?? state.currentDocumentGroup}.`,
      "- If the latest inbound message contains a file, briefly acknowledge it and move to this next item.",
    ].join("\n");
  }
  if (state.missingProfileFields.length > 0) {
    const key = state.missingProfileFields[0];
    return [
      ...header,
      "- The required documents are complete.",
      `- Ask only for the student's ${FIELD_LABELS[key] ?? key} needed by the final submission form.`,
    ].join("\n");
  }
  if (state.phase === "ready_for_student") {
    return [
      ...header,
      "- The intake is ready for the guarded Create Student action.",
      "- Do not expose internal action names; confirm the selected university and programme while the CRM action is reviewed.",
    ].join("\n");
  }
  if (state.phase === "ready_for_application") {
    return [
      ...header,
      state.programCandidate
        ? `- The guarded application action is ready for ${state.programCandidate.universityName} / ${state.programCandidate.programName}.`
        : "- Ask the student to confirm one exact university and programme.",
    ].join("\n");
  }
  if (state.phase === "application_created") {
    return [...header, `- Application #${state.applicationId} already exists; never submit it again.`].join("\n");
  }
  return [...header, `- Human review is required: ${state.reviewReason ?? "ambiguous intake data"}.`].join("\n");
}

export async function syncApplicationIntakeState(opts: {
  conversationId: number;
  inboundMessageId: number;
  capture: CaptureResult;
}): Promise<ApplicationIntakeState> {
  const [conversation] = await db
    .select({ metadata: conversationsTable.metadata })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, opts.conversationId));
  const previous = readApplicationIntakeState(conversation?.metadata);

  const [lead] = opts.capture.leadId
    ? await db.select().from(leadsTable).where(and(
        eq(leadsTable.id, opts.capture.leadId),
        isNull(leadsTable.deletedAt),
      )).limit(1)
    : [undefined];
  const [student] = opts.capture.studentId
    ? await db.select().from(studentsTable).where(and(
        eq(studentsTable.id, opts.capture.studentId),
        isNull(studentsTable.deletedAt),
      )).limit(1)
    : [undefined];

  const fields = opts.capture.capturedFields;
  const leadProfile = profileFromLeadEducationData(lead?.educationData);
  const values: Record<string, unknown> = student
    ? { ...student }
    : {
        ...leadProfile,
        firstName: lead?.firstName ?? fieldValue(fields, "firstName"),
        lastName: lead?.lastName ?? fieldValue(fields, "lastName"),
        email: lead?.email ?? fieldValue(fields, "email"),
        phone: lead?.phoneE164 ?? lead?.phone,
        level: lead?.interestedLevel ?? fieldValue(fields, "level"),
        university: lead?.interestedUniversity ?? fieldValue(fields, "university"),
        program: lead?.interestedProgram ?? fieldValue(fields, "program") ?? fieldValue(fields, "department"),
        motherName: lead?.motherName ?? fieldValue(fields, "motherName"),
        fatherName: lead?.fatherName ?? fieldValue(fields, "fatherName"),
      };

  const university = nonBlank(lead?.interestedUniversity) ?? fieldValue(fields, "university");
  const program = nonBlank(lead?.interestedProgram)
    ?? fieldValue(fields, "program")
    ?? fieldValue(fields, "department");
  const level = opts.capture.level
    ?? nonBlank(student?.interestedLevel)
    ?? nonBlank(lead?.interestedLevel)
    ?? previous?.level
    ?? null;

  const identityValues = {
    ...values,
    level,
    university,
    program,
  };
  const missingIdentityFields = missingKeys(identityValues, [
    "firstName", "lastName", "email", "phone", "level", "university", "program",
  ]);
  const missingProfileFields = missingKeys(values, [
    "motherName", "fatherName", "gender", "nationality", "dateOfBirth",
    "passportNumber", "passportIssueDate", "passportExpiry",
    ...requiredAcademicKeys(level),
  ]);
  const missingDocumentGroups = await computeMissingDocGroups({
    leadId: opts.capture.leadId,
    studentId: opts.capture.studentId,
    level,
  });
  const currentDocumentGroup = missingIdentityFields.length === 0
    ? missingDocumentGroups[0] ?? null
    : null;

  const resolvedProgram = await resolveProgramCandidate({ university, program });
  const [existingApplication] = student
    ? await db.select({ id: applicationsTable.id }).from(applicationsTable).where(and(
        eq(applicationsTable.studentId, student.id),
        resolvedProgram.candidate
          ? eq(applicationsTable.programId, resolvedProgram.candidate.programId)
          : sql`false`,
        isNull(applicationsTable.deletedAt),
      )).limit(1)
    : [undefined];

  let phase: ApplicationIntakePhase;
  let pendingAction: ApplicationIntakeState["pendingAction"] = null;
  let reviewReason: string | null = null;
  if (existingApplication) {
    phase = "application_created";
  } else if (resolvedProgram.ambiguous) {
    phase = "needs_review";
    reviewReason = "More than one active programme matches the supplied university and programme names.";
  } else if (resolvedProgram.notFound) {
    phase = "needs_review";
    reviewReason = "No exact active catalogue programme matches the supplied university and programme names.";
  } else if (missingIdentityFields.length > 0) {
    phase = "collecting_identity";
  } else if (missingDocumentGroups.length > 0) {
    phase = "collecting_documents";
  } else if (missingProfileFields.length > 0) {
    phase = "collecting_profile";
  } else if (!student) {
    phase = "ready_for_student";
    pendingAction = "create_student";
  } else {
    phase = "ready_for_application";
    if (resolvedProgram.candidate) pendingAction = "create_application";
  }

  const state: ApplicationIntakeState = {
    version: 1,
    phase,
    lastProcessedInboundMessageId: opts.inboundMessageId,
    leadId: opts.capture.leadId,
    studentId: opts.capture.studentId,
    applicationId: existingApplication?.id ?? null,
    level,
    missingIdentityFields,
    missingProfileFields,
    missingDocumentGroups,
    currentDocumentGroup,
    currentDocumentType: currentDocumentGroup
      ? GROUP_TO_DOCUMENT_TYPE[currentDocumentGroup] ?? "other_certificates_documents"
      : null,
    programCandidate: resolvedProgram.candidate,
    pendingAction,
    reviewReason,
    updatedAt: new Date().toISOString(),
  };

  await db.update(conversationsTable).set({
    metadata: sql`jsonb_set(
      coalesce(${conversationsTable.metadata}, '{}'::jsonb),
      '{aiApplicationIntake}',
      ${JSON.stringify(state)}::jsonb,
      true
    )`,
  }).where(eq(conversationsTable.id, opts.conversationId));
  return state;
}
