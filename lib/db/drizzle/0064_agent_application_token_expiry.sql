ALTER TABLE "agent_applications"
  ADD COLUMN IF NOT EXISTS "access_token_expires_at" timestamp with time zone;

-- Give existing active links one final seven-day grace period at rollout.
UPDATE "agent_applications"
SET "access_token_expires_at" = now() + interval '7 days'
WHERE "access_token_expires_at" IS NULL;

ALTER TABLE "agent_applications"
  ALTER COLUMN "access_token_expires_at" SET DEFAULT (now() + interval '7 days'),
  ALTER COLUMN "access_token_expires_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "agent_applications_access_token_expiry_idx"
  ON "agent_applications" ("access_token_expires_at");
