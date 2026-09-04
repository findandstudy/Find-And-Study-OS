-- Evidence-bound, append-only portal lifecycle observations.
-- The parent composite identity prevents cross-application attachment.

ALTER TABLE "portal_submissions"
  ADD CONSTRAINT "portal_submissions_id_application_uq"
  UNIQUE ("id", "application_id");

ALTER TABLE "portal_submissions"
  ADD COLUMN "status_check_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "status_check_next_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "status_check_last_at" timestamp with time zone,
  ADD COLUMN "status_check_error" text,
  ADD COLUMN "status_check_locked_at" timestamp with time zone,
  ADD COLUMN "status_check_locked_by" text,
  ADD COLUMN "status_check_suspended_at" timestamp with time zone,
  ADD CONSTRAINT "portal_submissions_status_check_attempts_chk"
    CHECK ("status_check_attempts" >= 0),
  ADD CONSTRAINT "portal_submissions_status_check_lock_pair_chk"
    CHECK (("status_check_locked_at" IS NULL) = ("status_check_locked_by" IS NULL)),
  ADD CONSTRAINT "portal_submissions_status_check_error_chk"
    CHECK ("status_check_error" IS NULL OR "status_check_error" IN (
      'STATUS_CHECK_UNSUPPORTED',
      'STATUS_CHECK_TIMEOUT',
      'STATUS_CHECK_AUTHENTICATION',
      'STATUS_CHECK_PORTAL_DRIFT',
      'STATUS_CHECK_NETWORK',
      'STATUS_CHECK_LEASE_LOST',
      'STATUS_CHECK_FAILED'
    ));

CREATE INDEX "portal_submissions_status_check_due_idx"
  ON "portal_submissions" ("status_check_next_at", "adapter_key", "university_key")
  WHERE "status" = 'submitted'
    AND "external_ref" IS NOT NULL
    AND btrim("external_ref") <> ''
    AND "adapter_key" IS NOT NULL
    AND btrim("adapter_key") <> ''
    AND "deleted_at" IS NULL
    AND "status_check_suspended_at" IS NULL;
CREATE INDEX "portal_submissions_status_check_lock_idx"
  ON "portal_submissions" ("status_check_locked_at");

ALTER TABLE "ai_action_queue"
  ADD COLUMN "idempotency_key" text,
  ADD CONSTRAINT "ai_action_queue_idempotency_key_chk"
    CHECK ("idempotency_key" IS NULL OR length("idempotency_key") BETWEEN 1 AND 128);
CREATE UNIQUE INDEX "ai_action_queue_idempotency_key_uq"
  ON "ai_action_queue" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE TABLE "portal_lifecycle_observations" (
  "id" serial PRIMARY KEY NOT NULL,
  "submission_id" integer NOT NULL,
  "application_id" integer NOT NULL,
  "adapter_key" text NOT NULL,
  "observation_hash" text NOT NULL,
  "raw_status" text NOT NULL,
  "signal" text NOT NULL,
  "disposition" text NOT NULL,
  "identity_verified" boolean DEFAULT false NOT NULL,
  "identity_source" text,
  "missing_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "portal_lifecycle_observations_submission_application_fk"
    FOREIGN KEY ("submission_id", "application_id")
    REFERENCES "public"."portal_submissions"("id", "application_id")
    ON DELETE CASCADE,
  CONSTRAINT "portal_lifecycle_observations_application_id_applications_id_fk"
    FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id")
    ON DELETE CASCADE,
  CONSTRAINT "portal_lifecycle_observations_adapter_key_chk"
    CHECK (length("adapter_key") BETWEEN 1 AND 100),
  CONSTRAINT "portal_lifecycle_observations_hash_chk"
    CHECK ("observation_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "portal_lifecycle_observations_raw_status_chk"
    CHECK (length("raw_status") BETWEEN 1 AND 250),
  CONSTRAINT "portal_lifecycle_observations_signal_chk"
    CHECK ("signal" IN ('submitted', 'missing_document', 'fee_required', 'offer_received', 'deposit_paid', 'acceptance_letter', 'final_acceptance', 'student_card', 'already_registered', 'quota_full', 'waitlisted', 'withdrawn', 'enrolled', 'rejected', 'unknown')),
  CONSTRAINT "portal_lifecycle_observations_disposition_chk"
    CHECK ("disposition" IN ('SUBMITTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT', 'FEE_REQUIRED', 'CONDITIONAL_OFFER', 'UNCONDITIONAL_OFFER', 'DEPOSIT_RECEIVED', 'WAITLISTED', 'REJECTED', 'FINAL_ACCEPTANCE', 'ENROLLED', 'FULL_QUOTA', 'DUPLICATE', 'ALREADY_REGISTERED', 'WITHDRAWN', 'UNKNOWN')),
  CONSTRAINT "portal_lifecycle_observations_identity_chk"
    CHECK (("identity_verified" AND "identity_source" IN ('matched_application_row', 'labeled_portal_field', 'structured_portal_field')) OR (NOT "identity_verified" AND "identity_source" IS NULL)),
  CONSTRAINT "portal_lifecycle_observations_missing_documents_chk"
    CHECK (jsonb_typeof("missing_documents") = 'array' AND jsonb_array_length("missing_documents") <= 50),
  CONSTRAINT "portal_lifecycle_observations_evidence_chk"
    CHECK (jsonb_typeof("evidence") = 'object')
);

CREATE UNIQUE INDEX "portal_lifecycle_observations_submission_hash_uq"
  ON "portal_lifecycle_observations" ("submission_id", "observation_hash");
CREATE INDEX "portal_lifecycle_observations_observed_idx"
  ON "portal_lifecycle_observations" ("observed_at");
CREATE INDEX "portal_lifecycle_observations_application_observed_idx"
  ON "portal_lifecycle_observations" ("application_id", "observed_at");
CREATE INDEX "portal_lifecycle_observations_adapter_disposition_idx"
  ON "portal_lifecycle_observations" ("adapter_key", "disposition", "observed_at");
