-- Institution Admissions v1 enrolment-evidence binding.
-- Additive/default-unwired: confirmation can consume only a consent-bound,
-- reviewer-verified evidence share selected from a published requirement.

ALTER TABLE public.institution_enrolments
  ADD COLUMN evidence_share_receipt_id uuid,
  ADD COLUMN evidence_assessment_id uuid;

ALTER TABLE public.institution_enrolments
  ADD CONSTRAINT institution_enrolments_evidence_share_fk
  FOREIGN KEY (
    tenant_id, relationship_id, application_case_id, evidence_share_receipt_id
  ) REFERENCES public.institution_evidence_share_receipts(
    tenant_id, relationship_id, application_case_id, id
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT institution_enrolments_evidence_assessment_fk
  FOREIGN KEY (tenant_id, evidence_assessment_id)
  REFERENCES public.institution_evidence_assessments(tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE public.institution_enrolments
  DROP CONSTRAINT institution_enrolments_evidence_chk,
  ADD CONSTRAINT institution_enrolments_evidence_chk CHECK (
    state <> 'CONFIRMED' OR (
      evidence_ref_hash ~ '^[0-9a-f]{64}$'
      AND receipt_hash ~ '^[0-9a-f]{64}$'
      AND verified_by_membership_id IS NOT NULL
      AND effective_at IS NOT NULL
      AND (
        (evidence_share_receipt_id IS NULL AND evidence_assessment_id IS NULL)
        OR (evidence_share_receipt_id IS NOT NULL AND evidence_assessment_id IS NOT NULL)
      )
    )
  ),
  ADD CONSTRAINT institution_enrolments_nonconfirmed_evidence_chk CHECK (
    state = 'CONFIRMED'
    OR (evidence_share_receipt_id IS NULL AND evidence_assessment_id IS NULL)
  );

CREATE FUNCTION fas_institution_evidence_v1.resolve_enrolment_confirmation(
  p_tenant_id uuid,
  p_relationship_id uuid,
  p_application_case_id uuid,
  p_share_receipt_id uuid,
  p_confirmed_at timestamptz
) RETURNS TABLE (
  evidence_ref_hash text,
  share_receipt_hash text,
  evidence_assessment_id uuid,
  evidence_assessment_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
SET row_security TO on
AS $$
DECLARE
  v_case public.institution_application_cases%ROWTYPE;
  v_share public.institution_evidence_share_receipts%ROWTYPE;
  v_latest_consent public.journey_consent_receipts%ROWTYPE;
  v_assessment record;
  v_caller_tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_caller_relationship uuid := NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid;
  v_caller_membership uuid := NULLIF(current_setting('app.institution_membership_id', true), '')::uuid;
  v_caller_principal uuid := NULLIF(current_setting('app.institution_principal_id', true), '')::uuid;
  v_caller_user integer := NULLIF(current_setting('app.legacy_user_id', true), '')::integer;
  v_caller_role text := NULLIF(current_setting('app.institution_role', true), '');
BEGIN
  IF p_confirmed_at IS NULL
    OR v_caller_tenant IS DISTINCT FROM p_tenant_id
    OR v_caller_relationship IS DISTINCT FROM p_relationship_id
    OR v_caller_membership IS NULL
    OR v_caller_principal IS NULL
    OR v_caller_user IS NULL
    OR v_caller_role <> 'DECISION_APPROVER' THEN
    RAISE EXCEPTION 'institution enrolment evidence actor context mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('app.institution_relationship_id', p_relationship_id::text, true);
  IF NOT EXISTS (
    SELECT 1 FROM public.institution_memberships m
    WHERE m.tenant_id = p_tenant_id
      AND m.relationship_id = p_relationship_id
      AND m.id = v_caller_membership
      AND m.principal_id = v_caller_principal
      AND m.legacy_user_id = v_caller_user
      AND m.role_key = 'DECISION_APPROVER'
      AND m.status = 'ACTIVE'
      AND m.valid_from <= p_confirmed_at
      AND (m.valid_until IS NULL OR m.valid_until > p_confirmed_at)
  ) THEN
    RAISE EXCEPTION 'institution enrolment evidence actor unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.institution_relationships r
    WHERE r.tenant_id = p_tenant_id
      AND r.id = p_relationship_id
      AND r.status = 'ACTIVE'
      AND r.purpose_code = 'admissions.review'
      AND 'application.enrolment' = ANY(r.data_scopes)
      AND r.valid_from <= p_confirmed_at
      AND (r.valid_until IS NULL OR r.valid_until > p_confirmed_at)
  ) THEN
    RAISE EXCEPTION 'institution enrolment evidence relationship unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT v_case
  FROM public.institution_application_cases c
  WHERE c.tenant_id = p_tenant_id
    AND c.relationship_id = p_relationship_id
    AND c.id = p_application_case_id;
  IF v_case.lifecycle_state NOT IN ('OFFER_ISSUED', 'ENROLMENT_PENDING') THEN
    RAISE EXCEPTION 'institution case is not ready for enrolment confirmation'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO STRICT v_share
  FROM public.institution_evidence_share_receipts r
  WHERE r.tenant_id = p_tenant_id
    AND r.relationship_id = p_relationship_id
    AND r.application_case_id = p_application_case_id
    AND r.id = p_share_receipt_id;

  SELECT * INTO STRICT v_latest_consent
  FROM public.journey_consent_receipts c
  WHERE c.tenant_id = v_share.tenant_id
    AND c.subject_id = v_share.journey_subject_id
    AND c.purpose = v_share.consent_purpose
    AND c.channel = 'in_app'
  ORDER BY c.sequence DESC
  LIMIT 1;
  IF v_latest_consent.id <> v_share.journey_consent_receipt_id
    OR v_latest_consent.receipt_hash <> v_share.consent_receipt_hash
    OR v_latest_consent.action <> 'CAPTURED'
    OR v_latest_consent.effective_at > p_confirmed_at
    OR (v_latest_consent.valid_until IS NOT NULL AND v_latest_consent.valid_until <= p_confirmed_at)
    OR (v_share.valid_until IS NOT NULL AND v_share.valid_until <= p_confirmed_at) THEN
    RAISE EXCEPTION 'institution enrolment evidence consent is not current and active'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    a.id,
    a.assessment_hash,
    a.result,
    req.evidence_type,
    requirement_set.state AS requirement_set_state,
    requirement_set.effective_from,
    requirement_set.effective_until
  INTO STRICT v_assessment
  FROM public.institution_evidence_assessments a
  JOIN public.institution_requirements req
    ON req.tenant_id = a.tenant_id AND req.id = a.requirement_id
  JOIN public.institution_requirement_sets requirement_set
    ON requirement_set.tenant_id = req.tenant_id
   AND requirement_set.id = req.requirement_set_id
  WHERE a.tenant_id = p_tenant_id
    AND a.relationship_id = p_relationship_id
    AND a.application_case_id = p_application_case_id
    AND a.evidence_share_receipt_id = p_share_receipt_id
    AND requirement_set.relationship_id = p_relationship_id
    AND requirement_set.program_id = v_case.program_id
    AND requirement_set.intake_key = v_case.intake_key
  ORDER BY a.assessed_at DESC, a.id DESC
  LIMIT 1;
  IF v_assessment.result <> 'VERIFIED'
    OR upper(v_assessment.evidence_type) <> 'ENROLMENT_CONFIRMATION'
    OR v_assessment.requirement_set_state <> 'PUBLISHED'
    OR v_assessment.effective_from IS NULL
    OR v_assessment.effective_from > p_confirmed_at
    OR (
      v_assessment.effective_until IS NOT NULL
      AND v_assessment.effective_until <= p_confirmed_at
    ) THEN
    RAISE EXCEPTION 'institution enrolment evidence is not currently eligible'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT
    v_share.evidence_ref_hash,
    v_share.receipt_hash,
    v_assessment.id::uuid,
    v_assessment.assessment_hash::text;
END;
$$;

REVOKE ALL ON FUNCTION fas_institution_evidence_v1.resolve_enrolment_confirmation(
  uuid, uuid, uuid, uuid, timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_institution_enrolment_evidence_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_evidence record;
BEGIN
  IF NEW.state <> 'CONFIRMED' THEN
    IF NEW.evidence_share_receipt_id IS NOT NULL
      OR NEW.evidence_assessment_id IS NOT NULL THEN
      RAISE EXCEPTION 'non-confirmed enrolment cannot retain evidence binding'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  NEW.effective_at := clock_timestamp();
  IF NEW.evidence_share_receipt_id IS NULL
    OR NEW.evidence_assessment_id IS NULL THEN
    -- Existing confirmed rows survive this additive migration, while every
    -- future confirmation is receipt-bound regardless of its intake source.
    RAISE EXCEPTION 'institution enrolment confirmation requires evidence share receipt'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO STRICT v_evidence
  FROM fas_institution_evidence_v1.resolve_enrolment_confirmation(
    NEW.tenant_id, NEW.relationship_id, NEW.application_case_id,
    NEW.evidence_share_receipt_id, NEW.effective_at
  );
  IF NEW.evidence_ref_hash <> v_evidence.evidence_ref_hash
    OR NEW.evidence_assessment_id <> v_evidence.evidence_assessment_id THEN
    RAISE EXCEPTION 'institution enrolment evidence binding mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER institution_enrolment_evidence_binding_guard
  BEFORE INSERT OR UPDATE ON public.institution_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_institution_enrolment_evidence_binding();
