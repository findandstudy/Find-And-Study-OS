import { sql, type AnyColumn } from "drizzle-orm";
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
import {
  accessDecisionReceiptsTable,
  activeSessionContextSelectionsTable,
  capabilityDefinitionsTable,
  membershipsTable,
  organizationsTable,
  policyVersionsTable,
  tenantOrganizationLegacyBranchesTable,
  tenantsTable,
} from "./authorization";
import { studentsTable } from "./students";
import { usersTable } from "./users";

const uuidV7 = (column: AnyColumn) =>
  sql`substring(${column}::text from 15 for 1) = '7'`;
const sha256 = (column: AnyColumn) => sql`${column} ~ '^[0-9a-f]{64}$'`;

export const journeySubjectsTable = pgTable(
  "journey_subjects",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, {
      onDelete: "restrict",
    }),
    organizationId: uuid("organization_id").notNull(),
    legacyBranchId: integer("legacy_branch_id").notNull(),
    legacyStudentId: integer("legacy_student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "restrict" }),
    legacyUserId: integer("legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    subjectRef: text("subject_ref").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_subjects_tenant_id_id_uq").on(table.tenantId, table.id),
    unique("journey_subjects_tenant_student_uq").on(
      table.tenantId,
      table.legacyStudentId,
    ),
    unique("journey_subjects_tenant_user_uq").on(
      table.tenantId,
      table.legacyUserId,
    ),
    unique("journey_subjects_tenant_ref_uq").on(
      table.tenantId,
      table.subjectRef,
    ),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "journey_subjects_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId, table.legacyBranchId],
      foreignColumns: [
        tenantOrganizationLegacyBranchesTable.tenantId,
        tenantOrganizationLegacyBranchesTable.organizationId,
        tenantOrganizationLegacyBranchesTable.legacyBranchId,
      ],
      name: "journey_subjects_branch_fk",
    }).onDelete("restrict"),
    index("journey_subjects_scope_idx").on(
      table.tenantId,
      table.organizationId,
      table.legacyBranchId,
      table.status,
    ),
    check("journey_subjects_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_subjects_ref_chk",
      sql`${table.subjectRef} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
    check(
      "journey_subjects_state_chk",
      sql`${table.status} IN ('ACTIVE', 'SUSPENDED', 'CLOSED')`,
    ),
    check("journey_subjects_version_chk", sql`${table.version} > 0`),
  ],
).enableRLS();

export const journeyRequirementSetsTable = pgTable(
  "journey_requirement_sets",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, {
      onDelete: "restrict",
    }),
    organizationId: uuid("organization_id").notNull(),
    legacyBranchId: integer("legacy_branch_id").notNull(),
    corridorCode: text("corridor_code").notNull(),
    versionNumber: bigint("version_number", { mode: "number" }).notNull(),
    authoritySource: text("authority_source").notNull(),
    authoritySourceHash: text("authority_source_hash").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    setHash: text("set_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_requirement_sets_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_requirement_sets_version_uq").on(
      table.tenantId,
      table.corridorCode,
      table.versionNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "journey_requirement_sets_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId, table.legacyBranchId],
      foreignColumns: [
        tenantOrganizationLegacyBranchesTable.tenantId,
        tenantOrganizationLegacyBranchesTable.organizationId,
        tenantOrganizationLegacyBranchesTable.legacyBranchId,
      ],
      name: "journey_requirement_sets_branch_fk",
    }).onDelete("restrict"),
    check("journey_requirement_sets_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_requirement_sets_version_chk",
      sql`${table.versionNumber} > 0`,
    ),
    check(
      "journey_requirement_sets_hash_chk",
      sql`${sha256(table.authoritySourceHash)} AND ${sha256(table.setHash)}`,
    ),
  ],
).enableRLS();

export const journeyRequirementItemsTable = pgTable(
  "journey_requirement_items",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    requirementSetId: uuid("requirement_set_id").notNull(),
    requirementCode: text("requirement_code").notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    mandatory: boolean("mandatory").notNull().default(true),
    ordinal: integer("ordinal").notNull(),
    itemHash: text("item_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_requirement_items_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_requirement_items_code_uq").on(
      table.tenantId,
      table.requirementSetId,
      table.requirementCode,
    ),
    unique("journey_requirement_items_ordinal_uq").on(
      table.tenantId,
      table.requirementSetId,
      table.ordinal,
    ),
    foreignKey({
      columns: [table.tenantId, table.requirementSetId],
      foreignColumns: [
        journeyRequirementSetsTable.tenantId,
        journeyRequirementSetsTable.id,
      ],
      name: "journey_requirement_items_set_fk",
    }).onDelete("restrict"),
    check("journey_requirement_items_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_requirement_items_ordinal_chk",
      sql`${table.ordinal} > 0 AND ${table.ordinal} <= 250`,
    ),
    check("journey_requirement_items_hash_chk", sha256(table.itemHash)),
  ],
).enableRLS();

export const journeyDossiersTable = pgTable(
  "journey_dossiers",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_dossiers_tenant_id_id_uq").on(table.tenantId, table.id),
    unique("journey_dossiers_subject_uq").on(table.tenantId, table.subjectId),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_dossiers_subject_fk",
    }).onDelete("restrict"),
    check("journey_dossiers_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_dossiers_status_chk",
      sql`${table.status} IN ('ACTIVE', 'CLOSED')`,
    ),
    check("journey_dossiers_version_chk", sql`${table.version} > 0`),
  ],
).enableRLS();

export const journeyDossierRevisionsTable = pgTable(
  "journey_dossier_revisions",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    dossierId: uuid("dossier_id").notNull(),
    requirementSetId: uuid("requirement_set_id").notNull(),
    revisionNumber: bigint("revision_number", { mode: "number" }).notNull(),
    revisionState: text("revision_state").notNull(),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    revisionHash: text("revision_hash").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("journey_dossier_revisions_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_dossier_revisions_dossier_uq").on(
      table.tenantId,
      table.id,
      table.dossierId,
    ),
    unique("journey_dossier_revisions_binding_uq").on(
      table.tenantId,
      table.id,
      table.dossierId,
      table.requirementSetId,
    ),
    unique("journey_dossier_revisions_number_uq").on(
      table.tenantId,
      table.dossierId,
      table.revisionNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.dossierId],
      foreignColumns: [journeyDossiersTable.tenantId, journeyDossiersTable.id],
      name: "journey_dossier_revisions_dossier_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.requirementSetId],
      foreignColumns: [
        journeyRequirementSetsTable.tenantId,
        journeyRequirementSetsTable.id,
      ],
      name: "journey_dossier_revisions_set_fk",
    }).onDelete("restrict"),
    check("journey_dossier_revisions_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_dossier_revisions_state_chk",
      sql`${table.revisionState} IN ('DRAFT', 'VERIFIED')`,
    ),
    check("journey_dossier_revisions_number_chk", sql`${table.revisionNumber} > 0`),
  ],
).enableRLS();

export const journeyApplicationCasesTable = pgTable(
  "journey_application_cases",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    legacyBranchId: integer("legacy_branch_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    dossierId: uuid("dossier_id").notNull(),
    legacyApplicationId: integer("legacy_application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "restrict" }),
    corridorCode: text("corridor_code").notNull(),
    lifecycleState: text("lifecycle_state")
      .notNull()
      .default("DOSSIER_PREPARATION"),
    activeDossierRevisionId: uuid("active_dossier_revision_id"),
    ownerMembershipId: uuid("owner_membership_id"),
    ownerLegacyUserId: integer("owner_legacy_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    nextAction: text("next_action"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    aggregateVersion: bigint("aggregate_version", { mode: "number" })
      .notNull()
      .default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_application_cases_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_application_cases_subject_binding_uq").on(
      table.tenantId,
      table.id,
      table.subjectId,
    ),
    unique("journey_application_cases_legacy_uq").on(
      table.tenantId,
      table.legacyApplicationId,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_application_cases_subject_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.dossierId],
      foreignColumns: [journeyDossiersTable.tenantId, journeyDossiersTable.id],
      name: "journey_application_cases_dossier_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [
        table.tenantId,
        table.activeDossierRevisionId,
        table.dossierId,
      ],
      foreignColumns: [
        journeyDossierRevisionsTable.tenantId,
        journeyDossierRevisionsTable.id,
        journeyDossierRevisionsTable.dossierId,
      ],
      name: "journey_application_cases_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "journey_application_cases_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId, table.legacyBranchId],
      foreignColumns: [
        tenantOrganizationLegacyBranchesTable.tenantId,
        tenantOrganizationLegacyBranchesTable.organizationId,
        tenantOrganizationLegacyBranchesTable.legacyBranchId,
      ],
      name: "journey_application_cases_branch_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.ownerMembershipId],
      foreignColumns: [membershipsTable.tenantId, membershipsTable.id],
      name: "journey_application_cases_owner_fk",
    }).onDelete("restrict"),
    index("journey_application_cases_scope_idx").on(
      table.tenantId,
      table.organizationId,
      table.legacyBranchId,
      table.lifecycleState,
    ),
    check("journey_application_cases_id_v7_chk", uuidV7(table.id)),
    check("journey_application_cases_version_chk", sql`${table.aggregateVersion} > 0`),
  ],
).enableRLS();

export const journeyRequirementResultsTable = pgTable(
  "journey_requirement_results",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    dossierRevisionId: uuid("dossier_revision_id").notNull(),
    dossierId: uuid("dossier_id").notNull(),
    requirementSetId: uuid("requirement_set_id").notNull(),
    requirementCode: text("requirement_code").notNull(),
    resultState: text("result_state").notNull(),
    evidenceReceiptId: uuid("evidence_receipt_id"),
    resultHash: text("result_hash").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("journey_requirement_results_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_requirement_results_code_uq").on(
      table.tenantId,
      table.dossierRevisionId,
      table.requirementCode,
    ),
    foreignKey({
      columns: [
        table.tenantId,
        table.dossierRevisionId,
        table.dossierId,
        table.requirementSetId,
      ],
      foreignColumns: [
        journeyDossierRevisionsTable.tenantId,
        journeyDossierRevisionsTable.id,
        journeyDossierRevisionsTable.dossierId,
        journeyDossierRevisionsTable.requirementSetId,
      ],
      name: "journey_requirement_results_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.requirementSetId, table.requirementCode],
      foreignColumns: [
        journeyRequirementItemsTable.tenantId,
        journeyRequirementItemsTable.requirementSetId,
        journeyRequirementItemsTable.requirementCode,
      ],
      name: "journey_requirement_results_item_fk",
    }).onDelete("restrict"),
    check("journey_requirement_results_id_v7_chk", uuidV7(table.id)),
    check("journey_requirement_results_hash_chk", sha256(table.resultHash)),
  ],
).enableRLS();

export const journeyVerifiedEvidenceReceiptsTable = pgTable(
  "journey_verified_evidence_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    applicationCaseId: uuid("application_case_id"),
    dossierRevisionId: uuid("dossier_revision_id").notNull(),
    dossierId: uuid("dossier_id").notNull(),
    requirementSetId: uuid("requirement_set_id").notNull(),
    requirementCode: text("requirement_code").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    contentSha256: text("content_sha256").notNull(),
    verificationPolicyVersion: text("verification_policy_version").notNull(),
    verifierPrincipalId: uuid("verifier_principal_id").notNull(),
    verifierMembershipId: uuid("verifier_membership_id").notNull(),
    accessDecisionReceiptId: uuid("access_decision_receipt_id").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receiptHash: text("receipt_hash").notNull(),
  },
  (table) => [
    unique("journey_verified_evidence_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_verified_evidence_hash_uq").on(
      table.tenantId,
      table.receiptHash,
    ),
    unique("journey_verified_evidence_ref_uq").on(
      table.tenantId,
      table.evidenceRef,
      table.contentSha256,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_verified_evidence_subject_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.applicationCaseId, table.subjectId],
      foreignColumns: [
        journeyApplicationCasesTable.tenantId,
        journeyApplicationCasesTable.id,
        journeyApplicationCasesTable.subjectId,
      ],
      name: "journey_verified_evidence_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [
        table.tenantId,
        table.dossierRevisionId,
        table.dossierId,
        table.requirementSetId,
      ],
      foreignColumns: [
        journeyDossierRevisionsTable.tenantId,
        journeyDossierRevisionsTable.id,
        journeyDossierRevisionsTable.dossierId,
        journeyDossierRevisionsTable.requirementSetId,
      ],
      name: "journey_verified_evidence_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.verifierMembershipId, table.verifierPrincipalId],
      foreignColumns: [
        membershipsTable.tenantId,
        membershipsTable.id,
        membershipsTable.principalId,
      ],
      name: "journey_verified_evidence_actor_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.accessDecisionReceiptId],
      foreignColumns: [
        accessDecisionReceiptsTable.tenantId,
        accessDecisionReceiptsTable.id,
      ],
      name: "journey_verified_evidence_access_fk",
    }).onDelete("restrict"),
    check("journey_verified_evidence_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_verified_evidence_hash_chk",
      sql`${sha256(table.contentSha256)} AND ${sha256(table.receiptHash)}`,
    ),
  ],
).enableRLS();

export const journeyConsentReceiptsTable = pgTable(
  "journey_consent_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    purpose: text("purpose").notNull(),
    lawfulBasis: text("lawful_basis").notNull(),
    channel: text("channel").notNull(),
    locale: text("locale").notNull(),
    noticeVersion: text("notice_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    retentionPolicyVersion: text("retention_policy_version").notNull(),
    action: text("action").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    previousReceiptHash: text("previous_receipt_hash"),
    evidenceRef: text("evidence_ref").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    receiptHash: text("receipt_hash").notNull(),
  },
  (table) => [
    unique("journey_consent_receipts_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_consent_receipts_sequence_uq").on(
      table.tenantId,
      table.subjectId,
      table.purpose,
      table.channel,
      table.sequence,
    ),
    unique("journey_consent_receipts_hash_uq").on(
      table.tenantId,
      table.receiptHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_consent_receipts_subject_fk",
    }).onDelete("restrict"),
    check("journey_consent_receipts_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_consent_receipts_action_chk",
      sql`${table.action} IN ('CAPTURED', 'WITHDRAWN')`,
    ),
    check(
      "journey_consent_receipts_channel_chk",
      sql`${table.channel} IN ('in_app', 'email')`,
    ),
    check("journey_consent_receipts_sequence_chk", sql`${table.sequence} > 0`),
    check(
      "journey_consent_receipts_hash_chk",
      sql`${sha256(table.evidenceSha256)} AND ${sha256(table.receiptHash)}`,
    ),
  ],
).enableRLS();

export const journeyCommunicationPreferenceReceiptsTable = pgTable(
  "journey_communication_preference_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    preferenceState: text("preference_state").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    policyVersion: text("policy_version").notNull(),
    previousReceiptHash: text("previous_receipt_hash"),
    evidenceRef: text("evidence_ref").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    receiptHash: text("receipt_hash").notNull(),
  },
  (table) => [
    unique("journey_comm_preferences_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_comm_preferences_sequence_uq").on(
      table.tenantId,
      table.subjectId,
      table.category,
      table.channel,
      table.sequence,
    ),
    unique("journey_comm_preferences_hash_uq").on(
      table.tenantId,
      table.receiptHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_comm_preferences_subject_fk",
    }).onDelete("restrict"),
    check("journey_comm_preferences_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_comm_preferences_category_chk",
      sql`${table.category} IN ('ACTION_REQUIRED', 'DEADLINE')`,
    ),
    check(
      "journey_comm_preferences_channel_chk",
      sql`${table.channel} IN ('in_app', 'email')`,
    ),
    check(
      "journey_comm_preferences_state_chk",
      sql`${table.preferenceState} IN ('ENABLED', 'DISABLED')`,
    ),
  ],
).enableRLS();

export const journeyCommunicationSuppressionReceiptsTable = pgTable(
  "journey_communication_suppression_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    channel: text("channel").notNull(),
    reason: text("reason").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    retentionPolicyVersion: text("retention_policy_version").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    receiptHash: text("receipt_hash").notNull(),
  },
  (table) => [
    unique("journey_comm_suppressions_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_comm_suppressions_hash_uq").on(
      table.tenantId,
      table.receiptHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_comm_suppressions_subject_fk",
    }).onDelete("restrict"),
    check("journey_comm_suppressions_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_comm_suppressions_channel_chk",
      sql`${table.channel} = 'email'`,
    ),
    check(
      "journey_comm_suppressions_reason_chk",
      sql`${table.reason} IN ('UNSUBSCRIBE', 'COMPLAINT', 'HARD_BOUNCE')`,
    ),
  ],
).enableRLS();

export const journeyNotificationIntentsTable = pgTable(
  "journey_notification_intents",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    taskStateRef: text("task_state_ref").notNull(),
    purpose: text("purpose").notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    locale: text("locale").notNull(),
    intendedAt: timestamp("intended_at", { withTimezone: true }).notNull(),
    dedupKey: text("dedup_key").notNull(),
    policyVersion: text("policy_version").notNull(),
    status: text("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_notification_intents_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_notification_intents_dedup_uq").on(
      table.tenantId,
      table.dedupKey,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_notification_intents_subject_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.applicationCaseId, table.subjectId],
      foreignColumns: [
        journeyApplicationCasesTable.tenantId,
        journeyApplicationCasesTable.id,
        journeyApplicationCasesTable.subjectId,
      ],
      name: "journey_notification_intents_case_fk",
    }).onDelete("restrict"),
    check("journey_notification_intents_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_notification_intents_category_chk",
      sql`${table.category} IN ('ACTION_REQUIRED', 'DEADLINE')`,
    ),
    check(
      "journey_notification_intents_channel_chk",
      sql`${table.channel} IN ('in_app', 'email')`,
    ),
    check(
      "journey_notification_intents_default_off_chk",
      sql`${table.status} <> 'READY' OR ${table.channel} = 'in_app'`,
    ),
    check("journey_notification_intents_dedup_chk", sha256(table.dedupKey)),
  ],
).enableRLS();

export const journeyCommunicationDecisionReceiptsTable = pgTable(
  "journey_communication_decision_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    notificationIntentId: uuid("notification_intent_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    activeConsentReceiptHash: text("active_consent_receipt_hash"),
    activePreferenceReceiptHash: text("active_preference_receipt_hash"),
    matchedSuppressionReceiptHash: text("matched_suppression_receipt_hash"),
    quietHoursPolicyVersion: text("quiet_hours_policy_version").notNull(),
    frequencyPolicyVersion: text("frequency_policy_version").notNull(),
    dedupPolicyVersion: text("dedup_policy_version").notNull(),
    stateInputHash: text("state_input_hash").notNull(),
    decisionHash: text("decision_hash").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("journey_comm_decisions_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_comm_decisions_intent_uq").on(
      table.tenantId,
      table.notificationIntentId,
    ),
    unique("journey_comm_decisions_hash_uq").on(
      table.tenantId,
      table.decisionHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.notificationIntentId],
      foreignColumns: [
        journeyNotificationIntentsTable.tenantId,
        journeyNotificationIntentsTable.id,
      ],
      name: "journey_comm_decisions_intent_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_comm_decisions_subject_fk",
    }).onDelete("restrict"),
    check("journey_comm_decisions_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_comm_decisions_decision_chk",
      sql`${table.decision} IN ('ALLOW', 'DENY')`,
    ),
    check(
      "journey_comm_decisions_hash_chk",
      sql`${sha256(table.stateInputHash)} AND ${sha256(table.decisionHash)}`,
    ),
  ],
).enableRLS();

export const journeyDocumentRequestsTable = pgTable(
  "journey_document_requests",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    requirementCode: text("requirement_code").notNull(),
    state: text("state").notNull().default("OPEN"),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    requestedByPrincipalId: uuid("requested_by_principal_id").notNull(),
    requestedByMembershipId: uuid("requested_by_membership_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_document_requests_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_document_requests_scope_uq").on(
      table.tenantId,
      table.id,
      table.subjectId,
      table.applicationCaseId,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [journeySubjectsTable.tenantId, journeySubjectsTable.id],
      name: "journey_document_requests_subject_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.applicationCaseId, table.subjectId],
      foreignColumns: [
        journeyApplicationCasesTable.tenantId,
        journeyApplicationCasesTable.id,
        journeyApplicationCasesTable.subjectId,
      ],
      name: "journey_document_requests_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [
        table.tenantId,
        table.requestedByMembershipId,
        table.requestedByPrincipalId,
      ],
      foreignColumns: [
        membershipsTable.tenantId,
        membershipsTable.id,
        membershipsTable.principalId,
      ],
      name: "journey_document_requests_actor_fk",
    }).onDelete("restrict"),
    index("journey_document_requests_action_idx").on(
      table.tenantId,
      table.subjectId,
      table.state,
      table.dueAt,
    ),
    check("journey_document_requests_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_document_requests_state_chk",
      sql`${table.state} IN ('OPEN', 'RESPONDED', 'FULFILLED', 'CANCELLED')`,
    ),
    check("journey_document_requests_version_chk", sql`${table.version} > 0`),
  ],
).enableRLS();

export const journeyDocumentIngestReceiptsTable = pgTable(
  "journey_document_ingest_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    documentRequestId: uuid("document_request_id").notNull(),
    objectRef: text("object_ref").notNull(),
    contentSha256: text("content_sha256").notNull(),
    scanStatus: text("scan_status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receiptHash: text("receipt_hash").notNull(),
  },
  (table) => [
    unique("journey_document_ingest_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_document_ingest_hash_uq").on(
      table.tenantId,
      table.receiptHash,
    ),
    foreignKey({
      columns: [
        table.tenantId,
        table.documentRequestId,
        table.subjectId,
        table.applicationCaseId,
      ],
      foreignColumns: [
        journeyDocumentRequestsTable.tenantId,
        journeyDocumentRequestsTable.id,
        journeyDocumentRequestsTable.subjectId,
        journeyDocumentRequestsTable.applicationCaseId,
      ],
      name: "journey_document_ingest_request_fk",
    }).onDelete("restrict"),
    check("journey_document_ingest_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_document_ingest_status_chk",
      sql`${table.scanStatus} IN ('QUARANTINED', 'SCANNING', 'PASSED')`,
    ),
    check(
      "journey_document_ingest_hash_chk",
      sql`${sha256(table.contentSha256)} AND ${sha256(table.receiptHash)}`,
    ),
  ],
).enableRLS();

export const journeyDocumentAccessReceiptsTable = pgTable(
  "journey_document_access_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    documentRequestId: uuid("document_request_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    contextId: uuid("context_id").notNull(),
    selectionId: uuid("selection_id").notNull(),
    sessionGeneration: bigint("session_generation", { mode: "number" }).notNull(),
    actorPrincipalId: uuid("actor_principal_id").notNull(),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    policyVersionId: uuid("policy_version_id").notNull(),
    capabilityKey: text("capability_key")
      .notNull()
      .references(() => capabilityDefinitionsTable.key, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    correlationId: text("correlation_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("journey_document_access_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    foreignKey({
      columns: [
        table.tenantId,
        table.documentRequestId,
        table.subjectId,
        table.applicationCaseId,
      ],
      foreignColumns: [
        journeyDocumentRequestsTable.tenantId,
        journeyDocumentRequestsTable.id,
        journeyDocumentRequestsTable.subjectId,
        journeyDocumentRequestsTable.applicationCaseId,
      ],
      name: "journey_document_access_request_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId, table.actorPrincipalId],
      foreignColumns: [
        membershipsTable.tenantId,
        membershipsTable.id,
        membershipsTable.principalId,
      ],
      name: "journey_document_access_actor_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.policyVersionId],
      foreignColumns: [policyVersionsTable.tenantId, policyVersionsTable.id],
      name: "journey_document_access_policy_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.selectionId],
      foreignColumns: [
        activeSessionContextSelectionsTable.tenantId,
        activeSessionContextSelectionsTable.id,
      ],
      name: "journey_document_access_selection_fk",
    }).onDelete("restrict"),
    check("journey_document_access_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_document_access_capability_chk",
      sql`${table.capabilityKey} = 'student.document_request.respond'`,
    ),
    check("journey_document_access_decision_chk", sql`${table.decision} = 'ALLOW'`),
  ],
).enableRLS();

export const journeyDocumentResponseReceiptsTable = pgTable(
  "journey_document_response_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    documentRequestId: uuid("document_request_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    commandId: uuid("command_id").notNull(),
    accessDecisionReceiptId: uuid("access_decision_receipt_id").notNull(),
    actorPrincipalId: uuid("actor_principal_id").notNull(),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    contextId: uuid("context_id").notNull(),
    selectionId: uuid("selection_id").notNull(),
    sessionGeneration: bigint("session_generation", { mode: "number" }).notNull(),
    policyVersionId: uuid("policy_version_id").notNull(),
    responseKind: text("response_kind").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    previousVersion: bigint("previous_version", { mode: "number" }).notNull(),
    nextVersion: bigint("next_version", { mode: "number" }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ingestReceiptId: uuid("ingest_receipt_id"),
    ingestReceiptHash: text("ingest_receipt_hash"),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    commandHash: text("command_hash").notNull(),
    auditCorrelationId: text("audit_correlation_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receiptHash: text("receipt_hash").notNull(),
    receiptPayload: jsonb("receipt_payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    unique("journey_document_responses_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_document_responses_command_uq").on(
      table.tenantId,
      table.commandId,
    ),
    unique("journey_document_responses_hash_uq").on(
      table.tenantId,
      table.receiptHash,
    ),
    unique("journey_document_responses_idempotency_uq").on(
      table.tenantId,
      table.idempotencyKeyHash,
    ),
    foreignKey({
      columns: [
        table.tenantId,
        table.documentRequestId,
        table.subjectId,
        table.applicationCaseId,
      ],
      foreignColumns: [
        journeyDocumentRequestsTable.tenantId,
        journeyDocumentRequestsTable.id,
        journeyDocumentRequestsTable.subjectId,
        journeyDocumentRequestsTable.applicationCaseId,
      ],
      name: "journey_document_responses_request_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.accessDecisionReceiptId],
      foreignColumns: [
        journeyDocumentAccessReceiptsTable.tenantId,
        journeyDocumentAccessReceiptsTable.id,
      ],
      name: "journey_document_responses_access_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.ingestReceiptId],
      foreignColumns: [
        journeyDocumentIngestReceiptsTable.tenantId,
        journeyDocumentIngestReceiptsTable.id,
      ],
      name: "journey_document_responses_ingest_fk",
    }).onDelete("restrict"),
    check("journey_document_responses_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_document_responses_kind_chk",
      sql`${table.responseKind} IN ('ACKNOWLEDGE', 'EVIDENCE_SUBMITTED')`,
    ),
    check(
      "journey_document_responses_version_chk",
      sql`${table.previousVersion} > 0 AND ${table.nextVersion} = ${table.previousVersion} + 1`,
    ),
    check(
      "journey_document_responses_hash_chk",
      sql`${sha256(table.idempotencyKeyHash)} AND ${sha256(table.commandHash)} AND ${sha256(table.receiptHash)}`,
    ),
  ],
).enableRLS();

export const journeyDocumentResponseAuditsTable = pgTable(
  "journey_document_response_audits",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    commandReceiptId: uuid("command_receipt_id").notNull(),
    accessDecisionReceiptId: uuid("access_decision_receipt_id").notNull(),
    actorPrincipalId: uuid("actor_principal_id").notNull(),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    contextId: uuid("context_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    documentRequestId: uuid("document_request_id").notNull(),
    responseKind: text("response_kind").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    previousVersion: bigint("previous_version", { mode: "number" }).notNull(),
    nextVersion: bigint("next_version", { mode: "number" }).notNull(),
    ingestReceiptId: uuid("ingest_receipt_id"),
    correlationId: text("correlation_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    auditHash: text("audit_hash").notNull(),
    auditPayload: jsonb("audit_payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    unique("journey_document_audits_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_document_audits_receipt_uq").on(
      table.tenantId,
      table.commandReceiptId,
    ),
    unique("journey_document_audits_hash_uq").on(
      table.tenantId,
      table.auditHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.commandReceiptId],
      foreignColumns: [
        journeyDocumentResponseReceiptsTable.tenantId,
        journeyDocumentResponseReceiptsTable.id,
      ],
      name: "journey_document_audits_receipt_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.accessDecisionReceiptId],
      foreignColumns: [
        journeyDocumentAccessReceiptsTable.tenantId,
        journeyDocumentAccessReceiptsTable.id,
      ],
      name: "journey_document_audits_access_fk",
    }).onDelete("restrict"),
    check("journey_document_audits_id_v7_chk", uuidV7(table.id)),
    check("journey_document_audits_hash_chk", sha256(table.auditHash)),
  ],
).enableRLS();

export const journeyDocumentIngestConsumptionsTable = pgTable(
  "journey_document_ingest_consumptions",
  {
    tenantId: uuid("tenant_id").notNull(),
    ingestReceiptId: uuid("ingest_receipt_id").notNull(),
    commandReceiptId: uuid("command_receipt_id").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.ingestReceiptId] }),
    unique("journey_document_consumptions_command_uq").on(
      table.tenantId,
      table.commandReceiptId,
    ),
    foreignKey({
      columns: [table.tenantId, table.ingestReceiptId],
      foreignColumns: [
        journeyDocumentIngestReceiptsTable.tenantId,
        journeyDocumentIngestReceiptsTable.id,
      ],
      name: "journey_document_consumptions_ingest_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.commandReceiptId],
      foreignColumns: [
        journeyDocumentResponseReceiptsTable.tenantId,
        journeyDocumentResponseReceiptsTable.id,
      ],
      name: "journey_document_consumptions_response_fk",
    }).onDelete("restrict"),
  ],
).enableRLS();

export const journeyDocumentResponseCommandsTable = pgTable(
  "journey_document_response_commands",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, {
      onDelete: "restrict",
    }),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    commandHash: text("command_hash").notNull(),
    status: text("status").notNull().default("CLAIMED"),
    responseReceiptId: uuid("response_receipt_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.idempotencyKeyHash] }),
    unique("journey_document_commands_receipt_uq").on(
      table.tenantId,
      table.responseReceiptId,
    ),
    foreignKey({
      columns: [table.tenantId, table.responseReceiptId],
      foreignColumns: [
        journeyDocumentResponseReceiptsTable.tenantId,
        journeyDocumentResponseReceiptsTable.id,
      ],
      name: "journey_document_commands_receipt_fk",
    }).onDelete("restrict"),
    check(
      "journey_document_commands_hash_chk",
      sql`${sha256(table.idempotencyKeyHash)} AND ${sha256(table.commandHash)}`,
    ),
    check(
      "journey_document_commands_status_chk",
      sql`(${table.status} = 'CLAIMED' AND ${table.responseReceiptId} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'COMMITTED' AND ${table.responseReceiptId} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
).enableRLS();

export const journeyStateTransitionReceiptsTable = pgTable(
  "journey_state_transition_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    actorPrincipalId: uuid("actor_principal_id").notNull(),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    previousVersion: bigint("previous_version", { mode: "number" }).notNull(),
    nextVersion: bigint("next_version", { mode: "number" }).notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    policyVersion: text("policy_version").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receiptHash: text("receipt_hash").notNull(),
  },
  (table) => [
    unique("journey_state_transitions_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_state_transitions_version_uq").on(
      table.tenantId,
      table.applicationCaseId,
      table.nextVersion,
    ),
    unique("journey_state_transitions_hash_uq").on(
      table.tenantId,
      table.receiptHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.applicationCaseId],
      foreignColumns: [
        journeyApplicationCasesTable.tenantId,
        journeyApplicationCasesTable.id,
      ],
      name: "journey_state_transitions_case_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId, table.actorPrincipalId],
      foreignColumns: [
        membershipsTable.tenantId,
        membershipsTable.id,
        membershipsTable.principalId,
      ],
      name: "journey_state_transitions_actor_fk",
    }).onDelete("restrict"),
    check("journey_state_transitions_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_state_transitions_version_chk",
      sql`${table.previousVersion} > 0 AND ${table.nextVersion} = ${table.previousVersion} + 1`,
    ),
    check(
      "journey_state_transitions_hash_chk",
      sql`${sha256(table.evidenceSha256)} AND ${sha256(table.receiptHash)}`,
    ),
  ],
).enableRLS();

