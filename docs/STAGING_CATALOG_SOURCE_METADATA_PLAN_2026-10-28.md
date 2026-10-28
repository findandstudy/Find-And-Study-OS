# Staging Catalog Source Metadata Plan — 2026-10-28

## Goal

Restore the local catalogue source-verification capability on staging for
countries, cities, universities and programs, and make those sources available
to dynamic detail-page authoring without exposing admin-only notes publicly.

## Delivery order

1. Add an additive `source_metadata jsonb NOT NULL DEFAULT '{}'` column to the
   four catalogue entity tables with a bounded object-shape check.
2. Add one canonical server normalizer for supported source fields, safe public
   HTTP(S) URLs, verification dates, validity dates and bounded internal notes.
3. Extend catalogue create/update/bulk-import/export paths. Existing files remain
   compatible through `sourceMetadataJson`; readable per-field source columns
   take precedence when present.
4. Add the “External sources & verification” editor to all four catalogue forms.
   Source metadata remains visible only to manager-class authenticated users.
5. Include source metadata in the admin-only dynamic-page context. AI/content
   generation receives source name, URL and freshness metadata, while internal
   notes are excluded. Generated section citations use matching catalogue
   sources and retain the existing official-site fallback.
6. Run focused source-metadata, API typecheck, Edcons typecheck/build and migration
   validation tests. Do not run broad load or production test suites.
7. Deploy only to staging, apply the additive migration, verify health, then use
   the staging UI to confirm country/city/university source editing and persistence.

## Safety and rollback

- No production access or production data writes.
- Migration is additive and backward compatible; old application code ignores
  the new column.
- Code rollback may leave the unused JSON columns in place without affecting
  existing catalogue records.
- Public catalogue responses omit source metadata; public pages show only
  citations explicitly copied into reviewed page content.
