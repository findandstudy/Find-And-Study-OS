-- Additive fix for the 0114 command function. Explicit variable binding keeps
-- request_key and other PL/pgSQL variables unambiguous beside table columns.

CREATE OR REPLACE FUNCTION fas_public_web_v1.apply_publication_command(
  p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_variable
DECLARE
  tenant uuid;
  organization uuid;
  content_record uuid;
  revision uuid;
  authorization_receipt uuid;
  publication_receipt uuid;
  actor_legacy_user integer;
  expected_version bigint;
  command_type text;
  request_key text;
  request_hash text;
  evidence_sha256 text;
  stale_reason text;
  required_capability text;
  existing_receipt public.public_web_publication_receipts%ROWTYPE;
  state_row public.public_web_publication_states%ROWTYPE;
  updated_state public.public_web_publication_states%ROWTYPE;
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

  tenant := (p_input->>'tenantId')::uuid;
  organization := (p_input->>'organizationId')::uuid;
  content_record := (p_input->>'contentRecordId')::uuid;
  revision := (p_input->>'revisionId')::uuid;
  authorization_receipt := (p_input->>'accessDecisionReceiptId')::uuid;
  publication_receipt := (p_input->>'publicationReceiptId')::uuid;
  actor_legacy_user := (p_input->>'actorLegacyUserId')::integer;
  expected_version := (p_input->>'expectedVersion')::bigint;
  command_type := p_input->>'command';
  request_key := p_input->>'requestKey';
  request_hash := p_input->>'requestHash';
  evidence_sha256 := p_input->>'evidenceSha256';
  stale_reason := nullif(p_input->>'staleReasonCode', '');

  PERFORM fas_public_web_v1.assert_scope(tenant, organization);

  IF command_type NOT IN (
      'SUBMIT_REVIEW', 'RETURN_DRAFT', 'APPROVE', 'PUBLISH',
      'ENABLE_INDEX', 'DISABLE_INDEX', 'MARK_STALE', 'RETIRE'
    )
    OR expected_version < 1
    OR actor_legacy_user < 1
    OR request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
    OR request_hash !~ '^[0-9a-f]{64}$'
    OR evidence_sha256 !~ '^[0-9a-f]{64}$'
    OR substring(publication_receipt::text from 15 for 1) <> '7'
    OR ((command_type = 'MARK_STALE') IS DISTINCT FROM (stale_reason IS NOT NULL))
    OR (stale_reason IS NOT NULL AND stale_reason !~ '^[A-Z][A-Z0-9_]{2,63}$') THEN
    RAISE EXCEPTION 'invalid public web command values' USING ERRCODE = '22023';
  END IF;

  required_capability := CASE command_type
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
    hashtextextended(tenant::text || ':' || content_record::text, 0)
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
    WHERE access_receipt.tenant_id = tenant
      AND access_receipt.id = authorization_receipt
      AND access_receipt.decision = 'ALLOW'
      AND access_receipt.reason_code = 'allowed'
      AND access_receipt.capability_key = required_capability
      AND access_receipt.resource_type = 'PUBLIC_WEB_CONTENT'
      AND access_receipt.resource_id = content_record::text
      AND access_receipt.correlation_id = request_key
      AND access_receipt.occurred_at <= now()
      AND access_receipt.occurred_at > now() - interval '5 minutes'
      AND principal.legacy_user_id = actor_legacy_user
      AND principal.principal_type = 'HUMAN'
      AND principal.status = 'ACTIVE'
      AND principal.risk_state = 'NORMAL'
      AND membership.status = 'ACTIVE'
      AND membership.valid_from <= now()
      AND (membership.valid_until IS NULL OR membership.valid_until > now())
      AND (membership.organization_id IS NULL OR membership.organization_id = organization)
      AND policy.state = 'ACTIVE'
      AND policy.effective_at <= now()
      AND policy.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'public web command authorization unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing_receipt
  FROM public.public_web_publication_receipts receipt
  WHERE receipt.tenant_id = tenant
    AND receipt.request_key = request_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_receipt.organization_id <> organization
      OR existing_receipt.content_record_id <> content_record
      OR existing_receipt.revision_id <> revision
      OR existing_receipt.actor_legacy_user_id <> actor_legacy_user
      OR existing_receipt.request_hash <> request_hash
      OR existing_receipt.evidence_sha256 <> evidence_sha256 THEN
      RAISE EXCEPTION 'public web command idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'REPLAY',
      'publicationReceiptId', existing_receipt.id,
      'status', existing_receipt.to_status,
      'indexState', existing_receipt.index_state
    );
  END IF;

  SELECT * INTO state_row
  FROM public.public_web_publication_states state
  WHERE state.tenant_id = tenant
    AND state.organization_id = organization
    AND state.content_record_id = content_record
  FOR UPDATE;

  IF NOT FOUND
    OR state_row.revision_id <> revision
    OR state_row.version <> expected_version THEN
    RAISE EXCEPTION 'public web publication state conflict' USING ERRCODE = '40001';
  END IF;

  IF (command_type = 'SUBMIT_REVIEW' AND state_row.status <> 'DRAFT')
    OR (command_type = 'RETURN_DRAFT' AND state_row.status NOT IN ('PENDING_REVIEW', 'APPROVED', 'STALE'))
    OR (command_type = 'APPROVE' AND state_row.status <> 'PENDING_REVIEW')
    OR (command_type = 'PUBLISH' AND state_row.status <> 'APPROVED')
    OR (command_type IN ('ENABLE_INDEX', 'DISABLE_INDEX') AND state_row.status <> 'PUBLISHED')
    OR (command_type = 'MARK_STALE' AND state_row.status <> 'PUBLISHED')
    OR (command_type = 'RETIRE' AND state_row.status NOT IN ('DRAFT', 'APPROVED', 'PUBLISHED', 'STALE')) THEN
    RAISE EXCEPTION 'public web command transition conflict' USING ERRCODE = '23514';
  END IF;

  UPDATE public.public_web_publication_states state
  SET status = CASE command_type
        WHEN 'SUBMIT_REVIEW' THEN 'PENDING_REVIEW'
        WHEN 'RETURN_DRAFT' THEN 'DRAFT'
        WHEN 'APPROVE' THEN 'APPROVED'
        WHEN 'PUBLISH' THEN 'PUBLISHED'
        WHEN 'MARK_STALE' THEN 'STALE'
        WHEN 'RETIRE' THEN 'RETIRED'
        ELSE state.status
      END,
      index_state = CASE command_type
        WHEN 'ENABLE_INDEX' THEN 'INDEX'
        WHEN 'DISABLE_INDEX' THEN 'NOINDEX'
        WHEN 'PUBLISH' THEN 'NOINDEX'
        ELSE state.index_state
      END,
      reviewed_by_legacy_user_id = CASE
        WHEN command_type = 'APPROVE' THEN actor_legacy_user
        ELSE state.reviewed_by_legacy_user_id
      END,
      reviewed_at = CASE
        WHEN command_type = 'APPROVE' THEN now()
        ELSE state.reviewed_at
      END,
      published_by_legacy_user_id = CASE
        WHEN command_type = 'PUBLISH' THEN actor_legacy_user
        ELSE state.published_by_legacy_user_id
      END,
      published_at = CASE
        WHEN command_type = 'PUBLISH' THEN now()
        ELSE state.published_at
      END,
      stale_reason_code = CASE
        WHEN command_type = 'MARK_STALE' THEN stale_reason
        ELSE state.stale_reason_code
      END
  WHERE state.tenant_id = tenant
    AND state.organization_id = organization
    AND state.content_record_id = content_record
  RETURNING * INTO updated_state;

  INSERT INTO public.public_web_publication_receipts (
    id, tenant_id, organization_id, content_record_id, revision_id,
    from_status, to_status, index_state, actor_legacy_user_id,
    request_key, evidence_sha256, authorization_decision_receipt_id,
    request_hash
  ) VALUES (
    publication_receipt, tenant, organization, content_record, revision,
    state_row.status, updated_state.status, updated_state.index_state,
    actor_legacy_user, request_key, evidence_sha256,
    authorization_receipt, request_hash
  );

  RETURN jsonb_build_object(
    'outcome', 'APPLIED',
    'publicationReceiptId', publication_receipt,
    'status', updated_state.status,
    'indexState', updated_state.index_state,
    'version', updated_state.version
  );
END;
$$;

REVOKE ALL ON FUNCTION fas_public_web_v1.apply_publication_command(jsonb) FROM PUBLIC;

-- Deliberately absent: grants, backfills, routes and runtime activation.
