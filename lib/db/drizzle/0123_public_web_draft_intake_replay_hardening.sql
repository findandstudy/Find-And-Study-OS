-- Hardens default-unwired public-web draft intake. The v2 gateway provides
-- durable replay after ambiguous COMMIT, DB-current authority revalidation,
-- scope-derived request keys (constructed by the application adapter), and a
-- source snapshot lock held in the same transaction as the draft write.

CREATE FUNCTION fas_public_web_v1.resolve_source_sha256_internal(
  p_entity_type text,
  p_entity_id integer,
  p_lock boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security TO on
AS $$
DECLARE
  v_source jsonb;
BEGIN
  IF p_entity_type IS NULL
    OR p_entity_id IS NULL
    OR p_lock IS NULL
    OR p_entity_type NOT IN (
      'PROGRAM','UNIVERSITY','DESTINATION','CITY','PAGE','ARTICLE'
    )
    OR p_entity_id < 1
    OR p_entity_id > 2147483647 THEN
    RAISE EXCEPTION 'invalid public web source reference' USING ERRCODE = '22023';
  END IF;

  IF p_entity_type = 'PROGRAM' THEN
    IF p_lock THEN
      PERFORM 1
      FROM public.programs program
      JOIN public.universities university ON university.id = program.university_id
      WHERE program.id = p_entity_id
        AND program.is_active = true
        AND university.is_active = true
        AND octet_length(program.name) <= 2048
        AND octet_length(coalesce(program.description, '')) <= 262144
        AND octet_length(coalesce(program.requirements, '')) <= 262144
        AND octet_length(coalesce(program.intakes, '')) <= 65536
      FOR SHARE OF program, university;
    END IF;
    SELECT to_jsonb(source_row) INTO v_source
    FROM (
      SELECT program.id, program.university_id, program.name,
        program.description, program.degree, program.field, program.language,
        program.duration, program.tuition_fee, program.currency,
        program.scholarship, program.intakes, program.requirements,
        program.application_fee, program.advanced_fee, program.deposit_fee,
        program.discounted_fee, program.language_fee, program.min_gpa,
        program.min_language_score, program.quota,
        floor(extract(epoch FROM program.updated_at) * 1000000)::bigint
          AS updated_at_epoch_micros
      FROM public.programs program
      JOIN public.universities university ON university.id = program.university_id
      WHERE program.id = p_entity_id
        AND program.is_active = true
        AND university.is_active = true
        AND octet_length(program.name) <= 2048
        AND octet_length(coalesce(program.description, '')) <= 262144
        AND octet_length(coalesce(program.requirements, '')) <= 262144
        AND octet_length(coalesce(program.intakes, '')) <= 65536
    ) source_row;
  ELSIF p_entity_type = 'UNIVERSITY' THEN
    IF p_lock THEN
      PERFORM 1
      FROM public.universities university
      WHERE university.id = p_entity_id
        AND university.is_active = true
        AND university.status = 'open'
        AND octet_length(university.name) <= 2048
        AND octet_length(coalesce(university.description, '')) <= 262144
        AND octet_length(coalesce(university.address, '')) <= 65536
      FOR SHARE OF university;
    END IF;
    SELECT to_jsonb(source_row) INTO v_source
    FROM (
      SELECT university.id, university.name, university.country,
        university.city, university.website, university.logo_url,
        university.description, university.ranking, university.university_type,
        university.qs_ranking, university.times_ranking,
        university.shanghai_ranking, university.cwts_leiden_ranking,
        university.address, university.status,
        floor(extract(epoch FROM university.updated_at) * 1000000)::bigint
          AS updated_at_epoch_micros
      FROM public.universities university
      WHERE university.id = p_entity_id
        AND university.is_active = true
        AND university.status = 'open'
        AND octet_length(university.name) <= 2048
        AND octet_length(coalesce(university.description, '')) <= 262144
        AND octet_length(coalesce(university.address, '')) <= 65536
    ) source_row;
  ELSIF p_entity_type = 'DESTINATION' THEN
    IF p_lock THEN
      PERFORM 1
      FROM public.destinations destination
      WHERE destination.id = p_entity_id
        AND destination.is_active = true
        AND octet_length(destination.name) <= 2048
        AND octet_length(coalesce(destination.description, '')) <= 262144
        AND octet_length(coalesce(destination.why_study_here, '')) <= 262144
        AND octet_length(coalesce(destination.visa_info, '')) <= 262144
      FOR SHARE OF destination;
    END IF;
    SELECT to_jsonb(source_row) INTO v_source
    FROM (
      SELECT destination.id, destination.name, destination.slug,
        destination.country, destination.flag_emoji, destination.hero_image_url,
        destination.thumbnail_url, destination.short_description,
        destination.description, destination.why_study_here,
        destination.living_cost, destination.climate, destination.language,
        destination.currency, destination.visa_info, destination.work_permit,
        destination.popular_cities, destination.university_count,
        destination.program_count, destination.average_tuition,
        floor(extract(epoch FROM destination.updated_at) * 1000000)::bigint
          AS updated_at_epoch_micros
      FROM public.destinations destination
      WHERE destination.id = p_entity_id
        AND destination.is_active = true
        AND octet_length(destination.name) <= 2048
        AND octet_length(coalesce(destination.description, '')) <= 262144
        AND octet_length(coalesce(destination.why_study_here, '')) <= 262144
        AND octet_length(coalesce(destination.visa_info, '')) <= 262144
    ) source_row;
  ELSIF p_entity_type = 'CITY' THEN
    IF p_lock THEN
      PERFORM 1
      FROM public.cities city
      JOIN public.countries country ON country.id = city.country_id
      WHERE city.id = p_entity_id
        AND city.is_active = true
        AND country.is_active = true
        AND octet_length(city.name) <= 2048
        AND octet_length(country.name) <= 2048
      FOR SHARE OF city, country;
    END IF;
    SELECT to_jsonb(source_row) INTO v_source
    FROM (
      SELECT city.id, city.name, city.country_id,
        country.name AS country_name, country.code AS country_code,
        floor(extract(epoch FROM city.updated_at) * 1000000)::bigint
          AS updated_at_epoch_micros,
        floor(extract(epoch FROM country.updated_at) * 1000000)::bigint
          AS country_updated_at_epoch_micros
      FROM public.cities city
      JOIN public.countries country ON country.id = city.country_id
      WHERE city.id = p_entity_id
        AND city.is_active = true
        AND country.is_active = true
        AND octet_length(city.name) <= 2048
        AND octet_length(country.name) <= 2048
    ) source_row;
  ELSIF p_entity_type = 'PAGE' THEN
    IF p_lock THEN
      PERFORM 1
      FROM public.website_pages page
      WHERE page.id = p_entity_id
        AND page.status IN ('draft', 'published')
        AND octet_length(page.title) <= 2048
        AND octet_length(coalesce(page.meta_description, '')) <= 65536
      FOR SHARE OF page;
    END IF;
    SELECT to_jsonb(source_row) INTO v_source
    FROM (
      SELECT page.id, page.title, page.slug, page.status, page.template,
        page.meta_title, page.meta_description, page.og_image_url,
        page.canonical_url, page.robots_index, page.robots_follow,
        page.og_title, page.og_description, page.twitter_title,
        page.twitter_description, page.twitter_image_url, page.locale,
        floor(extract(epoch FROM page.updated_at) * 1000000)::bigint
          AS updated_at_epoch_micros
      FROM public.website_pages page
      WHERE page.id = p_entity_id
        AND page.status IN ('draft', 'published')
        AND octet_length(page.title) <= 2048
        AND octet_length(coalesce(page.meta_description, '')) <= 65536
    ) source_row;
  ELSE
    IF p_lock THEN
      PERFORM 1
      FROM public.website_blog_posts article
      WHERE article.id = p_entity_id
        AND article.status IN ('draft', 'published')
        AND octet_length(article.title) <= 2048
        AND octet_length(coalesce(article.excerpt, '')) <= 65536
        AND octet_length(article.content::text) <= 1048576
        AND octet_length(coalesce(article.meta_description, '')) <= 65536
      FOR SHARE OF article;
    END IF;
    SELECT to_jsonb(source_row) INTO v_source
    FROM (
      SELECT article.id, article.title, article.slug, article.excerpt,
        article.content, article.featured_image_url, article.status,
        article.category_id, article.locale, article.meta_title,
        article.meta_description,
        floor(extract(epoch FROM article.updated_at) * 1000000)::bigint
          AS updated_at_epoch_micros
      FROM public.website_blog_posts article
      WHERE article.id = p_entity_id
        AND article.status IN ('draft', 'published')
        AND octet_length(article.title) <= 2048
        AND octet_length(coalesce(article.excerpt, '')) <= 65536
        AND octet_length(article.content::text) <= 1048576
        AND octet_length(coalesce(article.meta_description, '')) <= 65536
    ) source_row;
  END IF;

  IF v_source IS NULL THEN
    RETURN NULL;
  END IF;
  IF octet_length(v_source::text) > 2097152 THEN
    RAISE EXCEPTION 'public web source snapshot oversized' USING ERRCODE = '54000';
  END IF;
  RETURN encode(sha256(convert_to(
    E'fas.public-web.source.v2\n' || v_source::text,
    'UTF8'
  )), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION fas_public_web_v1.resolve_source_sha256_internal(text, integer, boolean)
  FROM PUBLIC;

CREATE FUNCTION fas_public_web_v1.resolve_source_sha256(
  p_entity_type text,
  p_entity_id integer
) RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security TO on
AS $$
  SELECT fas_public_web_v1.resolve_source_sha256_internal(
    p_entity_type,
    p_entity_id,
    false
  );
$$;

CREATE FUNCTION fas_public_web_v1.resolve_source_sha256_locked(
  p_entity_type text,
  p_entity_id integer
) RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security TO on
AS $$
  SELECT fas_public_web_v1.resolve_source_sha256_internal(
    p_entity_type,
    p_entity_id,
    true
  );
$$;

REVOKE ALL ON FUNCTION fas_public_web_v1.resolve_source_sha256(text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION fas_public_web_v1.resolve_source_sha256_locked(text, integer)
  FROM PUBLIC;

CREATE FUNCTION fas_public_web_v1.assert_current_draft_authority(
  p_access jsonb,
  p_command jsonb,
  p_selection jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security TO on
AS $$
DECLARE
  v_tenant uuid := (p_command->>'tenantId')::uuid;
  v_organization uuid := (p_command->>'organizationId')::uuid;
  v_content_record uuid := (p_command->>'contentRecordId')::uuid;
  v_context_id uuid := (p_access->>'contextId')::uuid;
  v_actor_principal_id uuid := (p_access->>'actorPrincipalId')::uuid;
  v_membership_id uuid := (p_access->>'membershipId')::uuid;
  v_policy_version_id uuid := (p_access->>'policyVersionId')::uuid;
  v_assignment_ids uuid[] := ARRAY(
    SELECT value::uuid FROM jsonb_array_elements_text(p_access->'assignmentIds') value
  );
  v_role_package_version_ids uuid[] := ARRAY(
    SELECT value::uuid FROM jsonb_array_elements_text(p_access->'rolePackageVersionIds') value
  );
  v_actor_legacy_user integer := (p_command->>'actorLegacyUserId')::integer;
  v_selection_id uuid := (p_selection->>'selectionId')::uuid;
  v_session_generation bigint := (p_selection->>'sessionGeneration')::bigint;
  v_session_id text := p_selection->>'sessionId';
  v_session_fingerprint text := p_selection->>'sessionFingerprint';
  v_context_issued_at_ms bigint := (p_selection->>'contextIssuedAt')::bigint;
  v_context_expires_at_ms bigint := (p_selection->>'contextExpiresAt')::bigint;
  v_now timestamptz;
  v_now_ms bigint;
  v_session_user_id integer;
  v_session_issued_at_ms bigint;
  v_session_row public.sessions%ROWTYPE;
  v_user_row public.users%ROWTYPE;
  v_selection_row public.active_session_context_selections%ROWTYPE;
  v_current_assignment_ids uuid[];
  v_current_package_ids uuid[];
BEGIN
  IF current_setting('transaction_isolation') <> 'serializable' THEN
    RAISE EXCEPTION 'public web draft intake requires serializable isolation'
      USING ERRCODE = '25001';
  END IF;
  IF jsonb_typeof(p_selection) <> 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_selection) key)
      IS DISTINCT FROM ARRAY[
        'contextExpiresAt', 'contextId', 'contextIssuedAt', 'selectionId',
        'sessionFingerprint', 'sessionGeneration', 'sessionId'
      ]::text[]
    OR jsonb_typeof(p_access->'assignmentIds') <> 'array'
    OR jsonb_typeof(p_access->'rolePackageVersionIds') <> 'array'
    OR cardinality(v_assignment_ids) NOT BETWEEN 1 AND 64
    OR cardinality(v_role_package_version_ids) NOT BETWEEN 1 AND 64
    OR cardinality(v_assignment_ids) <>
      (SELECT count(DISTINCT value) FROM unnest(v_assignment_ids) value)
    OR cardinality(v_role_package_version_ids) <>
      (SELECT count(DISTINCT value) FROM unnest(v_role_package_version_ids) value)
    OR (p_access->>'tenantId')::uuid IS DISTINCT FROM v_tenant
    OR p_access->>'resourceId' IS DISTINCT FROM v_content_record::text
    OR p_access->>'resourceType' <> 'PUBLIC_WEB_CONTENT'
    OR p_access->>'capabilityKey' <> 'public_web.content.write'
    OR p_access->>'decision' <> 'ALLOW'
    OR p_access->>'reasonCode' <> 'allowed'
    OR (p_selection->>'contextId')::uuid IS DISTINCT FROM v_context_id
    OR substring(v_context_id::text from 15 for 1) <> '7'
    OR substring(v_selection_id::text from 15 for 1) <> '7'
    OR v_session_generation NOT BETWEEN 1 AND 9007199254740991
    OR v_session_id !~ '^[0-9a-f]{64}$'
    OR v_session_fingerprint !~ '^[0-9a-f]{64}$'
    OR encode(sha256(convert_to(v_session_id, 'UTF8')), 'hex')
      IS DISTINCT FROM v_session_fingerprint
    OR v_context_issued_at_ms < 0
    OR v_context_expires_at_ms <= v_context_issued_at_ms
    OR v_context_expires_at_ms > v_context_issued_at_ms + 900000
    OR v_actor_legacy_user < 1 THEN
    RAISE EXCEPTION 'invalid public web draft authority claims' USING ERRCODE = '22023';
  END IF;

  PERFORM fas_public_web_v1.assert_scope(v_tenant, v_organization);

  -- Match the lifecycle corridor's lock order: session -> legacy user ->
  -- latest selection -> tenant/principal/membership/policy ->
  -- assignment/package/capability.
  SELECT * INTO v_session_row
  FROM public.sessions session
  WHERE session.sid = v_session_id
  FOR SHARE;
  SELECT * INTO v_user_row
  FROM public.users account
  WHERE account.id = v_session_row.user_id
  FOR SHARE;
  SELECT * INTO v_selection_row
  FROM public.active_session_context_selections selection
  WHERE selection.session_fingerprint = v_session_fingerprint
  ORDER BY selection.session_generation DESC
  LIMIT 1
  FOR UPDATE;
  PERFORM 1 FROM public.tenants tenant
    WHERE tenant.id = v_tenant FOR SHARE OF tenant;
  PERFORM 1 FROM public.organizations organization
    WHERE organization.tenant_id = v_tenant AND organization.id = v_organization
    FOR SHARE OF organization;
  PERFORM 1 FROM public.principals principal
    WHERE principal.id = v_actor_principal_id FOR SHARE OF principal;
  PERFORM 1 FROM public.memberships membership
    WHERE membership.tenant_id = v_tenant AND membership.id = v_membership_id
    FOR SHARE OF membership;
  PERFORM 1 FROM public.policy_versions policy
    WHERE policy.tenant_id = v_tenant AND policy.id = v_policy_version_id
    FOR SHARE OF policy;
  PERFORM 1 FROM public.access_assignments assignment
    WHERE assignment.tenant_id = v_tenant
      AND assignment.membership_id = v_membership_id
      AND assignment.id = ANY(v_assignment_ids)
    ORDER BY assignment.id
    FOR SHARE OF assignment;
  PERFORM 1 FROM public.role_package_versions package
    WHERE package.id = ANY(v_role_package_version_ids)
    ORDER BY package.id
    FOR SHARE OF package;
  PERFORM 1
    FROM public.role_definitions definition
    JOIN public.role_package_versions package
      ON package.role_definition_id = definition.id
    WHERE package.id = ANY(v_role_package_version_ids)
    ORDER BY definition.id
    FOR SHARE OF definition;
  PERFORM 1 FROM public.role_package_capabilities grant_record
    WHERE grant_record.role_package_version_id = ANY(v_role_package_version_ids)
      AND grant_record.capability_key = 'public_web.content.write'
    ORDER BY grant_record.role_package_version_id
    FOR SHARE OF grant_record;
  PERFORM 1 FROM public.capability_definitions capability
    WHERE capability.key = 'public_web.content.write'
    FOR SHARE OF capability;

  -- Refresh the DB clock only after every authority row lock is held.
  v_now := clock_timestamp();
  v_now_ms := floor(extract(epoch FROM v_now) * 1000)::bigint;
  IF v_session_row.sid IS NULL
    OR v_user_row.id IS NULL
    OR v_user_row.id IS DISTINCT FROM v_actor_legacy_user
    OR v_user_row.deleted_at IS NOT NULL
    OR v_user_row.is_active = false
    OR (v_user_row.role = 'student' AND v_user_row.email_verified = false)
    OR jsonb_typeof(v_session_row.sess->'user'->'id') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_session_row.sess->'issued_at') IS DISTINCT FROM 'number'
    OR v_session_row.sess ? 'originalSid' THEN
    RAISE EXCEPTION 'public web draft intake session unavailable' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_session_user_id := (v_session_row.sess->'user'->>'id')::integer;
    v_session_issued_at_ms := (v_session_row.sess->>'issued_at')::bigint;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'public web draft intake session unavailable' USING ERRCODE = '42501';
  END;

  IF v_context_issued_at_ms > v_now_ms + 30000
    OR v_now_ms >= v_context_expires_at_ms
    OR v_session_user_id IS DISTINCT FROM v_actor_legacy_user
    OR v_session_row.user_id IS DISTINCT FROM v_actor_legacy_user
    OR v_session_issued_at_ms <= 0
    OR v_session_issued_at_ms > v_context_issued_at_ms
    OR v_session_row.expire IS NULL
    OR floor(extract(epoch FROM v_session_row.expire AT TIME ZONE 'UTC') * 1000)::bigint <= v_now_ms
    OR v_session_issued_at_ms + 86400000 <= v_now_ms
    OR v_selection_row.id IS NULL
    OR v_selection_row.id IS DISTINCT FROM v_selection_id
    OR v_selection_row.session_generation IS DISTINCT FROM v_session_generation
    OR v_selection_row.session_fingerprint IS DISTINCT FROM v_session_fingerprint
    OR v_selection_row.tenant_id IS DISTINCT FROM v_tenant
    OR v_selection_row.legacy_user_id IS DISTINCT FROM v_actor_legacy_user
    OR v_selection_row.principal_id IS DISTINCT FROM v_actor_principal_id
    OR v_selection_row.membership_id IS DISTINCT FROM v_membership_id
    OR v_selection_row.organization_id IS DISTINCT FROM v_organization
    OR v_selection_row.legacy_branch_id IS NOT NULL
    OR v_selection_row.status <> 'ACTIVE'
    OR v_selection_row.impersonator_principal_id IS NOT NULL
    OR v_selection_row.original_session_fingerprint IS NOT NULL THEN
    RAISE EXCEPTION 'public web draft intake active selection unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(assignment.id ORDER BY assignment.id),
      array_agg(DISTINCT package.id ORDER BY package.id)
    INTO v_current_assignment_ids, v_current_package_ids
  FROM public.access_assignments assignment
  JOIN public.role_package_versions package
    ON package.id = assignment.role_package_version_id
  JOIN public.role_definitions definition
    ON definition.id = package.role_definition_id
  WHERE assignment.tenant_id = v_tenant
    AND assignment.membership_id = v_membership_id
    AND assignment.status = 'ACTIVE'
    AND assignment.valid_from <= v_now
    AND (assignment.valid_until IS NULL OR assignment.valid_until > v_now)
    AND (
      assignment.scope_type = 'TENANT'
      OR (assignment.scope_type = 'ORGANIZATION' AND assignment.organization_id = v_organization)
    )
    AND package.status = 'ACTIVE'
    AND package.effective_at IS NOT NULL
    AND package.effective_at <= v_now
    AND (package.deprecated_at IS NULL OR package.deprecated_at > v_now)
    AND definition.status = 'ACTIVE'
    AND definition.principal_type = 'HUMAN'
    AND EXISTS (
      SELECT 1
      FROM public.role_package_capabilities package_capability
      JOIN public.capability_definitions capability
        ON capability.key = package_capability.capability_key
      WHERE package_capability.role_package_version_id = package.id
        AND capability.status = 'ACTIVE'
    );

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
        AND membership.valid_from <= v_now
        AND (membership.valid_until IS NULL OR membership.valid_until > v_now)
        AND membership.legacy_branch_id IS NULL
        AND (membership.organization_id IS NULL OR membership.organization_id = v_organization)
        AND policy.state = 'ACTIVE'
        AND policy.effective_at <= v_now
        AND policy.revoked_at IS NULL
    )
    OR (coalesce(v_current_assignment_ids, ARRAY[]::uuid[]) @> v_assignment_ids) IS NOT TRUE
    OR (coalesce(v_current_assignment_ids, ARRAY[]::uuid[]) <@ v_assignment_ids) IS NOT TRUE
    OR (coalesce(v_current_package_ids, ARRAY[]::uuid[]) @> v_role_package_version_ids) IS NOT TRUE
    OR (coalesce(v_current_package_ids, ARRAY[]::uuid[]) <@ v_role_package_version_ids) IS NOT TRUE
    OR EXISTS (
      SELECT 1
      FROM public.access_assignments assignment
      JOIN public.role_package_versions package
        ON package.id = assignment.role_package_version_id
      WHERE assignment.tenant_id = v_tenant
        AND assignment.membership_id = v_membership_id
        AND assignment.id = ANY(v_assignment_ids)
        AND (
          assignment.constraint_document <> '{}'::jsonb
          OR package.constraint_document <> '{}'::jsonb
        )
    )
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
        AND assignment.constraint_document = '{}'::jsonb
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
END;
$$;

