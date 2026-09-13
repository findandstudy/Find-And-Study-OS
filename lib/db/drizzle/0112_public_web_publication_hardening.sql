-- Additive publication hardening for the public web foundation.
-- Keeps 0109 immutable after local application and makes the database enforce
-- critical-fact coverage plus translation/SEO/structured-data readiness.

ALTER TABLE "public_web_content_revisions"
  ADD COLUMN "translation_status" text NOT NULL DEFAULT 'MISSING',
  ADD COLUMN "seo_status" text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "structured_data_status" text NOT NULL DEFAULT 'PENDING',
  ADD CONSTRAINT "public_web_content_revisions_translation_chk" CHECK (
    "translation_status" IN ('SOURCE', 'PUBLISHED', 'MISSING', 'STALE')
  ),
  ADD CONSTRAINT "public_web_content_revisions_seo_status_chk" CHECK (
    "seo_status" IN ('PENDING', 'PASS', 'FAIL')
  ),
  ADD CONSTRAINT "public_web_content_revisions_structured_status_chk" CHECK (
    "structured_data_status" IN ('PENDING', 'PASS', 'FAIL')
  );

ALTER TABLE "public_web_source_evidence"
  DROP CONSTRAINT "public_web_source_evidence_expiry_chk";
ALTER TABLE "public_web_source_evidence"
  ADD CONSTRAINT "public_web_source_evidence_expiry_chk" CHECK (
    "expires_at" IS NULL
    OR "expires_at" > GREATEST(
      COALESCE("effective_from", "verified_at"),
      "verified_at"
    )
  );

