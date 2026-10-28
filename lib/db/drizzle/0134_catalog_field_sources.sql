ALTER TABLE "countries" ADD COLUMN IF NOT EXISTS "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "universities" ADD COLUMN IF NOT EXISTS "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'countries_source_metadata_object_chk') THEN
    ALTER TABLE "countries" ADD CONSTRAINT "countries_source_metadata_object_chk" CHECK (jsonb_typeof("source_metadata") = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cities_source_metadata_object_chk') THEN
    ALTER TABLE "cities" ADD CONSTRAINT "cities_source_metadata_object_chk" CHECK (jsonb_typeof("source_metadata") = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'universities_source_metadata_object_chk') THEN
    ALTER TABLE "universities" ADD CONSTRAINT "universities_source_metadata_object_chk" CHECK (jsonb_typeof("source_metadata") = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_source_metadata_object_chk') THEN
    ALTER TABLE "programs" ADD CONSTRAINT "programs_source_metadata_object_chk" CHECK (jsonb_typeof("source_metadata") = 'object');
  END IF;
END $$;