REVOKE ALL ON FUNCTION fas_public_web_v1.assert_current_draft_authority(jsonb, jsonb, jsonb)
  FROM PUBLIC;

CREATE FUNCTION fas_public_web_v1.apply_authorized_draft_intake_v2(
  p_access jsonb,
  p_command jsonb,
  p_selection jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security TO on
AS $$
DECLARE
  v_tenant uuid;
  v_organization uuid;
  v_content_record uuid;
  v_revision uuid;
  v_route_alias uuid;
  v_intake_receipt uuid;
  v_access_id uuid;
  v_actor_legacy_user integer;
  v_entity_type text;
  v_entity_id integer;
  v_locale text;
  v_source_sha256 text;
  v_request_key text;
  v_request_hash text;
  v_existing_intake public.public_web_draft_intake_receipts%ROWTYPE;
  v_current_source_sha256 text;
BEGIN
  IF jsonb_typeof(p_access) <> 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_access) key)
      IS DISTINCT FROM ARRAY[
        'actorPrincipalId', 'assignmentIds', 'capabilityKey', 'contextId',
        'correlationId', 'decision', 'id', 'membershipId', 'occurredAt',
        'policyVersionId', 'reasonCode', 'resourceId', 'resourceType',
        'rolePackageVersionIds', 'tenantId'
      ]::text[] THEN
    RAISE EXCEPTION 'invalid public web draft access shape' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_command) <> 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_command) key)
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
  IF octet_length(p_access::text) > 65536
    OR octet_length(p_command::text) > 2097152
    OR octet_length(p_selection::text) > 8192 THEN
    RAISE EXCEPTION 'public web draft intake payload oversized' USING ERRCODE = '54000';
  END IF;

  v_tenant := (p_command->>'tenantId')::uuid;
  v_organization := (p_command->>'organizationId')::uuid;
  v_content_record := (p_command->>'contentRecordId')::uuid;
  v_revision := (p_command->>'revisionId')::uuid;
  v_route_alias := (p_command->>'routeAliasId')::uuid;
  v_intake_receipt := (p_command->>'intakeReceiptId')::uuid;
  v_access_id := (p_access->>'id')::uuid;
  v_actor_legacy_user := (p_command->>'actorLegacyUserId')::integer;
  v_entity_type := p_command->>'entityType';
  v_entity_id := (p_command->>'entityId')::integer;
  v_locale := p_command->>'locale';
  v_source_sha256 := p_command->>'sourceSha256';
  v_request_key := p_command->>'requestKey';
  v_request_hash := p_command->>'requestHash';

  PERFORM fas_public_web_v1.assert_scope(v_tenant, v_organization);
  IF substring(v_access_id::text from 15 for 1) <> '7'
    OR substring(v_content_record::text from 15 for 1) <> '7'
    OR substring(v_revision::text from 15 for 1) <> '7'
    OR substring(v_route_alias::text from 15 for 1) <> '7'
    OR substring(v_intake_receipt::text from 15 for 1) <> '7'
    OR cardinality(ARRAY[v_access_id, v_content_record, v_revision, v_route_alias, v_intake_receipt]) <>
      cardinality(ARRAY(SELECT DISTINCT value FROM unnest(
        ARRAY[v_access_id, v_content_record, v_revision, v_route_alias, v_intake_receipt]
      ) value))
    OR (p_access->>'tenantId')::uuid IS DISTINCT FROM v_tenant
    OR p_access->>'resourceId' IS DISTINCT FROM v_content_record::text
    OR p_access->>'correlationId' IS DISTINCT FROM v_request_key
    OR (p_command->>'accessDecisionReceiptId')::uuid IS DISTINCT FROM v_access_id
    OR v_actor_legacy_user < 1
    OR v_entity_id < 1
    OR v_entity_type NOT IN ('PROGRAM','UNIVERSITY','DESTINATION','CITY','PAGE','ARTICLE')
    OR v_locale NOT IN ('en','tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it')
    OR v_source_sha256 !~ '^[0-9a-f]{64}$'
    OR v_request_key !~ '^pwd2:[0-9a-f]{64}$'
    OR v_request_hash !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_command->'contentJson') <> 'object'
    OR jsonb_typeof(p_command->'seoJson') <> 'object'
    OR jsonb_typeof(p_command->'structuredDataJson') <> 'object'
    OR octet_length((p_command->'contentJson')::text) > 1048576
    OR octet_length((p_command->'seoJson')::text) > 65536
    OR octet_length((p_command->'structuredDataJson')::text) > 262144 THEN
    RAISE EXCEPTION 'invalid public web draft intake v2 values' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_tenant::text || ':' || v_request_key,
    0
  ));
  PERFORM fas_public_web_v1.assert_current_draft_authority(
    p_access,
    p_command,
    p_selection
  );

  SELECT receipt.* INTO v_existing_intake
  FROM public.public_web_draft_intake_receipts receipt
  WHERE receipt.tenant_id = v_tenant
    AND receipt.organization_id = v_organization
    AND receipt.request_key = v_request_key;
  IF FOUND THEN
    IF v_existing_intake.entity_type <> v_entity_type
      OR v_existing_intake.entity_id <> v_entity_id
      OR v_existing_intake.locale <> v_locale
      OR v_existing_intake.actor_legacy_user_id <> v_actor_legacy_user
      OR v_existing_intake.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'public web draft intake idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'REPLAY',
      'intakeReceiptId', v_existing_intake.id,
      'contentRecordId', v_existing_intake.content_record_id,
      'revisionId', v_existing_intake.revision_id,
      'status', 'DRAFT',
      'indexState', 'NOINDEX',
      'version', 1
    );
  END IF;

  v_current_source_sha256 := fas_public_web_v1.resolve_source_sha256_locked(
    v_entity_type,
    v_entity_id
  );
  IF v_current_source_sha256 IS NULL
    OR v_current_source_sha256 IS DISTINCT FROM v_source_sha256 THEN
    RAISE EXCEPTION 'public web draft intake source changed' USING ERRCODE = '40001';
  END IF;

  -- Authority can change while waiting on source locks. Revalidate after every
  -- lock acquisition and immediately before entering the legacy writer.
  PERFORM fas_public_web_v1.assert_current_draft_authority(
    p_access,
    p_command,
    p_selection
  );

  RETURN fas_public_web_v1.apply_authorized_draft_intake(p_access, p_command);
