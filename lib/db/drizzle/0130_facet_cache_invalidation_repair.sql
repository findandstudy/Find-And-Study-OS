-- Forward-only repair for deployments where 0129 was ledgered without leaving
-- its trigger objects. Explicit statement boundaries keep function bodies and
-- trigger DDL independent across migration executors.
CREATE OR REPLACE FUNCTION public.notify_facet_cache_invalidation()
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
--> statement-breakpoint
DROP TRIGGER IF EXISTS applications_facet_cache_invalidation ON public.applications;
--> statement-breakpoint
CREATE TRIGGER applications_facet_cache_invalidation
AFTER INSERT OR UPDATE OR DELETE ON public.applications
FOR EACH STATEMENT EXECUTE FUNCTION public.notify_facet_cache_invalidation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS leads_facet_cache_invalidation ON public.leads;
--> statement-breakpoint
CREATE TRIGGER leads_facet_cache_invalidation
AFTER INSERT OR UPDATE OR DELETE ON public.leads
FOR EACH STATEMENT EXECUTE FUNCTION public.notify_facet_cache_invalidation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS students_facet_cache_invalidation ON public.students;
--> statement-breakpoint
CREATE TRIGGER students_facet_cache_invalidation
AFTER INSERT OR UPDATE OR DELETE ON public.students
FOR EACH STATEMENT EXECUTE FUNCTION public.notify_facet_cache_invalidation();
--> statement-breakpoint
DO $$
DECLARE
  installed_count integer;
BEGIN
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
