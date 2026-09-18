-- Additive city landing-page binding for the governed public web pipeline.
-- Existing content rows remain valid and no city content is published by this migration.

ALTER TABLE "public_web_content_records"
  ADD COLUMN "city_id" integer;

ALTER TABLE "public_web_content_records"
  ADD CONSTRAINT "public_web_content_records_city_fk"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT NOT VALID;

ALTER TABLE "public_web_content_records"
  DROP CONSTRAINT "public_web_content_records_entity_type_chk";

ALTER TABLE "public_web_content_records"
  ADD CONSTRAINT "public_web_content_records_entity_type_chk"
  CHECK ("entity_type" IN ('PROGRAM', 'UNIVERSITY', 'DESTINATION', 'CITY', 'PAGE', 'ARTICLE')) NOT VALID;

ALTER TABLE "public_web_content_records"
  DROP CONSTRAINT "public_web_content_records_entity_binding_chk";

ALTER TABLE "public_web_content_records"
  ADD CONSTRAINT "public_web_content_records_entity_binding_chk" CHECK (
    ("entity_type" = 'PROGRAM' AND "program_id" IS NOT NULL AND "university_id" IS NULL AND "destination_id" IS NULL AND "city_id" IS NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'UNIVERSITY' AND "program_id" IS NULL AND "university_id" IS NOT NULL AND "destination_id" IS NULL AND "city_id" IS NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'DESTINATION' AND "program_id" IS NULL AND "university_id" IS NULL AND "destination_id" IS NOT NULL AND "city_id" IS NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'CITY' AND "program_id" IS NULL AND "university_id" IS NULL AND "destination_id" IS NULL AND "city_id" IS NOT NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'PAGE' AND "program_id" IS NULL AND "university_id" IS NULL AND "destination_id" IS NULL AND "city_id" IS NULL AND "website_page_id" IS NOT NULL AND "blog_post_id" IS NULL)
    OR ("entity_type" = 'ARTICLE' AND "program_id" IS NULL AND "university_id" IS NULL AND "destination_id" IS NULL AND "city_id" IS NULL AND "website_page_id" IS NULL AND "blog_post_id" IS NOT NULL)
  ) NOT VALID;

CREATE UNIQUE INDEX "public_web_content_records_city_locale_uq"
  ON "public_web_content_records" ("tenant_id", "organization_id", "city_id", "locale")
  WHERE "entity_type" = 'CITY';
