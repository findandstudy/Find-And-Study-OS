ALTER TABLE "users" ADD COLUMN "activation_pending" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Preserve existing student invitations with current server-issued evidence.
-- Administrative deactivation always prevails and no account is activated here.
UPDATE "users" u
SET "activation_pending" = true
WHERE u."role" = 'student'
  AND u."is_active" = false
  AND u."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "audit_logs" a
    WHERE a."resource" = 'user' AND a."resource_id" = u."id"
      AND a."action" = 'update_user' AND a."changes" LIKE '%"isActive"%'
  )
  AND (
    (u."email_verified" = false AND EXISTS (
      SELECT 1 FROM "email_verification_codes" v
      WHERE v."email" = u."email" AND v."used" = false
        AND v."expires_at" > CURRENT_TIMESTAMP AND v."created_at" >= u."created_at"
    ))
    OR (
      u."password_hash" IS NULL AND u."password_reset_token" IS NOT NULL
      AND u."password_reset_expires" > CURRENT_TIMESTAMP
      AND (u."created_from_source" = 'public_apply' OR u."created_from_source" LIKE 'embed:%')
    )
  );
