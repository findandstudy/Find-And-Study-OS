import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  accessDecisionReceiptsTable,
  organizationsTable,
  tenantsTable,
} from "./authorization";
import { destinationsTable } from "./destinations";
import { programsTable, universitiesTable } from "./universities";
import { usersTable } from "./users";
import {
  websiteBlogPostsTable,
  websitePagesTable,
} from "./website";

const uuidV7 = (column: { name: string }) =>
  sql`substring(${sql.identifier(column.name)}::text from 15 for 1) = '7'`;

const supportedLocale = (column: { name: string }) =>
  sql`${sql.identifier(column.name)} IN ('en','tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it')`;

const sha256OrNull = (column: { name: string }) =>
  sql`${sql.identifier(column.name)} IS NULL OR ${sql.identifier(column.name)} ~ '^[0-9a-f]{64}$'`;

export const publicWebContentRecordsTable = pgTable(
  "public_web_content_records",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    entityType: text("entity_type").notNull(),
    programId: integer("program_id").references(() => programsTable.id, {
      onDelete: "restrict",
    }),
    universityId: integer("university_id").references(
      () => universitiesTable.id,
      { onDelete: "restrict" },
    ),
    destinationId: integer("destination_id").references(
      () => destinationsTable.id,
      { onDelete: "restrict" },
    ),
    websitePageId: integer("website_page_id").references(
      () => websitePagesTable.id,
      { onDelete: "restrict" },
    ),
    blogPostId: integer("blog_post_id").references(
      () => websiteBlogPostsTable.id,
      { onDelete: "restrict" },
    ),
    locale: text("locale").notNull(),
    canonicalSlug: text("canonical_slug").notNull(),
    canonicalPath: text("canonical_path").notNull(),
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
    unique("public_web_content_records_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("public_web_content_records_scope_id_uq").on(
      table.tenantId,
      table.organizationId,
      table.id,
    ),
    unique("public_web_content_records_scope_path_uq").on(
      table.tenantId,
      table.organizationId,
      table.canonicalPath,
    ),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "public_web_content_records_organization_fk",
    }).onDelete("restrict"),
    uniqueIndex("public_web_content_records_program_locale_uq")
      .on(table.tenantId, table.organizationId, table.programId, table.locale)
      .where(sql`${table.entityType} = 'PROGRAM'`),
    uniqueIndex("public_web_content_records_university_locale_uq")
      .on(
        table.tenantId,
        table.organizationId,
        table.universityId,
        table.locale,
      )
      .where(sql`${table.entityType} = 'UNIVERSITY'`),
    uniqueIndex("public_web_content_records_destination_locale_uq")
      .on(
        table.tenantId,
        table.organizationId,
        table.destinationId,
        table.locale,
      )
      .where(sql`${table.entityType} = 'DESTINATION'`),
    uniqueIndex("public_web_content_records_page_locale_uq")
      .on(
        table.tenantId,
        table.organizationId,
        table.websitePageId,
        table.locale,
      )
      .where(sql`${table.entityType} = 'PAGE'`),
    uniqueIndex("public_web_content_records_article_locale_uq")
      .on(
        table.tenantId,
        table.organizationId,
        table.blogPostId,
        table.locale,
      )
      .where(sql`${table.entityType} = 'ARTICLE'`),
    index("public_web_content_records_scope_entity_idx").on(
      table.tenantId,
      table.organizationId,
      table.entityType,
      table.locale,
      table.id,
    ),
    check("public_web_content_records_id_v7_chk", uuidV7(table.id)),
    check(
      "public_web_content_records_entity_type_chk",
      sql`${table.entityType} IN ('PROGRAM', 'UNIVERSITY', 'DESTINATION', 'PAGE', 'ARTICLE')`,
    ),
    check(
      "public_web_content_records_entity_binding_chk",
      sql`(
        (${table.entityType} = 'PROGRAM' AND ${table.programId} IS NOT NULL AND ${table.universityId} IS NULL AND ${table.destinationId} IS NULL AND ${table.websitePageId} IS NULL AND ${table.blogPostId} IS NULL)
        OR (${table.entityType} = 'UNIVERSITY' AND ${table.programId} IS NULL AND ${table.universityId} IS NOT NULL AND ${table.destinationId} IS NULL AND ${table.websitePageId} IS NULL AND ${table.blogPostId} IS NULL)
        OR (${table.entityType} = 'DESTINATION' AND ${table.programId} IS NULL AND ${table.universityId} IS NULL AND ${table.destinationId} IS NOT NULL AND ${table.websitePageId} IS NULL AND ${table.blogPostId} IS NULL)
        OR (${table.entityType} = 'PAGE' AND ${table.programId} IS NULL AND ${table.universityId} IS NULL AND ${table.destinationId} IS NULL AND ${table.websitePageId} IS NOT NULL AND ${table.blogPostId} IS NULL)
        OR (${table.entityType} = 'ARTICLE' AND ${table.programId} IS NULL AND ${table.universityId} IS NULL AND ${table.destinationId} IS NULL AND ${table.websitePageId} IS NULL AND ${table.blogPostId} IS NOT NULL)
      )`,
    ),
    check("public_web_content_records_locale_chk", supportedLocale(table.locale)),
    check(
      "public_web_content_records_slug_chk",
      sql`length(${table.canonicalSlug}) BETWEEN 1 AND 180 AND ${table.canonicalSlug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "public_web_content_records_path_chk",
      sql`length(${table.canonicalPath}) BETWEEN 4 AND 2048 AND ${table.canonicalPath} ~ '^/(en|tr|ar|fr|ru|fa|zh|hi|es|id|ur|tk|ky|kk|uz|tg|bn|pt|ne|vi|ko|uk|it)(/[a-z0-9][a-z0-9._~-]*)+/?$' AND ${table.canonicalPath} NOT LIKE '%//%'`,
    ),
  ],
).enableRLS();

export const publicWebContentRevisionsTable = pgTable(
  "public_web_content_revisions",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    contentRecordId: uuid("content_record_id").notNull(),
    revisionNumber: bigint("revision_number", { mode: "number" }).notNull(),
    origin: text("origin").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    contentJson: jsonb("content_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    seoJson: jsonb("seo_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    structuredDataJson: jsonb("structured_data_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sourceSha256: text("source_sha256").notNull(),
    contentSha256: text("content_sha256").notNull(),
    generatorReceiptSha256: text("generator_receipt_sha256"),
    qualityStatus: text("quality_status").notNull().default("PENDING"),
    sourceCoverage: text("source_coverage").notNull().default("MISSING"),
    translationStatus: text("translation_status").notNull().default("MISSING"),
    seoStatus: text("seo_status").notNull().default("PENDING"),
    structuredDataStatus: text("structured_data_status")
      .notNull()
      .default("PENDING"),
    createdByLegacyUserId: integer("created_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("public_web_content_revisions_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    unique("public_web_content_revisions_scope_record_id_uq").on(
      table.tenantId,
      table.organizationId,
      table.contentRecordId,
      table.id,
    ),
    unique("public_web_content_revisions_scope_version_uq").on(
      table.tenantId,
      table.organizationId,
      table.contentRecordId,
      table.revisionNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.organizationId, table.contentRecordId],
      foreignColumns: [
        publicWebContentRecordsTable.tenantId,
        publicWebContentRecordsTable.organizationId,
        publicWebContentRecordsTable.id,
      ],
      name: "public_web_content_revisions_record_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "public_web_content_revisions_organization_fk",
    }).onDelete("restrict"),
    index("public_web_content_revisions_record_idx").on(
      table.tenantId,
      table.organizationId,
      table.contentRecordId,
      table.revisionNumber,
    ),
    check("public_web_content_revisions_id_v7_chk", uuidV7(table.id)),
    check(
      "public_web_content_revisions_number_chk",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "public_web_content_revisions_origin_chk",
      sql`${table.origin} IN ('HUMAN', 'AI_ASSISTED', 'IMPORT')`,
    ),
    check(
      "public_web_content_revisions_hash_chk",
      sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$' AND ${table.contentSha256} ~ '^[0-9a-f]{64}$' AND (${sha256OrNull(table.generatorReceiptSha256)})`,
    ),
    check(
      "public_web_content_revisions_ai_receipt_chk",
      sql`${table.origin} <> 'AI_ASSISTED' OR ${table.generatorReceiptSha256} IS NOT NULL`,
    ),
    check(
      "public_web_content_revisions_quality_chk",
      sql`${table.qualityStatus} IN ('PENDING', 'PASS', 'FAIL')`,
    ),
    check(
      "public_web_content_revisions_coverage_chk",
      sql`${table.sourceCoverage} IN ('MISSING', 'PARTIAL', 'COMPLETE')`,
    ),
    check(
      "public_web_content_revisions_translation_chk",
      sql`${table.translationStatus} IN ('SOURCE', 'PUBLISHED', 'MISSING', 'STALE')`,
    ),
    check(
      "public_web_content_revisions_seo_status_chk",
      sql`${table.seoStatus} IN ('PENDING', 'PASS', 'FAIL')`,
    ),
    check(
      "public_web_content_revisions_structured_status_chk",
      sql`${table.structuredDataStatus} IN ('PENDING', 'PASS', 'FAIL')`,
    ),
  ],
).enableRLS();

