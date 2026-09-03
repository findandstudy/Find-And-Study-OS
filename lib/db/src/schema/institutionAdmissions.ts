import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { applicationsTable } from "./applications";
import { portalSubmissionsTable } from "./portalSubmissions";
import {
  principalsTable,
  rolePackageVersionsTable,
  tenantsTable,
} from "./authorization";
import { programsTable, universitiesTable } from "./universities";
import { usersTable } from "./users";
import {
  journeyApplicationCasesTable,
  journeyConsentReceiptsTable,
  journeyVerifiedEvidenceReceiptsTable,
} from "./studentJourney";

const uuidV7 = (column: { name: string }) =>
  sql`substring(${sql.identifier(column.name)}::text from 15 for 1) = '7'`;

export const institutionRelationshipsTable = pgTable(
  "institution_relationships",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "restrict" }),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => universitiesTable.id, { onDelete: "restrict" }),
    purposeCode: text("purpose_code").notNull(),
    dataScopes: text("data_scopes").array().notNull(),
    status: text("status").notNull().default("ACTIVE"),
    policyVersion: bigint("policy_version", { mode: "number" })
      .notNull()
      .default(1),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_relationships_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("institution_relationships_tenant_institution_uq").on(
      table.tenantId,
      table.institutionId,
    ),
    index("institution_relationships_status_idx").on(
      table.tenantId,
      table.status,
    ),
    check("institution_relationships_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_relationships_status_chk",
      sql`${table.status} IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')`,
    ),
    check(
      "institution_relationships_purpose_chk",
      sql`${table.purposeCode} ~ '^[a-z][a-z0-9._:-]{1,95}$'`,
    ),
    check(
      "institution_relationships_policy_version_chk",
      sql`${table.policyVersion} > 0`,
    ),
    check(
      "institution_relationships_validity_chk",
      sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`,
    ),
  ],
).enableRLS();

export const institutionMembershipsTable = pgTable(
  "institution_memberships",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principalsTable.id, { onDelete: "restrict" }),
    rolePackageVersionId: uuid("role_package_version_id")
      .notNull()
      .references(() => rolePackageVersionsTable.id, { onDelete: "restrict" }),
    legacyUserId: integer("legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    roleKey: text("role_key").notNull(),
    programScopeIds: integer("program_scope_ids").array().notNull().default([]),
    intakeScopes: text("intake_scopes").array().notNull().default([]),
    status: text("status").notNull().default("PENDING"),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_memberships_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    uniqueIndex("institution_memberships_active_user_uidx")
      .on(table.legacyUserId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index("institution_memberships_user_status_idx").on(
      table.legacyUserId,
      table.status,
    ),
    index("institution_memberships_relationship_role_idx").on(
      table.tenantId,
      table.relationshipId,
      table.roleKey,
      table.status,
    ),
    index("institution_memberships_role_package_idx").on(
      table.rolePackageVersionId,
      table.status,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId],
      foreignColumns: [
        institutionRelationshipsTable.tenantId,
        institutionRelationshipsTable.id,
      ],
      name: "institution_memberships_relationship_fk",
    }).onDelete("restrict"),
    check("institution_memberships_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_memberships_role_chk",
      sql`${table.roleKey} IN ('INSTITUTION_ADMIN', 'PROGRAM_INTAKE_MANAGER', 'ADMISSIONS_REVIEWER', 'DECISION_APPROVER', 'INTEGRATION_ADMIN', 'INSTITUTION_AUDITOR')`,
    ),
    check(
      "institution_memberships_status_chk",
      sql`${table.status} IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')`,
    ),
    check("institution_memberships_version_chk", sql`${table.version} > 0`),
    check(
      "institution_memberships_validity_chk",
      sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`,
    ),
  ],
).enableRLS();

export const institutionSlaPoliciesTable = pgTable(
  "institution_sla_policies",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    reviewTargetHours: integer("review_target_hours").notNull(),
    decisionTargetHours: integer("decision_target_hours").notNull(),
    informationResponseHours: integer("information_response_hours").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_sla_policies_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("institution_sla_policies_relationship_version_uq").on(
      table.tenantId,
      table.relationshipId,
      table.version,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId],
      foreignColumns: [
        institutionRelationshipsTable.tenantId,
        institutionRelationshipsTable.id,
      ],
      name: "institution_sla_policies_relationship_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.createdByMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_sla_policies_creator_fk",
    }).onDelete("restrict"),
    check("institution_sla_policies_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_sla_policies_status_chk",
      sql`${table.status} IN ('DRAFT', 'ACTIVE', 'RETIRED')`,
    ),
    check(
      "institution_sla_policies_targets_chk",
      sql`${table.reviewTargetHours} BETWEEN 1 AND 2160 AND ${table.decisionTargetHours} BETWEEN 1 AND 2160 AND ${table.informationResponseHours} BETWEEN 1 AND 2160`,
    ),
    check("institution_sla_policies_version_chk", sql`${table.version} > 0`),
  ],
).enableRLS();

export const institutionApplicationCasesTable = pgTable(
  "institution_application_cases",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    legacyApplicationId: integer("legacy_application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "restrict" }),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => universitiesTable.id, { onDelete: "restrict" }),
    programId: integer("program_id").references(() => programsTable.id, {
      onDelete: "restrict",
    }),
    intakeKey: text("intake_key"),
    maskedStudentRef: text("masked_student_ref").notNull(),
    sharedProfile: jsonb("shared_profile")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lifecycleState: text("lifecycle_state").notNull().default("RECEIVED"),
    priority: text("priority").notNull().default("NORMAL"),
    readinessPercent: integer("readiness_percent").notNull().default(0),
    blockerCode: text("blocker_code"),
    assignedReviewerMembershipId: uuid("assigned_reviewer_membership_id"),
    slaPolicyId: uuid("sla_policy_id"),
    reviewDueAt: timestamp("review_due_at", { withTimezone: true }),
    decisionDueAt: timestamp("decision_due_at", { withTimezone: true }),
    sourcePortalSubmissionId: integer("source_portal_submission_id").references(
      () => portalSubmissionsTable.id,
      { onDelete: "restrict" },
    ),
    sourceSnapshotHash: text("source_snapshot_hash"),
    intakeReceiptHash: text("intake_receipt_hash"),
    aggregateVersion: bigint("aggregate_version", { mode: "number" })
      .notNull()
      .default(1),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_application_cases_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("institution_application_cases_relationship_id_id_uq").on(
      table.tenantId,
      table.relationshipId,
      table.id,
    ),
    unique("institution_application_cases_legacy_uq").on(
      table.tenantId,
      table.relationshipId,
      table.legacyApplicationId,
    ),
    index("institution_application_cases_queue_idx").on(
      table.tenantId,
      table.relationshipId,
      table.lifecycleState,
      table.reviewDueAt,
    ),
    index("institution_application_cases_reviewer_idx").on(
      table.tenantId,
      table.assignedReviewerMembershipId,
      table.lifecycleState,
    ),
    uniqueIndex("institution_application_cases_intake_source_uidx")
      .on(
        table.tenantId,
        table.relationshipId,
        table.sourcePortalSubmissionId,
      )
      .where(sql`${table.sourcePortalSubmissionId} IS NOT NULL`),
    foreignKey({
      columns: [table.tenantId, table.relationshipId],
      foreignColumns: [
        institutionRelationshipsTable.tenantId,
        institutionRelationshipsTable.id,
      ],
      name: "institution_application_cases_relationship_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.assignedReviewerMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_application_cases_reviewer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.slaPolicyId],
      foreignColumns: [
        institutionSlaPoliciesTable.tenantId,
        institutionSlaPoliciesTable.id,
      ],
      name: "institution_application_cases_sla_fk",
    }).onDelete("restrict"),
    check("institution_application_cases_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_application_cases_state_chk",
      sql`${table.lifecycleState} IN ('RECEIVED', 'REVIEWING', 'INFORMATION_REQUESTED', 'READY_FOR_DECISION', 'DECISION_PENDING_APPROVAL', 'DECIDED', 'OFFER_ISSUED', 'ENROLMENT_PENDING', 'ENROLLED', 'CLOSED')`,
    ),
    check(
      "institution_application_cases_priority_chk",
      sql`${table.priority} IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')`,
    ),
    check(
      "institution_application_cases_readiness_chk",
      sql`${table.readinessPercent} BETWEEN 0 AND 100`,
    ),
    check(
      "institution_application_cases_version_chk",
      sql`${table.aggregateVersion} > 0`,
    ),
    check(
      "institution_application_cases_intake_binding_chk",
      sql`(
        ${table.sourcePortalSubmissionId} IS NULL
        AND ${table.sourceSnapshotHash} IS NULL
        AND ${table.intakeReceiptHash} IS NULL
      ) OR (
        ${table.sourcePortalSubmissionId} IS NOT NULL
        AND ${table.sourceSnapshotHash} ~ '^[0-9a-f]{64}$'
        AND ${table.intakeReceiptHash} ~ '^[0-9a-f]{64}$'
      )`,
    ),
  ],
).enableRLS();

