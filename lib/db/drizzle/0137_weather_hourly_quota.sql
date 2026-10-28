CREATE TABLE IF NOT EXISTS "weather_provider_calls" (
  "id" serial PRIMARY KEY,
  "provider" text DEFAULT 'openweather' NOT NULL,
  "call_kind" text NOT NULL,
  "city_id" integer REFERENCES "cities"("id") ON DELETE SET NULL,
  "outcome" text DEFAULT 'reserved' NOT NULL,
  "error_code" text,
  "reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  CONSTRAINT "weather_provider_calls_kind_valid" CHECK ("call_kind" IN ('city_refresh', 'city_geocode', 'connection_test')),
  CONSTRAINT "weather_provider_calls_outcome_valid" CHECK ("outcome" IN ('reserved', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS "weather_provider_calls_provider_reserved_idx"
  ON "weather_provider_calls" ("provider", "reserved_at");

ALTER TABLE "weather_sync_runs"
  DROP CONSTRAINT IF EXISTS "weather_sync_runs_status_valid";

ALTER TABLE "weather_sync_runs"
  ADD CONSTRAINT "weather_sync_runs_status_valid"
  CHECK ("status" IN ('running', 'completed', 'partial', 'failed', 'disabled', 'quota_exhausted'));
