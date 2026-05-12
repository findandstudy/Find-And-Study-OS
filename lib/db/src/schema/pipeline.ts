import { pgTable, serial, text, integer, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";

export const pipelineStagesTable = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  variant: text("variant"),
  icon: text("icon"),
  color: text("color"),
  isNotesMandatory: boolean("is_notes_mandatory").notNull().default(false),
  canAttachFile: boolean("can_attach_file").notNull().default(false),
  maxFiles: integer("max_files").notNull().default(1),
  isFileUploadMandatory: boolean("is_file_upload_mandatory").notNull().default(false),
  canGoBack: boolean("can_go_back").notNull().default(true),
  isCaseClose: boolean("is_case_close").notNull().default(false),
  countries: text("countries"),
  mappedStudentStageKey: text("mapped_student_stage_key"),
  // Task #134 — fully dynamic stage behaviors:
  // 'none' | 'admin_only' | 'staff_only' | 'staff_and_agent' | 'everyone' —
  // who can upload stage documents. 'admin_only' = admin/manager only
  // (preserves legacy admin-gated offer-stage behavior); 'staff_only' = all
  // staff roles; 'everyone' = staff + agents + students.
  uploadPermissionLevel: text("upload_permission_level").notNull().default("none"),
  // Whether documents at this stage support a `valid_until` date
  // (offer-letter expiry tracking + deadlines list + expiry notifier).
  tracksOfferExpiry: boolean("tracks_offer_expiry").notNull().default(false),
  // Whether `valid_until` is mandatory on upload (subset of tracksOfferExpiry).
  requiresValidUntil: boolean("requires_valid_until").notNull().default(false),
  // Explicit overrides for finance impact. NULL = derive from `variant`.
  // Allowed values: 'potential' | 'confirmed' | 'excluded'.
  commissionFinanceStatus: text("commission_finance_status"),
  serviceFeeFinanceStatus: text("service_fee_finance_status"),
  // When transitioning into this stage, automatically cancel sibling
  // applications for the same student.
  autoCancelSiblingsOnWon: boolean("auto_cancel_siblings_on_won").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("pipeline_stages_entity_key_uniq").on(table.entityType, table.key),
]);

export type PipelineStage = typeof pipelineStagesTable.$inferSelect;
export type InsertPipelineStage = typeof pipelineStagesTable.$inferInsert;
