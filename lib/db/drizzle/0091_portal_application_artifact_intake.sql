-- Portal-collected offer/final/card evidence stored in the existing
-- application document surface without impersonating a human uploader.

ALTER TABLE "portal_submissions"
  DROP CONSTRAINT "portal_submissions_status_check_error_chk",
  ADD CONSTRAINT "portal_submissions_status_check_error_chk"
    CHECK ("status_check_error" IS NULL OR "status_check_error" IN (
      'STATUS_CHECK_UNSUPPORTED',
      'STATUS_CHECK_TIMEOUT',
      'STATUS_CHECK_AUTHENTICATION',
      'STATUS_CHECK_PORTAL_DRIFT',
      'STATUS_CHECK_NETWORK',
      'STATUS_CHECK_LEASE_LOST',
      'STATUS_CHECK_ARTIFACT',
      'STATUS_CHECK_FAILED'
    ));

ALTER TABLE "portal_lifecycle_observations"
  ADD CONSTRAINT "portal_lifecycle_observations_identity_uq"
  UNIQUE ("id", "submission_id", "application_id");

ALTER TABLE "application_stage_documents"
  ALTER COLUMN "uploaded_by" DROP NOT NULL,
  ADD COLUMN "source_type" text DEFAULT 'user_upload' NOT NULL,
  ADD COLUMN "source_portal_submission_id" integer,
  ADD COLUMN "source_portal_observation_id" integer,
  ADD COLUMN "source_content_sha256" text,
  ADD COLUMN "source_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD CONSTRAINT "application_stage_documents_source_type_chk"
    CHECK ("source_type" IN ('user_upload', 'portal_automation')),
  ADD CONSTRAINT "application_stage_documents_source_evidence_chk"
    CHECK (
      jsonb_typeof("source_evidence") = 'object'
      AND octet_length("source_evidence"::text) <= 4096
    ),
  ADD CONSTRAINT "application_stage_documents_source_sha_chk"
    CHECK (
      "source_content_sha256" IS NULL
      OR "source_content_sha256" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "application_stage_documents_source_shape_chk"
    CHECK (
      (
        "source_type" = 'user_upload'
        AND "uploaded_by" IS NOT NULL
        AND "source_portal_submission_id" IS NULL
        AND "source_portal_observation_id" IS NULL
        AND "source_content_sha256" IS NULL
        AND "source_evidence" = '{}'::jsonb
      )
      OR
      (
        "source_type" = 'portal_automation'
        AND "uploaded_by" IS NULL
        AND "uploaded_by_role" = 'portal_automation'
        AND "source_portal_submission_id" IS NOT NULL
        AND "source_portal_observation_id" IS NOT NULL
        AND "source_content_sha256" IS NOT NULL
        AND "file_data" IS NULL
        AND "file_url" LIKE '/objects/portal-artifacts/%'
        AND NOT "is_missing_doc_note"
      )
    ),
  ADD CONSTRAINT "application_stage_documents_portal_observation_fk"
    FOREIGN KEY (
      "source_portal_observation_id",
      "source_portal_submission_id",
      "application_id"
    )
    REFERENCES "public"."portal_lifecycle_observations"(
      "id",
      "submission_id",
      "application_id"
    )
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX "application_stage_documents_portal_artifact_uq"
  ON "application_stage_documents"(
    "source_portal_submission_id",
    "stage",
    "source_content_sha256"
  )
  WHERE "source_type" = 'portal_automation';

CREATE INDEX "application_stage_documents_portal_observation_idx"
  ON "application_stage_documents"("source_portal_observation_id")
  WHERE "source_portal_observation_id" IS NOT NULL;
