-- Configurable calendar-day reminders. No delivery or historical send activation.
CREATE SEQUENCE "application_deadline_policy_revision_seq" AS integer;
--> statement-breakpoint
CREATE TABLE "application_deadline_reminder_policies" (
  "scope_key" text PRIMARY KEY,
  "university_id" integer UNIQUE REFERENCES "universities"("id") ON DELETE CASCADE,
  "days_before" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT nextval('application_deadline_policy_revision_seq') CHECK ("revision" > 0),
  "updated_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "deadline_policy_scope_chk" CHECK (("scope_key" = 'SYSTEM' AND "university_id" IS NULL) OR ("university_id" IS NOT NULL AND "scope_key" = 'UNIVERSITY:' || "university_id"::text)),
  CONSTRAINT "deadline_policy_array_chk" CHECK (jsonb_typeof("days_before") = 'array' AND jsonb_array_length("days_before") <= 20)
);
--> statement-breakpoint
CREATE FUNCTION "validate_deadline_policy_days"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; n numeric;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(NEW."days_before") LOOP
    IF jsonb_typeof(item) <> 'number' THEN RAISE EXCEPTION 'INVALID_REMINDER_DAYS'; END IF;
    n := item::text::numeric;
    IF n <> trunc(n) OR n < 0 OR n > 3650 THEN RAISE EXCEPTION 'INVALID_REMINDER_DAYS'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(NEW."days_before")) <> (SELECT count(DISTINCT value) FROM jsonb_array_elements(NEW."days_before")) THEN RAISE EXCEPTION 'DUPLICATE_REMINDER_DAY'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "deadline_policy_days_trg" BEFORE INSERT OR UPDATE ON "application_deadline_reminder_policies" FOR EACH ROW EXECUTE FUNCTION "validate_deadline_policy_days"();
--> statement-breakpoint
INSERT INTO "application_deadline_reminder_policies" ("scope_key","days_before") VALUES ('SYSTEM','[30,7]'::jsonb);
--> statement-breakpoint
ALTER TABLE "application_deadline_reminder_intents" DROP CONSTRAINT "application_deadline_reminder_intents_days_chk";
--> statement-breakpoint
ALTER TABLE "application_deadline_reminder_intents" ADD CONSTRAINT "application_deadline_reminder_intents_days_chk" CHECK ("days_before" BETWEEN 0 AND 3650);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cancel_deadline_reminders_on_calendar_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(OLD."applications_open_at",OLD."application_deadline_at",OLD."source_timezone",OLD."is_active",OLD."verified_at") IS DISTINCT FROM ROW(NEW."applications_open_at",NEW."application_deadline_at",NEW."source_timezone",NEW."is_active",NEW."verified_at") THEN
 UPDATE "application_deadline_reminder_intents" SET "status"='CANCELLED',"cancelled_at"=now(),"cancel_reason"='CALENDAR_CHANGED',"updated_at"=now() WHERE "university_application_period_id"=NEW."id" AND "status" IN ('PREVIEW_ONLY','PENDING');
 END IF; RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER "university_application_periods_cancel_reminders_trg" ON "university_application_periods";
--> statement-breakpoint
CREATE TRIGGER "university_application_periods_cancel_reminders_trg" AFTER UPDATE OF "applications_open_at","application_deadline_at","source_timezone","is_active","verified_at" ON "university_application_periods" FOR EACH ROW EXECUTE FUNCTION "cancel_deadline_reminders_on_calendar_change"();
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON "application_deadline_reminder_policies" TO fas_app;
--> statement-breakpoint
GRANT USAGE,SELECT ON SEQUENCE "application_deadline_policy_revision_seq" TO fas_app;
--> statement-breakpoint
CREATE FUNCTION "validate_program_application_calendar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p university_application_periods%ROWTYPE; n integer; has_override boolean;
BEGIN
 has_override := NEW.applications_open_override_at IS NOT NULL OR NEW.application_deadline_override_at IS NOT NULL OR NEW.classes_start_override_on IS NOT NULL OR NEW.classes_end_override_on IS NOT NULL;
 IF NEW.university_application_period_id IS NOT NULL THEN
   SELECT * INTO p FROM university_application_periods WHERE id=NEW.university_application_period_id AND university_id=NEW.university_id AND is_active AND verified_at IS NOT NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PROGRAM_CALENDAR_PERIOD'; END IF;
 ELSIF has_override THEN
   SELECT count(*) INTO n FROM university_application_periods WHERE university_id=NEW.university_id AND is_active AND verified_at IS NOT NULL;
   IF n <> 1 THEN RAISE EXCEPTION 'PROGRAM_CALENDAR_PERIOD_REQUIRED'; END IF;
   SELECT * INTO p FROM university_application_periods WHERE university_id=NEW.university_id AND is_active AND verified_at IS NOT NULL;
 ELSE RETURN NEW;
 END IF;
 IF coalesce(NEW.applications_open_override_at,p.applications_open_at)>coalesce(NEW.application_deadline_override_at,p.application_deadline_at) OR coalesce(NEW.classes_start_override_on,p.classes_start_on)>coalesce(NEW.classes_end_override_on,p.classes_end_on) THEN RAISE EXCEPTION 'PROGRAM_CALENDAR_DATE_CONFLICT'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "programs_validate_application_calendar_trg" BEFORE INSERT OR UPDATE OF university_id,university_application_period_id,applications_open_override_at,application_deadline_override_at,classes_start_override_on,classes_end_override_on ON programs FOR EACH ROW EXECUTE FUNCTION "validate_program_application_calendar"();
