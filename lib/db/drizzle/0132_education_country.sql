ALTER TABLE "student_education_records"
  ADD COLUMN IF NOT EXISTS "country" text;
--> statement-breakpoint
ALTER TABLE "student_education_records"
  DROP CONSTRAINT IF EXISTS "student_education_records_level_check";
--> statement-breakpoint
ALTER TABLE "student_education_records"
  ADD CONSTRAINT "student_education_records_level_check"
  CHECK ("level" IN ('high_school', 'bachelor', 'master', 'doctorate'));
--> statement-breakpoint
ALTER TABLE "education_records"
  DROP CONSTRAINT IF EXISTS "education_records_level_check";
--> statement-breakpoint
ALTER TABLE "education_records"
  ADD CONSTRAINT "education_records_level_check"
  CHECK ("level" IN ('high_school', 'bachelor', 'master', 'doctorate'));
