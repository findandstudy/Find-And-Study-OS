-- Keep city approval and publication fail-closed at the database boundary.
-- This is separate from 0120 so an already-applied additive city binding remains immutable.

CREATE OR REPLACE FUNCTION "enforce_public_web_city_publication_evidence"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  content_entity_type text;
  missing_fact_keys text;
BEGIN
  IF NEW."status" NOT IN ('APPROVED', 'PUBLISHED') THEN
    RETURN NEW;
  END IF;

  SELECT content."entity_type"
    INTO content_entity_type
  FROM "public_web_content_records" content
  WHERE content."tenant_id" = NEW."tenant_id"
    AND content."organization_id" = NEW."organization_id"
    AND content."id" = NEW."content_record_id";

  IF content_entity_type <> 'CITY' THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(required_fact_key, ',' ORDER BY required_fact_key)
    INTO missing_fact_keys
  FROM unnest(ARRAY['name','country','body']::text[]) AS required_fact_key
  WHERE NOT EXISTS (
    SELECT 1
    FROM "public_web_source_evidence" evidence
    WHERE evidence."tenant_id" = NEW."tenant_id"
      AND evidence."organization_id" = NEW."organization_id"
      AND evidence."content_record_id" = NEW."content_record_id"
      AND evidence."revision_id" = NEW."revision_id"
      AND evidence."status" = 'VERIFIED'
      AND evidence."verified_at" <= now()
      AND (evidence."effective_from" IS NULL OR evidence."effective_from" <= now())
      AND (evidence."effective_to" IS NULL OR evidence."effective_to" > now())
      AND (evidence."expires_at" IS NULL OR evidence."expires_at" > now())
      AND required_fact_key = ANY(evidence."fact_keys")
  );

  IF missing_fact_keys IS NOT NULL THEN
    RAISE EXCEPTION 'public web city approval lacks current verified critical facts: %', missing_fact_keys USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "enforce_public_web_city_publication_evidence"() FROM PUBLIC;

CREATE TRIGGER "public_web_city_publication_evidence_guard"
BEFORE INSERT OR UPDATE ON "public_web_publication_states"
FOR EACH ROW EXECUTE FUNCTION "enforce_public_web_city_publication_evidence"();
