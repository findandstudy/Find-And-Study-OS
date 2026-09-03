-- Reporting & Intelligence Center v1 role-package grants.
-- Additive only: custom roles and per-user revocations remain untouched.

UPDATE public.roles
SET permissions = permissions || '["reporting.view"]'::jsonb,
    updated_at = now()
WHERE name IN ('super_admin', 'admin', 'manager', 'accountant')
  AND NOT permissions ? 'reporting.view';

UPDATE public.roles
SET permissions = permissions || '["reporting.operations"]'::jsonb,
    updated_at = now()
WHERE name IN ('super_admin', 'admin', 'manager')
  AND NOT permissions ? 'reporting.operations';

UPDATE public.roles
SET permissions = permissions || '["reporting.finance"]'::jsonb,
    updated_at = now()
WHERE name IN ('super_admin', 'admin', 'manager', 'accountant')
  AND NOT permissions ? 'reporting.finance';

UPDATE public.roles
SET permissions = permissions || '["reporting.workforce"]'::jsonb,
    updated_at = now()
WHERE name IN ('super_admin', 'admin', 'manager')
  AND NOT permissions ? 'reporting.workforce';

UPDATE public.roles
SET permissions = permissions || '["reporting.export"]'::jsonb,
    updated_at = now()
WHERE name IN ('super_admin', 'admin', 'manager', 'accountant')
  AND NOT permissions ? 'reporting.export';

UPDATE public.roles
SET permissions = permissions || '["reporting.manage"]'::jsonb,
    updated_at = now()
WHERE name IN ('super_admin', 'admin')
  AND NOT permissions ? 'reporting.manage';
