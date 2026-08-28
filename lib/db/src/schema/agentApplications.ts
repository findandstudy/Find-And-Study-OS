import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { agentsTable } from "./agents";
import { branchesTable } from "./branches";
import { contractTemplatesTable, signedContractsTable, signingSessionsTable } from "./contracts";

/**
 * A public agency application is deliberately separate from `agents`.
 * Applicants only become users/agents after a manager approves a verified,
 * signed application. This keeps incomplete public submissions out of the
 * operational agent hierarchy and makes approval idempotent.
 */
export const agentApplicationsTable = pgTable("agent_applications", {
  id: serial("id").primaryKey(),
  referenceCode: text("reference_code").notNull(),
  accessTokenHash: text("access_token_hash").notNull(),
  idempotencyKeyHash: text("idempotency_key_hash"),
  status: text("status").notNull().default("submitted"),

  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  phoneE164: text("phone_e164"),
  entityType: text("entity_type").notNull(),
  preferredLanguage: text("preferred_language").notNull(),
  companyName: text("company_name"),
  businessName: text("business_name"),
  taxNumber: text("tax_number"),
  country: text("country"),
  state: text("state"),
  city: text("city"),
  address: text("address"),
  website: text("website"),
  estimatedStudents: integer("estimated_students"),
  operatingCountries: jsonb("operating_countries").notNull().default([]),
  recruitmentMarkets: jsonb("recruitment_markets").notNull().default([]),
  extraData: jsonb("extra_data").notNull().default({}),

  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  logoFileKey: text("logo_file_key"),
  representativeIdFileKey: text("representative_id_file_key"),
  businessRegistrationFileKey: text("business_registration_file_key"),
  documentMetadata: jsonb("document_metadata").notNull().default({}),

  contractTemplateId: integer("contract_template_id").notNull().references(() => contractTemplatesTable.id),
  contractTemplateSelection: text("contract_template_selection").notNull().default("automatic"),
  contractTemplateOverriddenByUserId: integer("contract_template_overridden_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  contractTemplateOverriddenAt: timestamp("contract_template_overridden_at", { withTimezone: true }),
  contractPreparedAt: timestamp("contract_prepared_at", { withTimezone: true }),
  contractSentAt: timestamp("contract_sent_at", { withTimezone: true }),
  signingSessionId: integer("signing_session_id").references(() => signingSessionsTable.id, { onDelete: "set null" }),
  signedContractId: integer("signed_contract_id").references(() => signedContractsTable.id, { onDelete: "set null" }),
  contractDataHash: text("contract_data_hash").notNull(),

  assignedStaffId: integer("assigned_staff_id").references(() => usersTable.id, { onDelete: "set null" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  reviewNotes: text("review_notes"),
  changeRequestMessage: text("change_request_message"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  approvedAgentId: integer("approved_agent_id").references(() => agentsTable.id, { onDelete: "set null" }),

  consentVersion: text("consent_version").notNull().default("agency-application-v1"),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
  consentIpHash: text("consent_ip_hash"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("agent_applications_reference_unique").on(table.referenceCode),
  uniqueIndex("agent_applications_access_token_unique").on(table.accessTokenHash),
  uniqueIndex("agent_applications_idempotency_unique").on(table.idempotencyKeyHash),
  uniqueIndex("agent_applications_signing_session_unique").on(table.signingSessionId),
  uniqueIndex("agent_applications_signed_contract_unique").on(table.signedContractId),
  uniqueIndex("agent_applications_approved_agent_unique").on(table.approvedAgentId),
  index("agent_applications_status_created_idx").on(table.status, table.createdAt),
  index("agent_applications_email_idx").on(table.email),
  index("agent_applications_template_idx").on(table.contractTemplateId),
  index("agent_applications_assigned_staff_idx").on(table.assignedStaffId),
]);

export const insertAgentApplicationSchema = createInsertSchema(agentApplicationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAgentApplication = z.infer<typeof insertAgentApplicationSchema>;
export type AgentApplication = typeof agentApplicationsTable.$inferSelect;
