import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  studentId: integer("student_id").notNull(),
  applicationId: integer("application_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("draft"),
  dueDate: text("due_date"),
  paidAt: text("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const commissionsTable = pgTable("commissions", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id"),
  studentId: integer("student_id"),
  agentId: integer("agent_id"),

  studentName: text("student_name"),
  universityName: text("university_name"),
  programName: text("program_name"),
  isStateUniversity: boolean("is_state_university").default(false),

  season: text("season").notNull().default("2025"),
  currency: text("currency").notNull().default("USD"),

  programFee: numeric("program_fee", { precision: 12, scale: 2 }),

  universityCommissionRate: numeric("university_commission_rate", { precision: 5, scale: 2 }),
  universityCommissionAmount: numeric("university_commission_amount", { precision: 12, scale: 2 }),
  universityCollected: numeric("university_collected", { precision: 12, scale: 2 }).default("0"),

  agentCommissionRate: numeric("agent_commission_rate", { precision: 5, scale: 2 }),
  agentCommissionAmount: numeric("agent_commission_amount", { precision: 12, scale: 2 }),
  agentPaid: numeric("agent_paid", { precision: 12, scale: 2 }).default("0"),

  status: text("status").notNull().default("potential"),
  confirmedAt: text("confirmed_at"),

  offsetAmount: numeric("offset_amount", { precision: 12, scale: 2 }).default("0"),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const serviceFeesTable = pgTable("service_fees", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id"),
  studentId: integer("student_id"),
  agentId: integer("agent_id"),

  studentName: text("student_name"),
  universityName: text("university_name"),
  isStateUniversity: boolean("is_state_university").default(false),

  payerType: text("payer_type").notNull().default("student"),
  season: text("season").notNull().default("2025"),
  currency: text("currency").notNull().default("USD"),

  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),

  firstInstallmentAmount: numeric("first_installment_amount", { precision: 12, scale: 2 }),
  firstInstallmentPaidAt: text("first_installment_paid_at"),

  secondInstallmentAmount: numeric("second_installment_amount", { precision: 12, scale: 2 }),
  secondInstallmentPaidAt: text("second_installment_paid_at"),

  financeStatus: text("finance_status").notNull().default("potential"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const financialTransactionsTable = pgTable("financial_transactions", {
  id: serial("id").primaryKey(),
  commissionId: integer("commission_id"),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  transactionDate: text("transaction_date").notNull(),
  reference: text("reference"),
  universityName: text("university_name"),
  agentId: integer("agent_id"),
  agentName: text("agent_name"),
  studentName: text("student_name"),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

export const insertCommissionSchema = createInsertSchema(commissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCommission = z.infer<typeof insertCommissionSchema>;
export type Commission = typeof commissionsTable.$inferSelect;

export const insertServiceFeeSchema = createInsertSchema(serviceFeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertServiceFee = z.infer<typeof insertServiceFeeSchema>;
export type ServiceFee = typeof serviceFeesTable.$inferSelect;

export const insertFinancialTransactionSchema = createInsertSchema(financialTransactionsTable).omit({ id: true, createdAt: true });
export type InsertFinancialTransaction = z.infer<typeof insertFinancialTransactionSchema>;
export type FinancialTransaction = typeof financialTransactionsTable.$inferSelect;
