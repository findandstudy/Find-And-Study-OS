-- Additive hardening for the canonical catalogue entity graph.
-- Keeps 0110 immutable after local application while tightening source and
-- commercial-listing invariants. No data backfill or runtime wiring occurs.

ALTER TABLE "catalog_source_records"
  DROP CONSTRAINT "catalog_source_records_time_chk";
ALTER TABLE "catalog_source_records"
  ADD CONSTRAINT "catalog_source_records_time_chk" CHECK (
    ("verified_at" IS NULL OR "verified_at" >= "fetched_at")
    AND (
      "expires_at" IS NULL
      OR "expires_at" > GREATEST("effective_at", COALESCE("verified_at", "effective_at"))
    )
  );

-- Tenant-specific service fees already have an authoritative finance model.
-- A global canonical catalogue price must not silently duplicate that truth.
ALTER TABLE "price_components"
  DROP CONSTRAINT "price_components_type_chk";
ALTER TABLE "price_components"
  ADD CONSTRAINT "price_components_type_chk" CHECK (
    "component_type" IN ('TUITION', 'APPLICATION', 'DEPOSIT', 'LANGUAGE', 'INSURANCE', 'OTHER')
  );

DROP TRIGGER "institution_campuses_source_guard" ON "institution_campuses";
CREATE TRIGGER "institution_campuses_source_guard"
  BEFORE INSERT OR UPDATE OF "source_record_id", "source_verified_at", "source_expires_at"
  ON "institution_campuses"
  FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_verified_source_binding"();

DROP TRIGGER "program_intakes_source_guard" ON "program_intakes";
CREATE TRIGGER "program_intakes_source_guard"
  BEFORE INSERT OR UPDATE OF "source_record_id", "source_verified_at", "source_expires_at"
  ON "program_intakes"
  FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_verified_source_binding"();

DROP TRIGGER "price_components_source_guard" ON "price_components";
CREATE TRIGGER "price_components_source_guard"
  BEFORE INSERT OR UPDATE OF "source_record_id", "source_verified_at", "source_expires_at"
  ON "price_components"
  FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_verified_source_binding"();

CREATE OR REPLACE FUNCTION "enforce_tenant_catalog_listing_transition"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publication_status" <> NEW."publication_status" AND NOT (
    (OLD."publication_status" = 'DRAFT' AND NEW."publication_status" IN ('IN_REVIEW', 'RETIRED'))
    OR (OLD."publication_status" = 'IN_REVIEW' AND NEW."publication_status" IN ('DRAFT', 'APPROVED'))
    OR (OLD."publication_status" = 'APPROVED' AND NEW."publication_status" IN ('DRAFT', 'PUBLISHED', 'RETIRED'))
    OR (OLD."publication_status" = 'PUBLISHED' AND NEW."publication_status" = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'invalid tenant catalog listing transition: % -> %', OLD."publication_status", NEW."publication_status" USING ERRCODE = '23514';
  END IF;

  IF OLD."publication_status" <> 'DRAFT' AND (
    OLD."tenant_id" IS DISTINCT FROM NEW."tenant_id"
    OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id"
    OR OLD."program_id" IS DISTINCT FROM NEW."program_id"
    OR OLD."intake_id" IS DISTINCT FROM NEW."intake_id"
    OR OLD."commercial_copy_json" IS DISTINCT FROM NEW."commercial_copy_json"
    OR OLD."pricing_presentation_json" IS DISTINCT FROM NEW."pricing_presentation_json"
    OR OLD."commission_presentation_json" IS DISTINCT FROM NEW."commission_presentation_json"
    OR OLD."counselor_note" IS DISTINCT FROM NEW."counselor_note"
    OR OLD."created_by_legacy_user_id" IS DISTINCT FROM NEW."created_by_legacy_user_id"
  ) THEN
    RAISE EXCEPTION 'reviewed tenant catalog listing content is immutable; return it to DRAFT first' USING ERRCODE = '23514';
  END IF;

  IF NEW."publication_status" IN ('DRAFT', 'IN_REVIEW') THEN
    NEW."reviewed_by_legacy_user_id" := NULL;
    NEW."reviewed_at" := NULL;
  ELSIF OLD."publication_status" IN ('APPROVED', 'PUBLISHED', 'RETIRED')
    AND NEW."publication_status" <> 'DRAFT'
    AND (
      OLD."reviewed_by_legacy_user_id" IS DISTINCT FROM NEW."reviewed_by_legacy_user_id"
      OR OLD."reviewed_at" IS DISTINCT FROM NEW."reviewed_at"
    ) THEN
    RAISE EXCEPTION 'tenant catalog listing review evidence is immutable after approval' USING ERRCODE = '23514';
  END IF;

  IF NEW."publication_status" IN ('APPROVED', 'PUBLISHED') AND (
    NEW."reviewed_by_legacy_user_id" IS NULL
    OR NEW."reviewed_at" IS NULL
    OR NEW."reviewed_by_legacy_user_id" = NEW."created_by_legacy_user_id"
  ) THEN
    RAISE EXCEPTION 'tenant catalog listing approval requires an independent reviewer' USING ERRCODE = '23514';
  END IF;

  NEW."version" := OLD."version" + 1;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_tenant_catalog_listing_initial_state"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."publication_status" <> 'DRAFT'
    OR NEW."reviewed_by_legacy_user_id" IS NOT NULL
    OR NEW."reviewed_at" IS NOT NULL THEN
    RAISE EXCEPTION 'tenant catalog listings must begin as an unreviewed DRAFT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_catalog_listings_initial_state_guard"
  BEFORE INSERT ON "tenant_catalog_listings"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tenant_catalog_listing_initial_state"();

CREATE TRIGGER "tenant_catalog_listings_transition_guard"
  BEFORE UPDATE ON "tenant_catalog_listings"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tenant_catalog_listing_transition"();

-- Deliberately absent: edits to existing catalogue rows, service-fee copies,
-- provider calls, public routes, role grants and unbounded updates.