export const institutionCaseIntakeReceiptsTable = pgTable(
  "institution_case_intake_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    legacyApplicationId: integer("legacy_application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "restrict" }),
    portalSubmissionId: integer("portal_submission_id")
      .notNull()
      .references(() => portalSubmissionsTable.id, { onDelete: "restrict" }),
    sourceStatus: text("source_status").notNull(),
    sourceObservedAt: timestamp("source_observed_at", { withTimezone: true })
      .notNull(),
    sourceExternalRefHash: text("source_external_ref_hash").notNull(),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    commandHash: text("command_hash").notNull(),
    maskedStudentRef: text("masked_student_ref").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    executorKey: text("executor_key")
      .notNull()
      .default("institution.case_intake.v1"),
    outcome: text("outcome").notNull().default("CREATED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_case_intake_receipts_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("institution_case_intake_receipts_source_uq").on(
      table.tenantId,
      table.relationshipId,
      table.portalSubmissionId,
    ),
    unique("institution_case_intake_receipts_receipt_hash_uq").on(
      table.tenantId,
      table.relationshipId,
      table.receiptHash,
    ),
    index("institution_case_intake_receipts_case_idx").on(
      table.tenantId,
      table.relationshipId,
      table.applicationCaseId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId],
      foreignColumns: [
        institutionRelationshipsTable.tenantId,
        institutionRelationshipsTable.id,
      ],
      name: "institution_case_intake_receipts_relationship_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [
        table.tenantId,
        table.relationshipId,
        table.applicationCaseId,
      ],
      foreignColumns: [
        institutionApplicationCasesTable.tenantId,
        institutionApplicationCasesTable.relationshipId,
        institutionApplicationCasesTable.id,
      ],
      name: "institution_case_intake_receipts_case_fk",
    }).onDelete("restrict"),
    check("institution_case_intake_receipts_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_case_intake_receipts_source_status_chk",
      sql`${table.sourceStatus} IN ('submitted', 'already_exists', 'accepted')`,
    ),
    check(
      "institution_case_intake_receipts_hash_chk",
      sql`${table.sourceExternalRefHash} ~ '^[0-9a-f]{64}$'
        AND ${table.sourceSnapshotHash} ~ '^[0-9a-f]{64}$'
        AND ${table.commandHash} ~ '^[0-9a-f]{64}$'
        AND ${table.receiptHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "institution_case_intake_receipts_masked_ref_chk",
      sql`${table.maskedStudentRef} ~ '^STU-[0-9A-F]{16}$'`,
    ),
    check(
      "institution_case_intake_receipts_executor_chk",
      sql`${table.executorKey} = 'institution.case_intake.v1'`,
    ),
    check(
      "institution_case_intake_receipts_outcome_chk",
      sql`${table.outcome} = 'CREATED'`,
    ),
  ],
).enableRLS();

export const institutionEvidenceShareReceiptsTable = pgTable(
  "institution_evidence_share_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    journeyApplicationCaseId: uuid("journey_application_case_id").notNull(),
    journeySubjectId: uuid("journey_subject_id").notNull(),
    journeyEvidenceReceiptId: uuid("journey_evidence_receipt_id").notNull(),
    journeyConsentReceiptId: uuid("journey_consent_receipt_id").notNull(),
    consentPurpose: text("consent_purpose").notNull(),
    requirementCode: text("requirement_code").notNull(),
    evidenceRefHash: text("evidence_ref_hash").notNull(),
    contentSha256: text("content_sha256").notNull(),
    evidenceReceiptHash: text("evidence_receipt_hash").notNull(),
    consentReceiptHash: text("consent_receipt_hash").notNull(),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    executorKey: text("executor_key")
      .notNull()
      .default("institution.evidence_share.v1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_evidence_share_receipts_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("institution_evidence_share_receipts_scope_id_uq").on(
      table.tenantId,
      table.relationshipId,
      table.applicationCaseId,
      table.id,
    ),
    unique("institution_evidence_share_receipts_source_uq").on(
      table.tenantId,
      table.relationshipId,
      table.applicationCaseId,
      table.journeyEvidenceReceiptId,
      table.journeyConsentReceiptId,
    ),
    unique("institution_evidence_share_receipts_hash_uq").on(
      table.tenantId,
      table.relationshipId,
      table.receiptHash,
    ),
    index("institution_evidence_share_receipts_case_idx").on(
      table.tenantId,
      table.relationshipId,
      table.applicationCaseId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId],
      foreignColumns: [
        institutionRelationshipsTable.tenantId,
        institutionRelationshipsTable.id,
      ],
      name: "institution_evidence_share_receipts_relationship_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.relationshipId, table.applicationCaseId],
      foreignColumns: [
        institutionApplicationCasesTable.tenantId,
        institutionApplicationCasesTable.relationshipId,
        institutionApplicationCasesTable.id,
      ],
      name: "institution_evidence_share_receipts_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [
        table.tenantId,
        table.journeyApplicationCaseId,
        table.journeySubjectId,
      ],
      foreignColumns: [
        journeyApplicationCasesTable.tenantId,
        journeyApplicationCasesTable.id,
        journeyApplicationCasesTable.subjectId,
      ],
      name: "institution_evidence_share_receipts_journey_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.journeyEvidenceReceiptId],
      foreignColumns: [
        journeyVerifiedEvidenceReceiptsTable.tenantId,
        journeyVerifiedEvidenceReceiptsTable.id,
      ],
      name: "institution_evidence_share_receipts_evidence_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.journeyConsentReceiptId],
      foreignColumns: [
        journeyConsentReceiptsTable.tenantId,
        journeyConsentReceiptsTable.id,
      ],
      name: "institution_evidence_share_receipts_consent_fk",
    }).onDelete("restrict"),
    check("institution_evidence_share_receipts_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_evidence_share_receipts_purpose_chk",
      sql`${table.consentPurpose} = 'institution.admissions.evidence_share'`,
    ),
    check(
      "institution_evidence_share_receipts_requirement_chk",
      sql`${table.requirementCode} ~ '^[a-z][a-z0-9._:-]{1,95}$'`,
    ),
    check(
      "institution_evidence_share_receipts_hash_chk",
      sql`${table.evidenceRefHash} ~ '^[0-9a-f]{64}$'
        AND ${table.contentSha256} ~ '^[0-9a-f]{64}$'
        AND ${table.evidenceReceiptHash} ~ '^[0-9a-f]{64}$'
        AND ${table.consentReceiptHash} ~ '^[0-9a-f]{64}$'
        AND ${table.sourceSnapshotHash} ~ '^[0-9a-f]{64}$'
        AND ${table.receiptHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "institution_evidence_share_receipts_executor_chk",
      sql`${table.executorKey} = 'institution.evidence_share.v1'`,
    ),
    check(
      "institution_evidence_share_receipts_validity_chk",
      sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.createdAt}`,
    ),
  ],
).enableRLS();

export const institutionRequirementSetsTable = pgTable(
  "institution_requirement_sets",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    programId: integer("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "restrict" }),
    intakeKey: text("intake_key").notNull(),
    versionNumber: bigint("version_number", { mode: "number" }).notNull(),
    state: text("state").notNull().default("DRAFT"),
    sourceRef: text("source_ref").notNull(),
    sourceHash: text("source_hash").notNull(),
    contentHash: text("content_hash").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    approvedByMembershipId: uuid("approved_by_membership_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    unique("institution_requirement_sets_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("institution_requirement_sets_scope_version_uq").on(
      table.tenantId,
      table.relationshipId,
      table.programId,
      table.intakeKey,
      table.versionNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId],
      foreignColumns: [
        institutionRelationshipsTable.tenantId,
        institutionRelationshipsTable.id,
      ],
      name: "institution_requirement_sets_relationship_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.createdByMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_requirement_sets_creator_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.approvedByMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_requirement_sets_approver_fk",
    }).onDelete("restrict"),
    check("institution_requirement_sets_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_requirement_sets_state_chk",
      sql`${table.state} IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED')`,
    ),
    check(
      "institution_requirement_sets_version_chk",
      sql`${table.versionNumber} > 0`,
    ),
    check(
      "institution_requirement_sets_hash_chk",
      sql`${table.sourceHash} ~ '^[0-9a-f]{64}$' AND ${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "institution_requirement_sets_checker_chk",
      sql`${table.approvedByMembershipId} IS NULL OR ${table.approvedByMembershipId} <> ${table.createdByMembershipId}`,
    ),
  ],
).enableRLS();

export const institutionRequirementsTable = pgTable(
  "institution_requirements",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    requirementSetId: uuid("requirement_set_id").notNull(),
    requirementCode: text("requirement_code").notNull(),
    title: text("title").notNull(),
    evidenceType: text("evidence_type").notNull(),
    mandatory: boolean("mandatory").notNull().default(true),
    rule: jsonb("rule").$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    unique("institution_requirements_set_code_uq").on(
      table.tenantId,
      table.requirementSetId,
      table.requirementCode,
    ),
    foreignKey({
      columns: [table.tenantId, table.requirementSetId],
      foreignColumns: [
        institutionRequirementSetsTable.tenantId,
        institutionRequirementSetsTable.id,
      ],
      name: "institution_requirements_set_fk",
    }).onDelete("restrict"),
    check("institution_requirements_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_requirements_code_chk",
      sql`${table.requirementCode} ~ '^[A-Z][A-Z0-9_]{1,63}$'`,
    ),
  ],
).enableRLS();

export const institutionEvidenceAssessmentsTable = pgTable(
  "institution_evidence_assessments",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    requirementId: uuid("requirement_id"),
    evidenceRefHash: text("evidence_ref_hash").notNull(),
    result: text("result").notNull(),
    reasonCode: text("reason_code").notNull(),
    notes: text("notes"),
    reviewerMembershipId: uuid("reviewer_membership_id").notNull(),
    evidenceShareReceiptId: uuid("evidence_share_receipt_id"),
    supersedesAssessmentId: uuid("supersedes_assessment_id"),
    assessmentHash: text("assessment_hash").notNull(),
    assessedAt: timestamp("assessed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_evidence_assessments_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    index("institution_evidence_assessments_case_idx").on(
      table.tenantId,
      table.applicationCaseId,
      table.assessedAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId, table.applicationCaseId],
      foreignColumns: [
        institutionApplicationCasesTable.tenantId,
        institutionApplicationCasesTable.relationshipId,
        institutionApplicationCasesTable.id,
      ],
      name: "institution_evidence_assessments_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.requirementId],
      foreignColumns: [
        institutionRequirementsTable.tenantId,
        institutionRequirementsTable.id,
      ],
      name: "institution_evidence_assessments_requirement_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reviewerMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_evidence_assessments_reviewer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [
        table.tenantId,
        table.relationshipId,
        table.applicationCaseId,
        table.evidenceShareReceiptId,
      ],
      foreignColumns: [
        institutionEvidenceShareReceiptsTable.tenantId,
        institutionEvidenceShareReceiptsTable.relationshipId,
        institutionEvidenceShareReceiptsTable.applicationCaseId,
        institutionEvidenceShareReceiptsTable.id,
      ],
      name: "institution_evidence_assessments_share_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.supersedesAssessmentId],
      foreignColumns: [table.tenantId, table.id],
      name: "institution_evidence_assessments_supersedes_fk",
    }).onDelete("restrict"),
    check("institution_evidence_assessments_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_evidence_assessments_result_chk",
      sql`${table.result} IN ('PENDING', 'VERIFIED', 'NEEDS_INFORMATION', 'REJECTED')`,
    ),
    check(
      "institution_evidence_assessments_hash_chk",
      sql`${table.evidenceRefHash} ~ '^[0-9a-f]{64}$' AND ${table.assessmentHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
).enableRLS();

export const institutionInformationRequestsTable = pgTable(
  "institution_information_requests",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    requirementCode: text("requirement_code").notNull(),
    requestCode: text("request_code").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("OPEN"),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    unique("institution_information_requests_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    index("institution_information_requests_case_status_idx").on(
      table.tenantId,
      table.applicationCaseId,
      table.status,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId, table.applicationCaseId],
      foreignColumns: [
        institutionApplicationCasesTable.tenantId,
        institutionApplicationCasesTable.relationshipId,
        institutionApplicationCasesTable.id,
      ],
      name: "institution_information_requests_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.createdByMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_information_requests_creator_fk",
    }).onDelete("restrict"),
    check("institution_information_requests_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_information_requests_status_chk",
      sql`${table.status} IN ('OPEN', 'RESPONDED', 'CLOSED', 'CANCELLED')`,
    ),
    check(
      "institution_information_requests_code_chk",
      sql`${table.requestCode} ~ '^[A-Z][A-Z0-9_]{1,63}$'`,
    ),
    check(
      "institution_information_requests_version_chk",
      sql`${table.version} > 0`,
    ),
  ],
).enableRLS();

