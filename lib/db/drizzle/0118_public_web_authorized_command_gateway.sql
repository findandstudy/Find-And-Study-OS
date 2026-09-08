-- Atomic gateway for persisting the evaluated access decision and applying a
-- public-web publication command. It remains default-unwired and grants no
-- executor role; a reviewed bootstrap may grant only this function.

CREATE FUNCTION fas_public_web_v1.apply_authorized_publication_command(
  p_access jsonb,
  p_command jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant uuid;
  v_access_id uuid;
  v_context_id uuid;
  v_actor_principal_id uuid;
  v_membership_id uuid;
  v_policy_version_id uuid;
  v_assignment_ids uuid[];
  v_role_package_version_ids uuid[];
  v_capability_key text;
  v_resource_type text;
  v_resource_id text;
  v_correlation_id text;
  v_occurred_at timestamptz;
  v_existing public.access_decision_receipts%ROWTYPE;
  v_inserted integer;
BEGIN
  IF jsonb_typeof(p_access) <> 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_access) key)
      IS DISTINCT FROM ARRAY[
        'actorPrincipalId', 'assignmentIds', 'capabilityKey', 'contextId',
        'correlationId', 'decision', 'id', 'membershipId', 'occurredAt',
        'policyVersionId', 'reasonCode', 'resourceId', 'resourceType',
        'rolePackageVersionIds', 'tenantId'
      ]::text[] THEN
    RAISE EXCEPTION 'invalid public web access receipt shape' USING ERRCODE = '22023';
  END IF;

  v_tenant := (p_access->>'tenantId')::uuid;
  v_access_id := (p_access->>'id')::uuid;
  v_context_id := (p_access->>'contextId')::uuid;
  v_actor_principal_id := (p_access->>'actorPrincipalId')::uuid;
  v_membership_id := (p_access->>'membershipId')::uuid;
  v_policy_version_id := (p_access->>'policyVersionId')::uuid;
  v_assignment_ids := ARRAY(
    SELECT value::uuid FROM jsonb_array_elements_text(p_access->'assignmentIds') value
  );
  v_role_package_version_ids := ARRAY(
    SELECT value::uuid FROM jsonb_array_elements_text(p_access->'rolePackageVersionIds') value
  );
  v_capability_key := p_access->>'capabilityKey';
  v_resource_type := p_access->>'resourceType';
  v_resource_id := p_access->>'resourceId';
  v_correlation_id := p_access->>'correlationId';
  v_occurred_at := to_timestamp((p_access->>'occurredAt')::double precision / 1000.0);

  PERFORM fas_public_web_v1.assert_scope(
    v_tenant,
    (p_command->>'organizationId')::uuid
  );

  IF jsonb_typeof(p_access->'assignmentIds') <> 'array'
    OR jsonb_typeof(p_access->'rolePackageVersionIds') <> 'array'
    OR cardinality(v_assignment_ids) NOT BETWEEN 1 AND 64
    OR cardinality(v_role_package_version_ids) NOT BETWEEN 1 AND 64
    OR cardinality(v_assignment_ids) <>
      (SELECT count(DISTINCT value) FROM unnest(v_assignment_ids) value)
    OR cardinality(v_role_package_version_ids) <>
      (SELECT count(DISTINCT value) FROM unnest(v_role_package_version_ids) value)
    OR substring(v_access_id::text from 15 for 1) <> '7'
    OR p_access->>'decision' <> 'ALLOW'
    OR p_access->>'reasonCode' <> 'allowed'
    OR v_tenant IS DISTINCT FROM (p_command->>'tenantId')::uuid
    OR v_capability_key IS DISTINCT FROM (CASE p_command->>'command'
      WHEN 'SUBMIT_REVIEW' THEN 'public_web.content.write'
      WHEN 'RETURN_DRAFT' THEN 'public_web.content.review'
      WHEN 'APPROVE' THEN 'public_web.content.review'
      WHEN 'PUBLISH' THEN 'public_web.content.publish'
      WHEN 'ENABLE_INDEX' THEN 'public_web.content.index'
      WHEN 'DISABLE_INDEX' THEN 'public_web.content.index'
      WHEN 'MARK_STALE' THEN 'public_web.content.write'
      WHEN 'RETIRE' THEN 'public_web.content.publish'
      ELSE NULL
    END)
    OR v_resource_type <> 'PUBLIC_WEB_CONTENT'
    OR v_resource_id IS DISTINCT FROM p_command->>'contentRecordId'
    OR v_correlation_id IS DISTINCT FROM p_command->>'requestKey'
    OR v_occurred_at > clock_timestamp()
    OR v_occurred_at <= clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid public web access receipt values' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.access_decision_receipts (
    id, tenant_id, context_id, actor_principal_id, membership_id,
    assignment_ids, role_package_version_ids, capability_key, resource_type,
    resource_id, decision, reason_code, policy_version_id, correlation_id,
    occurred_at
  ) VALUES (
    v_access_id, v_tenant, v_context_id, v_actor_principal_id, v_membership_id,
    v_assignment_ids, v_role_package_version_ids, v_capability_key,
    v_resource_type, v_resource_id, 'ALLOW', 'allowed', v_policy_version_id,
    v_correlation_id, v_occurred_at
  ) ON CONFLICT (tenant_id, id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT receipt.* INTO v_existing
    FROM public.access_decision_receipts receipt
    WHERE receipt.tenant_id = v_tenant
      AND receipt.id = v_access_id;

    IF NOT FOUND
      OR v_existing.context_id <> v_context_id
      OR v_existing.actor_principal_id <> v_actor_principal_id
      OR v_existing.membership_id <> v_membership_id
      OR v_existing.assignment_ids <> v_assignment_ids
      OR v_existing.role_package_version_ids <> v_role_package_version_ids
      OR v_existing.capability_key <> v_capability_key
      OR v_existing.resource_type <> v_resource_type
      OR v_existing.resource_id <> v_resource_id
      OR v_existing.decision <> 'ALLOW'
      OR v_existing.reason_code <> 'allowed'
      OR v_existing.policy_version_id <> v_policy_version_id
      OR v_existing.correlation_id <> v_correlation_id
      OR v_existing.occurred_at <> v_occurred_at THEN
      RAISE EXCEPTION 'public web access receipt idempotency conflict' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN fas_public_web_v1.apply_publication_command_v2(p_command);
END;
$$;

REVOKE ALL ON FUNCTION fas_public_web_v1.apply_authorized_publication_command(jsonb, jsonb) FROM PUBLIC;

COMMENT ON FUNCTION fas_public_web_v1.apply_authorized_publication_command(jsonb, jsonb) IS
  'Default-unwired atomic access-decision and public-web command gateway. Grant only to the dedicated non-login executor role.';