CREATE OR REPLACE FUNCTION "enforce_public_web_source_evidence_contract"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(NEW."fact_keys") AS fact_key
    WHERE fact_key !~ '^[a-z][a-z0-9_]{0,63}$'
  ) OR (
    SELECT count(*) FROM unnest(NEW."fact_keys") AS fact_key
  ) <> (
    SELECT count(DISTINCT fact_key) FROM unnest(NEW."fact_keys") AS fact_key
  ) THEN
    RAISE EXCEPTION 'public web evidence fact keys must be unique lowercase identifiers' USING ERRCODE = '23514';
  END IF;

  IF NEW."observed_at" > now() + interval '5 minutes'
    OR (NEW."verified_at" IS NOT NULL AND NEW."verified_at" < NEW."observed_at")
    OR (NEW."status" = 'VERIFIED') IS DISTINCT FROM (
      NEW."verified_by_legacy_user_id" IS NOT NULL AND NEW."verified_at" IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'public web evidence verification timeline is invalid' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "public_web_source_evidence_contract_guard"
  BEFORE INSERT ON "public_web_source_evidence"
  FOR EACH ROW EXECUTE FUNCTION "enforce_public_web_source_evidence_contract"();

CREATE OR REPLACE FUNCTION "enforce_public_web_publication_state"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_row record;
  required_fact_keys text[];
  missing_fact_keys text;
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW."status" <> 'DRAFT'
    OR NEW."index_state" <> 'NOINDEX'
    OR NEW."reviewed_by_legacy_user_id" IS NOT NULL
    OR NEW."reviewed_at" IS NOT NULL
    OR NEW."published_by_legacy_user_id" IS NOT NULL
    OR NEW."published_at" IS NOT NULL
    OR NEW."stale_reason_code" IS NOT NULL
    OR NEW."version" <> 1
  ) THEN
    RAISE EXCEPTION 'public web publication state must begin as a clean DRAFT' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" <> NEW."status" AND NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('PENDING_REVIEW', 'RETIRED'))
      OR (OLD."status" = 'PENDING_REVIEW' AND NEW."status" IN ('DRAFT', 'APPROVED'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('DRAFT', 'PUBLISHED', 'RETIRED'))
      OR (OLD."status" = 'PUBLISHED' AND NEW."status" IN ('STALE', 'RETIRED'))
      OR (OLD."status" = 'STALE' AND NEW."status" IN ('DRAFT', 'RETIRED'))
    ) THEN
      RAISE EXCEPTION 'invalid public web publication transition: % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
    END IF;

    IF OLD."revision_id" IS DISTINCT FROM NEW."revision_id"
      AND NOT (OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT') THEN
      RAISE EXCEPTION 'public web revision can only change while publication remains DRAFT' USING ERRCODE = '23514';
    END IF;

    IF NEW."status" IN ('DRAFT', 'PENDING_REVIEW') THEN
      NEW."reviewed_by_legacy_user_id" := NULL;
      NEW."reviewed_at" := NULL;
    ELSIF OLD."status" IN ('APPROVED', 'PUBLISHED', 'STALE', 'RETIRED')
      AND NEW."status" <> 'DRAFT'
      AND (
        OLD."reviewed_by_legacy_user_id" IS DISTINCT FROM NEW."reviewed_by_legacy_user_id"
        OR OLD."reviewed_at" IS DISTINCT FROM NEW."reviewed_at"
      ) THEN
      RAISE EXCEPTION 'public web review evidence is immutable after approval' USING ERRCODE = '23514';
    END IF;

    IF NEW."status" IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED') THEN
      NEW."published_by_legacy_user_id" := NULL;
      NEW."published_at" := NULL;
    ELSIF OLD."status" IN ('PUBLISHED', 'STALE', 'RETIRED')
      AND NEW."status" <> 'DRAFT'
      AND (
        OLD."published_by_legacy_user_id" IS DISTINCT FROM NEW."published_by_legacy_user_id"
        OR OLD."published_at" IS DISTINCT FROM NEW."published_at"
      ) THEN
      RAISE EXCEPTION 'public web publish evidence is immutable after publication' USING ERRCODE = '23514';
    END IF;

    IF NEW."status" <> 'STALE' THEN
      NEW."stale_reason_code" := NULL;
    END IF;
    IF NEW."status" <> 'PUBLISHED' THEN
      NEW."index_state" := 'NOINDEX';
    END IF;

    NEW."version" := OLD."version" + 1;
    NEW."updated_at" := now();
  END IF;

  IF NEW."status" IN ('APPROVED', 'PUBLISHED') THEN
    SELECT
      revision."quality_status",
      revision."source_coverage",
      revision."translation_status",
      revision."seo_status",
      revision."structured_data_status",
      revision."created_by_legacy_user_id",
      content."entity_type",
      content."locale"
      INTO revision_row
    FROM "public_web_content_revisions" revision
    JOIN "public_web_content_records" content
      ON content."tenant_id" = revision."tenant_id"
      AND content."organization_id" = revision."organization_id"
      AND content."id" = revision."content_record_id"
    WHERE revision."tenant_id" = NEW."tenant_id"
      AND revision."organization_id" = NEW."organization_id"
      AND revision."content_record_id" = NEW."content_record_id"
      AND revision."id" = NEW."revision_id";

    IF NOT FOUND
      OR revision_row."quality_status" <> 'PASS'
      OR revision_row."source_coverage" <> 'COMPLETE' THEN
      RAISE EXCEPTION 'public web approval requires a PASS revision with COMPLETE source coverage' USING ERRCODE = '23514';
    END IF;

    IF (revision_row."locale" = 'en' AND revision_row."translation_status" <> 'SOURCE')
      OR (revision_row."locale" <> 'en' AND revision_row."translation_status" <> 'PUBLISHED') THEN
      RAISE EXCEPTION 'public web approval requires a ready locale translation' USING ERRCODE = '23514';
    END IF;

    IF NEW."reviewed_by_legacy_user_id" IS NULL
      OR NEW."reviewed_by_legacy_user_id" = revision_row."created_by_legacy_user_id" THEN
      RAISE EXCEPTION 'public web approval requires an independent reviewer' USING ERRCODE = '23514';
    END IF;

    required_fact_keys := CASE revision_row."entity_type"
      WHEN 'PROGRAM' THEN ARRAY['name','institution','degree','tuition','currency','duration','requirements','intakes']
      WHEN 'UNIVERSITY' THEN ARRAY['name','country','status']
      WHEN 'DESTINATION' THEN ARRAY['name','country','body']
      WHEN 'PAGE' THEN ARRAY['title','body']
      WHEN 'ARTICLE' THEN ARRAY['title','body']
      ELSE ARRAY[]::text[]
    END;

    SELECT string_agg(required_fact_key, ',' ORDER BY required_fact_key)
      INTO missing_fact_keys
    FROM unnest(required_fact_keys) AS required_fact_key
    WHERE NOT EXISTS (
      SELECT 1
      FROM "public_web_source_evidence" evidence
      WHERE evidence."tenant_id" = NEW."tenant_id"
        AND evidence."organization_id" = NEW."organization_id"
        AND evidence."content_record_id" = NEW."content_record_id"
        AND evidence."revision_id" = NEW."revision_id"
        AND evidence."status" = 'VERIFIED'
        AND evidence."verified_at" <= now()
        AND (evidence."effective_from" IS NULL OR evidence."effective_from" <= now())
        AND (evidence."effective_to" IS NULL OR evidence."effective_to" > now())
        AND (evidence."expires_at" IS NULL OR evidence."expires_at" > now())
        AND required_fact_key = ANY(evidence."fact_keys")
    );

    IF missing_fact_keys IS NOT NULL THEN
      RAISE EXCEPTION 'public web approval lacks current verified critical facts: %', missing_fact_keys USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" = 'PUBLISHED' AND NEW."published_by_legacy_user_id" IS NULL THEN
    RAISE EXCEPTION 'public web publish requires an attributable publisher' USING ERRCODE = '23514';
  END IF;

  IF NEW."index_state" = 'INDEX' AND (
    revision_row."seo_status" <> 'PASS'
    OR revision_row."structured_data_status" <> 'PASS'
  ) THEN
    RAISE EXCEPTION 'public web indexing requires PASS SEO and structured data' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Deliberately absent: public routes, mass backfills, AI auto-publish, role
-- grants, provider calls and changes to legacy Website CMS records.
