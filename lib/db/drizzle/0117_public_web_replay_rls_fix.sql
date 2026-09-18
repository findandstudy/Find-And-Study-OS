-- The publication receipt ledger is append-only and deliberately has no
-- UPDATE policy. SELECT ... FOR UPDATE therefore hides rows under FORCE RLS.
-- The per-content transaction advisory lock already serializes replay and
-- mutation, so replay detection must use a plain SELECT.

CREATE OR REPLACE FUNCTION fas_public_web_v1.apply_publication_command_v2(
  p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant uuid;
  v_organization uuid;
  v_content_record uuid;
  v_revision uuid;
  v_authorization_receipt uuid;
  v_actor_legacy_user integer;
  v_command_type text;
  v_request_key text;
  v_request_hash text;
  v_evidence_sha256 text;
  v_required_capability text;
  v_existing_receipt public.public_web_publication_receipts%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_input) <> 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_input) key)
      IS DISTINCT FROM ARRAY[
        'accessDecisionReceiptId', 'actorLegacyUserId', 'command',
        'contentRecordId', 'evidenceSha256', 'expectedVersion',
        'organizationId', 'publicationReceiptId', 'requestHash', 'requestKey',
        'revisionId', 'staleReasonCode', 'tenantId'
      ]::text[] THEN
    RAISE EXCEPTION 'invalid public web command shape' USING ERRCODE = '22023';
  END IF;

  v_tenant := (p_input->>'tenantId')::uuid;
  v_organization := (p_input->>'organizationId')::uuid;
  v_content_record := (p_input->>'contentRecordId')::uuid;
  v_revision := (p_input->>'revisionId')::uuid;
  v_authorization_receipt := (p_input->>'accessDecisionReceiptId')::uuid;
  v_actor_legacy_user := (p_input->>'actorLegacyUserId')::integer;
  v_command_type := p_input->>'command';
  v_request_key := p_input->>'requestKey';
  v_request_hash := p_input->>'requestHash';
  v_evidence_sha256 := p_input->>'evidenceSha256';

  PERFORM fas_public_web_v1.assert_scope(v_tenant, v_organization);

  IF v_command_type NOT IN (
      'SUBMIT_REVIEW', 'RETURN_DRAFT', 'APPROVE', 'PUBLISH',
      'ENABLE_INDEX', 'DISABLE_INDEX', 'MARK_STALE', 'RETIRE'
    )
    OR v_actor_legacy_user < 1
    OR v_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
    OR v_request_hash !~ '^[0-9a-f]{64}$'
    OR v_evidence_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid public web command values' USING ERRCODE = '22023';
  END IF;

  v_required_capability := CASE v_command_type
    WHEN 'SUBMIT_REVIEW' THEN 'public_web.content.write'
    WHEN 'RETURN_DRAFT' THEN 'public_web.content.review'
    WHEN 'APPROVE' THEN 'public_web.content.review'
    WHEN 'PUBLISH' THEN 'public_web.content.publish'
    WHEN 'ENABLE_INDEX' THEN 'public_web.content.index'
    WHEN 'DISABLE_INDEX' THEN 'public_web.content.index'
    WHEN 'MARK_STALE' THEN 'public_web.content.write'
    WHEN 'RETIRE' THEN 'public_web.content.publish'
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_tenant::text || ':' || v_content_record::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.access_decision_receipts access_receipt
    JOIN public.principals principal
      ON principal.id = access_receipt.actor_principal_id
    JOIN public.memberships membership
      ON membership.tenant_id = access_receipt.tenant_id
      AND membership.id = access_receipt.membership_id
      AND membership.principal_id = access_receipt.actor_principal_id
    JOIN public.policy_versions policy
      ON policy.tenant_id = access_receipt.tenant_id
      AND policy.id = access_receipt.policy_version_id
    WHERE access_receipt.tenant_id = v_tenant
      AND access_receipt.id = v_authorization_receipt
      AND access_receipt.decision = 'ALLOW'
      AND access_receipt.reason_code = 'allowed'
      AND access_receipt.capability_key = v_required_capability
      AND access_receipt.resource_type = 'PUBLIC_WEB_CONTENT'
      AND access_receipt.resource_id = v_content_record::text
      AND access_receipt.correlation_id = v_request_key
      AND access_receipt.occurred_at <= now()
      AND access_receipt.occurred_at > now() - interval '5 minutes'
      AND principal.legacy_user_id = v_actor_legacy_user
      AND principal.principal_type = 'HUMAN'
      AND principal.status = 'ACTIVE'
      AND principal.risk_state = 'NORMAL'
      AND membership.status = 'ACTIVE'
      AND membership.valid_from <= now()
      AND (membership.valid_until IS NULL OR membership.valid_until > now())
      AND (membership.organization_id IS NULL OR membership.organization_id = v_organization)
      AND policy.state = 'ACTIVE'
      AND policy.effective_at <= now()
      AND policy.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'public web command authorization unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT receipt.* INTO v_existing_receipt
  FROM public.public_web_publication_receipts AS receipt
  WHERE receipt.tenant_id = v_tenant
    AND receipt.request_key = v_request_key;

  IF FOUND THEN
    IF v_existing_receipt.organization_id <> v_organization
      OR v_existing_receipt.content_record_id <> v_content_record
      OR v_existing_receipt.revision_id <> v_revision
      OR v_existing_receipt.actor_legacy_user_id <> v_actor_legacy_user
      OR v_existing_receipt.request_hash <> v_request_hash
      OR v_existing_receipt.evidence_sha256 <> v_evidence_sha256 THEN
      RAISE EXCEPTION 'public web command idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'REPLAY',
      'publicationReceiptId', v_existing_receipt.id,
      'status', v_existing_receipt.to_status,
      'indexState', v_existing_receipt.index_state
    );
  END IF;

  RETURN fas_public_web_v1.apply_publication_command(p_input);
END;
$$;

REVOKE ALL ON FUNCTION fas_public_web_v1.apply_publication_command_v2(jsonb) FROM PUBLIC;
