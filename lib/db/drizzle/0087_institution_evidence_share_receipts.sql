-- Institution Admissions v1 evidence-sharing corridor.
-- Additive/default-unwired: no document bytes or direct object references are
-- exposed, no consent is created, and no external delivery is activated.

ALTER TABLE public.institution_evidence_assessments
  ADD COLUMN evidence_share_receipt_id uuid;

CREATE TABLE public.institution_evidence_share_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  application_case_id uuid NOT NULL,
  journey_application_case_id uuid NOT NULL,
  journey_subject_id uuid NOT NULL,
  journey_evidence_receipt_id uuid NOT NULL,
  journey_consent_receipt_id uuid NOT NULL,
  consent_purpose text NOT NULL,
  requirement_code text NOT NULL,
  evidence_ref_hash text NOT NULL,
  content_sha256 text NOT NULL,
  evidence_receipt_hash text NOT NULL,
  consent_receipt_hash text NOT NULL,
  source_snapshot_hash text NOT NULL,
  receipt_hash text NOT NULL,
  valid_until timestamptz,
  executor_key text NOT NULL DEFAULT 'institution.evidence_share.v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_evidence_share_receipts_tenant_id_id_uq
    UNIQUE (tenant_id, id),
  CONSTRAINT institution_evidence_share_receipts_scope_id_uq
    UNIQUE (tenant_id, relationship_id, application_case_id, id),
  CONSTRAINT institution_evidence_share_receipts_source_uq
    UNIQUE (
      tenant_id, relationship_id, application_case_id,
      journey_evidence_receipt_id, journey_consent_receipt_id
    ),
  CONSTRAINT institution_evidence_share_receipts_hash_uq
    UNIQUE (tenant_id, relationship_id, receipt_hash),
  CONSTRAINT institution_evidence_share_receipts_relationship_fk
    FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES public.institution_relationships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_evidence_share_receipts_case_fk
    FOREIGN KEY (tenant_id, relationship_id, application_case_id)
    REFERENCES public.institution_application_cases(tenant_id, relationship_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_evidence_share_receipts_journey_case_fk
    FOREIGN KEY (tenant_id, journey_application_case_id, journey_subject_id)
    REFERENCES public.journey_application_cases(tenant_id, id, subject_id) ON DELETE RESTRICT,
  CONSTRAINT institution_evidence_share_receipts_evidence_fk
    FOREIGN KEY (tenant_id, journey_evidence_receipt_id)
    REFERENCES public.journey_verified_evidence_receipts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_evidence_share_receipts_consent_fk
    FOREIGN KEY (tenant_id, journey_consent_receipt_id)
    REFERENCES public.journey_consent_receipts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_evidence_share_receipts_id_v7_chk
    CHECK (substring(id::text from 15 for 1) = '7'),
  CONSTRAINT institution_evidence_share_receipts_purpose_chk
    CHECK (consent_purpose = 'institution.admissions.evidence_share'),
  CONSTRAINT institution_evidence_share_receipts_requirement_chk
    CHECK (requirement_code ~ '^[a-z][a-z0-9._:-]{1,95}$'),
  CONSTRAINT institution_evidence_share_receipts_hash_chk CHECK (
    evidence_ref_hash ~ '^[0-9a-f]{64}$'
    AND content_sha256 ~ '^[0-9a-f]{64}$'
    AND evidence_receipt_hash ~ '^[0-9a-f]{64}$'
    AND consent_receipt_hash ~ '^[0-9a-f]{64}$'
    AND source_snapshot_hash ~ '^[0-9a-f]{64}$'
    AND receipt_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT institution_evidence_share_receipts_executor_chk
    CHECK (executor_key = 'institution.evidence_share.v1'),
  CONSTRAINT institution_evidence_share_receipts_validity_chk
    CHECK (valid_until IS NULL OR valid_until > created_at)
);

ALTER TABLE public.institution_evidence_assessments
  ADD CONSTRAINT institution_evidence_assessments_share_fk
  FOREIGN KEY (
    tenant_id, relationship_id, application_case_id, evidence_share_receipt_id
  ) REFERENCES public.institution_evidence_share_receipts(
    tenant_id, relationship_id, application_case_id, id
  ) ON DELETE RESTRICT;

CREATE INDEX institution_evidence_share_receipts_case_idx
  ON public.institution_evidence_share_receipts
  (tenant_id, relationship_id, application_case_id, created_at);

ALTER TABLE public.institution_evidence_share_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_evidence_share_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.institution_evidence_share_receipts FROM PUBLIC;

CREATE POLICY institution_evidence_share_receipts_scoped_select
  ON public.institution_evidence_share_receipts FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.institution_application_cases c
      WHERE c.tenant_id = institution_evidence_share_receipts.tenant_id
        AND c.relationship_id = institution_evidence_share_receipts.relationship_id
        AND c.id = institution_evidence_share_receipts.application_case_id
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_institution_evidence_share_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'institution evidence share receipts are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER institution_evidence_share_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.institution_evidence_share_receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_institution_evidence_share_receipt_mutation();

CREATE SCHEMA fas_institution_evidence_v1;
REVOKE ALL ON SCHEMA fas_institution_evidence_v1 FROM PUBLIC;

CREATE FUNCTION fas_institution_evidence_v1.create_share_receipt(
  p_tenant_id uuid,
  p_relationship_id uuid,
  p_application_case_id uuid,
  p_journey_evidence_receipt_id uuid,
  p_journey_consent_receipt_id uuid,
  p_share_receipt_id uuid
) RETURNS TABLE (
  outcome text,
  share_receipt_id uuid,
  evidence_ref_hash text,
  content_sha256 text,
  requirement_code text,
  receipt_hash text,
  valid_until timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
SET row_security TO on
AS $$
DECLARE
  v_guard constant text := 'institution-evidence-share-v1:36a5d2c1';
  v_purpose constant text := 'institution.admissions.evidence_share';
  v_existing public.institution_evidence_share_receipts%ROWTYPE;
  v_relationship public.institution_relationships%ROWTYPE;
  v_case public.institution_application_cases%ROWTYPE;
  v_journey_case public.journey_application_cases%ROWTYPE;
  v_evidence public.journey_verified_evidence_receipts%ROWTYPE;
  v_consent public.journey_consent_receipts%ROWTYPE;
  v_latest_consent_id uuid;
  v_evidence_ref_hash text;
  v_source_snapshot_hash text;
  v_receipt_hash text;
BEGIN
  IF substring(p_share_receipt_id::text from 15 for 1) <> '7' THEN
    RAISE EXCEPTION 'institution evidence share requires uuidv7 receipt id'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    p_tenant_id::text, p_relationship_id::text, p_application_case_id::text,
    p_journey_evidence_receipt_id::text, p_journey_consent_receipt_id::text
  ), 2092026));
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('app.institution_relationship_id', p_relationship_id::text, true);
  PERFORM set_config('app.institution_evidence_share_guard', v_guard, true);

  SELECT * INTO STRICT v_relationship
  FROM public.institution_relationships r
  WHERE r.tenant_id = p_tenant_id AND r.id = p_relationship_id;
  IF v_relationship.status <> 'ACTIVE'
    OR v_relationship.purpose_code <> 'admissions.review'
    OR NOT ('application.evidence' = ANY(v_relationship.data_scopes))
    OR v_relationship.valid_from > now()
    OR (v_relationship.valid_until IS NOT NULL AND v_relationship.valid_until <= now()) THEN
    RAISE EXCEPTION 'institution evidence share relationship unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id AND t.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'institution evidence share tenant unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT v_case
  FROM public.institution_application_cases c
  WHERE c.tenant_id = p_tenant_id
    AND c.relationship_id = p_relationship_id
    AND c.id = p_application_case_id;

  SELECT * INTO STRICT v_journey_case
  FROM public.journey_application_cases j
  WHERE j.tenant_id = p_tenant_id
    AND j.legacy_application_id = v_case.legacy_application_id;

  SELECT * INTO STRICT v_evidence
  FROM public.journey_verified_evidence_receipts e
  WHERE e.tenant_id = p_tenant_id
    AND e.id = p_journey_evidence_receipt_id
    AND e.application_case_id = v_journey_case.id
    AND e.subject_id = v_journey_case.subject_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.journey_requirement_results rr
    WHERE rr.tenant_id = p_tenant_id
      AND rr.dossier_revision_id = v_evidence.dossier_revision_id
      AND rr.requirement_code = v_evidence.requirement_code
      AND rr.result_state = 'VERIFIED'
      AND rr.evidence_receipt_id = v_evidence.id
  ) THEN
    RAISE EXCEPTION 'institution evidence share source is not currently verified'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO STRICT v_consent
  FROM public.journey_consent_receipts c
  WHERE c.tenant_id = p_tenant_id
    AND c.id = p_journey_consent_receipt_id
    AND c.subject_id = v_journey_case.subject_id
    AND c.purpose = v_purpose
    AND c.channel = 'in_app';
  SELECT c.id INTO STRICT v_latest_consent_id
  FROM public.journey_consent_receipts c
  WHERE c.tenant_id = p_tenant_id
    AND c.subject_id = v_journey_case.subject_id
    AND c.purpose = v_purpose
    AND c.channel = 'in_app'
  ORDER BY c.sequence DESC
  LIMIT 1;
  IF v_latest_consent_id <> v_consent.id
    OR v_consent.action <> 'CAPTURED'
    OR v_consent.effective_at > now()
    OR (v_consent.valid_until IS NOT NULL AND v_consent.valid_until <= now()) THEN
    RAISE EXCEPTION 'institution evidence share consent is not current and active'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotent replay is still a current-authority operation. Never disclose
  -- or reactivate a historical manifest after relationship, evidence or
  -- consent state has changed.
  SELECT * INTO v_existing
  FROM public.institution_evidence_share_receipts r
  WHERE r.tenant_id = p_tenant_id
    AND r.relationship_id = p_relationship_id
    AND r.application_case_id = p_application_case_id
    AND r.journey_evidence_receipt_id = p_journey_evidence_receipt_id
    AND r.journey_consent_receipt_id = p_journey_consent_receipt_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      'REPLAY'::text, v_existing.id, v_existing.evidence_ref_hash,
      v_existing.content_sha256, v_existing.requirement_code,
      v_existing.receipt_hash, v_existing.valid_until;
    RETURN;
  END IF;

  v_evidence_ref_hash := encode(sha256(convert_to(v_evidence.evidence_ref, 'UTF8')), 'hex');
  v_source_snapshot_hash := encode(sha256(convert_to(concat_ws(E'\x1f',
    'institution-evidence-share-source-v1', p_tenant_id::text,
    p_relationship_id::text, p_application_case_id::text,
    v_journey_case.id::text, v_journey_case.subject_id::text,
    v_evidence.id::text, v_evidence.requirement_code,
    v_evidence_ref_hash, v_evidence.content_sha256, v_evidence.receipt_hash,
    v_consent.id::text, v_consent.receipt_hash,
    coalesce(to_char(v_consent.valid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
  ), 'UTF8')), 'hex');
  v_receipt_hash := encode(sha256(convert_to(concat_ws(E'\x1f',
    'institution-evidence-share-receipt-v1', p_share_receipt_id::text,
    v_source_snapshot_hash, v_evidence_ref_hash, v_evidence.content_sha256
  ), 'UTF8')), 'hex');

  INSERT INTO public.institution_evidence_share_receipts (
    id, tenant_id, relationship_id, application_case_id,
    journey_application_case_id, journey_subject_id,
    journey_evidence_receipt_id, journey_consent_receipt_id,
    consent_purpose, requirement_code, evidence_ref_hash, content_sha256,
    evidence_receipt_hash, consent_receipt_hash, source_snapshot_hash,
    receipt_hash, valid_until
  ) VALUES (
    p_share_receipt_id, p_tenant_id, p_relationship_id, p_application_case_id,
    v_journey_case.id, v_journey_case.subject_id,
    v_evidence.id, v_consent.id, v_purpose, v_evidence.requirement_code,
    v_evidence_ref_hash, v_evidence.content_sha256,
    v_evidence.receipt_hash, v_consent.receipt_hash, v_source_snapshot_hash,
    v_receipt_hash, v_consent.valid_until
  );

  RETURN QUERY SELECT
    'CREATED'::text, p_share_receipt_id, v_evidence_ref_hash,
    v_evidence.content_sha256, v_evidence.requirement_code,
    v_receipt_hash, v_consent.valid_until;
END;
$$;

CREATE FUNCTION fas_institution_evidence_v1.resolve_assessable_share(
  p_tenant_id uuid,
  p_relationship_id uuid,
  p_application_case_id uuid,
  p_share_receipt_id uuid,
  p_assessed_at timestamptz
) RETURNS TABLE (
  evidence_ref_hash text,
  content_sha256 text,
  requirement_code text,
  share_receipt_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
SET row_security TO on
AS $$
DECLARE
  v_share public.institution_evidence_share_receipts%ROWTYPE;
  v_latest_consent public.journey_consent_receipts%ROWTYPE;
  v_caller_tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_caller_relationship uuid := NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid;
  v_caller_membership uuid := NULLIF(current_setting('app.institution_membership_id', true), '')::uuid;
  v_caller_principal uuid := NULLIF(current_setting('app.institution_principal_id', true), '')::uuid;
  v_caller_user integer := NULLIF(current_setting('app.legacy_user_id', true), '')::integer;
  v_caller_role text := NULLIF(current_setting('app.institution_role', true), '');
BEGIN
  IF v_caller_tenant IS DISTINCT FROM p_tenant_id
    OR v_caller_relationship IS DISTINCT FROM p_relationship_id
    OR v_caller_membership IS NULL
    OR v_caller_principal IS NULL
    OR v_caller_user IS NULL
    OR v_caller_role <> 'ADMISSIONS_REVIEWER' THEN
    RAISE EXCEPTION 'institution evidence share actor context mismatch'
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
      AND m.role_key = 'ADMISSIONS_REVIEWER'
      AND m.status = 'ACTIVE'
      AND m.valid_from <= p_assessed_at
      AND (m.valid_until IS NULL OR m.valid_until > p_assessed_at)
  ) THEN
    RAISE EXCEPTION 'institution evidence share actor unavailable'
      USING ERRCODE = '42501';
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
    OR v_latest_consent.effective_at > p_assessed_at
    OR (v_latest_consent.valid_until IS NOT NULL AND v_latest_consent.valid_until <= p_assessed_at)
    OR (v_share.valid_until IS NOT NULL AND v_share.valid_until <= p_assessed_at) THEN
    RAISE EXCEPTION 'institution evidence share consent is not current and active'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    v_share.evidence_ref_hash, v_share.content_sha256,
    v_share.requirement_code, v_share.receipt_hash;
END;
$$;

REVOKE ALL ON FUNCTION fas_institution_evidence_v1.create_share_receipt(
  uuid, uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION fas_institution_evidence_v1.resolve_assessable_share(
  uuid, uuid, uuid, uuid, timestamptz
) FROM PUBLIC;

CREATE POLICY institution_evidence_share_receipts_executor_insert
  ON public.institution_evidence_share_receipts FOR INSERT WITH CHECK (
    current_user = pg_get_userbyid((
      SELECT p.proowner FROM pg_catalog.pg_proc p
      WHERE p.oid = 'fas_institution_evidence_v1.create_share_receipt(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure
    ))
    AND NULLIF(current_setting('app.institution_evidence_share_guard', true), '')
      = 'institution-evidence-share-v1:36a5d2c1'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  );

CREATE POLICY institution_application_cases_evidence_share_select
  ON public.institution_application_cases FOR SELECT USING (
    current_user = pg_get_userbyid((
      SELECT p.proowner FROM pg_catalog.pg_proc p
      WHERE p.oid = 'fas_institution_evidence_v1.create_share_receipt(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure
    ))
    AND NULLIF(current_setting('app.institution_evidence_share_guard', true), '')
      = 'institution-evidence-share-v1:36a5d2c1'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  );

CREATE OR REPLACE FUNCTION public.enforce_institution_evidence_share_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_source_portal_submission_id integer;
  v_share record;
  v_requirement_code text;
BEGIN
  NEW.assessed_at := clock_timestamp();
  SELECT c.source_portal_submission_id INTO STRICT v_source_portal_submission_id
  FROM public.institution_application_cases c
  WHERE c.tenant_id = NEW.tenant_id
    AND c.relationship_id = NEW.relationship_id
    AND c.id = NEW.application_case_id;

  IF NEW.evidence_share_receipt_id IS NULL THEN
    -- Historical/manual cases remain additive-compatible, but every case
    -- produced by the receipt-bound intake corridor is fail-closed.
    IF v_source_portal_submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'institution intake case assessment requires evidence share receipt'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT v_share
  FROM fas_institution_evidence_v1.resolve_assessable_share(
    NEW.tenant_id, NEW.relationship_id, NEW.application_case_id,
    NEW.evidence_share_receipt_id, NEW.assessed_at
  );
  IF NEW.evidence_ref_hash <> v_share.evidence_ref_hash THEN
    RAISE EXCEPTION 'institution assessment evidence hash mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.requirement_id IS NOT NULL THEN
    SELECT r.requirement_code INTO STRICT v_requirement_code
    FROM public.institution_requirements r
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.requirement_id;
    IF v_requirement_code <> upper(translate(v_share.requirement_code, '.:-', '___')) THEN
      RAISE EXCEPTION 'institution assessment requirement evidence mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER institution_evidence_share_binding_guard
  BEFORE INSERT ON public.institution_evidence_assessments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_institution_evidence_share_binding();
