-- Additive, default-unwired Public Web Content foundation.
--
-- Existing programs, universities, destinations and Website CMS rows remain
-- canonical. These tables add tenant-scoped publication governance, immutable
-- revisions, source evidence, transition receipts and URL history on top of
-- those records. This migration creates no public route, performs no catalogue
-- backfill and grants no role package permission.

CREATE TABLE "public_web_content_records" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "program_id" integer REFERENCES "programs"("id") ON DELETE RESTRICT,
  "university_id" integer REFERENCES "universities"("id") ON DELETE RESTRICT,
  "destination_id" integer REFERENCES "destinations"("id") ON DELETE RESTRICT,
  "website_page_id" integer REFERENCES "website_pages"("id") ON DELETE RESTRICT,
  "blog_post_id" integer REFERENCES "website_blog_posts"("id") ON DELETE RESTRICT,
  "locale" text NOT NULL,
  "canonical_slug" text NOT NULL,
  "canonical_path" text NOT NULL,
  "created_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "public_web_content_records_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "public_web_content_records_scope_id_uq" UNIQUE ("tenant_id", "organization_id", "id"),
  CONSTRAINT "public_web_content_records_scope_path_uq" UNIQUE ("tenant_id", "organization_id", "canonical_path"),
  CONSTRAINT "public_web_content_records_organization_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_content_records_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "public_web_content_records_entity_type_chk" CHECK ("entity_type" IN ('PROGRAM', 'UNIVERSITY', 'DESTINATION', 'PAGE', 'ARTICLE')),
  CONSTRAINT "public_web_content_records_entity_binding_chk" CHECK (
    ("entity_type" = 'PROGRAM' AND "program_id" IS NOT NULL AND "university_id" IS NULL AND "destination_id" IS NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'UNIVERSITY' AND "program_id" IS NULL AND "university_id" IS NOT NULL AND "destination_id" IS NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'DESTINATION' AND "program_id" IS NULL AND "university_id" IS NULL AND "destination_id" IS NOT NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'PAGE' AND "program_id" IS NULL AND "university_id" IS NULL AND "destination_id" IS NULL AND "website_page_id" IS NOT NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'ARTICLE' AND "program_id" IS NULL AND "university_id" IS NULL AND "destination_id" IS NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NOT NULL)
  ),
  CONSTRAINT "public_web_content_records_locale_chk" CHECK ("locale" IN ('en','tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it')),
  CONSTRAINT "public_web_content_records_slug_chk" CHECK (length("canonical_slug") BETWEEN 1 AND 180 AND "canonical_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "public_web_content_records_path_chk" CHECK (
    length("canonical_path") BETWEEN 4 AND 2048
    AND "canonical_path" ~ '^/(en|tr|ar|fr|ru|fa|zh|hi|es|id|ur|tk|ky|kk|uz|tg|bn|pt|ne|vi|ko|uk|it)(/[a-z0-9][a-z0-9._~-]*)+/?$'
    AND "canonical_path" NOT LIKE '%//%'
  )
);

CREATE UNIQUE INDEX "public_web_content_records_program_locale_uq"
  ON "public_web_content_records" ("tenant_id", "organization_id", "program_id", "locale")
  WHERE "entity_type" = 'PROGRAM';
CREATE UNIQUE INDEX "public_web_content_records_university_locale_uq"
  ON "public_web_content_records" ("tenant_id", "organization_id", "university_id", "locale")
  WHERE "entity_type" = 'UNIVERSITY';
CREATE UNIQUE INDEX "public_web_content_records_destination_locale_uq"
  ON "public_web_content_records" ("tenant_id", "organization_id", "destination_id", "locale")
  WHERE "entity_type" = 'DESTINATION';
CREATE UNIQUE INDEX "public_web_content_records_page_locale_uq"
  ON "public_web_content_records" ("tenant_id", "organization_id", "website_page_id", "locale")
  WHERE "entity_type" = 'PAGE';
CREATE UNIQUE INDEX "public_web_content_records_article_locale_uq"
  ON "public_web_content_records" ("tenant_id", "organization_id", "blog_post_id", "locale")
  WHERE "entity_type" = 'ARTICLE';
CREATE INDEX "public_web_content_records_scope_entity_idx"
  ON "public_web_content_records" ("tenant_id", "organization_id", "entity_type", "locale", "id");