export const journeyMilestoneEventsTable = pgTable(
  "journey_milestone_events",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    aggregateVersion: bigint("aggregate_version", { mode: "number" }).notNull(),
    lifecycleRef: text("lifecycle_ref").notNull(),
    milestoneCode: text("milestone_code").notNull(),
    ownerLegacyUserId: integer("owner_legacy_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    nextAction: text("next_action"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    onTime: boolean("on_time").notNull(),
    verificationKind: text("verification_kind").notNull(),
    qualityFactorBps: integer("quality_factor_bps").notNull(),
    qualityPolicyVersion: text("quality_policy_version").notNull(),
    qualityInputHash: text("quality_input_hash").notNull(),
    dedupKey: text("dedup_key").notNull(),
    eventHash: text("event_hash").notNull(),
  },
  (table) => [
    unique("journey_milestones_tenant_id_id_uq").on(table.tenantId, table.id),
    unique("journey_milestones_dedup_uq").on(table.tenantId, table.dedupKey),
    unique("journey_milestones_hash_uq").on(table.tenantId, table.eventHash),
    unique("journey_milestones_case_version_uq").on(
      table.tenantId,
      table.applicationCaseId,
      table.aggregateVersion,
      table.milestoneCode,
    ),
    foreignKey({
      columns: [table.tenantId, table.applicationCaseId, table.subjectId],
      foreignColumns: [
        journeyApplicationCasesTable.tenantId,
        journeyApplicationCasesTable.id,
        journeyApplicationCasesTable.subjectId,
      ],
      name: "journey_milestones_case_fk",
    }).onDelete("restrict"),
    index("journey_milestones_period_idx").on(
      table.tenantId,
      table.completedAt,
      table.milestoneCode,
    ),
    check("journey_milestones_id_v7_chk", uuidV7(table.id)),
    check("journey_milestones_version_chk", sql`${table.aggregateVersion} > 1`),
    check(
      "journey_milestones_quality_chk",
      sql`${table.qualityFactorBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "journey_milestones_hash_chk",
      sql`${sha256(table.qualityInputHash)} AND ${sha256(table.dedupKey)} AND ${sha256(table.eventHash)}`,
    ),
  ],
).enableRLS();

export const journeyMilestoneEvidenceTable = pgTable(
  "journey_milestone_evidence",
  {
    tenantId: uuid("tenant_id").notNull(),
    milestoneEventId: uuid("milestone_event_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.milestoneEventId, table.ordinal],
    }),
    unique("journey_milestone_evidence_ref_uq").on(
      table.tenantId,
      table.milestoneEventId,
      table.evidenceKind,
      table.evidenceRef,
    ),
    foreignKey({
      columns: [table.tenantId, table.milestoneEventId],
      foreignColumns: [
        journeyMilestoneEventsTable.tenantId,
        journeyMilestoneEventsTable.id,
      ],
      name: "journey_milestone_evidence_event_fk",
    }).onDelete("restrict"),
    check(
      "journey_milestone_evidence_ordinal_chk",
      sql`${table.ordinal} BETWEEN 1 AND 20`,
    ),
    check("journey_milestone_evidence_hash_chk", sha256(table.evidenceSha256)),
  ],
).enableRLS();

export const journeyQavjpSnapshotsTable = pgTable(
  "journey_qavjp_snapshots",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, {
      onDelete: "restrict",
    }),
    cohortRef: text("cohort_ref").notNull(),
    periodStartsAt: timestamp("period_starts_at", { withTimezone: true }).notNull(),
    periodEndsAt: timestamp("period_ends_at", { withTimezone: true }).notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
    eligibilityPolicyVersion: text("eligibility_policy_version").notNull(),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    sourceRecordCount: integer("source_record_count").notNull(),
    excludedRecordCount: integer("excluded_record_count").notNull(),
    eligibleItemCount: integer("eligible_item_count").notNull(),
    denominatorWeightBps: bigint("denominator_weight_bps", { mode: "number" }).notNull(),
    ownerCoverageBps: integer("owner_coverage_bps").notNull(),
    nextActionCoverageBps: integer("next_action_coverage_bps").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
  },
  (table) => [
    unique("journey_qavjp_snapshots_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("journey_qavjp_snapshots_cohort_uq").on(
      table.tenantId,
      table.cohortRef,
      table.periodStartsAt,
      table.periodEndsAt,
    ),
    unique("journey_qavjp_snapshots_hash_uq").on(
      table.tenantId,
      table.snapshotHash,
    ),
    check("journey_qavjp_snapshots_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_qavjp_snapshots_hash_chk",
      sql`${sha256(table.sourceSnapshotHash)} AND ${sha256(table.snapshotHash)}`,
    ),
  ],
).enableRLS();

export const journeyQavjpItemsTable = pgTable(
  "journey_qavjp_items",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    applicationCaseId: uuid("application_case_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    lifecycleRef: text("lifecycle_ref").notNull(),
    milestoneCode: text("milestone_code").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    ownerLegacyUserId: integer("owner_legacy_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    nextAction: text("next_action"),
    weightBps: integer("weight_bps").notNull(),
    consentEvidenceKind: text("consent_evidence_kind").notNull(),
    consentEvidenceRef: text("consent_evidence_ref").notNull(),
    consentEvidenceSha256: text("consent_evidence_sha256").notNull(),
    dedupKey: text("dedup_key").notNull(),
  },
  (table) => [
    unique("journey_qavjp_items_tenant_id_id_uq").on(table.tenantId, table.id),
    unique("journey_qavjp_items_dedup_uq").on(
      table.tenantId,
      table.snapshotId,
      table.dedupKey,
    ),
    foreignKey({
      columns: [table.tenantId, table.snapshotId],
      foreignColumns: [
        journeyQavjpSnapshotsTable.tenantId,
        journeyQavjpSnapshotsTable.id,
      ],
      name: "journey_qavjp_items_snapshot_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.applicationCaseId, table.subjectId],
      foreignColumns: [
        journeyApplicationCasesTable.tenantId,
        journeyApplicationCasesTable.id,
        journeyApplicationCasesTable.subjectId,
      ],
      name: "journey_qavjp_items_case_fk",
    }).onDelete("restrict"),
    check("journey_qavjp_items_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_qavjp_items_weight_chk",
      sql`${table.weightBps} BETWEEN 1 AND 10000`,
    ),
    check(
      "journey_qavjp_items_consent_kind_chk",
      sql`${table.consentEvidenceKind} = 'VERIFIED_EVIDENCE'`,
    ),
    check(
      "journey_qavjp_items_hash_chk",
      sql`${sha256(table.consentEvidenceSha256)} AND ${sha256(table.dedupKey)}`,
    ),
  ],
).enableRLS();

export const journeyOutboxEventsTable = pgTable(
  "journey_outbox_events",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, {
      onDelete: "restrict",
    }),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    dedupKey: text("dedup_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    unique("journey_outbox_tenant_id_id_uq").on(table.tenantId, table.id),
    unique("journey_outbox_dedup_uq").on(
      table.tenantId,
      table.eventType,
      table.dedupKey,
    ),
    uniqueIndex("journey_outbox_pending_idx")
      .on(table.tenantId, table.status, table.availableAt)
      .where(sql`${table.status} = 'PENDING'`),
    check("journey_outbox_id_v7_chk", uuidV7(table.id)),
    check(
      "journey_outbox_hash_chk",
      sql`${sha256(table.dedupKey)} AND ${sha256(table.payloadHash)}`,
    ),
    check(
      "journey_outbox_status_chk",
      sql`${table.status} IN ('PENDING', 'PUBLISHED', 'FAILED')`,
    ),
  ],
).enableRLS();
