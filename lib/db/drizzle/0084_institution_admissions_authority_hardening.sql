-- Institution Admissions v1 authority hardening.
-- Additive follow-up: preserve 0083 identity while moving program/intake,
-- assigned-case and current-actor invariants into the database boundary.

CREATE FUNCTION "institution_current_program_scope_ids"() RETURNS integer[]
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(value::integer), ARRAY[]::integer[])
  FROM jsonb_array_elements_text(
    COALESCE(NULLIF(current_setting('app.institution_program_scope_ids', true), ''), '[]')::jsonb
  ) AS item(value)
$$;

CREATE FUNCTION "institution_current_intake_scopes"() RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(value), ARRAY[]::text[])
  FROM jsonb_array_elements_text(
    COALESCE(NULLIF(current_setting('app.institution_intake_scopes', true), ''), '[]')::jsonb
  ) AS item(value)
$$;

CREATE FUNCTION "institution_case_scope_matches"(
  case_program_id integer,
  case_intake_key text,
  assigned_membership_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT
    (
      cardinality(public.institution_current_program_scope_ids()) = 0
      OR case_program_id = ANY(public.institution_current_program_scope_ids())
    )
    AND (
      cardinality(public.institution_current_intake_scopes()) = 0
      OR case_intake_key = ANY(public.institution_current_intake_scopes())
    )
    AND (
      NULLIF(current_setting('app.institution_role', true), '') <> 'ADMISSIONS_REVIEWER'
      OR assigned_membership_id IS NULL
      OR assigned_membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    )
$$;

-- Institution Admin governs the relationship, team and policy surface; it is
-- not an admissions reviewer. Deny wins in the capability resolver.
UPDATE "role_package_capabilities"
SET "effect" = 'DENY'
WHERE "role_package_version_id" = '018f9000-0000-7000-8000-000000000011'
  AND "capability_key" = 'institution.applications.review';

DROP POLICY "institution_application_cases_scoped_select" ON "institution_application_cases";
CREATE POLICY "institution_application_cases_scoped_select" ON "institution_application_cases" FOR SELECT USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND public.institution_case_scope_matches("program_id", "intake_key", "assigned_reviewer_membership_id")
);

DROP POLICY "institution_requirement_sets_scoped_select" ON "institution_requirement_sets";
CREATE POLICY "institution_requirement_sets_scoped_select" ON "institution_requirement_sets" FOR SELECT USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND (
    cardinality(public.institution_current_program_scope_ids()) = 0
    OR "program_id" = ANY(public.institution_current_program_scope_ids())
  )
  AND (
    cardinality(public.institution_current_intake_scopes()) = 0
    OR "intake_key" = ANY(public.institution_current_intake_scopes())
  )
);

DROP POLICY "institution_requirements_scoped_select" ON "institution_requirements";
CREATE POLICY "institution_requirements_scoped_select" ON "institution_requirements" FOR SELECT USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM "institution_requirement_sets" s
    WHERE s."tenant_id" = "institution_requirements"."tenant_id"
      AND s."id" = "institution_requirements"."requirement_set_id"
  )
);

DO $$
DECLARE
  policy_name text;
  table_name text;
  case_tables constant text[] := ARRAY[
    'institution_evidence_assessments', 'institution_information_requests',
    'institution_decisions', 'institution_offers', 'institution_enrolments'
  ];
