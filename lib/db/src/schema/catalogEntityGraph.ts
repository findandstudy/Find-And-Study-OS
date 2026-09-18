import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizationsTable, tenantsTable } from "./authorization";
import { citiesTable } from "./catalog";
import { programsTable, universitiesTable } from "./universities";
import { usersTable } from "./users";

const uuidV7 = (column: { name: string }) =>
  sql`substring(${sql.identifier(column.name)}::text from 15 for 1) = '7'`;

export const catalogSourcesTable = pgTable(
  "catalog_sources",
  {
    id: uuid("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    displayName: text("display_name").notNull(),
    sourceType: text("source_type").notNull(),
    baseUrl: text("base_url"),
    licenseCode: text("license_code"),
    authorityRank: integer("authority_rank").notNull().default(50),
    status: text("status").notNull().default("ACTIVE"),
    createdByLegacyUserId: integer("created_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("catalog_sources_status_rank_idx").on(
      table.status,
      table.authorityRank,
      table.sourceKey,
    ),
    check("catalog_sources_id_v7_chk", uuidV7(table.id)),
    check(
      "catalog_sources_key_chk",
      sql`length(${table.sourceKey}) BETWEEN 2 AND 96 AND ${table.sourceKey} ~ '^[a-z][a-z0-9._:-]+$'`,
    ),
    check(
      "catalog_sources_type_chk",
      sql`${table.sourceType} IN ('OFFICIAL_API', 'PARTNER_FEED', 'INSTITUTION_PORTAL', 'MANUAL_REVIEW', 'CONTRACT')`,
    ),
    check(
      "catalog_sources_rank_chk",
      sql`${table.authorityRank} BETWEEN 1 AND 100`,
    ),
    check(
      "catalog_sources_status_chk",
      sql`${table.status} IN ('ACTIVE', 'SUSPENDED', 'RETIRED')`,
    ),
  ],
);

export const catalogSourceRecordsTable = pgTable(
  "catalog_source_records",
  {
    id: uuid("id").primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => catalogSourcesTable.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url"),
    rawObjectSha256: text("raw_object_sha256").notNull(),
    licenseCode: text("license_code"),
    status: text("status").notNull().default("OBSERVED"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    verifiedByLegacyUserId: integer("verified_by_legacy_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationEvidenceSha256: text("verification_evidence_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("catalog_source_records_source_external_hash_uq").on(
      table.sourceId,
      table.entityType,
      table.externalId,
      table.rawObjectSha256,
    ),
    index("catalog_source_records_lookup_idx").on(
      table.sourceId,
      table.entityType,
      table.externalId,
      table.fetchedAt,
    ),
    index("catalog_source_records_freshness_idx").on(
      table.entityType,
      table.status,
      table.expiresAt,
      table.id,
    ),
    check("catalog_source_records_id_v7_chk", uuidV7(table.id)),
    check(
      "catalog_source_records_entity_chk",
      sql`${table.entityType} IN ('INSTITUTION', 'CAMPUS', 'PROGRAM', 'INTAKE', 'REQUIREMENT', 'PRICE')`,
    ),
    check(
      "catalog_source_records_hash_chk",
      sql`${table.rawObjectSha256} ~ '^[0-9a-f]{64}$' AND (${table.verificationEvidenceSha256} IS NULL OR ${table.verificationEvidenceSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "catalog_source_records_status_chk",
      sql`${table.status} IN ('OBSERVED', 'VERIFIED', 'REJECTED', 'SUPERSEDED')`,
    ),
  ],
);

export const institutionCampusesTable = pgTable(
  "institution_campuses",
  {
    id: uuid("id").primaryKey(),
    universityId: integer("university_id")
      .notNull()
      .references(() => universitiesTable.id, { onDelete: "restrict" }),
    campusKey: text("campus_key").notNull(),
    name: text("name").notNull(),
    countryCode: text("country_code").notNull(),
    cityId: integer("city_id").references(() => citiesTable.id, {
      onDelete: "restrict",
    }),
    publicAddress: text("public_address"),
    deliveryModes: text("delivery_modes")
      .array()
      .notNull()
      .default(["ON_CAMPUS"]),
    sourceTimezone: text("source_timezone").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sourceRecordId: uuid("source_record_id").references(
      () => catalogSourceRecordsTable.id,
      { onDelete: "restrict" },
    ),
    sourceVerifiedAt: timestamp("source_verified_at", { withTimezone: true }),
    sourceExpiresAt: timestamp("source_expires_at", { withTimezone: true }),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdByLegacyUserId: integer("created_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    updatedByLegacyUserId: integer("updated_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("institution_campuses_university_key_uq").on(
      table.universityId,
      table.campusKey,
    ),
    index("institution_campuses_university_active_idx").on(
      table.universityId,
      table.isActive,
      table.id,
    ),
    check("institution_campuses_id_v7_chk", uuidV7(table.id)),
    check(
      "institution_campuses_country_chk",
      sql`${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "institution_campuses_modes_chk",
      sql`cardinality(${table.deliveryModes}) BETWEEN 1 AND 4 AND ${table.deliveryModes} <@ ARRAY['ON_CAMPUS','ONLINE','HYBRID','BLENDED']::text[]`,
    ),
    check(
      "institution_campuses_version_chk",
      sql`${table.version} > 0`,
    ),
  ],
);

export const programIntakesTable = pgTable(
  "program_intakes",
  {
    id: uuid("id").primaryKey(),
    programId: integer("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "restrict" }),
    campusId: uuid("campus_id").references(() => institutionCampusesTable.id, {
      onDelete: "restrict",
    }),
    intakeKey: text("intake_key").notNull(),
    academicYear: integer("academic_year").notNull(),
    startsOn: date("starts_on"),
    applicationDeadlineAt: timestamp("application_deadline_at", {
      withTimezone: true,
    }),
    sourceTimezone: text("source_timezone").notNull(),
    capacityStatus: text("capacity_status").notNull().default("UNKNOWN"),
    deliveryMode: text("delivery_mode").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    sourceRecordId: uuid("source_record_id").references(
      () => catalogSourceRecordsTable.id,
      { onDelete: "restrict" },
    ),
    sourceVerifiedAt: timestamp("source_verified_at", { withTimezone: true }),
    sourceExpiresAt: timestamp("source_expires_at", { withTimezone: true }),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdByLegacyUserId: integer("created_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    updatedByLegacyUserId: integer("updated_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("program_intakes_program_id_id_uq").on(table.programId, table.id),
    uniqueIndex("program_intakes_identity_uq").on(
      table.programId,
      sql`coalesce(${table.campusId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.intakeKey,
      table.academicYear,
    ),
    index("program_intakes_public_lookup_idx").on(
      table.programId,
      table.status,
      table.academicYear,
      table.applicationDeadlineAt,
      table.id,
    ),
    check("program_intakes_id_v7_chk", uuidV7(table.id)),
    check(
      "program_intakes_year_chk",
      sql`${table.academicYear} BETWEEN 2000 AND 2200`,
    ),
    check(
      "program_intakes_capacity_chk",
      sql`${table.capacityStatus} IN ('OPEN', 'LIMITED', 'FULL', 'WAITLIST', 'CLOSED', 'UNKNOWN')`,
    ),
    check(
      "program_intakes_delivery_chk",
      sql`${table.deliveryMode} IN ('ON_CAMPUS', 'ONLINE', 'HYBRID', 'BLENDED')`,
    ),
    check(
      "program_intakes_status_chk",
      sql`${table.status} IN ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED', 'ARCHIVED')`,
    ),
    check("program_intakes_version_chk", sql`${table.version} > 0`),
  ],
);

export const priceComponentsTable = pgTable(
  "price_components",
  {
    id: uuid("id").primaryKey(),
    programId: integer("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "restrict" }),
    intakeId: uuid("intake_id"),
    componentCode: text("component_code").notNull(),
    componentType: text("component_type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: text("currency_code").notNull(),
    frequency: text("frequency").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    status: text("status").notNull().default("ACTIVE"),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => catalogSourceRecordsTable.id, { onDelete: "restrict" }),
    sourceVerifiedAt: timestamp("source_verified_at", { withTimezone: true })
      .notNull(),
    sourceExpiresAt: timestamp("source_expires_at", { withTimezone: true }),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdByLegacyUserId: integer("created_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    updatedByLegacyUserId: integer("updated_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.programId, table.intakeId],
      foreignColumns: [programIntakesTable.programId, programIntakesTable.id],
      name: "price_components_program_intake_fk",
    }).onDelete("restrict"),
    uniqueIndex("price_components_identity_uq").on(
      table.programId,
      sql`coalesce(${table.intakeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.componentCode,
      table.effectiveFrom,
    ),
    index("price_components_public_lookup_idx").on(
      table.programId,
      table.intakeId,
      table.status,
      table.effectiveFrom,
      table.effectiveUntil,
      table.id,
    ),
    check("price_components_id_v7_chk", uuidV7(table.id)),
    check(
      "price_components_type_chk",
      sql`${table.componentType} IN ('TUITION', 'APPLICATION', 'DEPOSIT', 'LANGUAGE', 'INSURANCE', 'OTHER')`,
    ),
    check(
      "price_components_amount_chk",
      sql`${table.amountMinor} >= 0`,
    ),
    check(
      "price_components_currency_chk",
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "price_components_frequency_chk",
      sql`${table.frequency} IN ('ONE_TIME', 'PER_YEAR', 'PER_TERM', 'PER_CREDIT', 'PER_MONTH')`,
    ),
    check(
      "price_components_status_chk",
      sql`${table.status} IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED')`,
    ),
    check("price_components_version_chk", sql`${table.version} > 0`),
  ],
);

export const tenantCatalogListingsTable = pgTable(
  "tenant_catalog_listings",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    programId: integer("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "restrict" }),
    intakeId: uuid("intake_id"),
    visibility: text("visibility").notNull().default("HIDDEN"),
    publicationStatus: text("publication_status").notNull().default("DRAFT"),
    commercialCopyJson: jsonb("commercial_copy_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    pricingPresentationJson: jsonb("pricing_presentation_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    commissionPresentationJson: jsonb("commission_presentation_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    counselorNote: text("counselor_note"),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdByLegacyUserId: integer("created_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    reviewedByLegacyUserId: integer("reviewed_by_legacy_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("tenant_catalog_listings_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("tenant_catalog_listings_scope_id_uq").on(
      table.tenantId,
      table.organizationId,
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "tenant_catalog_listings_organization_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.programId, table.intakeId],
      foreignColumns: [programIntakesTable.programId, programIntakesTable.id],
      name: "tenant_catalog_listings_program_intake_fk",
    }).onDelete("restrict"),
    uniqueIndex("tenant_catalog_listings_identity_uq").on(
      table.tenantId,
      table.organizationId,
      table.programId,
      sql`coalesce(${table.intakeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index("tenant_catalog_listings_scope_status_idx").on(
      table.tenantId,
      table.organizationId,
      table.visibility,
      table.publicationStatus,
      table.programId,
      table.id,
    ),
    check("tenant_catalog_listings_id_v7_chk", uuidV7(table.id)),
    check(
      "tenant_catalog_listings_visibility_chk",
      sql`${table.visibility} IN ('HIDDEN', 'INTERNAL', 'PUBLIC')`,
    ),
    check(
      "tenant_catalog_listings_publication_chk",
      sql`${table.publicationStatus} IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED')`,
    ),
    check(
      "tenant_catalog_listings_public_gate_chk",
      sql`${table.visibility} <> 'PUBLIC' OR ${table.publicationStatus} = 'PUBLISHED'`,
    ),
    check(
      "tenant_catalog_listings_checker_chk",
      sql`${table.reviewedByLegacyUserId} IS NULL OR ${table.reviewedByLegacyUserId} <> ${table.createdByLegacyUserId}`,
    ),
    check("tenant_catalog_listings_version_chk", sql`${table.version} > 0`),
  ],
).enableRLS();

export type CatalogSource = typeof catalogSourcesTable.$inferSelect;
export type CatalogSourceRecord = typeof catalogSourceRecordsTable.$inferSelect;
export type InstitutionCampus = typeof institutionCampusesTable.$inferSelect;
export type ProgramIntake = typeof programIntakesTable.$inferSelect;
export type PriceComponent = typeof priceComponentsTable.$inferSelect;
export type TenantCatalogListing = typeof tenantCatalogListingsTable.$inferSelect;
