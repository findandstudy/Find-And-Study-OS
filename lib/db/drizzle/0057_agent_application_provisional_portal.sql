-- Provisional agency portal access before commercial approval.
-- This migration is additive and remains compatible with the previous API release.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS access_tier text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS commercial_activated_at timestamptz;

ALTER TABLE agents ALTER COLUMN agency_code DROP NOT NULL;

CREATE INDEX IF NOT EXISTS agents_access_tier_idx ON agents (access_tier);

ALTER TABLE agent_applications
  ADD COLUMN IF NOT EXISTS provisional_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provisional_agent_id integer REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_access_status text NOT NULL DEFAULT 'provisional',
  ADD COLUMN IF NOT EXISTS contract_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contract_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_setup_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_commission_rate real,
  ADD COLUMN IF NOT EXISTS commercial_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_restricted_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_restriction_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS agent_applications_provisional_user_unique
  ON agent_applications (provisional_user_id)
  WHERE provisional_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_applications_provisional_agent_unique
  ON agent_applications (provisional_agent_id)
  WHERE provisional_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_applications_portal_access_idx
  ON agent_applications (portal_access_status, contract_deadline_at);

UPDATE agents
   SET access_tier = 'provisional'
 WHERE id IN (
   SELECT provisional_agent_id
     FROM agent_applications
    WHERE provisional_agent_id IS NOT NULL
      AND approved_at IS NULL
 );
