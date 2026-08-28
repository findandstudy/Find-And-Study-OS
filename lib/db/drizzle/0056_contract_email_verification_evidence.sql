-- Immutable evidence for the email-verification policy used at signing time.
-- Session columns capture the verification event; signed-contract columns
-- preserve the final policy/evidence even if the template changes later.
ALTER TABLE signing_sessions
  ADD COLUMN IF NOT EXISTS email_verification_method text,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

ALTER TABLE signed_contracts
  ADD COLUMN IF NOT EXISTS email_verification_required boolean,
  ADD COLUMN IF NOT EXISTS email_verification_method text,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
