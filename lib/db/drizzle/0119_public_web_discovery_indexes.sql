-- Additive lookup support for tenant-scoped public sitemap and SEO discovery.
-- This migration publishes no content and changes no rollout state.

CREATE INDEX "public_web_publication_states_public_index_idx"
  ON "public_web_publication_states" (
    "tenant_id", "organization_id", "content_record_id", "updated_at"
  )
  WHERE "status" = 'PUBLISHED' AND "index_state" = 'INDEX';
