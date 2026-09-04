import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { applicationsTable } from "./applications";
import { studentsTable } from "./students";
import { usersTable } from "./users";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const portalSubmissionModeEnum = pgEnum("portal_submission_mode", [
  "dry",
  "real",
]);

export const portalSubmissionStatusEnum = pgEnum("portal_submission_status", [
  "queued",
  "running",
  "submitted",
  "already_exists",
  "program_missing",
  "failed",
  "canceled",
  "dry_run",
  "program_full",
  "exclusive_region",
  "accepted",
  "rejected",
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export const portalSubmissionsTable = pgTable(
  "portal_submissions",
  {
    id: serial("id").primaryKey(),

    /** Multi-tenant org ID — matches other tables' pattern. */
    organizationId: integer("organization_id"),

    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),

    /** Nullable: preserved as evidence even if student record is deleted. */
    studentId: integer("student_id").references(() => studentsTable.id, {
      onDelete: "set null",
    }),

    universityKey: text("university_key").notNull(),
    universityName: text("university_name").notNull(),

    /**
     * Adapter key the submission is (or was) routed to at enqueue time
     * (e.g. "topkapi", "sit"). Nullable: historical rows predate the column
     * and are backfilled best-effort from portal_universities. Drives
     * adapter auto-graduation (live COUNT of status='submitted' per key).
     */
    adapterKey: text("adapter_key"),

    mode: portalSubmissionModeEnum("mode").notNull().default("dry"),

    status: portalSubmissionStatusEnum("status").notNull().default("queued"),

    externalRef: text("external_ref"),
    resultJson: jsonb("result_json"),
    screenshotUrls: jsonb("screenshot_urls"),
    error: text("error"),

    /** Free-form metadata (e.g. supersession context, fallback chain). */
    meta: jsonb("meta"),

    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),

    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),

    /** Independent read-only portal status polling lease and retry state. */
    statusCheckAttempts: integer("status_check_attempts").notNull().default(0),
    statusCheckNextAt: timestamp("status_check_next_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    statusCheckLastAt: timestamp("status_check_last_at", { withTimezone: true }),
    statusCheckError: text("status_check_error"),
    statusCheckLockedAt: timestamp("status_check_locked_at", { withTimezone: true }),
    statusCheckLockedBy: text("status_check_locked_by"),
    statusCheckSuspendedAt: timestamp("status_check_suspended_at", {
      withTimezone: true,
    }),

    enqueuedBy: integer("enqueued_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("portal_submissions_id_application_uq").on(
      table.id,
      table.applicationId,
    ),
    index("portal_submissions_application_id_idx").on(table.applicationId),
    index("portal_submissions_status_idx").on(table.status),
    index("portal_submissions_locked_at_idx").on(table.lockedAt),
    // Added: worker poll filter by universityKey
    index("portal_submissions_university_key_idx").on(table.universityKey),
    // Added: worker poll query — multi-tenant status filter
    index("portal_submissions_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    // Added: adapter auto-graduation success COUNT per adapter key
    index("portal_submissions_adapter_key_status_idx").on(
      table.adapterKey,
      table.status,
    ),
    index("portal_submissions_status_check_due_idx")
      .on(table.statusCheckNextAt, table.adapterKey, table.universityKey)
      .where(
        sql`${table.status} = 'submitted' AND ${table.externalRef} IS NOT NULL AND btrim(${table.externalRef}) <> '' AND ${table.adapterKey} IS NOT NULL AND btrim(${table.adapterKey}) <> '' AND ${table.deletedAt} IS NULL AND ${table.statusCheckSuspendedAt} IS NULL`,
      ),
    index("portal_submissions_status_check_lock_idx").on(
      table.statusCheckLockedAt,
    ),
    check(
      "portal_submissions_status_check_attempts_chk",
      sql`${table.statusCheckAttempts} >= 0`,
    ),
    check(
      "portal_submissions_status_check_lock_pair_chk",
      sql`(${table.statusCheckLockedAt} IS NULL) = (${table.statusCheckLockedBy} IS NULL)`,
    ),
    check(
      "portal_submissions_status_check_error_chk",
      sql`${table.statusCheckError} IS NULL OR ${table.statusCheckError} IN ('STATUS_CHECK_UNSUPPORTED', 'STATUS_CHECK_TIMEOUT', 'STATUS_CHECK_AUTHENTICATION', 'STATUS_CHECK_PORTAL_DRIFT', 'STATUS_CHECK_NETWORK', 'STATUS_CHECK_LEASE_LOST', 'STATUS_CHECK_FAILED')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Zod schemas & TS types
// ---------------------------------------------------------------------------
export const insertPortalSubmissionSchema = createInsertSchema(
  portalSubmissionsTable,
  {
    universityKey: z.string().min(1),
    universityName: z.string().min(1),
  },
);

export type PortalSubmission = typeof portalSubmissionsTable.$inferSelect;
export type NewPortalSubmission = typeof portalSubmissionsTable.$inferInsert;
