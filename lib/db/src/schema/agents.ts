import { pgTable, text, serial, timestamp, integer, real, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  parentAgentId: integer("parent_agent_id"),
  agencyCode: text("agency_code"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  country: text("country"),
  state: text("state"),
  city: text("city"),
  address: text("address"),
  companyName: text("company_name"),
  businessName: text("business_name"),
  category: text("category"),
  commissionRate: real("commission_rate"),
  subAgentCommissionRate: real("sub_agent_commission_rate"),
  hideServiceFees: boolean("hide_service_fees").notNull().default(false),
  status: text("status").notNull().default("active"),
  logoUrl: text("logo_url"),
  agentIdProofUrl: text("agent_id_proof_url"),
  businessCertUrl: text("business_cert_url"),
  contractUrl: text("contract_url"),
  branch: text("branch"),
  pointOfContact: text("point_of_contact"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("agents_user_id_idx").on(table.userId),
  index("agents_parent_agent_id_idx").on(table.parentAgentId),
  index("agents_status_idx").on(table.status),
]);

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
