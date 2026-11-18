ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "enrollment_fee" real;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "refund_process" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "enrollment_fee" real;
--> statement-breakpoint
ALTER TABLE "program_translations" ADD COLUMN IF NOT EXISTS "refund_process" text;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "fas_program_content_source_hash"(
	p_name text,
	p_description text,
	p_field text,
	p_duration text,
	p_intakes text,
	p_requirements text,
	p_refund_process text
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
	SELECT encode(sha256(convert_to(jsonb_build_object(
		'description', coalesce(p_description, ''),
		'duration', coalesce(p_duration, ''),
		'field', coalesce(p_field, ''),
		'intakes', coalesce(p_intakes, ''),
		'name', coalesce(p_name, ''),
		'refundProcess', coalesce(p_refund_process, ''),
		'requirements', coalesce(p_requirements, '')
	)::text, 'UTF8')), 'hex')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "fas_queue_program_translations"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_source_hash text;
BEGIN
	v_source_hash := "fas_program_content_source_hash"(
		NEW."name", NEW."description", NEW."field", NEW."duration", NEW."intakes",
		NEW."requirements", NEW."refund_process"
	);

	INSERT INTO "program_translations" (
		"program_id", "locale", "source_hash", "status", "next_attempt_at", "updated_at"
	)
	SELECT NEW."id", locale, v_source_hash, 'queued', now(), now()
	FROM unnest(ARRAY['tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it']::text[]) AS locale
	ON CONFLICT ("program_id", "locale") DO UPDATE
	SET "source_hash" = EXCLUDED."source_hash",
		"status" = CASE WHEN "program_translations"."is_manual" THEN 'stale_manual' ELSE 'queued' END,
		"attempts" = CASE WHEN "program_translations"."is_manual" THEN "program_translations"."attempts" ELSE 0 END,
		"error_code" = NULL,
		"next_attempt_at" = now(),
		"leased_at" = NULL,
		"lease_expires_at" = NULL,
		"worker_id" = NULL,
		"updated_at" = now()
	WHERE "program_translations"."source_hash" IS DISTINCT FROM EXCLUDED."source_hash";

	RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "programs_queue_translations_trg" ON "programs";
--> statement-breakpoint
CREATE TRIGGER "programs_queue_translations_trg"
AFTER INSERT OR UPDATE OF "name", "description", "field", "duration", "intakes", "requirements", "refund_process"
ON "programs"
FOR EACH ROW
EXECUTE FUNCTION "fas_queue_program_translations"();
