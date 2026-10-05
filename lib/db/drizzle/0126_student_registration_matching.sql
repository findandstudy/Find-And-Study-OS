ALTER TABLE "universities"
  ADD COLUMN IF NOT EXISTS "nationality_policy" text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "accepted_nationality_codes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "default_required_education_level" text,
  ADD COLUMN IF NOT EXISTS "default_min_grade_value" real,
  ADD COLUMN IF NOT EXISTS "default_grade_scale" text,
  ADD COLUMN IF NOT EXISTS "default_language_requirements" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "default_conditional_admission" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "admission_source_url" text,
  ADD COLUMN IF NOT EXISTS "admission_verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "admission_valid_until" timestamptz;

ALTER TABLE "programs"
  ADD COLUMN IF NOT EXISTS "required_education_level" text,
  ADD COLUMN IF NOT EXISTS "min_grade_value" real,
  ADD COLUMN IF NOT EXISTS "grade_scale" text,
  ADD COLUMN IF NOT EXISTS "language_requirements" jsonb,
  ADD COLUMN IF NOT EXISTS "conditional_admission" boolean,
  ADD COLUMN IF NOT EXISTS "admission_source_url" text,
  ADD COLUMN IF NOT EXISTS "admission_verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "admission_valid_until" timestamptz;

DO $$ BEGIN
  ALTER TABLE "universities" ADD CONSTRAINT "universities_nationality_policy_check"
    CHECK ("nationality_policy" IN ('unknown', 'open', 'restricted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "universities" ADD CONSTRAINT "universities_accepted_nationalities_array_check"
    CHECK (jsonb_typeof("accepted_nationality_codes") = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "programs" ADD CONSTRAINT "programs_language_requirements_array_check"
    CHECK ("language_requirements" IS NULL OR jsonb_typeof("language_requirements") = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "universities" ADD CONSTRAINT "universities_default_language_requirements_array_check"
    CHECK (jsonb_typeof("default_language_requirements") = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "student_registration_profiles" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "nationality_code" text,
  "education_country_code" text,
  "completed_education_level" text,
  "target_education_level" text,
  "grade_value" real,
  "grade_scale" text,
  "language_test" text,
  "language_overall" real,
  "language_subscores" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "language_test_date" timestamptz,
  "preferred_country_codes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "preferred_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "budget_amount" real,
  "budget_currency" text,
  "funding_source" text,
  "selected_program_id" integer REFERENCES "programs"("id") ON DELETE SET NULL,
  "declaration_status" text NOT NULL DEFAULT 'declared',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_registration_profiles_user_uniq"
  ON "student_registration_profiles"("user_id");
CREATE INDEX IF NOT EXISTS "student_registration_profiles_selected_program_idx"
  ON "student_registration_profiles"("selected_program_id");
