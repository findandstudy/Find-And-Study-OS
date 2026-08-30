-- Date-linked, globally unique agency identifiers for every agency. Historical
-- values are retained as lookup aliases so existing referral URLs continue to
-- resolve while the canonical code shown in the product always uses FAS.
CREATE SEQUENCE IF NOT EXISTS agent_agency_code_seq START WITH 1;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS legacy_agency_code text;

UPDATE agents
SET legacy_agency_code = agency_code
WHERE legacy_agency_code IS NULL
  AND agency_code IS NOT NULL
  AND agency_code !~ '^FAS-[0-9]{8}-[0-9]{6}$';

-- Resume after any FAS codes that may already exist (for example after a
-- partially completed rollout) instead of allowing the sequence to collide.
WITH existing AS (
  SELECT MAX(substring(agency_code FROM '([0-9]{6})$')::bigint) AS max_suffix
  FROM agents
  WHERE agency_code ~ '^FAS-[0-9]{8}-[0-9]{6}$'
), sequence_state AS (
  SELECT last_value, is_called FROM agent_agency_code_seq
)
SELECT setval(
  'agent_agency_code_seq',
  GREATEST(COALESCE(max_suffix, 0), last_value),
  max_suffix IS NOT NULL OR is_called
)
FROM existing, sequence_state;

UPDATE agents
SET agency_code = (
  'FAS-' ||
  TO_CHAR(COALESCE(created_at, CURRENT_TIMESTAMP) AT TIME ZONE 'UTC', 'YYYYMMDD') ||
  '-' ||
  LPAD(nextval('agent_agency_code_seq')::text, 6, '0')
)
WHERE agency_code IS NULL
   OR agency_code !~ '^FAS-[0-9]{8}-[0-9]{6}$';

ALTER TABLE agents
  ALTER COLUMN agency_code SET DEFAULT (
    'FAS-' ||
    TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYYMMDD') ||
    '-' ||
    LPAD(nextval('agent_agency_code_seq')::text, 6, '0')
  );

CREATE UNIQUE INDEX IF NOT EXISTS agents_fas_agency_code_unique
  ON agents (agency_code)
  WHERE agency_code ~ '^FAS-[0-9]{8}-[0-9]{6}$';

CREATE INDEX IF NOT EXISTS agents_legacy_agency_code_idx
  ON agents (legacy_agency_code);
