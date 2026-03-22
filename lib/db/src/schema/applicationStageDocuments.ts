import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const applicationStageDocumentsTable = pgTable("application_stage_documents", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  stage: text("stage").notNull(),
  fileName: text("file_name").notNull(),
  fileData: text("file_data"),
  fileUrl: text("file_url"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: integer("uploaded_by").notNull(),
  uploadedByRole: text("uploaded_by_role").notNull(),
  uploadedByName: text("uploaded_by_name"),
  isMissingDocNote: boolean("is_missing_doc_note").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApplicationStageDocument = typeof applicationStageDocumentsTable.$inferSelect;