export const institutionDecisionsTable = pgTable(
  "institution_decisions",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    versionNumber: bigint("version_number", { mode: "number" }).notNull(),
    decisionType: text("decision_type").notNull(),
    state: text("state").notNull().default("DRAFT"),
    reasonCode: text("reason_code").notNull(),
    rationale: text("rationale").notNull(),
    conditions: jsonb("conditions")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    makerMembershipId: uuid("maker_membership_id").notNull(),
    checkerMembershipId: uuid("checker_membership_id"),
    previousDecisionId: uuid("previous_decision_id"),
    contentHash: text("content_hash").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    unique("institution_decisions_tenant_id_id_uq").on(table.tenantId, table.id),
    unique("institution_decisions_case_version_uq").on(
      table.tenantId,
      table.applicationCaseId,
      table.versionNumber,
    ),
    index("institution_decisions_approval_queue_idx").on(
      table.tenantId,
      table.relationshipId,
      table.state,
      table.submittedAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId, table.applicationCaseId],
      foreignColumns: [
        institutionApplicationCasesTable.tenantId,
        institutionApplicationCasesTable.relationshipId,
        institutionApplicationCasesTable.id,
      ],
      name: "institution_decisions_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.makerMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_decisions_maker_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.checkerMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_decisions_checker_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.previousDecisionId],
      foreignColumns: [table.tenantId, table.id],
      name: "institution_decisions_previous_fk",
    }).onDelete("restrict"),
    check("institution_decisions_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_decisions_type_chk",
      sql`${table.decisionType} IN ('WAITLISTED', 'CONDITIONAL_OFFER', 'UNCONDITIONAL_OFFER', 'REJECTED')`,
    ),
    check(
      "institution_decisions_state_chk",
      sql`${table.state} IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'SUPERSEDED')`,
    ),
    check(
      "institution_decisions_hash_chk",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "institution_decisions_checker_chk",
      sql`${table.checkerMembershipId} IS NULL OR ${table.checkerMembershipId} <> ${table.makerMembershipId}`,
    ),
    check("institution_decisions_version_chk", sql`${table.versionNumber} > 0`),
  ],
).enableRLS();

