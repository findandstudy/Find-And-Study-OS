\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

LOCK TABLE universities, programs IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE import_expectations (
  program_count bigint NOT NULL,
  university_count bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO import_expectations(program_count, university_count)
VALUES (:expected_programs, :expected_universities);

CREATE TEMP TABLE import_universities (
  university_name text NOT NULL,
  country text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE import_programs (
  university_name text NOT NULL,
  program_name text NOT NULL,
  degree text,
  field text,
  language text,
  duration text,
  tuition_fee text,
  currency text,
  intakes text,
  requirements text,
  application_fee text,
  fee_type text,
  is_active text
) ON COMMIT DROP;

COPY import_universities(university_name, country)
FROM :'university_file'
WITH (FORMAT csv, HEADER true, DELIMITER E'\t', ENCODING 'UTF8');

COPY import_programs(
  university_name, program_name, degree, field, language, duration,
  tuition_fee, currency, intakes, requirements, application_fee,
  fee_type, is_active
)
FROM :'program_file'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

DO $validation$
DECLARE
  expected_programs bigint;
  expected_universities bigint;
BEGIN
  SELECT program_count, university_count
    INTO expected_programs, expected_universities
    FROM import_expectations;

  IF EXISTS (SELECT 1 FROM universities LIMIT 1)
     OR EXISTS (SELECT 1 FROM programs LIMIT 1) THEN
    RAISE EXCEPTION 'Target catalog must be empty before this staging bootstrap import';
  END IF;

  IF (SELECT count(*) FROM import_programs) <> expected_programs THEN
    RAISE EXCEPTION 'Unexpected program row count: got %, expected %',
      (SELECT count(*) FROM import_programs), expected_programs;
  END IF;

  IF (SELECT count(*) FROM import_universities) <> expected_universities THEN
    RAISE EXCEPTION 'Unexpected university row count: got %, expected %',
      (SELECT count(*) FROM import_universities), expected_universities;
  END IF;

  IF EXISTS (
    SELECT lower(trim(university_name))
      FROM import_universities
     GROUP BY lower(trim(university_name))
    HAVING count(*) <> 1 OR count(DISTINCT country) <> 1
  ) THEN
    RAISE EXCEPTION 'University mapping contains duplicate or conflicting names';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM import_programs p
      LEFT JOIN import_universities u
        ON lower(trim(u.university_name)) = lower(trim(p.university_name))
     WHERE u.university_name IS NULL
  ) THEN
    RAISE EXCEPTION 'At least one program has no university/country mapping';
  END IF;

  IF EXISTS (
    SELECT 1 FROM import_programs
     WHERE trim(university_name) = '' OR trim(program_name) = ''
  ) THEN
    RAISE EXCEPTION 'Program or university name is blank';
  END IF;

  IF EXISTS (
    SELECT 1 FROM import_programs
     WHERE (nullif(trim(tuition_fee), '') IS NOT NULL
            AND trim(tuition_fee) !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$')
        OR (nullif(trim(application_fee), '') IS NOT NULL
            AND trim(application_fee) !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$')
  ) THEN
    RAISE EXCEPTION 'Invalid numeric fee value in source data';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM import_programs
     GROUP BY university_name, program_name, degree, field, language,
              duration, tuition_fee, currency, intakes, requirements,
              application_fee, fee_type, is_active
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Exact duplicate program rows exist in source data';
  END IF;
END
$validation$;

INSERT INTO universities(name, country, is_active, status)
SELECT trim(university_name), trim(country), true, 'open'
  FROM import_universities
 ORDER BY lower(trim(university_name));

INSERT INTO programs(
  university_id, name, degree, field, language, duration, tuition_fee,
  currency, intakes, requirements, application_fee, fee_type, is_active
)
SELECT
  u.id,
  trim(p.program_name),
  nullif(trim(p.degree), ''),
  nullif(trim(p.field), ''),
  nullif(trim(p.language), ''),
  nullif(trim(p.duration), ''),
  nullif(trim(p.tuition_fee), '')::real,
  coalesce(nullif(trim(p.currency), ''), 'USD'),
  nullif(trim(p.intakes), ''),
  nullif(trim(p.requirements), ''),
  nullif(trim(p.application_fee), '')::real,
  nullif(trim(p.fee_type), ''),
  CASE
    WHEN lower(trim(p.is_active)) IN ('no', 'false', '0') THEN false
    ELSE true
  END
FROM import_programs p
JOIN universities u
  ON lower(trim(u.name)) = lower(trim(p.university_name));

DO $postcondition$
DECLARE
  expected_programs bigint;
  expected_universities bigint;
BEGIN
  SELECT program_count, university_count
    INTO expected_programs, expected_universities
    FROM import_expectations;

  IF (SELECT count(*) FROM programs) <> expected_programs THEN
    RAISE EXCEPTION 'Program insert postcondition failed: got %, expected %',
      (SELECT count(*) FROM programs), expected_programs;
  END IF;

  IF (SELECT count(*) FROM universities) <> expected_universities THEN
    RAISE EXCEPTION 'University insert postcondition failed: got %, expected %',
      (SELECT count(*) FROM universities), expected_universities;
  END IF;
END
$postcondition$;

INSERT INTO audit_logs(user_id, action, resource, changes)
SELECT
  NULL,
  'staging_program_catalog_bootstrap',
  'program',
  jsonb_build_object(
    'source', 'ApplyBoard_Edvoy_Merged_No_Duplicates.csv',
    'programs', (SELECT count(*) FROM programs),
    'universities', (SELECT count(*) FROM universities),
    'environment', 'staging'
  )::text;

COMMIT;

SELECT
  (SELECT count(*) FROM universities) AS universities,
  (SELECT count(*) FROM programs) AS programs,
  (SELECT count(*) FROM programs WHERE is_active) AS active_programs,
  (SELECT count(DISTINCT country) FROM universities) AS countries;
