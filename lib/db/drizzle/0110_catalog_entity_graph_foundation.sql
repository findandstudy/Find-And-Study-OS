-- Additive canonical catalogue entity-graph foundation.
--
-- Existing universities/programs remain canonical and are not backfilled or
-- rewritten here. Institution Admissions requirement sets are reused rather
-- than duplicated. This migration adds only the missing provenance, campus,
-- intake, precise price-component and tenant commercial-listing concepts.

CREATE TABLE "catalog_sources" (
  "id" uuid PRIMARY KEY,
  "source_key" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "source_type" text NOT NULL,
  "base_url" text,
  "license_code" text,
  "authority_rank" integer NOT NULL DEFAULT 50,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "created_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "catalog_sources_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "catalog_sources_key_chk" CHECK (length("source_key") BETWEEN 2 AND 96 AND "source_key" ~ '^[a-z][a-z0-9._:-]+$'),
  CONSTRAINT "catalog_sources_name_chk" CHECK (length(trim("display_name")) BETWEEN 1 AND 240),
  CONSTRAINT "catalog_sources_type_chk" CHECK ("source_type" IN ('OFFICIAL_API', 'PARTNER_FEED', 'INSTITUTION_PORTAL', 'MANUAL_REVIEW', 'CONTRACT')),
  CONSTRAINT "catalog_sources_url_chk" CHECK ("base_url" IS NULL OR (length("base_url") BETWEEN 10 AND 2048 AND "base_url" ~ '^https://' AND "base_url" NOT LIKE '%#%')),
  CONSTRAINT "catalog_sources_license_chk" CHECK ("license_code" IS NULL OR (length("license_code") BETWEEN 2 AND 96 AND "license_code" ~ '^[A-Za-z0-9._:-]+$')),
  CONSTRAINT "catalog_sources_rank_chk" CHECK ("authority_rank" BETWEEN 1 AND 100),
  CONSTRAINT "catalog_sources_status_chk" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'RETIRED'))
);
CREATE INDEX "catalog_sources_status_rank_idx"
  ON "catalog_sources" ("status", "authority_rank", "source_key");