export const institutionDecisionApprovalsTable = pgTable(
  "institution_decision_approvals",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    checkerMembershipId: uuid("checker_membership_id").notNull(),
    outcome: text("outcome").notNull(),
    reasonCode: text("reason_code").notNull(),
    comment: text("comment"),
    previousHash: text("previous_hash"),
    receiptHash: text("receipt_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_decision_approvals_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("institution_decision_approvals_decision_uq").on(
      table.tenantId,
      table.decisionId,
    ),
    unique("institution_decision_approvals_receipt_hash_uq").on(
      table.tenantId,
      table.receiptHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.decisionId],
      foreignColumns: [institutionDecisionsTable.tenantId, institutionDecisionsTable.id],
      name: "institution_decision_approvals_decision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.checkerMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_decision_approvals_checker_fk",
    }).onDelete("restrict"),
    check("institution_decision_approvals_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_decision_approvals_outcome_chk",
      sql`${table.outcome} IN ('APPROVED', 'RETURNED', 'REJECTED')`,
    ),
    check(
      "institution_decision_approvals_hash_chk",
      sql`${table.receiptHash} ~ '^[0-9a-f]{64}$' AND (${table.previousHash} IS NULL OR ${table.previousHash} ~ '^[0-9a-f]{64}$')`,
    ),
  ],
).enableRLS();

