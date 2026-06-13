import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
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
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export const portalSubmissionsTable = pgTable(
  "portal_submissions",
  {
    id: serial("id").primaryKey(),

    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),

    studentId: integer("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),

    universityKey:  text("university_key").notNull(),
    universityName: text("university_name").notNull(),

    mode: portalSubmissionModeEnum("mode").notNull().default("dry"),

    status: portalSubmissionStatusEnum("status").notNull().default("queued"),

    externalRef:    text("external_ref"),
    resultJson:     jsonb("result_json"),
    screenshotUrls: jsonb("screenshot_urls"),
    error:          text("error"),

    attempts:    integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),

    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),

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
    index("portal_submissions_application_id_idx").on(table.applicationId),
    index("portal_submissions_status_idx").on(table.status),
    index("portal_submissions_locked_at_idx").on(table.lockedAt),
  ],
);
