# Staging editorial approval

The owner requested that the About content be published without switching to a
second reviewer account. Managed CMS page publication now supports an opt-in
staging editorial policy. It is disabled by default.

`WEBSITE_STAGING_SINGLE_ADMIN_PUBLISH=true` is effective only for `super_admin`
and only when the server release has the canonical `staging-<timestamp>-<commit12>`
identity, `ALLOW_LIVE_INTEGRATIONS=false`, and `EMAIL_DELIVERY_DISABLED=true`.
Missing or invalid configuration retains dual review. Production release IDs
cannot activate the exception. Request-changes and other publication systems
retain their existing policies.

The existing explicit `approved=true`, exact revision, preflight digest, content
validation, canonical collision checks and transactional publication remain.
The immutable version snapshot records author, reviewer and approval mode
`STAGING_EXPLICIT_SINGLE_ADMIN` or `DUAL_REVIEW`. No author ID is rewritten.
Preflight reports reviewer eligibility before offering final publication.

Disable by setting the opt-in to `false` and recreating only the staging app.
Test: `node --test artifacts/api-server/scripts/test-website-editorial-review.mjs`.