export const institutionOffersTable = pgTable(
  "institution_offers",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    state: text("state").notNull().default("DRAFT"),
    conditions: jsonb("conditions")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    acceptanceDeadline: timestamp("acceptance_deadline", { withTimezone: true }),
    issuedByMembershipId: uuid("issued_by_membership_id"),
    receiptHash: text("receipt_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_offers_tenant_id_id_uq").on(table.tenantId, table.id),
    unique("institution_offers_decision_uq").on(table.tenantId, table.decisionId),
    foreignKey({
      columns: [table.tenantId, table.relationshipId, table.applicationCaseId],
      foreignColumns: [
        institutionApplicationCasesTable.tenantId,
        institutionApplicationCasesTable.relationshipId,
        institutionApplicationCasesTable.id,
      ],
      name: "institution_offers_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.decisionId],
      foreignColumns: [institutionDecisionsTable.tenantId, institutionDecisionsTable.id],
      name: "institution_offers_decision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.issuedByMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_offers_issuer_fk",
    }).onDelete("restrict"),
    check("institution_offers_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_offers_state_chk",
      sql`${table.state} IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'DECLINED', 'LAPSED', 'SUPERSEDED')`,
    ),
    check(
      "institution_offers_receipt_chk",
      sql`(${table.state} = 'DRAFT' AND ${table.receiptHash} IS NULL AND ${table.issuedAt} IS NULL) OR (${table.state} <> 'DRAFT' AND ${table.receiptHash} ~ '^[0-9a-f]{64}$' AND ${table.issuedAt} IS NOT NULL)`,
    ),
  ],
).enableRLS();