export const publicWebSourceEvidenceTable = pgTable(
  "public_web_source_evidence",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    contentRecordId: uuid("content_record_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceVisibility: text("source_visibility").notNull().default("INTERNAL"),
    sourceUrl: text("source_url"),
    sourceReferenceSha256: text("source_reference_sha256").notNull(),
    sourceContentSha256: text("source_content_sha256").notNull(),
    factKeys: text("fact_keys").array().notNull(),
    status: text("status").notNull().default("OBSERVED"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    verifiedByLegacyUserId: integer("verified_by_legacy_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("public_web_source_evidence_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    foreignKey({
      columns: [
        table.tenantId,
        table.organizationId,
        table.contentRecordId,
        table.revisionId,
      ],
      foreignColumns: [
        publicWebContentRevisionsTable.tenantId,
        publicWebContentRevisionsTable.organizationId,
        publicWebContentRevisionsTable.contentRecordId,
        publicWebContentRevisionsTable.id,
      ],
      name: "public_web_source_evidence_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "public_web_source_evidence_organization_fk",
    }).onDelete("restrict"),
    index("public_web_source_evidence_revision_idx").on(
      table.tenantId,
      table.organizationId,
      table.contentRecordId,
      table.revisionId,
      table.status,
      table.expiresAt,
    ),
    check("public_web_source_evidence_id_v7_chk", uuidV7(table.id)),
    check(
      "public_web_source_evidence_type_chk",
      sql`${table.sourceType} IN ('INSTITUTION', 'GOVERNMENT', 'CONTRACT', 'PARTNER', 'EDITORIAL', 'OTHER')`,
    ),
    check(
      "public_web_source_evidence_visibility_chk",
      sql`${table.sourceVisibility} IN ('PUBLIC', 'INTERNAL')`,
    ),
    check(
      "public_web_source_evidence_hash_chk",
      sql`${table.sourceReferenceSha256} ~ '^[0-9a-f]{64}$' AND ${table.sourceContentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "public_web_source_evidence_status_chk",
      sql`${table.status} IN ('OBSERVED', 'VERIFIED', 'REJECTED', 'SUPERSEDED')`,
    ),
    check(
      "public_web_source_evidence_verification_pair_chk",
      sql`(${table.verifiedByLegacyUserId} IS NULL) = (${table.verifiedAt} IS NULL)`,
    ),
  ],
).enableRLS();

export const publicWebPublicationStatesTable = pgTable(
  "public_web_publication_states",
  {
    tenantId: uuid("tenant_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    contentRecordId: uuid("content_record_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    status: text("status").notNull().default("DRAFT"),
    indexState: text("index_state").notNull().default("NOINDEX"),
    reviewedByLegacyUserId: integer("reviewed_by_legacy_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    publishedByLegacyUserId: integer("published_by_legacy_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    staleReasonCode: text("stale_reason_code"),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.contentRecordId],
      name: "public_web_publication_states_pk",
    }),
    unique("public_web_publication_states_scope_record_uq").on(
      table.tenantId,
      table.organizationId,
      table.contentRecordId,
    ),
    foreignKey({
      columns: [
        table.tenantId,
        table.organizationId,
        table.contentRecordId,
        table.revisionId,
      ],
      foreignColumns: [
        publicWebContentRevisionsTable.tenantId,
        publicWebContentRevisionsTable.organizationId,
        publicWebContentRevisionsTable.contentRecordId,
        publicWebContentRevisionsTable.id,
      ],
      name: "public_web_publication_states_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "public_web_publication_states_organization_fk",
    }).onDelete("restrict"),
    index("public_web_publication_states_queue_idx").on(
      table.tenantId,
      table.organizationId,
      table.status,
      table.updatedAt,
      table.contentRecordId,
    ),
    check(
      "public_web_publication_states_status_chk",
      sql`${table.status} IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'STALE', 'RETIRED')`,
    ),
    check(
      "public_web_publication_states_index_chk",
      sql`${table.indexState} IN ('NOINDEX', 'INDEX')`,
    ),
    check(
      "public_web_publication_states_index_status_chk",
      sql`${table.indexState} = 'NOINDEX' OR ${table.status} = 'PUBLISHED'`,
    ),
    check(
      "public_web_publication_states_version_chk",
      sql`${table.version} > 0`,
    ),
  ],
).enableRLS();

export const publicWebPublicationReceiptsTable = pgTable(
  "public_web_publication_receipts",
  {
    id: uuid("id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    contentRecordId: uuid("content_record_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    indexState: text("index_state").notNull(),
    actorLegacyUserId: integer("actor_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    requestKey: text("request_key").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    authorizationDecisionReceiptId: uuid(
      "authorization_decision_receipt_id",
    ).notNull(),
    requestHash: text("request_hash").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.id],
      name: "public_web_publication_receipts_pk",
    }),
    unique("public_web_publication_receipts_request_uq").on(
      table.tenantId,
      table.requestKey,
    ),
    foreignKey({
      columns: [
        table.tenantId,
        table.organizationId,
        table.contentRecordId,
        table.revisionId,
      ],
      foreignColumns: [
        publicWebContentRevisionsTable.tenantId,
        publicWebContentRevisionsTable.organizationId,
        publicWebContentRevisionsTable.contentRecordId,
        publicWebContentRevisionsTable.id,
      ],
      name: "public_web_publication_receipts_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.authorizationDecisionReceiptId],
      foreignColumns: [
        accessDecisionReceiptsTable.tenantId,
        accessDecisionReceiptsTable.id,
      ],
      name: "public_web_publication_receipts_authorization_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "public_web_publication_receipts_organization_fk",
    }).onDelete("restrict"),
    index("public_web_publication_receipts_record_idx").on(
      table.tenantId,
      table.organizationId,
      table.contentRecordId,
      table.occurredAt,
    ),
    check("public_web_publication_receipts_id_v7_chk", uuidV7(table.id)),
    check(
      "public_web_publication_receipts_index_chk",
      sql`${table.indexState} IN ('NOINDEX', 'INDEX')`,
    ),
    check(
      "public_web_publication_receipts_hash_chk",
      sql`${table.evidenceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "public_web_publication_receipts_request_hash_chk",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
).enableRLS();

export const publicWebRouteAliasesTable = pgTable(
  "public_web_route_aliases",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    contentRecordId: uuid("content_record_id").notNull(),
    path: text("path").notNull(),
    routeKind: text("route_kind").notNull(),
    redirectToPath: text("redirect_to_path"),
    httpStatus: integer("http_status").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    createdByLegacyUserId: integer("created_by_legacy_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("public_web_route_aliases_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.organizationId, table.contentRecordId],
      foreignColumns: [
        publicWebContentRecordsTable.tenantId,
        publicWebContentRecordsTable.organizationId,
        publicWebContentRecordsTable.id,
      ],
      name: "public_web_route_aliases_record_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
      name: "public_web_route_aliases_organization_fk",
    }).onDelete("restrict"),
    uniqueIndex("public_web_route_aliases_active_path_uq")
      .on(table.tenantId, table.organizationId, table.path)
      .where(sql`${table.validTo} IS NULL`),
    uniqueIndex("public_web_route_aliases_active_canonical_uq")
      .on(
        table.tenantId,
        table.organizationId,
        table.contentRecordId,
      )
      .where(sql`${table.validTo} IS NULL AND ${table.routeKind} = 'CANONICAL'`),
    check("public_web_route_aliases_id_v7_chk", uuidV7(table.id)),
    check(
      "public_web_route_aliases_kind_chk",
      sql`${table.routeKind} IN ('CANONICAL', 'REDIRECT', 'GONE')`,
    ),
    check(
      "public_web_route_aliases_semantics_chk",
      sql`(${table.routeKind} = 'CANONICAL' AND ${table.redirectToPath} IS NULL AND ${table.httpStatus} = 200) OR (${table.routeKind} = 'REDIRECT' AND ${table.redirectToPath} IS NOT NULL AND ${table.httpStatus} IN (301, 308)) OR (${table.routeKind} = 'GONE' AND ${table.redirectToPath} IS NULL AND ${table.httpStatus} = 410)`,
    ),
  ],
).enableRLS();

export type PublicWebContentRecord =
  typeof publicWebContentRecordsTable.$inferSelect;
export type InsertPublicWebContentRecord =
  typeof publicWebContentRecordsTable.$inferInsert;
export type PublicWebContentRevision =
  typeof publicWebContentRevisionsTable.$inferSelect;
export type PublicWebSourceEvidence =
  typeof publicWebSourceEvidenceTable.$inferSelect;
export type PublicWebPublicationState =
  typeof publicWebPublicationStatesTable.$inferSelect;
export type PublicWebPublicationReceipt =
  typeof publicWebPublicationReceiptsTable.$inferSelect;
export type PublicWebRouteAlias = typeof publicWebRouteAliasesTable.$inferSelect;
