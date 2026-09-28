-- Drizzle's staging executor can ledger a migration after running only the
-- first statement in a file. Keep the complete repair and its assertion in one
-- atomic statement so partial installation cannot be recorded as successful.
DO $$
DECLARE
  installed_count integer;
BEGIN
  IF to_regprocedure('public.notify_facet_cache_invalidation()') IS NULL THEN
    RAISE EXCEPTION 'facet cache invalidation function is missing';
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS applications_facet_cache_invalidation ON public.applications';
  EXECUTE 'CREATE TRIGGER applications_facet_cache_invalidation
    AFTER INSERT OR UPDATE OR DELETE ON public.applications
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_facet_cache_invalidation()';

  EXECUTE 'DROP TRIGGER IF EXISTS leads_facet_cache_invalidation ON public.leads';
  EXECUTE 'CREATE TRIGGER leads_facet_cache_invalidation
    AFTER INSERT OR UPDATE OR DELETE ON public.leads
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_facet_cache_invalidation()';

  EXECUTE 'DROP TRIGGER IF EXISTS students_facet_cache_invalidation ON public.students';
  EXECUTE 'CREATE TRIGGER students_facet_cache_invalidation
    AFTER INSERT OR UPDATE OR DELETE ON public.students
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_facet_cache_invalidation()';

  SELECT count(*)::integer
    INTO installed_count
    FROM pg_trigger
   WHERE tgname IN (
     'applications_facet_cache_invalidation',
     'leads_facet_cache_invalidation',
     'students_facet_cache_invalidation'
   )
     AND NOT tgisinternal;
  IF installed_count <> 3 THEN
    RAISE EXCEPTION 'facet cache invalidation trigger installation incomplete: %', installed_count;
  END IF;
END;
$$;