export const institutionEnrolmentsTable = pgTable(
  "institution_enrolments",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    state: text("state").notNull().default("PENDING_EVIDENCE"),
    evidenceShareReceiptId: uuid("evidence_share_receipt_id"),
    evidenceAssessmentId: uuid("evidence_assessment_id"),
    evidenceRefHash: text("evidence_ref_hash"),
    verifiedByMembershipId: uuid("verified_by_membership_id"),
    receiptHash: text("receipt_hash"),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_enrolments_tenant_id_id_uq").on(table.tenantId, table.id),
    unique("institution_enrolments_case_uq").on(
      table.tenantId,
      table.applicationCaseId,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId, table.applicationCaseId],
      foreignColumns: [
        institutionApplicationCasesTable.tenantId,
        institutionApplicationCasesTable.relationshipId,
        institutionApplicationCasesTable.id,
      ],
      name: "institution_enrolments_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [
        table.tenantId,
        table.relationshipId,
        table.applicationCaseId,
        table.evidenceShareReceiptId,
      ],
      foreignColumns: [
        institutionEvidenceShareReceiptsTable.tenantId,
        institutionEvidenceShareReceiptsTable.relationshipId,
        institutionEvidenceShareReceiptsTable.applicationCaseId,
        institutionEvidenceShareReceiptsTable.id,
      ],
      name: "institution_enrolments_evidence_share_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.evidenceAssessmentId],
      foreignColumns: [
        institutionEvidenceAssessmentsTable.tenantId,
        institutionEvidenceAssessmentsTable.id,
      ],
      name: "institution_enrolments_evidence_assessment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.verifiedByMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_enrolments_verifier_fk",
    }).onDelete("restrict"),
    check("institution_enrolments_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_enrolments_state_chk",
      sql`${table.state} IN ('PENDING_EVIDENCE', 'CONFIRMED', 'DEFERRED', 'NOT_ENROLLED')`,
    ),
    check(
      "institution_enrolments_evidence_chk",
      sql`${table.state} <> 'CONFIRMED' OR (${table.evidenceRefHash} ~ '^[0-9a-f]{64}$' AND ${table.receiptHash} ~ '^[0-9a-f]{64}$' AND ${table.verifiedByMembershipId} IS NOT NULL AND ${table.effectiveAt} IS NOT NULL AND ((${table.evidenceShareReceiptId} IS NULL AND ${table.evidenceAssessmentId} IS NULL) OR (${table.evidenceShareReceiptId} IS NOT NULL AND ${table.evidenceAssessmentId} IS NOT NULL)))`,
    ),
    check(
      "institution_enrolments_nonconfirmed_evidence_chk",
      sql`${table.state} = 'CONFIRMED' OR (${table.evidenceShareReceiptId} IS NULL AND ${table.evidenceAssessmentId} IS NULL)`,
    ),
    check("institution_enrolments_version_chk", sql`${table.version} > 0`),
  ],
).enableRLS();

