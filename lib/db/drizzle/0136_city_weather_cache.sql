CREATE TABLE IF NOT EXISTS "city_weather_snapshots" (
  "city_id" integer PRIMARY KEY REFERENCES "cities"("id") ON DELETE CASCADE,
  "provider" text DEFAULT 'openweather' NOT NULL,
  "latitude" real NOT NULL,
  "longitude" real NOT NULL,
  "condition_code" integer,
  "condition_group" text,
  "description" text,
  "icon_code" text,
  "temperature_c" real,
  "feels_like_c" real,
  "minimum_c" real,
  "maximum_c" real,
  "humidity_percent" integer,
  "wind_speed_mps" real,
  "observed_at" timestamp with time zone,
  "forecast_date" date,
  "fetched_at" timestamp with time zone,
  "stale_after" timestamp with time zone,
  "last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error_code" text,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "city_weather_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  CONSTRAINT "city_weather_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180),
  CONSTRAINT "city_weather_humidity_range" CHECK ("humidity_percent" IS NULL OR "humidity_percent" BETWEEN 0 AND 100),
  CONSTRAINT "city_weather_failure_count_nonnegative" CHECK ("consecutive_failures" >= 0)
);

CREATE INDEX IF NOT EXISTS "city_weather_snapshots_stale_after_idx"
  ON "city_weather_snapshots" ("stale_after");

CREATE TABLE IF NOT EXISTS "weather_sync_runs" (
  "id" serial PRIMARY KEY,
  "provider" text DEFAULT 'openweather' NOT NULL,
  "status" text NOT NULL,
  "requested_count" integer DEFAULT 0 NOT NULL,
  "refreshed_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "weather_sync_runs_status_valid" CHECK ("status" IN ('running', 'completed', 'partial', 'failed', 'disabled')),
  CONSTRAINT "weather_sync_runs_counts_nonnegative" CHECK (
    "requested_count" >= 0 AND "refreshed_count" >= 0 AND "failed_count" >= 0 AND "skipped_count" >= 0
  )
);

CREATE INDEX IF NOT EXISTS "weather_sync_runs_started_at_idx"
  ON "weather_sync_runs" ("started_at");
