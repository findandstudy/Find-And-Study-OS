import { pgTable, text, serial, timestamp, integer, boolean, index, jsonb, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type CatalogFieldSource = {
  sourceName?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  validUntil?: string;
  notes?: string;
};

export type CatalogSourceMetadata = Record<string, CatalogFieldSource>;

export const countriesTable = pgTable("countries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  flagEmoji: text("flag_emoji"),
  dialCode: text("dial_code"),
  sourceMetadata: jsonb("source_metadata").notNull().default({}).$type<CatalogSourceMetadata>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const citiesTable = pgTable("cities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  countryId: integer("country_id").notNull().references(() => countriesTable.id, { onDelete: "cascade" }),
  teachingLanguages: jsonb("teaching_languages").notNull().default([]).$type<string[]>(),
  transportModes: jsonb("transport_modes").notNull().default([]).$type<string[]>(),
  campusGeography: text("campus_geography"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  sourceMetadata: jsonb("source_metadata").notNull().default({}).$type<CatalogSourceMetadata>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("cities_country_id_idx").on(table.countryId),
]);

export const cityExternalFactsTable = pgTable("city_external_facts", {
  cityId: integer("city_id").primaryKey().references(() => citiesTable.id, { onDelete: "cascade" }),
  climateProvider: text("climate_provider"),
  climateSourceUrl: text("climate_source_url"),
  climateSummary: text("climate_summary"),
  climateAnnualAverageC: real("climate_annual_average_c"),
  climateMonths: jsonb("climate_months").notNull().default([]).$type<Array<{ month: string; highC?: number; lowC?: number; condition?: string }>>(),
  climateVerifiedAt: timestamp("climate_verified_at", { withTimezone: true }),
  housingProvider: text("housing_provider"),
  housingSourceUrl: text("housing_source_url"),
  housingSummary: text("housing_summary"),
  housingFormats: jsonb("housing_formats").notNull().default([]).$type<Array<{ name: string; area?: string; priceFrom?: number; currency?: string; billingPeriod?: string; url?: string }>>(),
  housingVerifiedAt: timestamp("housing_verified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const cityWeatherSnapshotsTable = pgTable("city_weather_snapshots", {
  cityId: integer("city_id").primaryKey().references(() => citiesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("openweather"),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  conditionCode: integer("condition_code"),
  conditionGroup: text("condition_group"),
  description: text("description"),
  iconCode: text("icon_code"),
  temperatureC: real("temperature_c"),
  feelsLikeC: real("feels_like_c"),
  minimumC: real("minimum_c"),
  maximumC: real("maximum_c"),
  humidityPercent: integer("humidity_percent"),
  windSpeedMps: real("wind_speed_mps"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  forecastDate: date("forecast_date"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  staleAfter: timestamp("stale_after", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastErrorCode: text("last_error_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("city_weather_snapshots_stale_after_idx").on(table.staleAfter),
]);

export const weatherSyncRunsTable = pgTable("weather_sync_runs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("openweather"),
  status: text("status").notNull(),
  requestedCount: integer("requested_count").notNull().default(0),
  refreshedCount: integer("refreshed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("weather_sync_runs_started_at_idx").on(table.startedAt),
]);

export const weatherProviderCallsTable = pgTable("weather_provider_calls", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("openweather"),
  callKind: text("call_kind").notNull(),
  cityId: integer("city_id").references(() => citiesTable.id, { onDelete: "set null" }),
  outcome: text("outcome").notNull().default("reserved"),
  errorCode: text("error_code"),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  index("weather_provider_calls_provider_reserved_idx").on(table.provider, table.reservedAt),
]);

export const insertCountrySchema = createInsertSchema(countriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCountry = z.infer<typeof insertCountrySchema>;
export type Country = typeof countriesTable.$inferSelect;

export const insertCitySchema = createInsertSchema(citiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCity = z.infer<typeof insertCitySchema>;
export type City = typeof citiesTable.$inferSelect;

export const catalogOptionsTable = pgTable("catalog_options", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  value: text("value").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("catalog_options_category_idx").on(table.category),
]);

export type CatalogOption = typeof catalogOptionsTable.$inferSelect;