export const institutionAdmissionEventsTable = pgTable(
  "institution_admission_events",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    applicationCaseId: uuid("application_case_id"),
    eventType: text("event_type").notNull(),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateVersion: bigint("aggregate_version", { mode: "number" }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    previousHash: text("previous_hash"),
    eventHash: text("event_hash").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_admission_events_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("institution_admission_events_hash_uq").on(
      table.tenantId,
      table.relationshipId,
      table.eventHash,
    ),
    index("institution_admission_events_case_idx").on(
      table.tenantId,
      table.applicationCaseId,
      table.occurredAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.relationshipId],
      foreignColumns: [
        institutionRelationshipsTable.tenantId,
        institutionRelationshipsTable.id,
      ],
      name: "institution_admission_events_relationship_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.relationshipId, table.applicationCaseId],
      foreignColumns: [
        institutionApplicationCasesTable.tenantId,
        institutionApplicationCasesTable.relationshipId,
        institutionApplicationCasesTable.id,
      ],
      name: "institution_admission_events_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [
        institutionMembershipsTable.tenantId,
        institutionMembershipsTable.id,
      ],
      name: "institution_admission_events_actor_fk",
    }).onDelete("restrict"),
    check("institution_admission_events_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_admission_events_event_type_chk",
      sql`${table.eventType} ~ '^institution\.[a-z][a-z0-9_.-]{1,94}\.v1$'`,
    ),
    check(
      "institution_admission_events_hash_chk",
      sql`${table.eventHash} ~ '^[0-9a-f]{64}$' AND (${table.previousHash} IS NULL OR ${table.previousHash} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "institution_admission_events_version_chk",
      sql`${table.aggregateVersion} > 0`,
    ),
  ],
).enableRLS();

export type InstitutionRelationship =
  typeof institutionRelationshipsTable.$inferSelect;
export type InstitutionMembership =
  typeof institutionMembershipsTable.$inferSelect;
export type InstitutionApplicationCase =
  typeof institutionApplicationCasesTable.$inferSelect;
export type InstitutionCaseIntakeReceipt =
  typeof institutionCaseIntakeReceiptsTable.$inferSelect;
export type InstitutionEvidenceShareReceipt =
  typeof institutionEvidenceShareReceiptsTable.$inferSelect;
export type InstitutionDecision = typeof institutionDecisionsTable.$inferSelect;
