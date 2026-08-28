-- Review-first agency onboarding lifecycle and automatic agency codes.
ALTER TABLE agent_applications
  ALTER COLUMN status SET DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS logo_file_key text,
  ADD COLUMN IF NOT EXISTS representative_id_file_key text,
  ADD COLUMN IF NOT EXISTS business_registration_file_key text,
  ADD COLUMN IF NOT EXISTS document_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contract_template_selection text NOT NULL DEFAULT 'automatic',
  ADD COLUMN IF NOT EXISTS contract_template_overridden_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_template_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS agent_applications_email_verified_idx
  ON agent_applications (email_verified_at);

CREATE INDEX IF NOT EXISTS agent_applications_contract_sent_idx
  ON agent_applications (contract_sent_at);

CREATE SEQUENCE IF NOT EXISTS agent_agency_code_seq START WITH 1;

DO $$
DECLARE
  existing_max bigint;
BEGIN
  SELECT COALESCE(MAX((regexp_match(agency_code, '^AG-([0-9]+)$'))[1]::bigint), 0)
    INTO existing_max
    FROM agents
   WHERE agency_code ~ '^AG-[0-9]+$';

  IF existing_max = 0 THEN
    PERFORM setval('agent_agency_code_seq', 1, false);
  ELSE
    PERFORM setval('agent_agency_code_seq', existing_max, true);
  END IF;
END $$;

ALTER TABLE agents
  ALTER COLUMN agency_code SET DEFAULT ('AG-' || LPAD(nextval('agent_agency_code_seq')::text, 6, '0'));

CREATE UNIQUE INDEX IF NOT EXISTS agents_agency_code_unique
  ON agents (agency_code)
  WHERE agency_code ~ '^AG-[0-9]+$';
