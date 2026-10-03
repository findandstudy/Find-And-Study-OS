-- Durable, PII-free upload authorization. Object ownership remains the
-- long-lived download authorization; this table governs only the short-lived
-- upload/finalization corridor.
CREATE TABLE IF NOT EXISTS "object_upload_grants" (
  "object_key" text PRIMARY KEY REFERENCES "object_owners"("object_key") ON DELETE CASCADE,
  "uploaded_by" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expected_size" integer NOT NULL,
  "expected_content_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ISSUED',
  "expires_at" timestamptz NOT NULL,
  "final_size" integer,
  "final_content_type" text,
  "content_sha256" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "finalized_at" timestamptz,
  "consumed_at" timestamptz,
  CONSTRAINT "object_upload_grants_size_chk" CHECK (
    "expected_size" > 0 AND "expected_size" <= 26214400
    AND ("final_size" IS NULL OR ("final_size" > 0 AND "final_size" <= 26214400))
  ),
  CONSTRAINT "object_upload_grants_type_chk" CHECK (
    "expected_content_type" = lower(btrim("expected_content_type"))
    AND length("expected_content_type") BETWEEN 3 AND 200
    AND ("final_content_type" IS NULL OR "final_content_type" = lower(btrim("final_content_type")))
  ),
  CONSTRAINT "object_upload_grants_status_chk" CHECK ("status" IN ('ISSUED', 'FINALIZED', 'CONSUMED')),
  CONSTRAINT "object_upload_grants_hash_chk" CHECK (
    "content_sha256" IS NULL OR "content_sha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "object_upload_grants_state_chk" CHECK (
    ("status" = 'ISSUED' AND "final_size" IS NULL AND "final_content_type" IS NULL
      AND "content_sha256" IS NULL AND "finalized_at" IS NULL AND "consumed_at" IS NULL)
    OR
    ("status" = 'FINALIZED' AND "final_size" IS NOT NULL AND "final_content_type" IS NOT NULL
      AND "content_sha256" IS NOT NULL AND "finalized_at" IS NOT NULL AND "consumed_at" IS NULL)
    OR
    ("status" = 'CONSUMED' AND "final_size" IS NOT NULL AND "final_content_type" IS NOT NULL
      AND "content_sha256" IS NOT NULL AND "finalized_at" IS NOT NULL AND "consumed_at" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "object_upload_grants_owner_status_idx"
  ON "object_upload_grants" ("uploaded_by", "status", "expires_at");

COMMENT ON TABLE "object_upload_grants" IS
  'Short-lived upload/finalization authorization; contains no original filename, URL, secret, or user content.';