BEGIN
  FOREACH table_name IN ARRAY case_tables LOOP
    policy_name := table_name || '_scoped_select';
    EXECUTE format('DROP POLICY %I ON public.%I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (
        tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid
        AND relationship_id = NULLIF(current_setting(''app.institution_relationship_id'', true), '''')::uuid
        AND EXISTS (
          SELECT 1 FROM public.institution_application_cases c
          WHERE c.tenant_id = %I.tenant_id
            AND c.relationship_id = %I.relationship_id
            AND c.id = %I.application_case_id
        )
      )',
      policy_name, table_name, table_name, table_name, table_name
    );
  END LOOP;
END;
$$;

DROP POLICY "institution_decision_approvals_scoped_select" ON "institution_decision_approvals";
CREATE POLICY "institution_decision_approvals_scoped_select" ON "institution_decision_approvals" FOR SELECT USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM "institution_decisions" d
    WHERE d."tenant_id" = "institution_decision_approvals"."tenant_id"
      AND d."id" = "institution_decision_approvals"."decision_id"
  )
);

DROP POLICY "institution_admission_events_scoped_select" ON "institution_admission_events";
CREATE POLICY "institution_admission_events_scoped_select" ON "institution_admission_events" FOR SELECT USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND (
    "application_case_id" IS NULL
    OR EXISTS (
      SELECT 1 FROM "institution_application_cases" c
      WHERE c."tenant_id" = "institution_admission_events"."tenant_id"
        AND c."relationship_id" = "institution_admission_events"."relationship_id"
        AND c."id" = "institution_admission_events"."application_case_id"
    )
  )
);

DROP POLICY "institution_application_cases_scoped_update" ON "institution_application_cases";
CREATE POLICY "institution_application_cases_scoped_update" ON "institution_application_cases" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('ADMISSIONS_REVIEWER', 'DECISION_APPROVER')
  AND public.institution_case_scope_matches("program_id", "intake_key", "assigned_reviewer_membership_id")
) WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND public.institution_case_scope_matches("program_id", "intake_key", "assigned_reviewer_membership_id")
);

DROP POLICY "institution_requirement_sets_scoped_update" ON "institution_requirement_sets";
CREATE POLICY "institution_requirement_sets_scoped_update" ON "institution_requirement_sets" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'PROGRAM_INTAKE_MANAGER'
  AND (
    cardinality(public.institution_current_program_scope_ids()) = 0
    OR "program_id" = ANY(public.institution_current_program_scope_ids())
  )
  AND (
    cardinality(public.institution_current_intake_scopes()) = 0
    OR "intake_key" = ANY(public.institution_current_intake_scopes())
  )
) WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'PROGRAM_INTAKE_MANAGER'
);

-- No institution route mutates an information request after creation in this
-- slice. Keep that future receipt corridor closed at the database boundary.
DROP POLICY "institution_information_requests_scoped_update" ON "institution_information_requests";

DROP POLICY "institution_offers_approver_insert" ON "institution_offers";
CREATE POLICY "institution_offers_approver_insert" ON "institution_offers" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'DECISION_APPROVER'
  AND "state" = 'DRAFT'
  AND "issued_by_membership_id" IS NULL
  AND "receipt_hash" IS NULL
  AND EXISTS (
    SELECT 1 FROM "institution_decisions" d
    WHERE d."tenant_id" = "institution_offers"."tenant_id"
      AND d."relationship_id" = "institution_offers"."relationship_id"
      AND d."application_case_id" = "institution_offers"."application_case_id"
      AND d."id" = "institution_offers"."decision_id"
      AND d."state" = 'APPROVED'
  )
);

DROP POLICY "institution_enrolments_approver_insert" ON "institution_enrolments";
CREATE POLICY "institution_enrolments_approver_insert" ON "institution_enrolments" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'DECISION_APPROVER'
  AND "state" = 'PENDING_EVIDENCE'
  AND "evidence_ref_hash" IS NULL
  AND "verified_by_membership_id" IS NULL
  AND "receipt_hash" IS NULL
  AND "effective_at" IS NULL
);

DROP POLICY "institution_enrolments_scoped_update" ON "institution_enrolments";
CREATE POLICY "institution_enrolments_scoped_update" ON "institution_enrolments" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'DECISION_APPROVER'
) WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'DECISION_APPROVER'
);

DROP POLICY "institution_sla_policies_admin_insert" ON "institution_sla_policies";
CREATE POLICY "institution_sla_policies_admin_insert" ON "institution_sla_policies" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND "created_by_membership_id" = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'INSTITUTION_ADMIN'
);

DROP POLICY "institution_requirement_sets_manager_insert" ON "institution_requirement_sets";
CREATE POLICY "institution_requirement_sets_manager_insert" ON "institution_requirement_sets" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND "created_by_membership_id" = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'PROGRAM_INTAKE_MANAGER'
  AND (
    cardinality(public.institution_current_program_scope_ids()) = 0
    OR "program_id" = ANY(public.institution_current_program_scope_ids())
  )
  AND (
    cardinality(public.institution_current_intake_scopes()) = 0
    OR "intake_key" = ANY(public.institution_current_intake_scopes())
  )
);

DROP POLICY "institution_requirements_scoped_insert" ON "institution_requirements";
CREATE POLICY "institution_requirements_scoped_insert" ON "institution_requirements" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'PROGRAM_INTAKE_MANAGER'
  AND EXISTS (
    SELECT 1 FROM "institution_requirement_sets" s
    WHERE s."tenant_id" = "institution_requirements"."tenant_id"
      AND s."id" = "institution_requirements"."requirement_set_id"
      AND s."created_by_membership_id" = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
      AND s."state" = 'DRAFT'
  )
);

DROP POLICY "institution_evidence_assessments_reviewer_insert" ON "institution_evidence_assessments";
CREATE POLICY "institution_evidence_assessments_reviewer_insert" ON "institution_evidence_assessments" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND "reviewer_membership_id" = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'ADMISSIONS_REVIEWER'
  AND EXISTS (SELECT 1 FROM "institution_application_cases" c WHERE c."id" = "application_case_id")
);

DROP POLICY "institution_information_requests_reviewer_insert" ON "institution_information_requests";
CREATE POLICY "institution_information_requests_reviewer_insert" ON "institution_information_requests" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND "created_by_membership_id" = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'ADMISSIONS_REVIEWER'
  AND EXISTS (SELECT 1 FROM "institution_application_cases" c WHERE c."id" = "application_case_id")
);

DROP POLICY "institution_decisions_reviewer_insert" ON "institution_decisions";
CREATE POLICY "institution_decisions_reviewer_insert" ON "institution_decisions" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND "maker_membership_id" = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'ADMISSIONS_REVIEWER'
  AND EXISTS (SELECT 1 FROM "institution_application_cases" c WHERE c."id" = "application_case_id")
);

DROP POLICY "institution_decision_approvals_approver_insert" ON "institution_decision_approvals";
CREATE POLICY "institution_decision_approvals_approver_insert" ON "institution_decision_approvals" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND "checker_membership_id" = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'DECISION_APPROVER'
);

DROP POLICY "institution_events_actor_insert" ON "institution_admission_events";
CREATE POLICY "institution_events_actor_insert" ON "institution_admission_events" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND "actor_membership_id" = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN (
    'INSTITUTION_ADMIN', 'PROGRAM_INTAKE_MANAGER', 'ADMISSIONS_REVIEWER',
    'DECISION_APPROVER', 'INTEGRATION_ADMIN'
  )
);

CREATE UNIQUE INDEX "institution_evidence_assessments_supersedes_once_uq"
  ON "institution_evidence_assessments" ("tenant_id", "supersedes_assessment_id")
  WHERE "supersedes_assessment_id" IS NOT NULL;

CREATE FUNCTION "enforce_institution_evidence_lineage"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  superseded record;
  case_record record;
BEGIN
  SELECT "program_id", "intake_key" INTO case_record
  FROM public."institution_application_cases"
  WHERE "tenant_id" = NEW."tenant_id"
    AND "relationship_id" = NEW."relationship_id"
    AND "id" = NEW."application_case_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'institution evidence case unavailable' USING ERRCODE = '23514';
  END IF;

  IF NEW."requirement_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public."institution_requirements" r
    JOIN public."institution_requirement_sets" s
      ON s."tenant_id" = r."tenant_id" AND s."id" = r."requirement_set_id"
    WHERE r."tenant_id" = NEW."tenant_id"
      AND r."id" = NEW."requirement_id"
      AND s."relationship_id" = NEW."relationship_id"
      AND s."program_id" = case_record."program_id"
      AND s."intake_key" = case_record."intake_key"
  ) THEN
    RAISE EXCEPTION 'institution evidence requirement scope mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW."supersedes_assessment_id" IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public."institution_evidence_assessments" e
      WHERE e."tenant_id" = NEW."tenant_id"
        AND e."application_case_id" = NEW."application_case_id"
        AND e."evidence_ref_hash" = NEW."evidence_ref_hash"
    ) THEN
      RAISE EXCEPTION 'institution evidence reassessment must supersede current assessment' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO superseded
    FROM public."institution_evidence_assessments" e
    WHERE e."tenant_id" = NEW."tenant_id" AND e."id" = NEW."supersedes_assessment_id";
    IF NOT FOUND
      OR superseded."application_case_id" <> NEW."application_case_id"
      OR superseded."evidence_ref_hash" <> NEW."evidence_ref_hash" THEN
      RAISE EXCEPTION 'institution evidence supersedes scope mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "institution_evidence_lineage_guard"
  BEFORE INSERT ON "institution_evidence_assessments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_institution_evidence_lineage"();

CREATE OR REPLACE FUNCTION "enforce_institution_case_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  actor_role text := NULLIF(current_setting('app.institution_role', true), '');
  actor_membership uuid := NULLIF(current_setting('app.institution_membership_id', true), '')::uuid;
BEGIN
  IF (
    NEW."tenant_id", NEW."relationship_id", NEW."legacy_application_id",
    NEW."institution_id", NEW."program_id", NEW."intake_key",
    NEW."masked_student_ref", NEW."shared_profile", NEW."sla_policy_id",
    NEW."review_due_at", NEW."decision_due_at", NEW."received_at", NEW."created_at"
  ) IS DISTINCT FROM (
    OLD."tenant_id", OLD."relationship_id", OLD."legacy_application_id",
    OLD."institution_id", OLD."program_id", OLD."intake_key",
    OLD."masked_student_ref", OLD."shared_profile", OLD."sla_policy_id",
    OLD."review_due_at", OLD."decision_due_at", OLD."received_at", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'institution case projection fields are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."aggregate_version" <> OLD."aggregate_version" + 1 THEN
    RAISE EXCEPTION 'institution case version must increment by one' USING ERRCODE = '40001';
  END IF;
  IF NOT (
    (OLD."lifecycle_state" = NEW."lifecycle_state") OR
    (OLD."lifecycle_state" = 'RECEIVED' AND NEW."lifecycle_state" IN ('REVIEWING', 'CLOSED')) OR
    (OLD."lifecycle_state" = 'REVIEWING' AND NEW."lifecycle_state" IN ('INFORMATION_REQUESTED', 'READY_FOR_DECISION', 'CLOSED')) OR
    (OLD."lifecycle_state" = 'INFORMATION_REQUESTED' AND NEW."lifecycle_state" IN ('REVIEWING', 'READY_FOR_DECISION', 'CLOSED')) OR
    (OLD."lifecycle_state" = 'READY_FOR_DECISION' AND NEW."lifecycle_state" IN ('DECISION_PENDING_APPROVAL', 'REVIEWING', 'CLOSED')) OR
    (OLD."lifecycle_state" = 'DECISION_PENDING_APPROVAL' AND NEW."lifecycle_state" IN ('DECIDED', 'READY_FOR_DECISION')) OR
    (OLD."lifecycle_state" = 'DECIDED' AND NEW."lifecycle_state" IN ('OFFER_ISSUED', 'CLOSED')) OR
    (OLD."lifecycle_state" = 'OFFER_ISSUED' AND NEW."lifecycle_state" IN ('ENROLMENT_PENDING', 'CLOSED')) OR
    (OLD."lifecycle_state" = 'ENROLMENT_PENDING' AND NEW."lifecycle_state" IN ('ENROLLED', 'CLOSED'))
  ) THEN
    RAISE EXCEPTION 'invalid institution case transition % -> %', OLD."lifecycle_state", NEW."lifecycle_state" USING ERRCODE = '23514';
  END IF;
  IF OLD."lifecycle_state" IN ('ENROLLED', 'CLOSED') THEN
    RAISE EXCEPTION 'terminal institution case cannot be updated' USING ERRCODE = '23514';
  END IF;
  IF OLD."lifecycle_state" <> NEW."lifecycle_state" AND NEW."lifecycle_state" = 'DECIDED' AND NOT EXISTS (
    SELECT 1 FROM public."institution_decisions" d
    WHERE d."tenant_id" = NEW."tenant_id" AND d."relationship_id" = NEW."relationship_id"
      AND d."application_case_id" = NEW."id" AND d."state" = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'institution decided case requires approved decision evidence' USING ERRCODE = '23514';
  END IF;
  IF OLD."lifecycle_state" <> NEW."lifecycle_state" AND NEW."lifecycle_state" = 'OFFER_ISSUED' AND NOT EXISTS (
    SELECT 1 FROM public."institution_offers" o
    WHERE o."tenant_id" = NEW."tenant_id" AND o."relationship_id" = NEW."relationship_id"
      AND o."application_case_id" = NEW."id" AND o."state" = 'ISSUED'
  ) THEN
    RAISE EXCEPTION 'institution offer case requires issued offer evidence' USING ERRCODE = '23514';
  END IF;
  IF OLD."lifecycle_state" <> NEW."lifecycle_state" AND NEW."lifecycle_state" = 'ENROLMENT_PENDING' AND NOT EXISTS (
    SELECT 1 FROM public."institution_enrolments" e
    WHERE e."tenant_id" = NEW."tenant_id" AND e."relationship_id" = NEW."relationship_id"
      AND e."application_case_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'institution enrolment case requires enrolment evidence' USING ERRCODE = '23514';
  END IF;
  IF OLD."lifecycle_state" <> NEW."lifecycle_state" AND NEW."lifecycle_state" = 'ENROLLED' AND NOT EXISTS (
    SELECT 1 FROM public."institution_enrolments" e
    WHERE e."tenant_id" = NEW."tenant_id" AND e."relationship_id" = NEW."relationship_id"
      AND e."application_case_id" = NEW."id" AND e."state" = 'CONFIRMED'
  ) THEN
    RAISE EXCEPTION 'institution enrolled case requires confirmed enrolment evidence' USING ERRCODE = '23514';
  END IF;
  IF actor_role = 'ADMISSIONS_REVIEWER' THEN
    IF NEW."assigned_reviewer_membership_id" IS DISTINCT FROM OLD."assigned_reviewer_membership_id"
      AND NOT (OLD."assigned_reviewer_membership_id" IS NULL AND NEW."assigned_reviewer_membership_id" = actor_membership) THEN
      RAISE EXCEPTION 'reviewer cannot assign another institution actor' USING ERRCODE = '42501';
    END IF;
    IF NEW."lifecycle_state" NOT IN ('REVIEWING', 'INFORMATION_REQUESTED', 'READY_FOR_DECISION', 'DECISION_PENDING_APPROVAL') THEN
      RAISE EXCEPTION 'reviewer case transition denied' USING ERRCODE = '42501';
    END IF;
  ELSIF actor_role = 'DECISION_APPROVER' THEN
    IF NEW."assigned_reviewer_membership_id" IS DISTINCT FROM OLD."assigned_reviewer_membership_id" THEN
      RAISE EXCEPTION 'decision approver cannot change reviewer assignment' USING ERRCODE = '42501';
    END IF;
    IF NEW."lifecycle_state" NOT IN ('READY_FOR_DECISION', 'DECIDED', 'OFFER_ISSUED', 'ENROLMENT_PENDING', 'ENROLLED') THEN
      RAISE EXCEPTION 'decision approver case transition denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW."updated_at" := now();
  NEW."last_activity_at" := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_institution_decision_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  actor_role text := NULLIF(current_setting('app.institution_role', true), '');
  actor_membership uuid := NULLIF(current_setting('app.institution_membership_id', true), '')::uuid;
BEGIN
  IF OLD."content_hash" <> NEW."content_hash" OR OLD."maker_membership_id" <> NEW."maker_membership_id" OR OLD."decision_type" <> NEW."decision_type" OR OLD."conditions" <> NEW."conditions" THEN
    RAISE EXCEPTION 'decision content is immutable; create a new version' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD."state" = 'DRAFT' AND NEW."state" = 'SUBMITTED' AND NEW."submitted_at" IS NOT NULL) OR
    (OLD."state" = 'SUBMITTED' AND NEW."state" IN ('APPROVED', 'RETURNED', 'REJECTED') AND NEW."checker_membership_id" IS NOT NULL AND NEW."checker_membership_id" <> NEW."maker_membership_id")
  ) THEN
    RAISE EXCEPTION 'invalid institution decision transition' USING ERRCODE = '23514';
  END IF;
  IF actor_role = 'ADMISSIONS_REVIEWER' AND NOT (
    OLD."state" = 'DRAFT' AND NEW."state" = 'SUBMITTED' AND OLD."maker_membership_id" = actor_membership
  ) THEN
    RAISE EXCEPTION 'institution decision maker transition denied' USING ERRCODE = '42501';
  END IF;
  IF actor_role = 'DECISION_APPROVER' AND NOT (
    OLD."state" = 'SUBMITTED' AND NEW."checker_membership_id" = actor_membership
  ) THEN
    RAISE EXCEPTION 'institution decision checker transition denied' USING ERRCODE = '42501';
  END IF;
  IF NEW."state" = 'APPROVED' AND (NEW."decided_at" IS NULL OR NEW."effective_at" IS NULL) THEN
    RAISE EXCEPTION 'approved decision requires effective and decided timestamps' USING ERRCODE = '23514';
  END IF;
  IF OLD."state" = 'SUBMITTED' AND NOT EXISTS (
    SELECT 1 FROM public."institution_decision_approvals" a
    WHERE a."tenant_id" = NEW."tenant_id" AND a."relationship_id" = NEW."relationship_id"
      AND a."decision_id" = NEW."id" AND a."checker_membership_id" = NEW."checker_membership_id"
      AND a."outcome" = NEW."state"
  ) THEN
    RAISE EXCEPTION 'institution decision transition requires matching approval receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_institution_decision_approval_lineage"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."institution_decisions" d
    WHERE d."tenant_id" = NEW."tenant_id" AND d."relationship_id" = NEW."relationship_id"
      AND d."id" = NEW."decision_id" AND d."state" = 'SUBMITTED'
      AND d."maker_membership_id" <> NEW."checker_membership_id"
  ) THEN
    RAISE EXCEPTION 'institution approval decision scope or maker-checker mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "institution_decision_approval_lineage_guard"
  BEFORE INSERT ON "institution_decision_approvals"
  FOR EACH ROW EXECUTE FUNCTION "enforce_institution_decision_approval_lineage"();

CREATE OR REPLACE FUNCTION "enforce_institution_offer_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  actor_membership uuid := NULLIF(current_setting('app.institution_membership_id', true), '')::uuid;
BEGIN
  IF OLD."decision_id" <> NEW."decision_id" OR OLD."application_case_id" <> NEW."application_case_id" OR OLD."conditions" <> NEW."conditions" THEN
    RAISE EXCEPTION 'offer content is immutable; create a superseding offer' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(current_setting('app.institution_role', true), '') <> 'DECISION_APPROVER' THEN
    RAISE EXCEPTION 'institution offer transition actor denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    (OLD."state" = 'DRAFT' AND NEW."state" = 'ISSUED' AND NEW."issued_at" IS NOT NULL
      AND NEW."receipt_hash" IS NOT NULL AND NEW."issued_by_membership_id" = actor_membership
      AND EXISTS (
        SELECT 1 FROM public."institution_decisions" d
        WHERE d."tenant_id" = NEW."tenant_id" AND d."relationship_id" = NEW."relationship_id"
          AND d."application_case_id" = NEW."application_case_id"
          AND d."id" = NEW."decision_id" AND d."state" = 'APPROVED'
      )) OR
    (OLD."state" = 'ISSUED' AND NEW."state" IN ('ACCEPTED', 'DECLINED', 'LAPSED', 'SUPERSEDED'))
  ) THEN
    RAISE EXCEPTION 'invalid institution offer transition' USING ERRCODE = '23514';
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_institution_enrolment_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  actor_membership uuid := NULLIF(current_setting('app.institution_membership_id', true), '')::uuid;
BEGIN
  IF OLD."application_case_id" <> NEW."application_case_id" THEN
    RAISE EXCEPTION 'enrolment case binding is immutable' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(current_setting('app.institution_role', true), '') <> 'DECISION_APPROVER' THEN
    RAISE EXCEPTION 'institution enrolment transition actor denied' USING ERRCODE = '42501';
  END IF;
  IF OLD."state" <> 'PENDING_EVIDENCE' OR NEW."state" NOT IN ('CONFIRMED', 'DEFERRED', 'NOT_ENROLLED') THEN
    RAISE EXCEPTION 'invalid institution enrolment transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'institution enrolment version must increment by one' USING ERRCODE = '40001';
  END IF;
  IF NEW."state" = 'CONFIRMED' AND (
    NEW."evidence_ref_hash" !~ '^[0-9a-f]{64}$' OR NEW."receipt_hash" !~ '^[0-9a-f]{64}$'
    OR NEW."verified_by_membership_id" <> actor_membership OR NEW."effective_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'confirmed enrolment requires current verifier and evidence receipt' USING ERRCODE = '23514';
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_institution_requirement_set_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  actor_membership uuid := NULLIF(current_setting('app.institution_membership_id', true), '')::uuid;
BEGIN
  IF NULLIF(current_setting('app.institution_role', true), '') <> 'PROGRAM_INTAKE_MANAGER' THEN
    RAISE EXCEPTION 'institution requirement transition actor denied' USING ERRCODE = '42501';
  END IF;
  IF OLD."content_hash" <> NEW."content_hash" OR OLD."source_hash" <> NEW."source_hash" OR OLD."created_by_membership_id" <> NEW."created_by_membership_id" THEN
    RAISE EXCEPTION 'requirement content is immutable; create a new version' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD."state" = 'DRAFT' AND NEW."state" = 'IN_REVIEW') OR
    (OLD."state" = 'IN_REVIEW' AND NEW."state" = 'PUBLISHED') OR
    (OLD."state" = 'PUBLISHED' AND NEW."state" = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'invalid requirement set transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."state" = 'IN_REVIEW' AND OLD."created_by_membership_id" <> actor_membership THEN
    RAISE EXCEPTION 'only requirement maker can submit' USING ERRCODE = '42501';
  END IF;
  IF NEW."state" = 'PUBLISHED' AND (
    NEW."approved_by_membership_id" IS NULL
    OR NEW."approved_by_membership_id" = NEW."created_by_membership_id"
    OR NEW."approved_by_membership_id" <> actor_membership
    OR NEW."published_at" IS NULL OR NEW."effective_from" IS NULL
  ) THEN
    RAISE EXCEPTION 'published requirement set requires independent current checker and effective time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_institution_membership_authority"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  expected_role_definition text;
BEGIN
  expected_role_definition := CASE NEW."role_key"
    WHEN 'INSTITUTION_ADMIN' THEN 'institution.admin'
    WHEN 'PROGRAM_INTAKE_MANAGER' THEN 'institution.program_intake_manager'
    WHEN 'ADMISSIONS_REVIEWER' THEN 'institution.admissions_reviewer'
    WHEN 'DECISION_APPROVER' THEN 'institution.decision_approver'
    WHEN 'INTEGRATION_ADMIN' THEN 'institution.integration_admin'
    WHEN 'INSTITUTION_AUDITOR' THEN 'institution.auditor'
  END;
  IF expected_role_definition IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public."principals" p
    JOIN public."role_package_versions" rpv ON rpv."id" = NEW."role_package_version_id"
    JOIN public."role_definitions" rd ON rd."id" = rpv."role_definition_id"
    WHERE p."id" = NEW."principal_id"
      AND p."legacy_user_id" = NEW."legacy_user_id"
      AND p."principal_type" = 'HUMAN'
      AND p."status" = 'ACTIVE' AND p."risk_state" = 'NORMAL'
      AND rpv."status" = 'ACTIVE' AND rpv."effective_at" <= now()
      AND (rpv."deprecated_at" IS NULL OR rpv."deprecated_at" > now())
      AND rd."status" = 'ACTIVE' AND rd."key" = expected_role_definition
  ) THEN
    RAISE EXCEPTION 'institution membership authority mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "institution_membership_authority_guard"
  BEFORE INSERT OR UPDATE ON "institution_memberships"
  FOR EACH ROW EXECUTE FUNCTION "enforce_institution_membership_authority"();

REVOKE ALL ON FUNCTION public."institution_current_program_scope_ids"() FROM PUBLIC;
REVOKE ALL ON FUNCTION public."institution_current_intake_scopes"() FROM PUBLIC;
REVOKE ALL ON FUNCTION public."institution_case_scope_matches"(integer, text, uuid) FROM PUBLIC;
