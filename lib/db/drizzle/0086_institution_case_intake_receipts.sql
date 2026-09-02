-- Institution Admissions v1 case-intake corridor.
-- Additive/default-unwired: this migration does not backfill a legacy case,
-- expose applicant PII, call an external portal or enable an intake worker.

ALTER TABLE public.institution_application_cases
  ADD COLUMN source_portal_submission_id integer,
  ADD COLUMN source_snapshot_hash text,
  ADD COLUMN intake_receipt_hash text,
  ADD CONSTRAINT institution_application_cases_intake_source_fk
    FOREIGN KEY (source_portal_submission_id)
    REFERENCES public.portal_submissions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT institution_application_cases_intake_binding_chk CHECK (
    (source_portal_submission_id IS NULL AND source_snapshot_hash IS NULL AND intake_receipt_hash IS NULL)
    OR
    (source_portal_submission_id IS NOT NULL
      AND source_snapshot_hash ~ '^[0-9a-f]{64}$'
      AND intake_receipt_hash ~ '^[0-9a-f]{64}$')
  );

CREATE UNIQUE INDEX institution_application_cases_intake_source_uidx
  ON public.institution_application_cases
  (tenant_id, relationship_id, source_portal_submission_id)
  WHERE source_portal_submission_id IS NOT NULL;

CREATE TABLE public.institution_case_intake_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  application_case_id uuid NOT NULL,
  legacy_application_id integer NOT NULL,
  portal_submission_id integer NOT NULL,
  source_status text NOT NULL,
  source_observed_at timestamptz NOT NULL,
  source_external_ref_hash text NOT NULL,
  source_snapshot_hash text NOT NULL,
  command_hash text NOT NULL,
  masked_student_ref text NOT NULL,
  receipt_hash text NOT NULL,
  executor_key text NOT NULL DEFAULT 'institution.case_intake.v1',
  outcome text NOT NULL DEFAULT 'CREATED',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_case_intake_receipts_tenant_id_id_uq
    UNIQUE (tenant_id, id),
  CONSTRAINT institution_case_intake_receipts_source_uq
    UNIQUE (tenant_id, relationship_id, portal_submission_id),
  CONSTRAINT institution_case_intake_receipts_receipt_hash_uq
    UNIQUE (tenant_id, relationship_id, receipt_hash),
  CONSTRAINT institution_case_intake_receipts_relationship_fk
    FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES public.institution_relationships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_case_intake_receipts_case_fk
    FOREIGN KEY (tenant_id, relationship_id, application_case_id)
    REFERENCES public.institution_application_cases(tenant_id, relationship_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_case_intake_receipts_application_fk
    FOREIGN KEY (legacy_application_id)
    REFERENCES public.applications(id) ON DELETE RESTRICT,
  CONSTRAINT institution_case_intake_receipts_submission_fk
    FOREIGN KEY (portal_submission_id)
    REFERENCES public.portal_submissions(id) ON DELETE RESTRICT,
  CONSTRAINT institution_case_intake_receipts_id_v7_chk
    CHECK (substring(id::text from 15 for 1) = '7'),
  CONSTRAINT institution_case_intake_receipts_source_status_chk
    CHECK (source_status IN ('submitted', 'already_exists', 'accepted')),
  CONSTRAINT institution_case_intake_receipts_hash_chk CHECK (
    source_external_ref_hash ~ '^[0-9a-f]{64}$'
    AND source_snapshot_hash ~ '^[0-9a-f]{64}$'
    AND command_hash ~ '^[0-9a-f]{64}$'
    AND receipt_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT institution_case_intake_receipts_masked_ref_chk
    CHECK (masked_student_ref ~ '^STU-[0-9A-F]{16}$'),
  CONSTRAINT institution_case_intake_receipts_executor_chk
    CHECK (executor_key = 'institution.case_intake.v1'),
  CONSTRAINT institution_case_intake_receipts_outcome_chk
    CHECK (outcome = 'CREATED')
);

CREATE INDEX institution_case_intake_receipts_case_idx
  ON public.institution_case_intake_receipts
  (tenant_id, relationship_id, application_case_id, created_at);

ALTER TABLE public.institution_case_intake_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_case_intake_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.institution_case_intake_receipts FROM PUBLIC;

CREATE POLICY institution_case_intake_receipts_scoped_select
  ON public.institution_case_intake_receipts FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  );

