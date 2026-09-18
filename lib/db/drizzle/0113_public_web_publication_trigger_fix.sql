-- Additive fix for the 0112 publication trigger. PostgreSQL RECORD values
-- have no tuple structure before assignment, so all revision fields use
-- initialized scalar variables and INDEX checks run only inside their branch.

CREATE OR REPLACE FUNCTION "enforce_public_web_publication_state"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_quality_status text;
  revision_source_coverage text;
  revision_translation_status text;
  revision_seo_status text;
  revision_structured_data_status text;
  revision_author_legacy_user_id integer;
  content_entity_type text;
  content_locale text;
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
    INTO
      revision_quality_status,
      revision_source_coverage,
      revision_translation_status,
      revision_seo_status,
      revision_structured_data_status,
      revision_author_legacy_user_id,
      content_entity_type,
      content_locale
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
      OR revision_quality_status <> 'PASS'
      OR revision_source_coverage <> 'COMPLETE' THEN
      RAISE EXCEPTION 'public web approval requires a PASS revision with COMPLETE source coverage' USING ERRCODE = '23514';
    END IF;

    IF (content_locale = 'en' AND revision_translation_status <> 'SOURCE')
      OR (content_locale <> 'en' AND revision_translation_status <> 'PUBLISHED') THEN
      RAISE EXCEPTION 'public web approval requires a ready locale translation' USING ERRCODE = '23514';
    END IF;

    IF NEW."reviewed_by_legacy_user_id" IS NULL
      OR NEW."reviewed_by_legacy_user_id" = revision_author_legacy_user_id THEN
      RAISE EXCEPTION 'public web approval requires an independent reviewer' USING ERRCODE = '23514';
    END IF;

    required_fact_keys := CASE content_entity_type
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

    IF NEW."index_state" = 'INDEX' AND (
      revision_seo_status <> 'PASS'
      OR revision_structured_data_status <> 'PASS'
    ) THEN
      RAISE EXCEPTION 'public web indexing requires PASS SEO and structured data' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" = 'PUBLISHED' AND NEW."published_by_legacy_user_id" IS NULL THEN
    RAISE EXCEPTION 'public web publish requires an attributable publisher' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Deliberately absent: data rewrites, public routes, grants and provider calls.
