import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { websitePagesTable } from "./website";

export const websiteTranslationJobsTable = pgTable("website_translation_jobs", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  kind: text("kind").notNull(),
  entityId: integer("entity_id").notNull(),
  locale: text("locale").notNull(),
  status: text("status").notNull().default("queued"),
  provider: text("provider"),
  model: text("model"),
  qualityMode: text("quality_mode").notNull().default("balanced"),
  attempts: integer("attempts").notNull().default(0),
  errorCode: text("error_code"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leasedAt: timestamp("leased_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  workerId: text("worker_id"),
  generatedPageId: integer("generated_page_id").references(() => websitePagesTable.id, { onDelete: "set null" }),
  generatedDigest: text("generated_digest"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("website_translation_jobs_batch_item_uq").on(table.batchId, table.kind, table.entityId, table.locale),
  index("website_translation_jobs_queue_idx").on(table.status, table.nextAttemptAt, table.id),
  index("website_translation_jobs_batch_idx").on(table.batchId, table.status, table.id),
  index("website_translation_jobs_review_idx").on(table.status, table.createdAt),
  index("website_translation_jobs_entity_idx").on(table.kind, table.entityId, table.locale, table.createdAt),
  uniqueIndex("website_translation_jobs_active_entity_uq").on(table.kind, table.entityId, table.locale).where(sql`${table.status} IN ('queued','processing','retrying','review_required','approved','publish_queued','publishing')`),
  check("website_translation_jobs_kind_chk", sql`${table.kind} IN ('destination','city','university','program')`),
  check("website_translation_jobs_locale_chk", sql`${table.locale} IN ('tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it')`),
  check("website_translation_jobs_status_chk", sql`${table.status} IN ('queued','processing','retrying','review_required','approved','publish_queued','publishing','published','rejected','failed','cancelled')`),
  check("website_translation_jobs_quality_chk", sql`${table.qualityMode} IN ('fast','balanced','premium')`),
  check("website_translation_jobs_attempts_chk", sql`${table.attempts} >= 0 AND ${table.attempts} <= 20`),
]);

export type WebsiteTranslationJob = typeof websiteTranslationJobsTable.$inferSelect;
