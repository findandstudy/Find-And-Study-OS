-- Commit-bound, PII-free invalidation for process-local facet caches. A
-- statement notification is delivered only after the surrounding transaction
-- commits, so readers never evict for rolled-back mutations.
CREATE OR REPLACE FUNCTION notify_facet_cache_invalidation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  namespace text;
BEGIN
  namespace := CASE TG_TABLE_NAME
    WHEN 'applications' THEN 'applications'
    WHEN 'leads' THEN 'leads'
    WHEN 'students' THEN 'students'
    ELSE NULL
  END;
  IF namespace IS NOT NULL THEN
    PERFORM pg_notify(
      'facet_cache_invalidation',
      json_build_object('namespace', namespace)::text
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS applications_facet_cache_invalidation ON applications;
CREATE TRIGGER applications_facet_cache_invalidation
AFTER INSERT OR UPDATE OR DELETE ON applications
FOR EACH STATEMENT EXECUTE FUNCTION notify_facet_cache_invalidation();

DROP TRIGGER IF EXISTS leads_facet_cache_invalidation ON leads;
CREATE TRIGGER leads_facet_cache_invalidation
AFTER INSERT OR UPDATE OR DELETE ON leads
FOR EACH STATEMENT EXECUTE FUNCTION notify_facet_cache_invalidation();

DROP TRIGGER IF EXISTS students_facet_cache_invalidation ON students;
CREATE TRIGGER students_facet_cache_invalidation
AFTER INSERT OR UPDATE OR DELETE ON students
FOR EACH STATEMENT EXECUTE FUNCTION notify_facet_cache_invalidation();
