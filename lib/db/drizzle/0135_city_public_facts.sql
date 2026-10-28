ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "teaching_languages" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "transport_modes" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "campus_geography" text;
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "latitude" real;
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "longitude" real;

CREATE TABLE IF NOT EXISTS "city_external_facts" (
  "city_id" integer PRIMARY KEY REFERENCES "cities"("id") ON DELETE CASCADE,
  "climate_provider" text,
  "climate_source_url" text,
  "climate_summary" text,
  "climate_annual_average_c" real,
  "climate_months" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "climate_verified_at" timestamp with time zone,
  "housing_provider" text,
  "housing_source_url" text,
  "housing_summary" text,
  "housing_formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "housing_verified_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
