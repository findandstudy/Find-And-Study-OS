-- Institution application calendar, program inheritance/override fields and
-- lossless partner price-list fields. All changes are additive.

CREATE TABLE IF NOT EXISTS "university_application_periods" (
  "id" serial PRIMARY KEY,
  "university_id" integer NOT NULL REFERENCES "universities"("id") ON DELETE CASCADE,
  "term_name" text NOT NULL,
  "academic_year" integer NOT NULL,
  "campus_name" text,
  "applications_open_at" date,
  "application_deadline_at" date,
  "classes_start_on" date,
  "classes_end_on" date,
  "source_timezone" text NOT NULL,
  "source_url" text NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "university_application_periods_identity_uq" UNIQUE ("university_id", "term_name", "academic_year", "campus_name"),
  CONSTRAINT "university_application_periods_year_chk" CHECK ("academic_year" BETWEEN 2000 AND 2200),
  CONSTRAINT "university_application_periods_window_chk" CHECK ("application_deadline_at" IS NULL OR "applications_open_at" IS NULL OR "application_deadline_at" >= "applications_open_at"),
  CONSTRAINT "university_application_periods_teaching_window_chk" CHECK ("classes_end_on" IS NULL OR "classes_start_on" IS NULL OR "classes_end_on" >= "classes_start_on"),
  CONSTRAINT "university_application_periods_timezone_chk" CHECK (length(trim("source_timezone")) BETWEEN 1 AND 64),
  CONSTRAINT "university_application_periods_source_chk" CHECK ("source_url" ~ '^https://')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "university_application_periods_lookup_idx"
  ON "university_application_periods" ("university_id", "is_active", "application_deadline_at");
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "adaptation_fee" real;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "price_valid_from" date;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "price_valid_until" date;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "finance_notes" text;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "university_application_period_id" integer REFERENCES "university_application_periods"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "applications_open_override_at" date;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "application_deadline_override_at" date;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "classes_start_override_on" date;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "classes_end_override_on" date;
--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_override_application_window_chk"
  CHECK ("application_deadline_override_at" IS NULL OR "applications_open_override_at" IS NULL OR "application_deadline_override_at" >= "applications_open_override_at");
--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_override_teaching_window_chk"
  CHECK ("classes_end_override_on" IS NULL OR "classes_start_override_on" IS NULL OR "classes_end_override_on" >= "classes_start_override_on");
--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_price_validity_chk"
  CHECK ("price_valid_until" IS NULL OR "price_valid_from" IS NULL OR "price_valid_until" >= "price_valid_from");
--> statement-breakpoint
ALTER TABLE "price_components" DROP CONSTRAINT IF EXISTS "price_components_type_chk";
--> statement-breakpoint
ALTER TABLE "price_components" ADD CONSTRAINT "price_components_type_chk"
  CHECK ("component_type" IN ('TUITION', 'APPLICATION', 'ENROLLMENT', 'ADAPTATION', 'DEPOSIT', 'SERVICE', 'LANGUAGE', 'INSURANCE', 'OTHER'));
--> statement-breakpoint
ALTER TABLE "price_components" DROP CONSTRAINT IF EXISTS "price_components_frequency_chk";
--> statement-breakpoint
ALTER TABLE "price_components" ADD CONSTRAINT "price_components_frequency_chk"
  CHECK ("frequency" IN ('ONE_TIME', 'PER_PROGRAM', 'PER_YEAR', 'PER_TERM', 'PER_WEEK', 'PER_CREDIT', 'PER_MONTH'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_deadline_reminder_intents" (
  "id" serial PRIMARY KEY,
  "university_application_period_id" integer NOT NULL REFERENCES "university_application_periods"("id") ON DELETE CASCADE,
  "subject_type" text NOT NULL,
  "subject_id" integer NOT NULL,
  "channel" text NOT NULL,
  "days_before" integer NOT NULL,
  "schedule_fingerprint" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PREVIEW_ONLY',
  "reason_code" text NOT NULL,
  "cancelled_at" timestamptz,
  "cancel_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "application_deadline_reminder_intents_identity_uq" UNIQUE ("university_application_period_id", "subject_type", "subject_id", "channel", "days_before", "schedule_fingerprint"),
  CONSTRAINT "application_deadline_reminder_intents_subject_chk" CHECK ("subject_type" IN ('LEAD', 'APPLICATION')),
  CONSTRAINT "application_deadline_reminder_intents_channel_chk" CHECK ("channel" IN ('EMAIL', 'WHATSAPP')),
  CONSTRAINT "application_deadline_reminder_intents_days_chk" CHECK ("days_before" IN (30, 7)),
  CONSTRAINT "application_deadline_reminder_intents_status_chk" CHECK ("status" IN ('PREVIEW_ONLY', 'PENDING', 'CANCELLED', 'SENT', 'SUPPRESSED')),
  CONSTRAINT "application_deadline_reminder_intents_hash_chk" CHECK ("schedule_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_deadline_reminder_intents_period_status_idx"
  ON "application_deadline_reminder_intents" ("university_application_period_id", "status", "days_before");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cancel_deadline_reminders_on_calendar_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD."applications_open_at", OLD."application_deadline_at", OLD."source_timezone")
     IS DISTINCT FROM
     ROW(NEW."applications_open_at", NEW."application_deadline_at", NEW."source_timezone") THEN
    UPDATE "application_deadline_reminder_intents"
       SET "status" = 'CANCELLED', "cancelled_at" = now(),
           "cancel_reason" = 'CALENDAR_CHANGED', "updated_at" = now()
     WHERE "university_application_period_id" = NEW."id"
       AND "status" IN ('PREVIEW_ONLY', 'PENDING');
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "university_application_periods_cancel_reminders_trg" ON "university_application_periods";
--> statement-breakpoint
CREATE TRIGGER "university_application_periods_cancel_reminders_trg"
AFTER UPDATE OF "applications_open_at", "application_deadline_at", "source_timezone"
ON "university_application_periods"
FOR EACH ROW EXECUTE FUNCTION "cancel_deadline_reminders_on_calendar_change"();