CREATE OR REPLACE FUNCTION public.prevent_institution_case_intake_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'institution case intake receipts are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER institution_case_intake_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.institution_case_intake_receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_institution_case_intake_receipt_mutation();

-- The intake binding becomes immutable once it exists. Historical/manual cases
-- remain nullable; this migration intentionally refuses a guessed backfill.
CREATE OR REPLACE FUNCTION public.enforce_institution_case_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  actor_role text := NULLIF(current_setting('app.institution_role', true), '');
  actor_membership uuid := NULLIF(current_setting('app.institution_membership_id', true), '')::uuid;
BEGIN
  IF (
    NEW.tenant_id, NEW.relationship_id, NEW.legacy_application_id,
    NEW.institution_id, NEW.program_id, NEW.intake_key,
    NEW.masked_student_ref, NEW.shared_profile, NEW.sla_policy_id,
    NEW.review_due_at, NEW.decision_due_at, NEW.received_at, NEW.created_at,
    NEW.source_portal_submission_id, NEW.source_snapshot_hash, NEW.intake_receipt_hash
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.relationship_id, OLD.legacy_application_id,
    OLD.institution_id, OLD.program_id, OLD.intake_key,
    OLD.masked_student_ref, OLD.shared_profile, OLD.sla_policy_id,
    OLD.review_due_at, OLD.decision_due_at, OLD.received_at, OLD.created_at,
    OLD.source_portal_submission_id, OLD.source_snapshot_hash, OLD.intake_receipt_hash
  ) THEN
    RAISE EXCEPTION 'institution case projection fields are immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'institution case version must increment by one' USING ERRCODE = '40001';
  END IF;
  IF NOT (
    (OLD.lifecycle_state = NEW.lifecycle_state) OR
    (OLD.lifecycle_state = 'RECEIVED' AND NEW.lifecycle_state IN ('REVIEWING', 'CLOSED')) OR
    (OLD.lifecycle_state = 'REVIEWING' AND NEW.lifecycle_state IN ('INFORMATION_REQUESTED', 'READY_FOR_DECISION', 'CLOSED')) OR
    (OLD.lifecycle_state = 'INFORMATION_REQUESTED' AND NEW.lifecycle_state IN ('REVIEWING', 'READY_FOR_DECISION', 'CLOSED')) OR
    (OLD.lifecycle_state = 'READY_FOR_DECISION' AND NEW.lifecycle_state IN ('DECISION_PENDING_APPROVAL', 'REVIEWING', 'CLOSED')) OR
    (OLD.lifecycle_state = 'DECISION_PENDING_APPROVAL' AND NEW.lifecycle_state IN ('DECIDED', 'READY_FOR_DECISION')) OR
    (OLD.lifecycle_state = 'DECIDED' AND NEW.lifecycle_state IN ('OFFER_ISSUED', 'CLOSED')) OR
    (OLD.lifecycle_state = 'OFFER_ISSUED' AND NEW.lifecycle_state IN ('ENROLMENT_PENDING', 'CLOSED')) OR
    (OLD.lifecycle_state = 'ENROLMENT_PENDING' AND NEW.lifecycle_state IN ('ENROLLED', 'CLOSED'))
  ) THEN
    RAISE EXCEPTION 'invalid institution case transition % -> %', OLD.lifecycle_state, NEW.lifecycle_state USING ERRCODE = '23514';
  END IF;
  IF OLD.lifecycle_state IN ('ENROLLED', 'CLOSED') THEN
    RAISE EXCEPTION 'terminal institution case cannot be updated' USING ERRCODE = '23514';
  END IF;
  IF OLD.lifecycle_state <> NEW.lifecycle_state AND NEW.lifecycle_state = 'DECIDED' AND NOT EXISTS (
    SELECT 1 FROM public.institution_decisions d
    WHERE d.tenant_id = NEW.tenant_id AND d.relationship_id = NEW.relationship_id
      AND d.application_case_id = NEW.id AND d.state = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'institution decided case requires approved decision evidence' USING ERRCODE = '23514';
  END IF;
  IF OLD.lifecycle_state <> NEW.lifecycle_state AND NEW.lifecycle_state = 'OFFER_ISSUED' AND NOT EXISTS (
    SELECT 1 FROM public.institution_offers o
    WHERE o.tenant_id = NEW.tenant_id AND o.relationship_id = NEW.relationship_id
      AND o.application_case_id = NEW.id AND o.state = 'ISSUED'
  ) THEN
    RAISE EXCEPTION 'institution offer case requires issued offer evidence' USING ERRCODE = '23514';
  END IF;
  IF OLD.lifecycle_state <> NEW.lifecycle_state AND NEW.lifecycle_state = 'ENROLMENT_PENDING' AND NOT EXISTS (
    SELECT 1 FROM public.institution_enrolments e
    WHERE e.tenant_id = NEW.tenant_id AND e.relationship_id = NEW.relationship_id
      AND e.application_case_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'institution enrolment case requires enrolment evidence' USING ERRCODE = '23514';
  END IF;
  IF OLD.lifecycle_state <> NEW.lifecycle_state AND NEW.lifecycle_state = 'ENROLLED' AND NOT EXISTS (
    SELECT 1 FROM public.institution_enrolments e
    WHERE e.tenant_id = NEW.tenant_id AND e.relationship_id = NEW.relationship_id
      AND e.application_case_id = NEW.id AND e.state = 'CONFIRMED'
  ) THEN
    RAISE EXCEPTION 'institution enrolled case requires confirmed enrolment evidence' USING ERRCODE = '23514';
  END IF;
  IF actor_role = 'ADMISSIONS_REVIEWER' THEN
    IF NEW.assigned_reviewer_membership_id IS DISTINCT FROM OLD.assigned_reviewer_membership_id
      AND NOT (OLD.assigned_reviewer_membership_id IS NULL AND NEW.assigned_reviewer_membership_id = actor_membership) THEN
      RAISE EXCEPTION 'reviewer cannot assign another institution actor' USING ERRCODE = '42501';
    END IF;
    IF NEW.lifecycle_state NOT IN ('REVIEWING', 'INFORMATION_REQUESTED', 'READY_FOR_DECISION', 'DECISION_PENDING_APPROVAL') THEN
      RAISE EXCEPTION 'reviewer case transition denied' USING ERRCODE = '42501';
    END IF;
  ELSIF actor_role = 'DECISION_APPROVER' THEN
    IF NEW.assigned_reviewer_membership_id IS DISTINCT FROM OLD.assigned_reviewer_membership_id THEN
      RAISE EXCEPTION 'decision approver cannot change reviewer assignment' USING ERRCODE = '42501';
    END IF;
    IF NEW.lifecycle_state NOT IN ('READY_FOR_DECISION', 'DECIDED', 'OFFER_ISSUED', 'ENROLMENT_PENDING', 'ENROLLED') THEN
      RAISE EXCEPTION 'decision approver case transition denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.last_activity_at := now();
  RETURN NEW;
END;
$$;

CREATE SCHEMA fas_institution_intake_v1;
REVOKE ALL ON SCHEMA fas_institution_intake_v1 FROM PUBLIC;

CREATE FUNCTION fas_institution_intake_v1.create_case_from_portal_submission(
  p_tenant_id uuid,
  p_relationship_id uuid,
  p_portal_submission_id integer,
  p_application_case_id uuid,
  p_receipt_id uuid
) RETURNS TABLE (
  outcome text,
  application_case_id uuid,
  receipt_id uuid,
  source_snapshot_hash text,
  receipt_hash text,
  masked_student_ref text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
SET row_security TO on
AS $$
DECLARE
  v_guard constant text := 'institution-case-intake-v1:7d52b7f6';
  v_existing public.institution_case_intake_receipts%ROWTYPE;
  v_relationship public.institution_relationships%ROWTYPE;
  v_submission public.portal_submissions%ROWTYPE;
  v_application public.applications%ROWTYPE;
  v_program_university_id integer;
  v_source_snapshot_hash text;
  v_source_external_ref_hash text;
  v_command_hash text;
  v_receipt_hash text;
  v_masked_student_ref text;
  v_sla_id uuid;
  v_review_target_hours integer;
  v_active_sla_count integer;
BEGIN
  IF p_portal_submission_id IS NULL OR p_portal_submission_id <= 0 THEN
    RAISE EXCEPTION 'institution intake submission id invalid' USING ERRCODE = '22023';
  END IF;
  IF substring(p_application_case_id::text from 15 for 1) <> '7'
    OR substring(p_receipt_id::text from 15 for 1) <> '7' THEN
    RAISE EXCEPTION 'institution intake requires uuidv7 ids' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_relationship_id::text || ':' || p_portal_submission_id::text,
    9042026
  ));
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('app.institution_relationship_id', p_relationship_id::text, true);

  SELECT * INTO v_existing
  FROM public.institution_case_intake_receipts r
  WHERE r.tenant_id = p_tenant_id
    AND r.relationship_id = p_relationship_id
    AND r.portal_submission_id = p_portal_submission_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      'REPLAY'::text,
      v_existing.application_case_id,
      v_existing.id,
      v_existing.source_snapshot_hash,
      v_existing.receipt_hash,
      v_existing.masked_student_ref;
    RETURN;
  END IF;

  SELECT * INTO STRICT v_relationship
  FROM public.institution_relationships r
  WHERE r.tenant_id = p_tenant_id
    AND r.id = p_relationship_id;
  IF v_relationship.status <> 'ACTIVE'
    OR v_relationship.purpose_code <> 'admissions.review'
    OR NOT ('application.profile' = ANY(v_relationship.data_scopes))
    OR v_relationship.valid_from > now()
    OR (v_relationship.valid_until IS NOT NULL AND v_relationship.valid_until <= now()) THEN
    RAISE EXCEPTION 'institution intake relationship unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id AND t.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'institution intake tenant unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT v_submission
  FROM public.portal_submissions ps
  WHERE ps.id = p_portal_submission_id;
  IF v_submission.deleted_at IS NOT NULL
    OR v_submission.mode::text <> 'real'
    OR v_submission.status::text NOT IN ('submitted', 'already_exists', 'accepted')
    OR NULLIF(btrim(v_submission.external_ref), '') IS NULL
    OR v_submission.student_id IS NULL THEN
    RAISE EXCEPTION 'institution intake source is not a successful real submission' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO STRICT v_application
  FROM public.applications a
  WHERE a.id = v_submission.application_id;
  IF v_application.deleted_at IS NOT NULL
    OR v_application.student_id <> v_submission.student_id
    OR v_application.university_id IS NULL
    OR v_application.university_id <> v_relationship.institution_id
    OR v_application.program_id IS NULL
    OR v_application.branch_id IS NULL THEN
    RAISE EXCEPTION 'institution intake application scope mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_organization_legacy_branches branch_map
    JOIN public.organizations organization
      ON organization.tenant_id = branch_map.tenant_id
     AND organization.id = branch_map.organization_id
     AND organization.status = 'ACTIVE'
    WHERE branch_map.tenant_id = p_tenant_id
      AND branch_map.legacy_branch_id = v_application.branch_id
  ) THEN
    RAISE EXCEPTION 'institution intake application tenant binding unavailable' USING ERRCODE = '23514';
  END IF;
  SELECT p.university_id INTO STRICT v_program_university_id
  FROM public.programs p
  WHERE p.id = v_application.program_id AND p.is_active = true;
  IF v_program_university_id <> v_relationship.institution_id THEN
    RAISE EXCEPTION 'institution intake program scope mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.portal_universities pu
    WHERE pu.crm_university_id = v_relationship.institution_id
      AND pu.is_active = true
      AND pu.deleted_at IS NULL
      AND (pu.university_key = v_submission.university_key OR pu.routes_via = v_submission.university_key)
  ) THEN
    RAISE EXCEPTION 'institution intake portal university binding unavailable' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
  INTO v_active_sla_count
  FROM public.institution_sla_policies s
  WHERE s.tenant_id = p_tenant_id
    AND s.relationship_id = p_relationship_id
    AND s.status = 'ACTIVE';
  IF v_active_sla_count > 1 THEN
    RAISE EXCEPTION 'institution intake active SLA is ambiguous' USING ERRCODE = '23514';
  END IF;
  IF v_active_sla_count = 1 THEN
    SELECT s.id, s.review_target_hours
    INTO STRICT v_sla_id, v_review_target_hours
    FROM public.institution_sla_policies s
    WHERE s.tenant_id = p_tenant_id
      AND s.relationship_id = p_relationship_id
      AND s.status = 'ACTIVE';
  END IF;

  v_source_external_ref_hash := encode(sha256(convert_to(v_submission.external_ref, 'UTF8')), 'hex');
  v_source_snapshot_hash := encode(sha256(convert_to(concat_ws(E'\x1f',
    'institution-portal-source-v1', p_tenant_id::text, p_relationship_id::text,
    v_submission.id::text, v_submission.application_id::text, v_submission.student_id::text,
    v_submission.university_key, coalesce(v_submission.adapter_key, ''),
    v_submission.mode::text, v_submission.status::text, v_source_external_ref_hash,
    v_application.university_id::text, v_application.program_id::text,
    coalesce(v_application.intake, ''), v_application.branch_id::text,
    to_char(v_submission.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ), 'UTF8')), 'hex');
  v_command_hash := encode(sha256(convert_to(concat_ws(E'\x1f',
    'institution-case-intake-command-v1', p_tenant_id::text,
    p_relationship_id::text, v_submission.id::text, v_submission.application_id::text,
    v_source_snapshot_hash
  ), 'UTF8')), 'hex');
  v_masked_student_ref := 'STU-' || upper(substr(encode(sha256(convert_to(
    p_tenant_id::text || ':' || v_application.student_id::text,
    'UTF8'
  )), 'hex'), 1, 16));
  v_receipt_hash := encode(sha256(convert_to(concat_ws(E'\x1f',
    'institution-case-intake-receipt-v1', p_receipt_id::text,
    p_application_case_id::text, v_command_hash, v_source_snapshot_hash,
    v_masked_student_ref
  ), 'UTF8')), 'hex');

  PERFORM set_config('app.institution_intake_guard', v_guard, true);
  INSERT INTO public.institution_application_cases (
    id, tenant_id, relationship_id, legacy_application_id, institution_id,
    program_id, intake_key, masked_student_ref, shared_profile,
    lifecycle_state, priority, readiness_percent, blocker_code,
    sla_policy_id, review_due_at, received_at, last_activity_at,
    source_portal_submission_id, source_snapshot_hash, intake_receipt_hash
  ) VALUES (
    p_application_case_id, p_tenant_id, p_relationship_id, v_application.id,
    v_relationship.institution_id, v_application.program_id, v_application.intake,
    v_masked_student_ref, '{}'::jsonb, 'RECEIVED', 'NORMAL', 0,
    'EVIDENCE_NOT_SHARED', v_sla_id,
    CASE WHEN v_review_target_hours IS NULL THEN NULL
      ELSE v_submission.updated_at + make_interval(hours => v_review_target_hours) END,
    v_submission.updated_at, v_submission.updated_at,
    v_submission.id, v_source_snapshot_hash, v_receipt_hash
  );

  INSERT INTO public.institution_case_intake_receipts (
    id, tenant_id, relationship_id, application_case_id, legacy_application_id,
    portal_submission_id, source_status, source_observed_at,
    source_external_ref_hash, source_snapshot_hash, command_hash,
    masked_student_ref, receipt_hash
  ) VALUES (
    p_receipt_id, p_tenant_id, p_relationship_id, p_application_case_id,
    v_application.id, v_submission.id, v_submission.status::text,
    v_submission.updated_at, v_source_external_ref_hash, v_source_snapshot_hash,
    v_command_hash, v_masked_student_ref, v_receipt_hash
  );

  RETURN QUERY SELECT
    'CREATED'::text, p_application_case_id, p_receipt_id,
    v_source_snapshot_hash, v_receipt_hash, v_masked_student_ref;
END;
$$;

REVOKE ALL ON FUNCTION fas_institution_intake_v1.create_case_from_portal_submission(
  uuid, uuid, integer, uuid, uuid
) FROM PUBLIC;

-- FORCE RLS remains enabled. These policies are usable only while the exact
-- SECURITY DEFINER function owner is executing with its transaction-local guard.
CREATE POLICY institution_application_cases_intake_insert
  ON public.institution_application_cases FOR INSERT WITH CHECK (
    current_user = pg_get_userbyid((
      SELECT p.proowner FROM pg_catalog.pg_proc p
      WHERE p.oid = 'fas_institution_intake_v1.create_case_from_portal_submission(uuid,uuid,integer,uuid,uuid)'::regprocedure
    ))
    AND NULLIF(current_setting('app.institution_intake_guard', true), '')
      = 'institution-case-intake-v1:7d52b7f6'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND shared_profile = '{}'::jsonb
    AND lifecycle_state = 'RECEIVED'
    AND readiness_percent = 0
    AND blocker_code = 'EVIDENCE_NOT_SHARED'
  );

CREATE POLICY institution_case_intake_receipts_executor_insert
  ON public.institution_case_intake_receipts FOR INSERT WITH CHECK (
    current_user = pg_get_userbyid((
      SELECT p.proowner FROM pg_catalog.pg_proc p
      WHERE p.oid = 'fas_institution_intake_v1.create_case_from_portal_submission(uuid,uuid,integer,uuid,uuid)'::regprocedure
    ))
    AND NULLIF(current_setting('app.institution_intake_guard', true), '')
      = 'institution-case-intake-v1:7d52b7f6'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  );