CREATE TABLE "public_web_content_revisions" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "content_record_id" uuid NOT NULL,
  "revision_number" bigint NOT NULL,
  "origin" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "content_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "seo_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "structured_data_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_sha256" text NOT NULL,
  "content_sha256" text NOT NULL,
  "generator_receipt_sha256" text,
  "quality_status" text NOT NULL DEFAULT 'PENDING',
  "source_coverage" text NOT NULL DEFAULT 'MISSING',
  "created_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "public_web_content_revisions_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "public_web_content_revisions_scope_record_id_uq" UNIQUE ("tenant_id", "organization_id", "content_record_id", "id"),
  CONSTRAINT "public_web_content_revisions_scope_version_uq" UNIQUE ("tenant_id", "organization_id", "content_record_id", "revision_number"),
  CONSTRAINT "public_web_content_revisions_record_fk" FOREIGN KEY ("tenant_id", "organization_id", "content_record_id") REFERENCES "public_web_content_records"("tenant_id", "organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_content_revisions_organization_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_content_revisions_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "public_web_content_revisions_number_chk" CHECK ("revision_number" > 0),
  CONSTRAINT "public_web_content_revisions_origin_chk" CHECK ("origin" IN ('HUMAN', 'AI_ASSISTED', 'IMPORT')),
  CONSTRAINT "public_web_content_revisions_title_chk" CHECK (length(trim("title")) BETWEEN 1 AND 500),
  CONSTRAINT "public_web_content_revisions_summary_chk" CHECK ("summary" IS NULL OR length("summary") <= 4000),
  CONSTRAINT "public_web_content_revisions_payload_chk" CHECK (
    jsonb_typeof("content_json") = 'object'
    AND jsonb_typeof("seo_json") = 'object'
    AND jsonb_typeof("structured_data_json") = 'object'
    AND octet_length("content_json"::text) <= 1048576
    AND octet_length("seo_json"::text) <= 65536
    AND octet_length("structured_data_json"::text) <= 262144
  ),
  CONSTRAINT "public_web_content_revisions_hash_chk" CHECK (
    "source_sha256" ~ '^[0-9a-f]{64}$'
    AND "content_sha256" ~ '^[0-9a-f]{64}$'
    AND ("generator_receipt_sha256" IS NULL OR "generator_receipt_sha256" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "public_web_content_revisions_ai_receipt_chk" CHECK ("origin" <> 'AI_ASSISTED' OR "generator_receipt_sha256" IS NOT NULL),
  CONSTRAINT "public_web_content_revisions_quality_chk" CHECK ("quality_status" IN ('PENDING', 'PASS', 'FAIL')),
  CONSTRAINT "public_web_content_revisions_coverage_chk" CHECK ("source_coverage" IN ('MISSING', 'PARTIAL', 'COMPLETE'))
);
CREATE INDEX "public_web_content_revisions_record_idx"
  ON "public_web_content_revisions" ("tenant_id", "organization_id", "content_record_id", "revision_number" DESC);

CREATE TABLE "public_web_source_evidence" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "content_record_id" uuid NOT NULL,
  "revision_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "source_visibility" text NOT NULL DEFAULT 'INTERNAL',
  "source_url" text,
  "source_reference_sha256" text NOT NULL,
  "source_content_sha256" text NOT NULL,
  "fact_keys" text[] NOT NULL,
  "status" text NOT NULL DEFAULT 'OBSERVED',
  "observed_at" timestamptz NOT NULL,
  "effective_from" timestamptz,
  "effective_to" timestamptz,
  "verified_by_legacy_user_id" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_at" timestamptz,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "public_web_source_evidence_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "public_web_source_evidence_revision_fk" FOREIGN KEY ("tenant_id", "organization_id", "content_record_id", "revision_id") REFERENCES "public_web_content_revisions"("tenant_id", "organization_id", "content_record_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_source_evidence_organization_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_source_evidence_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "public_web_source_evidence_type_chk" CHECK ("source_type" IN ('INSTITUTION', 'GOVERNMENT', 'CONTRACT', 'PARTNER', 'EDITORIAL', 'OTHER')),
  CONSTRAINT "public_web_source_evidence_visibility_chk" CHECK ("source_visibility" IN ('PUBLIC', 'INTERNAL')),
  CONSTRAINT "public_web_source_evidence_url_chk" CHECK (
    "source_url" IS NULL OR (
      length("source_url") BETWEEN 10 AND 2048
      AND "source_url" ~ '^https://'
      AND "source_url" NOT LIKE '%#%'
    )
  ),
  CONSTRAINT "public_web_source_evidence_hash_chk" CHECK (
    "source_reference_sha256" ~ '^[0-9a-f]{64}$'
    AND "source_content_sha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "public_web_source_evidence_fact_keys_chk" CHECK (
    cardinality("fact_keys") BETWEEN 1 AND 64
    AND array_position("fact_keys", NULL) IS NULL
  ),
  CONSTRAINT "public_web_source_evidence_status_chk" CHECK ("status" IN ('OBSERVED', 'VERIFIED', 'REJECTED', 'SUPERSEDED')),
  CONSTRAINT "public_web_source_evidence_verification_pair_chk" CHECK (("verified_by_legacy_user_id" IS NULL) = ("verified_at" IS NULL)),
  CONSTRAINT "public_web_source_evidence_verified_chk" CHECK ("status" <> 'VERIFIED' OR "verified_at" IS NOT NULL),
  CONSTRAINT "public_web_source_evidence_effective_window_chk" CHECK ("effective_to" IS NULL OR ("effective_from" IS NOT NULL AND "effective_to" > "effective_from")),
  CONSTRAINT "public_web_source_evidence_expiry_chk" CHECK ("expires_at" IS NULL OR ("verified_at" IS NOT NULL AND "expires_at" > "verified_at"))
);
CREATE INDEX "public_web_source_evidence_revision_idx"
  ON "public_web_source_evidence" ("tenant_id", "organization_id", "content_record_id", "revision_id", "status", "expires_at");

CREATE TABLE "public_web_publication_states" (
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "content_record_id" uuid NOT NULL,
  "revision_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "index_state" text NOT NULL DEFAULT 'NOINDEX',
  "reviewed_by_legacy_user_id" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_at" timestamptz,
  "published_by_legacy_user_id" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "published_at" timestamptz,
  "stale_reason_code" text,
  "version" bigint NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "public_web_publication_states_pk" PRIMARY KEY ("tenant_id", "content_record_id"),
  CONSTRAINT "public_web_publication_states_scope_record_uq" UNIQUE ("tenant_id", "organization_id", "content_record_id"),
  CONSTRAINT "public_web_publication_states_revision_fk" FOREIGN KEY ("tenant_id", "organization_id", "content_record_id", "revision_id") REFERENCES "public_web_content_revisions"("tenant_id", "organization_id", "content_record_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_publication_states_organization_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_publication_states_status_chk" CHECK ("status" IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'STALE', 'RETIRED')),
  CONSTRAINT "public_web_publication_states_index_chk" CHECK ("index_state" IN ('NOINDEX', 'INDEX')),
  CONSTRAINT "public_web_publication_states_index_status_chk" CHECK ("index_state" = 'NOINDEX' OR "status" = 'PUBLISHED'),
  CONSTRAINT "public_web_publication_states_review_pair_chk" CHECK (("reviewed_by_legacy_user_id" IS NULL) = ("reviewed_at" IS NULL)),
  CONSTRAINT "public_web_publication_states_publish_pair_chk" CHECK (("published_by_legacy_user_id" IS NULL) = ("published_at" IS NULL)),
  CONSTRAINT "public_web_publication_states_reviewed_status_chk" CHECK ("status" NOT IN ('APPROVED', 'PUBLISHED', 'STALE') OR "reviewed_at" IS NOT NULL),
  CONSTRAINT "public_web_publication_states_published_status_chk" CHECK ("status" NOT IN ('PUBLISHED', 'STALE') OR "published_at" IS NOT NULL),
  CONSTRAINT "public_web_publication_states_stale_reason_chk" CHECK (("status" = 'STALE') = ("stale_reason_code" IS NOT NULL)),
  CONSTRAINT "public_web_publication_states_version_chk" CHECK ("version" > 0)
);
CREATE INDEX "public_web_publication_states_queue_idx"
  ON "public_web_publication_states" ("tenant_id", "organization_id", "status", "updated_at", "content_record_id");

CREATE TABLE "public_web_publication_receipts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "content_record_id" uuid NOT NULL,
  "revision_id" uuid NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "index_state" text NOT NULL,
  "actor_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "request_key" text NOT NULL,
  "evidence_sha256" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "public_web_publication_receipts_pk" PRIMARY KEY ("tenant_id", "id"),
  CONSTRAINT "public_web_publication_receipts_request_uq" UNIQUE ("tenant_id", "request_key"),
  CONSTRAINT "public_web_publication_receipts_revision_fk" FOREIGN KEY ("tenant_id", "organization_id", "content_record_id", "revision_id") REFERENCES "public_web_content_revisions"("tenant_id", "organization_id", "content_record_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_publication_receipts_organization_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_publication_receipts_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "public_web_publication_receipts_status_chk" CHECK (
    ("from_status" IS NULL OR "from_status" IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'STALE', 'RETIRED'))
    AND "to_status" IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'STALE', 'RETIRED')
  ),
  CONSTRAINT "public_web_publication_receipts_index_chk" CHECK ("index_state" IN ('NOINDEX', 'INDEX')),
  CONSTRAINT "public_web_publication_receipts_request_chk" CHECK (length("request_key") BETWEEN 8 AND 160 AND "request_key" ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT "public_web_publication_receipts_hash_chk" CHECK ("evidence_sha256" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "public_web_publication_receipts_record_idx"
  ON "public_web_publication_receipts" ("tenant_id", "organization_id", "content_record_id", "occurred_at" DESC);

CREATE TABLE "public_web_route_aliases" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "content_record_id" uuid NOT NULL,
  "path" text NOT NULL,
  "route_kind" text NOT NULL,
  "redirect_to_path" text,
  "http_status" integer NOT NULL,
  "valid_from" timestamptz NOT NULL DEFAULT now(),
  "valid_to" timestamptz,
  "created_by_legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "public_web_route_aliases_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "public_web_route_aliases_record_fk" FOREIGN KEY ("tenant_id", "organization_id", "content_record_id") REFERENCES "public_web_content_records"("tenant_id", "organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_route_aliases_organization_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "public_web_route_aliases_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "public_web_route_aliases_kind_chk" CHECK ("route_kind" IN ('CANONICAL', 'REDIRECT', 'GONE')),
  CONSTRAINT "public_web_route_aliases_path_chk" CHECK (
    length("path") BETWEEN 4 AND 2048
    AND "path" ~ '^/(en|tr|ar|fr|ru|fa|zh|hi|es|id|ur|tk|ky|kk|uz|tg|bn|pt|ne|vi|ko|uk|it)(/[a-z0-9][a-z0-9._~-]*)+/?$'
    AND "path" NOT LIKE '%//%'
  ),
  CONSTRAINT "public_web_route_aliases_target_chk" CHECK (
    "redirect_to_path" IS NULL OR (
      length("redirect_to_path") BETWEEN 4 AND 2048
      AND "redirect_to_path" ~ '^/(en|tr|ar|fr|ru|fa|zh|hi|es|id|ur|tk|ky|kk|uz|tg|bn|pt|ne|vi|ko|uk|it)(/[a-z0-9][a-z0-9._~-]*)+/?$'
      AND "redirect_to_path" NOT LIKE '%//%'
      AND "redirect_to_path" <> "path"
    )
  ),
  CONSTRAINT "public_web_route_aliases_semantics_chk" CHECK (
    ("route_kind" = 'CANONICAL' AND "redirect_to_path" IS NULL AND "http_status" = 200)
    OR ("route_kind" = 'REDIRECT' AND "redirect_to_path" IS NOT NULL AND "http_status" IN (301, 308))
    OR ("route_kind" = 'GONE' AND "redirect_to_path" IS NULL AND "http_status" = 410)
  ),
  CONSTRAINT "public_web_route_aliases_window_chk" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from")
);
CREATE UNIQUE INDEX "public_web_route_aliases_active_path_uq"
  ON "public_web_route_aliases" ("tenant_id", "organization_id", "path")
  WHERE "valid_to" IS NULL;
CREATE UNIQUE INDEX "public_web_route_aliases_active_canonical_uq"
  ON "public_web_route_aliases" ("tenant_id", "organization_id", "content_record_id")
  WHERE "valid_to" IS NULL AND "route_kind" = 'CANONICAL';

CREATE OR REPLACE FUNCTION "protect_public_web_immutable_record"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'public web evidence and revision records are append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "public_web_content_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "public_web_content_revisions"
  FOR EACH ROW EXECUTE FUNCTION "protect_public_web_immutable_record"();
CREATE TRIGGER "public_web_source_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "public_web_source_evidence"
  FOR EACH ROW EXECUTE FUNCTION "protect_public_web_immutable_record"();
CREATE TRIGGER "public_web_publication_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "public_web_publication_receipts"
  FOR EACH ROW EXECUTE FUNCTION "protect_public_web_immutable_record"();

CREATE OR REPLACE FUNCTION "enforce_public_web_publication_state"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_row "public_web_content_revisions"%ROWTYPE;
  has_current_verified_evidence boolean;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'public web publication state must start as DRAFT' USING ERRCODE = '23514';
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

    NEW."version" := OLD."version" + 1;
    NEW."updated_at" := now();
  END IF;

  IF NEW."status" IN ('APPROVED', 'PUBLISHED') THEN
    SELECT * INTO revision_row
    FROM "public_web_content_revisions"
    WHERE "tenant_id" = NEW."tenant_id"
      AND "organization_id" = NEW."organization_id"
      AND "content_record_id" = NEW."content_record_id"
      AND "id" = NEW."revision_id";

    IF NOT FOUND
       OR revision_row."quality_status" <> 'PASS'
       OR revision_row."source_coverage" <> 'COMPLETE' THEN
      RAISE EXCEPTION 'public web approval requires a PASS revision with COMPLETE source coverage' USING ERRCODE = '23514';
    END IF;

    IF NEW."reviewed_by_legacy_user_id" IS NULL
       OR NEW."reviewed_by_legacy_user_id" = revision_row."created_by_legacy_user_id" THEN
      RAISE EXCEPTION 'public web approval requires an independent reviewer' USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM "public_web_source_evidence" evidence
      WHERE evidence."tenant_id" = NEW."tenant_id"
        AND evidence."organization_id" = NEW."organization_id"
        AND evidence."content_record_id" = NEW."content_record_id"
        AND evidence."revision_id" = NEW."revision_id"
        AND evidence."status" = 'VERIFIED'
        AND (evidence."expires_at" IS NULL OR evidence."expires_at" > now())
    ) INTO has_current_verified_evidence;

    IF NOT has_current_verified_evidence THEN
      RAISE EXCEPTION 'public web approval requires current verified source evidence' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" = 'PUBLISHED' AND NEW."published_by_legacy_user_id" IS NULL THEN
    RAISE EXCEPTION 'public web publish requires an attributable publisher' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "public_web_publication_states_guard"
  BEFORE INSERT OR UPDATE ON "public_web_publication_states"
  FOR EACH ROW EXECUTE FUNCTION "enforce_public_web_publication_state"();

CREATE OR REPLACE FUNCTION "protect_public_web_route_alias"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."tenant_id" IS DISTINCT FROM NEW."tenant_id"
     OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id"
     OR OLD."content_record_id" IS DISTINCT FROM NEW."content_record_id"
     OR OLD."path" IS DISTINCT FROM NEW."path"
     OR OLD."route_kind" IS DISTINCT FROM NEW."route_kind"
     OR OLD."redirect_to_path" IS DISTINCT FROM NEW."redirect_to_path"
     OR OLD."http_status" IS DISTINCT FROM NEW."http_status"
     OR OLD."valid_from" IS DISTINCT FROM NEW."valid_from"
     OR OLD."created_by_legacy_user_id" IS DISTINCT FROM NEW."created_by_legacy_user_id"
     OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
     OR OLD."valid_to" IS NOT NULL
     OR NEW."valid_to" IS NULL THEN
    RAISE EXCEPTION 'public web route aliases are immutable except for one-way closure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "public_web_route_aliases_close_only"
  BEFORE UPDATE ON "public_web_route_aliases"
  FOR EACH ROW EXECUTE FUNCTION "protect_public_web_route_alias"();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'public_web_content_records',
    'public_web_content_revisions',
    'public_web_source_evidence',
    'public_web_publication_states',
    'public_web_publication_receipts',
    'public_web_route_aliases'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)',
      table_name || '_scope_select', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)',
      table_name || '_scope_insert', table_name
    );
    IF table_name IN ('public_web_content_records', 'public_web_publication_states', 'public_web_route_aliases') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)',
        table_name || '_scope_update', table_name
      );
    END IF;
  END LOOP;
END;
$$;

-- Deliberately absent: role grants, public HTTP routes, mass catalogue writes,
-- automated index enablement, provider calls and publication backfills.
