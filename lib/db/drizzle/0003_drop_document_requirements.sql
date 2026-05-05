-- Task #97: retire degree-level document requirements completely.
-- Document requirements are now exclusively program-level (see
-- program_document_requirements). The legacy degree-keyed table and its
-- one-time backfill flag are no longer used.

DROP TABLE IF EXISTS "document_requirements" CASCADE;

DELETE FROM "system_flags" WHERE "key" = 'program_doc_requirements_backfill_v1';
