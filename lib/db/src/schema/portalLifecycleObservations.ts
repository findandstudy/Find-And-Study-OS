import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { applicationsTable } from "./applications";
import { portalSubmissionsTable } from "./portalSubmissions";

export type PortalLifecycleMissingDocument = {
  code?: string;
  label: string;
};

/**
 * Append-only, deduplicated observations returned by an institution portal.
 * The composite FK prevents a status read for one submission from being
 * attached to another application, even if an application id is supplied
 * incorrectly by a caller.
 */
export const portalLifecycleObservationsTable = pgTable(
  "portal_lifecycle_observations",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id").notNull(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    adapterKey: text("adapter_key").notNull(),
    observationHash: text("observation_hash").notNull(),
    rawStatus: text("raw_status").notNull(),
    signal: text("signal").notNull(),
    disposition: text("disposition").notNull(),
    identityVerified: boolean("identity_verified").notNull().default(false),
    identitySource: text("identity_source"),
    missingDocuments: jsonb("missing_documents")
      .$type<PortalLifecycleMissingDocument[]>()
      .notNull()
      .default([]),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.submissionId, table.applicationId],
      foreignColumns: [portalSubmissionsTable.id, portalSubmissionsTable.applicationId],
      name: "portal_lifecycle_observations_submission_application_fk",
    }).onDelete("cascade"),
    uniqueIndex("portal_lifecycle_observations_submission_hash_uq").on(
      table.submissionId,
      table.observationHash,
    ),
    index("portal_lifecycle_observations_observed_idx").on(table.observedAt),
    index("portal_lifecycle_observations_application_observed_idx").on(
      table.applicationId,
      table.observedAt,
    ),
    index("portal_lifecycle_observations_adapter_disposition_idx").on(
      table.adapterKey,
      table.disposition,
      table.observedAt,
    ),
    check(
      "portal_lifecycle_observations_adapter_key_chk",
      sql`length(${table.adapterKey}) BETWEEN 1 AND 100`,
    ),
    check(
      "portal_lifecycle_observations_hash_chk",
      sql`${table.observationHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "portal_lifecycle_observations_raw_status_chk",
      sql`length(${table.rawStatus}) BETWEEN 1 AND 250`,
    ),
    check(
      "portal_lifecycle_observations_signal_chk",
      sql`${table.signal} IN ('submitted', 'missing_document', 'fee_required', 'offer_received', 'deposit_paid', 'acceptance_letter', 'final_acceptance', 'student_card', 'already_registered', 'quota_full', 'waitlisted', 'withdrawn', 'enrolled', 'rejected', 'unknown')`,
    ),
    check(
      "portal_lifecycle_observations_disposition_chk",
      sql`${table.disposition} IN ('SUBMITTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT', 'FEE_REQUIRED', 'CONDITIONAL_OFFER', 'UNCONDITIONAL_OFFER', 'DEPOSIT_RECEIVED', 'WAITLISTED', 'REJECTED', 'FINAL_ACCEPTANCE', 'ENROLLED', 'FULL_QUOTA', 'DUPLICATE', 'ALREADY_REGISTERED', 'WITHDRAWN', 'UNKNOWN')`,
    ),
    check(
      "portal_lifecycle_observations_identity_chk",
      sql`(${table.identityVerified} AND ${table.identitySource} IN ('matched_application_row', 'labeled_portal_field', 'structured_portal_field')) OR (NOT ${table.identityVerified} AND ${table.identitySource} IS NULL)`,
    ),
    check(
      "portal_lifecycle_observations_missing_documents_chk",
      sql`jsonb_typeof(${table.missingDocuments}) = 'array' AND jsonb_array_length(${table.missingDocuments}) <= 50`,
    ),
    check(
      "portal_lifecycle_observations_evidence_chk",
      sql`jsonb_typeof(${table.evidence}) = 'object'`,
    ),
  ],
);

export type PortalLifecycleObservation =
  typeof portalLifecycleObservationsTable.$inferSelect;
export type NewPortalLifecycleObservation =
  typeof portalLifecycleObservationsTable.$inferInsert;
