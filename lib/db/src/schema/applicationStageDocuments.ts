import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { applicationsTable } from "./applications";
import { usersTable } from "./users";

export const applicationStageDocumentsTable = pgTable("application_stage_documents", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applicationsTable.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  fileName: text("file_name").notNull(),
  fileData: text("file_data"),
  fileUrl: text("file_url"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: integer("uploaded_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  uploadedByRole: text("uploaded_by_role").notNull(),
  uploadedByName: text("uploaded_by_name"),
  isMissingDocNote: boolean("is_missing_doc_note").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("app_stage_docs_application_id_idx").on(table.applicationId),
  index("app_stage_docs_stage_idx").on(table.stage),
]);

export type ApplicationStageDocument = typeof applicationStageDocumentsTable.$inferSelect;
