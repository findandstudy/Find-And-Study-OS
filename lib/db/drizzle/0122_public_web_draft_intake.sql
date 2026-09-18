-- Governed draft intake for public-web content. This migration remains
-- default-unwired: it grants no login role, role package, HTTP route, worker,
-- publication transition or index activation.

CREATE TABLE public.public_web_draft_intake_receipts (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  content_record_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  route_alias_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  locale text NOT NULL,
  actor_legacy_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  authorization_decision_receipt_id uuid NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_web_draft_intake_receipts_pk PRIMARY KEY (tenant_id, id),
  CONSTRAINT public_web_draft_intake_receipts_request_uq UNIQUE (tenant_id, request_key),
  CONSTRAINT public_web_draft_intake_receipts_revision_fk
    FOREIGN KEY (tenant_id, organization_id, content_record_id, revision_id)
    REFERENCES public.public_web_content_revisions(
      tenant_id, organization_id, content_record_id, id
    ) ON DELETE RESTRICT,
  CONSTRAINT public_web_draft_intake_receipts_route_fk
    FOREIGN KEY (tenant_id, route_alias_id)
    REFERENCES public.public_web_route_aliases(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT public_web_draft_intake_receipts_authorization_fk
    FOREIGN KEY (tenant_id, authorization_decision_receipt_id)
    REFERENCES public.access_decision_receipts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT public_web_draft_intake_receipts_organization_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT public_web_draft_intake_receipts_id_v7_chk
    CHECK (substring(id::text from 15 for 1) = '7'),
  CONSTRAINT public_web_draft_intake_receipts_entity_type_chk
    CHECK (entity_type IN ('PROGRAM','UNIVERSITY','DESTINATION','CITY','PAGE','ARTICLE')),
  CONSTRAINT public_web_draft_intake_receipts_entity_id_chk CHECK (entity_id > 0),
  CONSTRAINT public_web_draft_intake_receipts_locale_chk
    CHECK (locale IN ('en','tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it')),
  CONSTRAINT public_web_draft_intake_receipts_request_key_chk
    CHECK (request_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'),
  CONSTRAINT public_web_draft_intake_receipts_request_hash_chk
    CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX public_web_draft_intake_receipts_record_idx
  ON public.public_web_draft_intake_receipts (
    tenant_id, organization_id, content_record_id, occurred_at
  );

ALTER TABLE public.public_web_draft_intake_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_web_draft_intake_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY public_web_draft_intake_receipts_scope_select
  ON public.public_web_draft_intake_receipts FOR SELECT
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
  );

CREATE POLICY public_web_draft_intake_receipts_scope_insert
  ON public.public_web_draft_intake_receipts FOR INSERT
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
  );

CREATE FUNCTION public.reject_public_web_draft_intake_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'public web draft intake receipts are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER public_web_draft_intake_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.public_web_draft_intake_receipts
  FOR EACH ROW EXECUTE FUNCTION public.reject_public_web_draft_intake_receipt_mutation();

CREATE FUNCTION fas_public_web_v1.apply_authorized_draft_intake(
  p_access jsonb,
  p_command jsonb
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
  v_route_alias uuid;
  v_intake_receipt uuid;
  v_access_id uuid;
  v_context_id uuid;
  v_actor_principal_id uuid;
  v_membership_id uuid;
  v_policy_version_id uuid;
  v_assignment_ids uuid[];
  v_role_package_version_ids uuid[];
  v_actor_legacy_user integer;
  v_entity_type text;
  v_entity_id integer;
  v_locale text;
  v_slug text;
  v_path text;
  v_expected_path text;
  v_origin text;
  v_title text;
  v_summary text;
  v_source_sha256 text;
  v_content_sha256 text;
  v_generator_receipt_sha256 text;
  v_request_key text;
  v_request_hash text;
  v_occurred_at timestamptz;
  v_inserted integer;
  v_existing_access public.access_decision_receipts%ROWTYPE;
  v_existing_intake public.public_web_draft_intake_receipts%ROWTYPE;
  v_current_assignment_count integer;
  v_current_package_ids uuid[];
BEGIN
  IF jsonb_typeof(p_access) <> 'object' THEN
    RAISE EXCEPTION 'invalid public web draft access shape' USING ERRCODE = '22023';
  END IF;
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_access) key)
    IS DISTINCT FROM ARRAY[
      'actorPrincipalId', 'assignmentIds', 'capabilityKey', 'contextId',
      'correlationId', 'decision', 'id', 'membershipId', 'occurredAt',
      'policyVersionId', 'reasonCode', 'resourceId', 'resourceType',
      'rolePackageVersionIds', 'tenantId'
    ]::text[] THEN
    RAISE EXCEPTION 'invalid public web draft access shape' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_command) <> 'object' THEN
    RAISE EXCEPTION 'invalid public web draft intake shape' USING ERRCODE = '22023';
  END IF;
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_command) key)
    IS DISTINCT FROM ARRAY[
      'accessDecisionReceiptId', 'actorLegacyUserId', 'canonicalPath',
      'canonicalSlug', 'contentJson', 'contentRecordId', 'contentSha256',
      'entityId', 'entityType', 'generatorReceiptSha256', 'intakeReceiptId',
      'locale', 'organizationId', 'origin', 'requestHash', 'requestKey',
      'revisionId', 'routeAliasId', 'seoJson', 'sourceSha256',
      'structuredDataJson', 'summary', 'tenantId', 'title'
    ]::text[] THEN
    RAISE EXCEPTION 'invalid public web draft intake shape' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_access->'assignmentIds') <> 'array'
    OR jsonb_typeof(p_access->'rolePackageVersionIds') <> 'array'
    OR jsonb_typeof(p_command->'contentJson') <> 'object'
    OR jsonb_typeof(p_command->'seoJson') <> 'object'
    OR jsonb_typeof(p_command->'structuredDataJson') <> 'object'
    OR jsonb_typeof(p_command->'title') <> 'string'
    OR jsonb_typeof(p_command->'summary') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'invalid public web draft intake document types' USING ERRCODE = '22023';
  END IF;

  v_tenant := (p_command->>'tenantId')::uuid;
  v_organization := (p_command->>'organizationId')::uuid;
  v_content_record := (p_command->>'contentRecordId')::uuid;
  v_revision := (p_command->>'revisionId')::uuid;
  v_route_alias := (p_command->>'routeAliasId')::uuid;
  v_intake_receipt := (p_command->>'intakeReceiptId')::uuid;
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
  v_actor_legacy_user := (p_command->>'actorLegacyUserId')::integer;
  v_entity_type := p_command->>'entityType';
  v_entity_id := (p_command->>'entityId')::integer;
  v_locale := p_command->>'locale';
  v_slug := p_command->>'canonicalSlug';
  v_path := p_command->>'canonicalPath';
  v_origin := p_command->>'origin';
  v_title := p_command->>'title';
  v_summary := CASE WHEN jsonb_typeof(p_command->'summary') = 'null'
    THEN NULL ELSE p_command->>'summary' END;
  v_source_sha256 := p_command->>'sourceSha256';
  v_content_sha256 := p_command->>'contentSha256';
  v_generator_receipt_sha256 := nullif(p_command->>'generatorReceiptSha256', '');
  v_request_key := p_command->>'requestKey';
  v_request_hash := p_command->>'requestHash';
  v_occurred_at := to_timestamp((p_access->>'occurredAt')::double precision / 1000.0);

  PERFORM fas_public_web_v1.assert_scope(v_tenant, v_organization);

  v_expected_path := CASE v_entity_type
    WHEN 'PROGRAM' THEN '/' || v_locale || '/programs/' || v_slug || '-' || v_entity_id::text
    WHEN 'UNIVERSITY' THEN '/' || v_locale || '/universities/' || v_slug || '-' || v_entity_id::text
    WHEN 'DESTINATION' THEN '/' || v_locale || '/destinations/' || v_slug
    WHEN 'CITY' THEN '/' || v_locale || '/cities/' || v_slug || '-' || v_entity_id::text
    WHEN 'PAGE' THEN '/' || v_locale || '/' || v_slug
    WHEN 'ARTICLE' THEN '/' || v_locale || '/guides/' || v_slug || '-' || v_entity_id::text
    ELSE NULL
  END;

  IF cardinality(v_assignment_ids) NOT BETWEEN 1 AND 64
    OR cardinality(v_role_package_version_ids) NOT BETWEEN 1 AND 64
    OR cardinality(v_assignment_ids) <>
      (SELECT count(DISTINCT value) FROM unnest(v_assignment_ids) value)
    OR cardinality(v_role_package_version_ids) <>
      (SELECT count(DISTINCT value) FROM unnest(v_role_package_version_ids) value)
    OR substring(v_access_id::text from 15 for 1) <> '7'
    OR substring(v_content_record::text from 15 for 1) <> '7'
    OR substring(v_revision::text from 15 for 1) <> '7'
    OR substring(v_route_alias::text from 15 for 1) <> '7'
    OR substring(v_intake_receipt::text from 15 for 1) <> '7'
    OR cardinality(ARRAY[v_access_id, v_content_record, v_revision, v_route_alias, v_intake_receipt]) <>
      cardinality(ARRAY(SELECT DISTINCT value FROM unnest(ARRAY[v_access_id, v_content_record, v_revision, v_route_alias, v_intake_receipt]) value))
    OR (p_access->>'tenantId')::uuid IS DISTINCT FROM v_tenant
    OR (p_access->>'resourceId') IS DISTINCT FROM v_content_record::text
    OR p_access->>'resourceType' <> 'PUBLIC_WEB_CONTENT'
    OR p_access->>'capabilityKey' <> 'public_web.content.write'
    OR p_access->>'decision' <> 'ALLOW'
    OR p_access->>'reasonCode' <> 'allowed'
    OR p_access->>'correlationId' IS DISTINCT FROM v_request_key
    OR (p_command->>'accessDecisionReceiptId')::uuid IS DISTINCT FROM v_access_id
    OR v_actor_legacy_user < 1
    OR v_entity_id < 1
    OR v_entity_type NOT IN ('PROGRAM','UNIVERSITY','DESTINATION','CITY','PAGE','ARTICLE')
    OR v_locale NOT IN ('en','tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it')
    OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR length(v_slug) NOT BETWEEN 1 AND 180
    OR v_path IS DISTINCT FROM v_expected_path
    OR v_path !~ '^/(en|tr|ar|fr|ru|fa|zh|hi|es|id|ur|tk|ky|kk|uz|tg|bn|pt|ne|vi|ko|uk|it)(/[a-z0-9][a-z0-9._~-]*)+/?$'
    OR v_path LIKE '%//%'
    OR (v_entity_type = 'PAGE' AND v_slug = ANY(ARRAY[
      'about','countries','destinations','cities','programs','universities','blog',
      'guides','contact','login','register','agency','agency-application','student',
      'staff','admin','agent','institution','accommodation','instructor','embed',
      'api','sitemaps','robots.txt','sitemap.xml'
    ]::text[]))
    OR v_origin NOT IN ('HUMAN','AI_ASSISTED','IMPORT')
    OR length(trim(v_title)) NOT BETWEEN 1 AND 500
    OR v_title IS DISTINCT FROM trim(v_title)
    OR (v_summary IS NOT NULL AND length(v_summary) > 4000)
    OR octet_length((p_command->'contentJson')::text) > 1048576
    OR octet_length((p_command->'seoJson')::text) > 65536
    OR octet_length((p_command->'structuredDataJson')::text) > 262144
    OR v_source_sha256 !~ '^[0-9a-f]{64}$'
    OR v_content_sha256 !~ '^[0-9a-f]{64}$'
    OR (v_generator_receipt_sha256 IS NOT NULL AND v_generator_receipt_sha256 !~ '^[0-9a-f]{64}$')
    OR ((v_origin = 'AI_ASSISTED') IS DISTINCT FROM (v_generator_receipt_sha256 IS NOT NULL))
    OR v_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
    OR v_request_hash !~ '^[0-9a-f]{64}$'
    OR v_occurred_at > clock_timestamp()
    OR v_occurred_at <= clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid public web draft intake values' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_tenant::text || ':' || v_organization::text || ':' || v_entity_type || ':' ||
    v_entity_id::text || ':' || v_locale,
    0
  ));

  INSERT INTO public.access_decision_receipts (
    id, tenant_id, context_id, actor_principal_id, membership_id,
    assignment_ids, role_package_version_ids, capability_key, resource_type,
    resource_id, decision, reason_code, policy_version_id, correlation_id,
    occurred_at
  ) VALUES (
    v_access_id, v_tenant, v_context_id, v_actor_principal_id, v_membership_id,
    v_assignment_ids, v_role_package_version_ids, 'public_web.content.write',
    'PUBLIC_WEB_CONTENT', v_content_record::text, 'ALLOW', 'allowed',
    v_policy_version_id, v_request_key, v_occurred_at
  ) ON CONFLICT (tenant_id, id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT receipt.* INTO v_existing_access
    FROM public.access_decision_receipts receipt
    WHERE receipt.tenant_id = v_tenant AND receipt.id = v_access_id;
    IF NOT FOUND
      OR v_existing_access.context_id <> v_context_id
      OR v_existing_access.actor_principal_id <> v_actor_principal_id
      OR v_existing_access.membership_id <> v_membership_id
      OR v_existing_access.assignment_ids <> v_assignment_ids
      OR v_existing_access.role_package_version_ids <> v_role_package_version_ids
      OR v_existing_access.capability_key <> 'public_web.content.write'
      OR v_existing_access.resource_type <> 'PUBLIC_WEB_CONTENT'
      OR v_existing_access.resource_id <> v_content_record::text
      OR v_existing_access.decision <> 'ALLOW'
      OR v_existing_access.reason_code <> 'allowed'
      OR v_existing_access.policy_version_id <> v_policy_version_id
      OR v_existing_access.correlation_id <> v_request_key
      OR v_existing_access.occurred_at <> v_occurred_at THEN
      RAISE EXCEPTION 'public web draft access idempotency conflict' USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT count(*), array_agg(DISTINCT package.id ORDER BY package.id)
    INTO v_current_assignment_count, v_current_package_ids
  FROM public.access_assignments assignment
  JOIN public.role_package_versions package
    ON package.id = assignment.role_package_version_id
  JOIN public.role_definitions definition
    ON definition.id = package.role_definition_id
  WHERE assignment.tenant_id = v_tenant
    AND assignment.membership_id = v_membership_id
    AND assignment.id = ANY(v_assignment_ids)
    AND assignment.status = 'ACTIVE'
    AND assignment.valid_from <= v_occurred_at
    AND (assignment.valid_until IS NULL OR assignment.valid_until > v_occurred_at)
    AND (
      assignment.scope_type = 'TENANT'
      OR (assignment.scope_type = 'ORGANIZATION' AND assignment.organization_id = v_organization)
    )
    AND package.status = 'ACTIVE'
    AND package.effective_at <= v_occurred_at
    AND (package.deprecated_at IS NULL OR package.deprecated_at > v_occurred_at)
    AND definition.status = 'ACTIVE'
    AND definition.principal_type = 'HUMAN';

  IF NOT EXISTS (
      SELECT 1
      FROM public.tenants tenant
      JOIN public.organizations organization
        ON organization.tenant_id = tenant.id
       AND organization.id = v_organization
      JOIN public.principals principal ON principal.id = v_actor_principal_id
      JOIN public.memberships membership
        ON membership.tenant_id = tenant.id
       AND membership.id = v_membership_id
       AND membership.principal_id = principal.id
      JOIN public.policy_versions policy
        ON policy.tenant_id = tenant.id
       AND policy.id = v_policy_version_id
       AND policy.version_number = tenant.policy_version
      WHERE tenant.id = v_tenant
        AND tenant.status = 'ACTIVE'
        AND organization.status = 'ACTIVE'
        AND principal.legacy_user_id = v_actor_legacy_user
        AND principal.principal_type = 'HUMAN'
        AND principal.status = 'ACTIVE'
        AND principal.risk_state = 'NORMAL'
        AND membership.status = 'ACTIVE'
        AND membership.valid_from <= v_occurred_at
        AND (membership.valid_until IS NULL OR membership.valid_until > v_occurred_at)
        AND (membership.organization_id IS NULL OR membership.organization_id = v_organization)
        AND policy.state = 'ACTIVE'
        AND policy.effective_at <= v_occurred_at
        AND policy.revoked_at IS NULL
    )
    OR v_current_assignment_count <> cardinality(v_assignment_ids)
    OR (coalesce(v_current_package_ids, ARRAY[]::uuid[]) @> v_role_package_version_ids) IS NOT TRUE
    OR (coalesce(v_current_package_ids, ARRAY[]::uuid[]) <@ v_role_package_version_ids) IS NOT TRUE
    OR NOT EXISTS (
      SELECT 1
      FROM public.access_assignments assignment
      JOIN public.role_package_capabilities grant_record
        ON grant_record.role_package_version_id = assignment.role_package_version_id
      JOIN public.capability_definitions capability
        ON capability.key = grant_record.capability_key
      WHERE assignment.tenant_id = v_tenant
        AND assignment.membership_id = v_membership_id
        AND assignment.id = ANY(v_assignment_ids)
        AND grant_record.capability_key = 'public_web.content.write'
        AND grant_record.effect = 'ALLOW'
        AND capability.status = 'ACTIVE'
        AND capability.step_up_required = false
        AND capability.approval_required = false
    )
    OR EXISTS (
      SELECT 1
      FROM public.access_assignments assignment
      JOIN public.role_package_capabilities deny_record
        ON deny_record.role_package_version_id = assignment.role_package_version_id
      WHERE assignment.tenant_id = v_tenant
        AND assignment.membership_id = v_membership_id
        AND assignment.id = ANY(v_assignment_ids)
        AND deny_record.capability_key = 'public_web.content.write'
        AND deny_record.effect = 'DENY'
    ) THEN
    RAISE EXCEPTION 'public web draft intake authority unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT receipt.* INTO v_existing_intake
  FROM public.public_web_draft_intake_receipts receipt
  WHERE receipt.tenant_id = v_tenant AND receipt.request_key = v_request_key;
  IF FOUND THEN
    IF v_existing_intake.id <> v_intake_receipt
      OR v_existing_intake.organization_id <> v_organization
      OR v_existing_intake.content_record_id <> v_content_record
      OR v_existing_intake.revision_id <> v_revision
      OR v_existing_intake.route_alias_id <> v_route_alias
      OR v_existing_intake.entity_type <> v_entity_type
      OR v_existing_intake.entity_id <> v_entity_id
      OR v_existing_intake.locale <> v_locale
      OR v_existing_intake.actor_legacy_user_id <> v_actor_legacy_user
      OR v_existing_intake.authorization_decision_receipt_id <> v_access_id
      OR v_existing_intake.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'public web draft intake idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'REPLAY',
      'intakeReceiptId', v_intake_receipt,
      'contentRecordId', v_content_record,
      'revisionId', v_revision,
      'status', 'DRAFT',
      'indexState', 'NOINDEX',
      'version', 1
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.public_web_content_records content
    WHERE content.tenant_id = v_tenant AND content.organization_id = v_organization
      AND (
        content.id = v_content_record
        OR (content.entity_type = v_entity_type AND content.locale = v_locale AND
          CASE v_entity_type
            WHEN 'PROGRAM' THEN content.program_id
            WHEN 'UNIVERSITY' THEN content.university_id
            WHEN 'DESTINATION' THEN content.destination_id
            WHEN 'CITY' THEN content.city_id
            WHEN 'PAGE' THEN content.website_page_id
            WHEN 'ARTICLE' THEN content.blog_post_id
          END = v_entity_id)
      )
  ) OR EXISTS (
    SELECT 1 FROM public.public_web_content_revisions revision
    WHERE revision.id = v_revision
  ) THEN
    RAISE EXCEPTION 'public web draft intake target conflict' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.public_web_content_records (
    id, tenant_id, organization_id, entity_type, program_id, university_id,
    destination_id, city_id, website_page_id, blog_post_id, locale,
    canonical_slug, canonical_path, created_by_legacy_user_id
  ) VALUES (
    v_content_record, v_tenant, v_organization, v_entity_type,
    CASE WHEN v_entity_type = 'PROGRAM' THEN v_entity_id END,
    CASE WHEN v_entity_type = 'UNIVERSITY' THEN v_entity_id END,
    CASE WHEN v_entity_type = 'DESTINATION' THEN v_entity_id END,
    CASE WHEN v_entity_type = 'CITY' THEN v_entity_id END,
    CASE WHEN v_entity_type = 'PAGE' THEN v_entity_id END,
    CASE WHEN v_entity_type = 'ARTICLE' THEN v_entity_id END,
    v_locale, v_slug, v_path, v_actor_legacy_user
  );

  INSERT INTO public.public_web_content_revisions (
    id, tenant_id, organization_id, content_record_id, revision_number,
    origin, title, summary, content_json, seo_json, structured_data_json,
    source_sha256, content_sha256, generator_receipt_sha256, quality_status,
    source_coverage, translation_status, seo_status, structured_data_status,
    created_by_legacy_user_id
  ) VALUES (
    v_revision, v_tenant, v_organization, v_content_record, 1,
    v_origin, v_title, v_summary, p_command->'contentJson', p_command->'seoJson',
    p_command->'structuredDataJson', v_source_sha256, v_content_sha256,
    v_generator_receipt_sha256, 'PENDING', 'MISSING',
    CASE WHEN v_locale = 'en' THEN 'SOURCE' ELSE 'MISSING' END,
    'PENDING', 'PENDING', v_actor_legacy_user
  );

  INSERT INTO public.public_web_publication_states (
    tenant_id, organization_id, content_record_id, revision_id, status,
    index_state, version
  ) VALUES (
    v_tenant, v_organization, v_content_record, v_revision, 'DRAFT', 'NOINDEX', 1
  );

  INSERT INTO public.public_web_route_aliases (
    id, tenant_id, organization_id, content_record_id, path, route_kind,
    redirect_to_path, http_status, created_by_legacy_user_id
  ) VALUES (
    v_route_alias, v_tenant, v_organization, v_content_record, v_path,
    'CANONICAL', NULL, 200, v_actor_legacy_user
  );

  INSERT INTO public.public_web_draft_intake_receipts (
    id, tenant_id, organization_id, content_record_id, revision_id,
    route_alias_id, entity_type, entity_id, locale, actor_legacy_user_id,
    authorization_decision_receipt_id, request_key, request_hash, occurred_at
  ) VALUES (
    v_intake_receipt, v_tenant, v_organization, v_content_record, v_revision,
    v_route_alias, v_entity_type, v_entity_id, v_locale, v_actor_legacy_user,
    v_access_id, v_request_key, v_request_hash, v_occurred_at
  );

  RETURN jsonb_build_object(
    'outcome', 'APPLIED',
    'intakeReceiptId', v_intake_receipt,
    'contentRecordId', v_content_record,
    'revisionId', v_revision,
    'status', 'DRAFT',
    'indexState', 'NOINDEX',
    'version', 1
  );
END;
$$;

REVOKE ALL ON FUNCTION fas_public_web_v1.apply_authorized_draft_intake(jsonb, jsonb)
  FROM PUBLIC;

COMMENT ON FUNCTION fas_public_web_v1.apply_authorized_draft_intake(jsonb, jsonb) IS
  'Default-unwired, idempotent creation of one governed DRAFT+NOINDEX public content record and immutable revision. No publication or index transition.';
