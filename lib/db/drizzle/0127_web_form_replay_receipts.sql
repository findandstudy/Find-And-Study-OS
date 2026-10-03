CREATE TABLE "web_form_ingest_receipts" (
  "form_scope" text NOT NULL,
  "request_id" text NOT NULL,
  "payload_sha256" text NOT NULL,
  "request_timestamp" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  CONSTRAINT "web_form_ingest_receipts_pk" PRIMARY KEY ("form_scope", "request_id"),
  CONSTRAINT "web_form_ingest_receipts_scope_chk" CHECK (length("form_scope") BETWEEN 1 AND 200),
  CONSTRAINT "web_form_ingest_receipts_request_id_chk" CHECK ("request_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'),
  CONSTRAINT "web_form_ingest_receipts_hash_chk" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "web_form_ingest_receipts_status_chk" CHECK ("status" IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT "web_form_ingest_receipts_terminal_time_chk" CHECK (
    ("status" = 'PROCESSING' AND "completed_at" IS NULL AND "failed_at" IS NULL)
    OR ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL AND "failed_at" IS NULL)
    OR ("status" = 'FAILED' AND "completed_at" IS NULL AND "failed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "web_form_ingest_receipts_received_idx"
  ON "web_form_ingest_receipts" ("received_at" DESC);
--> statement-breakpoint
COMMENT ON TABLE "web_form_ingest_receipts" IS
  'PII-free durable freshness/idempotency receipts for authenticated web-form ingestion.';
