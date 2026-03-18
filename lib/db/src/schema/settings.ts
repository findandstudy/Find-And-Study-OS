import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name"),
  companyEmail: text("company_email"),
  companyPhone: text("company_phone"),
  companyAddress: text("company_address"),
  defaultLanguage: text("default_language").notNull().default("en"),
  supportedLanguages: text("supported_languages").notNull().default("en,tr,ar,fr,ru"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpFromEmail: text("smtp_from_email"),
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
  whatsappToken: text("whatsapp_token"),
  n8nWebhookUrl: text("n8n_webhook_url"),
  googleSheetsId: text("google_sheets_id"),
  metaLeadEnabled: boolean("meta_lead_enabled").notNull().default(false),
  logoUrl: text("logo_url"),
  logoDarkUrl: text("logo_dark_url"),
  faviconUrl: text("favicon_url"),
  themePrimary: text("theme_primary"),
  themeButton: text("theme_button"),
  themeHover: text("theme_hover"),
  seoDefaultTitle: text("seo_default_title"),
  seoDefaultDescription: text("seo_default_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
