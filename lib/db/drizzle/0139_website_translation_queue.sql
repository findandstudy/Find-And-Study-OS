CREATE TABLE "website_translation_jobs" (
  "id" serial PRIMARY KEY,
  "batch_id" text NOT NULL,
  "kind" text NOT NULL,
  "entity_id" integer NOT NULL,
  "locale" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "provider" text,
  "model" text,
  "quality_mode" text NOT NULL DEFAULT 'balanced',
  "attempts" integer NOT NULL DEFAULT 0,
  "error_code" text,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "leased_at" timestamptz,
  "lease_expires_at" timestamptz,
  "worker_id" text,
  "generated_page_id" integer REFERENCES "website_pages"("id") ON DELETE SET NULL,
  "generated_digest" text,
  "reviewed_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamptz,
  "created_by" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "website_translation_jobs_batch_item_uq" UNIQUE("batch_id", "kind", "entity_id", "locale"),
  CONSTRAINT "website_translation_jobs_kind_chk" CHECK ("kind" IN ('destination','city','university','program')),
  CONSTRAINT "website_translation_jobs_locale_chk" CHECK ("locale" IN ('tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it')),
  CONSTRAINT "website_translation_jobs_status_chk" CHECK ("status" IN ('queued','processing','retrying','review_required','approved','publish_queued','publishing','published','rejected','failed','cancelled')),
  CONSTRAINT "website_translation_jobs_quality_chk" CHECK ("quality_mode" IN ('fast','balanced','premium')),
  CONSTRAINT "website_translation_jobs_attempts_chk" CHECK ("attempts" >= 0 AND "attempts" <= 20),
  CONSTRAINT "website_translation_jobs_lease_chk" CHECK (("status" IN ('processing','publishing')) = ("worker_id" IS NOT NULL AND "leased_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL)),
  CONSTRAINT "website_translation_jobs_digest_chk" CHECK ("generated_digest" IS NULL OR "generated_digest" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "website_translation_jobs_queue_idx" ON "website_translation_jobs" ("status", "next_attempt_at", "id");
CREATE INDEX "website_translation_jobs_batch_idx" ON "website_translation_jobs" ("batch_id", "status", "id");
CREATE INDEX "website_translation_jobs_review_idx" ON "website_translation_jobs" ("status", "created_at" DESC);
CREATE INDEX "website_translation_jobs_entity_idx" ON "website_translation_jobs" ("kind", "entity_id", "locale", "created_at" DESC);
CREATE UNIQUE INDEX "website_translation_jobs_active_entity_uq" ON "website_translation_jobs" ("kind", "entity_id", "locale") WHERE "status" IN ('queued','processing','retrying','review_required','approved','publish_queued','publishing');