CREATE TABLE "catalog_source_records" (
  "id" uuid PRIMARY KEY,
  "source_id" uuid NOT NULL REFERENCES "catalog_sources"("id") ON DELETE RESTRICT,
  "entity_type" text NOT NULL,
  "external_id" text NOT NULL,
  "source_url" text,
  "raw_object_sha256" text NOT NULL,
  "license_code" text,
  "status" text NOT NULL DEFAULT 'OBSERVED',
  "fetched_at" timestamptz NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "expires_at" timestamptz,
  "verified_by_legacy_user_id" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_at" timestamptz,
  "verification_evidence_sha256" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "catalog_source_records_source_external_hash_uq" UNIQUE ("source_id", "entity_type", "external_id", "raw_object_sha256"),
  CONSTRAINT "catalog_source_records_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "catalog_source_records_entity_chk" CHECK ("entity_type" IN ('INSTITUTION', 'CAMPUS', 'PROGRAM', 'INTAKE', 'REQUIREMENT', 'PRICE')),
  CONSTRAINT "catalog_source_records_external_id_chk" CHECK (length("external_id") BETWEEN 1 AND 500 AND "external_id" !~ '[[:cntrl:]]'),
  CONSTRAINT "catalog_source_records_url_chk" CHECK ("source_url" IS NULL OR (length("source_url") BETWEEN 10 AND 2048 AND "source_url" ~ '^https://' AND "source_url" NOT LIKE '%#%')),
  CONSTRAINT "catalog_source_records_hash_chk" CHECK (
    "raw_object_sha256" ~ '^[0-9a-f]{64}$'
    AND ("verification_evidence_sha256" IS NULL OR "verification_evidence_sha256" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "catalog_source_records_status_chk" CHECK ("status" IN ('OBSERVED', 'VERIFIED', 'REJECTED', 'SUPERSEDED')),
  CONSTRAINT "catalog_source_records_verify_pair_chk" CHECK (("verified_by_legacy_user_id" IS NULL) = ("verified_at" IS NULL)),
  CONSTRAINT "catalog_source_records_verified_chk" CHECK ("status" <> 'VERIFIED' OR ("verified_at" IS NOT NULL AND "verification_evidence_sha256" IS NOT NULL)),
  CONSTRAINT "catalog_source_records_time_chk" CHECK (
    "fetched_at" >= "effective_at"
    AND ("verified_at" IS NULL OR "verified_at" >= "fetched_at")
    AND ("expires_at" IS NULL OR "expires_at" > COALESCE("verified_at", "effective_at"))
  )
);
CREATE INDEX "catalog_source_records_lookup_idx"
  ON "catalog_source_records" ("source_id", "entity_type", "external_id", "fetched_at" DESC);
CREATE INDEX "catalog_source_records_freshness_idx"
  ON "catalog_source_records" ("entity_type", "status", "expires_at", "id");

CREATE TABLE "institution_campuses" (
  "id" uuid PRIMARY KEY,
  "university_id" integer NOT NULL REFERENCES "universities"("id") ON DELETE RESTRICT,
  "campus_key" text NOT NULL,
  "name" text NOT NULL,
  "country_code" text NOT NULL,
  "city_id" integer REFERENCES "cities"("id") ON DELETE RESTRICT,
  "public_address" text,
  "delivery_modes" text[] NOT NULL DEFAULT ARRAY['ON_CAMPUS']::text[],
  "source_timezone" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "source_record_id" uuid REFERENCES "catalog_source_records"("id") ON DELETE RESTRICT,
  "source_verified_at" timestamptz,
  "source_expires_at" timestamptz,
  "version" bigint NOT NULL DEFAULT 1,
  "created_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_campuses_university_key_uq" UNIQUE ("university_id", "campus_key"),
  CONSTRAINT "institution_campuses_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_campuses_key_chk" CHECK (length("campus_key") BETWEEN 2 AND 96 AND "campus_key" ~ '^[a-z][a-z0-9._:-]+$'),
  CONSTRAINT "institution_campuses_name_chk" CHECK (length(trim("name")) BETWEEN 1 AND 240),
  CONSTRAINT "institution_campuses_country_chk" CHECK ("country_code" ~ '^[A-Z]{2}$'),
  CONSTRAINT "institution_campuses_modes_chk" CHECK (
    cardinality("delivery_modes") BETWEEN 1 AND 4
    AND "delivery_modes" <@ ARRAY['ON_CAMPUS','ONLINE','HYBRID','BLENDED']::text[]
  ),
  CONSTRAINT "institution_campuses_timezone_chk" CHECK (length("source_timezone") BETWEEN 1 AND 64 AND "source_timezone" !~ '[[:space:]]'),
  CONSTRAINT "institution_campuses_source_pair_chk" CHECK (
    ("source_record_id" IS NULL AND "source_verified_at" IS NULL AND "source_expires_at" IS NULL)
    OR ("source_record_id" IS NOT NULL AND "source_verified_at" IS NOT NULL)
  ),
  CONSTRAINT "institution_campuses_version_chk" CHECK ("version" > 0)
);
CREATE INDEX "institution_campuses_university_active_idx"
  ON "institution_campuses" ("university_id", "is_active", "id");

CREATE TABLE "program_intakes" (
  "id" uuid PRIMARY KEY,
  "program_id" integer NOT NULL REFERENCES "programs"("id") ON DELETE RESTRICT,
  "campus_id" uuid REFERENCES "institution_campuses"("id") ON DELETE RESTRICT,
  "intake_key" text NOT NULL,
  "academic_year" integer NOT NULL,
  "starts_on" date,
  "application_deadline_at" timestamptz,
  "source_timezone" text NOT NULL,
  "capacity_status" text NOT NULL DEFAULT 'UNKNOWN',
  "delivery_mode" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "source_record_id" uuid REFERENCES "catalog_source_records"("id") ON DELETE RESTRICT,
  "source_verified_at" timestamptz,
  "source_expires_at" timestamptz,
  "version" bigint NOT NULL DEFAULT 1,
  "created_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "program_intakes_program_id_id_uq" UNIQUE ("program_id", "id"),
  CONSTRAINT "program_intakes_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "program_intakes_key_chk" CHECK (length("intake_key") BETWEEN 2 AND 96 AND "intake_key" ~ '^[a-z0-9][a-z0-9._:-]+$'),
  CONSTRAINT "program_intakes_year_chk" CHECK ("academic_year" BETWEEN 2000 AND 2200),
  CONSTRAINT "program_intakes_timezone_chk" CHECK (length("source_timezone") BETWEEN 1 AND 64 AND "source_timezone" !~ '[[:space:]]'),
  CONSTRAINT "program_intakes_capacity_chk" CHECK ("capacity_status" IN ('OPEN', 'LIMITED', 'FULL', 'WAITLIST', 'CLOSED', 'UNKNOWN')),
  CONSTRAINT "program_intakes_delivery_chk" CHECK ("delivery_mode" IN ('ON_CAMPUS', 'ONLINE', 'HYBRID', 'BLENDED')),
  CONSTRAINT "program_intakes_status_chk" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED', 'ARCHIVED')),
  CONSTRAINT "program_intakes_source_pair_chk" CHECK (
    ("source_record_id" IS NULL AND "source_verified_at" IS NULL AND "source_expires_at" IS NULL)
    OR ("source_record_id" IS NOT NULL AND "source_verified_at" IS NOT NULL)
  ),
  CONSTRAINT "program_intakes_version_chk" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "program_intakes_identity_uq"
  ON "program_intakes" ("program_id", COALESCE("campus_id", '00000000-0000-0000-0000-000000000000'::uuid), "intake_key", "academic_year");
CREATE INDEX "program_intakes_public_lookup_idx"
  ON "program_intakes" ("program_id", "status", "academic_year", "application_deadline_at", "id");
CREATE INDEX "program_intakes_freshness_idx"
  ON "program_intakes" ("source_expires_at", "capacity_status", "id")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "price_components" (
  "id" uuid PRIMARY KEY,
  "program_id" integer NOT NULL REFERENCES "programs"("id") ON DELETE RESTRICT,
  "intake_id" uuid,
  "component_code" text NOT NULL,
  "component_type" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency_code" text NOT NULL,
  "frequency" text NOT NULL,
  "effective_from" timestamptz NOT NULL,
  "effective_until" timestamptz,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "source_record_id" uuid NOT NULL REFERENCES "catalog_source_records"("id") ON DELETE RESTRICT,
  "source_verified_at" timestamptz NOT NULL,
  "source_expires_at" timestamptz,
  "version" bigint NOT NULL DEFAULT 1,
  "created_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "price_components_program_intake_fk" FOREIGN KEY ("program_id", "intake_id") REFERENCES "program_intakes"("program_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "price_components_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "price_components_code_chk" CHECK (length("component_code") BETWEEN 2 AND 96 AND "component_code" ~ '^[A-Z][A-Z0-9_]+$'),
  CONSTRAINT "price_components_type_chk" CHECK ("component_type" IN ('TUITION', 'APPLICATION', 'DEPOSIT', 'SERVICE', 'LANGUAGE', 'INSURANCE', 'OTHER')),
  CONSTRAINT "price_components_amount_chk" CHECK ("amount_minor" >= 0),
  CONSTRAINT "price_components_currency_chk" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT "price_components_frequency_chk" CHECK ("frequency" IN ('ONE_TIME', 'PER_YEAR', 'PER_TERM', 'PER_CREDIT', 'PER_MONTH')),
  CONSTRAINT "price_components_window_chk" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "price_components_source_expiry_chk" CHECK ("source_expires_at" IS NULL OR "source_expires_at" > "source_verified_at"),
  CONSTRAINT "price_components_status_chk" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  CONSTRAINT "price_components_version_chk" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "price_components_identity_uq"
  ON "price_components" ("program_id", COALESCE("intake_id", '00000000-0000-0000-0000-000000000000'::uuid), "component_code", "effective_from");
CREATE INDEX "price_components_public_lookup_idx"
  ON "price_components" ("program_id", "intake_id", "status", "effective_from", "effective_until", "id");
CREATE INDEX "price_components_freshness_idx"
  ON "price_components" ("source_expires_at", "currency_code", "id")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "tenant_catalog_listings" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL,
  "program_id" integer NOT NULL REFERENCES "programs"("id") ON DELETE RESTRICT,
  "intake_id" uuid,
  "visibility" text NOT NULL DEFAULT 'HIDDEN',
  "publication_status" text NOT NULL DEFAULT 'DRAFT',
  "commercial_copy_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "pricing_presentation_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "commission_presentation_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "counselor_note" text,
  "version" bigint NOT NULL DEFAULT 1,
  "created_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_by_legacy_user_id" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_catalog_listings_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "tenant_catalog_listings_scope_id_uq" UNIQUE ("tenant_id", "organization_id", "id"),
  CONSTRAINT "tenant_catalog_listings_organization_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "tenant_catalog_listings_program_intake_fk" FOREIGN KEY ("program_id", "intake_id") REFERENCES "program_intakes"("program_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "tenant_catalog_listings_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "tenant_catalog_listings_visibility_chk" CHECK ("visibility" IN ('HIDDEN', 'INTERNAL', 'PUBLIC')),
  CONSTRAINT "tenant_catalog_listings_publication_chk" CHECK ("publication_status" IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT "tenant_catalog_listings_public_gate_chk" CHECK ("visibility" <> 'PUBLIC' OR "publication_status" = 'PUBLISHED'),
  CONSTRAINT "tenant_catalog_listings_payload_chk" CHECK (
    jsonb_typeof("commercial_copy_json") = 'object'
    AND jsonb_typeof("pricing_presentation_json") = 'object'
    AND jsonb_typeof("commission_presentation_json") = 'object'
    AND octet_length("commercial_copy_json"::text) <= 262144
    AND octet_length("pricing_presentation_json"::text) <= 65536
    AND octet_length("commission_presentation_json"::text) <= 65536
  ),
  CONSTRAINT "tenant_catalog_listings_note_chk" CHECK ("counselor_note" IS NULL OR length("counselor_note") <= 8000),
  CONSTRAINT "tenant_catalog_listings_review_pair_chk" CHECK (("reviewed_by_legacy_user_id" IS NULL) = ("reviewed_at" IS NULL)),
  CONSTRAINT "tenant_catalog_listings_checker_chk" CHECK ("reviewed_by_legacy_user_id" IS NULL OR "reviewed_by_legacy_user_id" <> "created_by_legacy_user_id"),
  CONSTRAINT "tenant_catalog_listings_reviewed_status_chk" CHECK ("publication_status" NOT IN ('APPROVED', 'PUBLISHED') OR "reviewed_at" IS NOT NULL),
  CONSTRAINT "tenant_catalog_listings_version_chk" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "tenant_catalog_listings_identity_uq"
  ON "tenant_catalog_listings" ("tenant_id", "organization_id", "program_id", COALESCE("intake_id", '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX "tenant_catalog_listings_scope_status_idx"
  ON "tenant_catalog_listings" ("tenant_id", "organization_id", "visibility", "publication_status", "program_id", "id");

CREATE OR REPLACE FUNCTION "protect_catalog_source_record"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'catalog source records are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "catalog_source_records_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_source_records"
  FOR EACH ROW EXECUTE FUNCTION "protect_catalog_source_record"();

CREATE OR REPLACE FUNCTION "enforce_catalog_verified_source_binding"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_row "catalog_source_records"%ROWTYPE;
  expected_entity_type text;
BEGIN
  expected_entity_type := CASE TG_TABLE_NAME
    WHEN 'institution_campuses' THEN 'CAMPUS'
    WHEN 'program_intakes' THEN 'INTAKE'
    WHEN 'price_components' THEN 'PRICE'
    ELSE NULL
  END;

  IF NEW."source_record_id" IS NULL THEN
    IF TG_TABLE_NAME = 'price_components' THEN
      RAISE EXCEPTION 'price components require verified source evidence' USING ERRCODE = '23514';
    END IF;
    IF NEW."source_verified_at" IS NOT NULL OR NEW."source_expires_at" IS NOT NULL THEN
      RAISE EXCEPTION 'catalog source timestamps require a source record' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO source_row
  FROM "catalog_source_records"
  WHERE "id" = NEW."source_record_id";

  IF NOT FOUND
     OR source_row."entity_type" <> expected_entity_type
     OR source_row."status" <> 'VERIFIED'
     OR source_row."verified_at" IS NULL
     OR (source_row."expires_at" IS NOT NULL AND source_row."expires_at" <= now()) THEN
    RAISE EXCEPTION 'catalog entity requires current verified source evidence of the matching type' USING ERRCODE = '23514';
  END IF;

  NEW."source_verified_at" := source_row."verified_at";
  NEW."source_expires_at" := source_row."expires_at";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "institution_campuses_source_guard"
  BEFORE INSERT OR UPDATE OF "source_record_id" ON "institution_campuses"
  FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_verified_source_binding"();
CREATE TRIGGER "program_intakes_source_guard"
  BEFORE INSERT OR UPDATE OF "source_record_id" ON "program_intakes"
  FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_verified_source_binding"();
CREATE TRIGGER "price_components_source_guard"
  BEFORE INSERT OR UPDATE OF "source_record_id" ON "price_components"
  FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_verified_source_binding"();

CREATE OR REPLACE FUNCTION "enforce_program_intake_campus_scope"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."campus_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "programs" program
    JOIN "institution_campuses" campus
      ON campus."id" = NEW."campus_id"
     AND campus."university_id" = program."university_id"
    WHERE program."id" = NEW."program_id"
  ) THEN
    RAISE EXCEPTION 'program intake campus must belong to the awarding university' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "program_intakes_campus_scope_guard"
  BEFORE INSERT OR UPDATE OF "program_id", "campus_id" ON "program_intakes"
  FOR EACH ROW EXECUTE FUNCTION "enforce_program_intake_campus_scope"();

ALTER TABLE "tenant_catalog_listings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_catalog_listings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_catalog_listings_scope_select" ON "tenant_catalog_listings"
  FOR SELECT USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND "organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid
  );
CREATE POLICY "tenant_catalog_listings_scope_insert" ON "tenant_catalog_listings"
  FOR INSERT WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND "organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid
  );
CREATE POLICY "tenant_catalog_listings_scope_update" ON "tenant_catalog_listings"
  FOR UPDATE USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND "organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid
  ) WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND "organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid
  );

-- Deliberately absent: requirement-table duplication, legacy float rewrites,
-- unbounded backfill, public routes, provider calls and role-package grants.