END;
$$;

REVOKE ALL ON FUNCTION fas_public_web_v1.apply_authorized_draft_intake_v2(jsonb, jsonb, jsonb)
  FROM PUBLIC;

DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fas_public_web_executor') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION fas_public_web_v1.apply_authorized_draft_intake(jsonb, jsonb) FROM fas_public_web_executor';
    EXECUTE 'REVOKE ALL ON FUNCTION fas_public_web_v1.resolve_source_sha256_internal(text, integer, boolean) FROM fas_public_web_executor';
    EXECUTE 'REVOKE ALL ON FUNCTION fas_public_web_v1.resolve_source_sha256_locked(text, integer) FROM fas_public_web_executor';
    EXECUTE 'REVOKE ALL ON FUNCTION fas_public_web_v1.assert_current_draft_authority(jsonb, jsonb, jsonb) FROM fas_public_web_executor';
  END IF;
END
$acl$;

COMMENT ON FUNCTION fas_public_web_v1.resolve_source_sha256(text, integer) IS
  'Lockless bounded DB-canonical SHA-256 facade for an allowlisted public-web source.';
COMMENT ON FUNCTION fas_public_web_v1.resolve_source_sha256_internal(text, integer, boolean) IS
  'Owner-private public-web source resolver. Executor roles must never receive EXECUTE.';
COMMENT ON FUNCTION fas_public_web_v1.resolve_source_sha256_locked(text, integer) IS
  'Owner-private locked source resolver used only by the authorized intake wrapper.';
COMMENT ON FUNCTION fas_public_web_v1.assert_current_draft_authority(jsonb, jsonb, jsonb) IS
  'Owner-private DB-current session, active-selection and authority revalidation with authority-row locks.';
COMMENT ON FUNCTION fas_public_web_v1.apply_authorized_draft_intake_v2(jsonb, jsonb, jsonb) IS
  'Durable replay, current-session/current-selection authority and locked-source wrapper for default-unwired DRAFT+NOINDEX intake.';
