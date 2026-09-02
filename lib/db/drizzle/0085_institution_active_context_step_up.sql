-- Institution Admissions active-context, step-up and role-grant request corridor.
-- Additive/default-unwired: this migration does not mint a browser selection,
-- issue a step-up receipt, grant a membership or activate a live integration.

INSERT INTO public.capability_definitions
  (key, description, risk_class, delegable, step_up_required, approval_required, status, version)
VALUES
  ('institution.sla.request', 'Request an institution SLA policy change',
    'HIGH', false, true, false, 'ACTIVE', 1),
  ('institution.team.request', 'Request an institution relationship membership change',
    'HIGH', false, true, false, 'ACTIVE', 1)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_package_capabilities(role_package_version_id, capability_key, effect)
VALUES
  ('018f9000-0000-7000-8000-000000000011', 'institution.sla.request', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000011', 'institution.team.request', 'ALLOW')
ON CONFLICT (role_package_version_id, capability_key) DO NOTHING;

ALTER TABLE public.institution_sla_policies
  ADD COLUMN request_hash text,
  ADD COLUMN authorization_receipt_id uuid;

CREATE TABLE public.institution_active_context_selections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  principal_id uuid NOT NULL REFERENCES public.principals(id) ON DELETE RESTRICT,
  legacy_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  session_fingerprint text NOT NULL,
  session_generation bigint NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  impersonator_principal_id uuid REFERENCES public.principals(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  terminated_at timestamptz,
  termination_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_active_context_selections_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT institution_active_context_selections_membership_fk
    FOREIGN KEY (tenant_id, membership_id)
    REFERENCES public.institution_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_active_context_selections_relationship_fk
    FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES public.institution_relationships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_active_context_selections_id_v7_chk
    CHECK (substring(id::text from 15 for 1) = '7'),
  CONSTRAINT institution_active_context_selections_fingerprint_chk
    CHECK (session_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT institution_active_context_selections_generation_chk
    CHECK (session_generation > 0),
  CONSTRAINT institution_active_context_selections_status_chk
    CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED', 'REPLACED')),
  CONSTRAINT institution_active_context_selections_window_chk
    CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '24 hours'),
  CONSTRAINT institution_active_context_selections_impersonation_chk
    CHECK (impersonator_principal_id IS NULL),
  CONSTRAINT institution_active_context_selections_terminal_chk CHECK (
    (status = 'ACTIVE' AND terminated_at IS NULL AND termination_reason IS NULL)
    OR
    (status <> 'ACTIVE' AND terminated_at IS NOT NULL AND termination_reason ~ '^[a-z][a-z0-9_.:-]{1,95}$')
  )
);
CREATE UNIQUE INDEX institution_active_context_one_active_session_uidx
  ON public.institution_active_context_selections(session_fingerprint)
  WHERE status = 'ACTIVE';
CREATE INDEX institution_active_context_actor_idx
  ON public.institution_active_context_selections
  (tenant_id, relationship_id, membership_id, principal_id, session_generation DESC);

CREATE TABLE public.institution_step_up_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  principal_id uuid NOT NULL REFERENCES public.principals(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  selection_id uuid NOT NULL,
  session_generation bigint NOT NULL,
  context_id uuid NOT NULL,
  capability_key text NOT NULL REFERENCES public.capability_definitions(key) ON DELETE RESTRICT,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  request_hash text NOT NULL,
  issuer_reference_hash text NOT NULL,
  receipt_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_step_up_receipts_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT institution_step_up_receipts_membership_fk
    FOREIGN KEY (tenant_id, membership_id)
    REFERENCES public.institution_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_step_up_receipts_selection_fk
    FOREIGN KEY (tenant_id, selection_id)
    REFERENCES public.institution_active_context_selections(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_step_up_receipts_relationship_fk
    FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES public.institution_relationships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_step_up_receipts_id_v7_chk
    CHECK (substring(id::text from 15 for 1) = '7' AND substring(context_id::text from 15 for 1) = '7'),
  CONSTRAINT institution_step_up_receipts_generation_chk CHECK (session_generation > 0),
  CONSTRAINT institution_step_up_receipts_resource_chk CHECK (
    resource_type ~ '^[a-z][a-z0-9_]{1,63}$'
    AND length(resource_id) BETWEEN 1 AND 200
  ),
  CONSTRAINT institution_step_up_receipts_hash_chk CHECK (
    request_hash ~ '^[0-9a-f]{64}$'
    AND issuer_reference_hash ~ '^[0-9a-f]{64}$'
    AND receipt_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT institution_step_up_receipts_status_chk
    CHECK (status IN ('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT institution_step_up_receipts_window_chk CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '10 minutes'
  ),
  CONSTRAINT institution_step_up_receipts_consumption_chk CHECK (
    (status = 'ACTIVE' AND consumed_at IS NULL)
    OR (status = 'CONSUMED' AND consumed_at IS NOT NULL AND consumed_at >= issued_at AND consumed_at <= expires_at)
    OR (status IN ('REVOKED', 'EXPIRED') AND consumed_at IS NULL)
  )
);
CREATE UNIQUE INDEX institution_step_up_receipts_hash_uidx
  ON public.institution_step_up_receipts(tenant_id, receipt_hash);
CREATE INDEX institution_step_up_receipts_actor_idx
  ON public.institution_step_up_receipts
  (tenant_id, relationship_id, membership_id, selection_id, status, expires_at);

CREATE TABLE public.institution_command_authorization_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  context_id uuid NOT NULL,
  selection_id uuid NOT NULL,
  session_generation bigint NOT NULL,
  actor_principal_id uuid NOT NULL REFERENCES public.principals(id) ON DELETE RESTRICT,
  actor_membership_id uuid NOT NULL,
  capability_key text NOT NULL REFERENCES public.capability_definitions(key) ON DELETE RESTRICT,
  required_data_scope text NOT NULL,
  policy_version_id uuid NOT NULL,
  policy_version bigint NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  request_hash text NOT NULL,
  step_up_receipt_id uuid,
  decision text NOT NULL,
  decision_reason text NOT NULL,
  authorization_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_command_authorization_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT institution_command_authorization_membership_fk
    FOREIGN KEY (tenant_id, actor_membership_id)
    REFERENCES public.institution_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_command_authorization_selection_fk
    FOREIGN KEY (tenant_id, selection_id)
    REFERENCES public.institution_active_context_selections(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_command_authorization_step_up_fk
    FOREIGN KEY (tenant_id, step_up_receipt_id)
    REFERENCES public.institution_step_up_receipts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_command_authorization_relationship_fk
    FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES public.institution_relationships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_command_authorization_policy_fk
    FOREIGN KEY (tenant_id, policy_version_id)
    REFERENCES public.policy_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_command_authorization_id_v7_chk
    CHECK (substring(id::text from 15 for 1) = '7' AND substring(context_id::text from 15 for 1) = '7'),
  CONSTRAINT institution_command_authorization_generation_chk CHECK (session_generation > 0),
  CONSTRAINT institution_command_authorization_policy_version_chk CHECK (policy_version > 0),
  CONSTRAINT institution_command_authorization_resource_chk CHECK (
    required_data_scope ~ '^[a-z][a-z0-9_.:-]{1,95}$'
    AND
    resource_type ~ '^[a-z][a-z0-9_]{1,63}$'
    AND length(resource_id) BETWEEN 1 AND 200
  ),
  CONSTRAINT institution_command_authorization_hash_chk CHECK (
    request_hash ~ '^[0-9a-f]{64}$' AND authorization_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT institution_command_authorization_allow_chk CHECK (
    decision = 'ALLOW' AND decision_reason = 'allowed'
  )
);
CREATE UNIQUE INDEX institution_command_authorization_replay_uidx
  ON public.institution_command_authorization_receipts
  (tenant_id, relationship_id, actor_membership_id, capability_key, resource_type, resource_id, request_hash);

CREATE TABLE public.institution_membership_change_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  target_principal_id uuid NOT NULL REFERENCES public.principals(id) ON DELETE RESTRICT,
  target_legacy_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_role_package_version_id uuid NOT NULL REFERENCES public.role_package_versions(id) ON DELETE RESTRICT,
  requested_role_key text NOT NULL,
  requested_program_scope_ids integer[] NOT NULL DEFAULT '{}',
  requested_intake_scopes text[] NOT NULL DEFAULT '{}',
  maker_membership_id uuid NOT NULL,
  checker_membership_id uuid,
  state text NOT NULL DEFAULT 'PENDING_CONTROL_PLANE',
  request_hash text NOT NULL,
  authorization_receipt_id uuid NOT NULL,
  applied_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  applied_at timestamptz,
  CONSTRAINT institution_membership_change_requests_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT institution_membership_change_requests_relationship_fk
    FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES public.institution_relationships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_membership_change_requests_maker_fk
    FOREIGN KEY (tenant_id, maker_membership_id)
    REFERENCES public.institution_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_membership_change_requests_checker_fk
    FOREIGN KEY (tenant_id, checker_membership_id)
    REFERENCES public.institution_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_membership_change_requests_applied_fk
    FOREIGN KEY (tenant_id, applied_membership_id)
    REFERENCES public.institution_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_membership_change_requests_authorization_fk
    FOREIGN KEY (tenant_id, authorization_receipt_id)
    REFERENCES public.institution_command_authorization_receipts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT institution_membership_change_requests_id_v7_chk
    CHECK (substring(id::text from 15 for 1) = '7'),
  CONSTRAINT institution_membership_change_requests_role_chk CHECK (
    requested_role_key IN ('INSTITUTION_ADMIN', 'PROGRAM_INTAKE_MANAGER', 'ADMISSIONS_REVIEWER',
      'DECISION_APPROVER', 'INTEGRATION_ADMIN', 'INSTITUTION_AUDITOR')
  ),
  CONSTRAINT institution_membership_change_requests_state_chk CHECK (
    state IN ('PENDING_CONTROL_PLANE', 'APPROVED', 'REJECTED', 'APPLIED', 'CANCELLED')
  ),
  CONSTRAINT institution_membership_change_requests_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT institution_membership_change_requests_checker_chk CHECK (
    checker_membership_id IS NULL OR checker_membership_id <> maker_membership_id
  ),
  CONSTRAINT institution_membership_change_requests_state_shape_chk CHECK (
    (state = 'PENDING_CONTROL_PLANE' AND checker_membership_id IS NULL AND decided_at IS NULL AND applied_membership_id IS NULL AND applied_at IS NULL)
    OR (state IN ('APPROVED', 'REJECTED') AND checker_membership_id IS NOT NULL AND decided_at IS NOT NULL AND applied_membership_id IS NULL AND applied_at IS NULL)
    OR (state = 'APPLIED' AND checker_membership_id IS NOT NULL AND decided_at IS NOT NULL AND applied_membership_id IS NOT NULL AND applied_at IS NOT NULL)
    OR (state = 'CANCELLED' AND applied_membership_id IS NULL AND applied_at IS NULL)
  )
);
CREATE UNIQUE INDEX institution_membership_change_requests_pending_target_uidx
  ON public.institution_membership_change_requests(tenant_id, relationship_id, target_legacy_user_id)
  WHERE state IN ('PENDING_CONTROL_PLANE', 'APPROVED');

ALTER TABLE public.institution_sla_policies
  ADD CONSTRAINT institution_sla_policies_request_hash_chk
    CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT institution_sla_policies_authorization_fk
    FOREIGN KEY (tenant_id, authorization_receipt_id)
    REFERENCES public.institution_command_authorization_receipts(tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT institution_sla_policies_request_authorization_shape_chk CHECK (
    (request_hash IS NULL AND authorization_receipt_id IS NULL)
    OR (request_hash IS NOT NULL AND authorization_receipt_id IS NOT NULL)
  );

CREATE SCHEMA fas_institution_v1;
REVOKE ALL ON SCHEMA fas_institution_v1 FROM PUBLIC;

CREATE FUNCTION fas_institution_v1.lock_current_mutation_authority(
  p_tenant_id uuid,
  p_relationship_id uuid,
  p_selection_id uuid,
  p_session_generation bigint,
  p_context_id uuid,
  p_actor_principal_id uuid,
  p_actor_membership_id uuid,
  p_actor_legacy_user_id integer,
  p_capability_key text,
  p_required_data_scope text,
  p_policy_version_id uuid,
  p_policy_version bigint,
  p_checked_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
SET row_security TO on
AS $$
DECLARE
  authority_locked boolean := false;
BEGIN
  IF p_tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR p_relationship_id IS DISTINCT FROM NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    OR p_actor_membership_id IS DISTINCT FROM NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    OR p_actor_principal_id IS DISTINCT FROM NULLIF(current_setting('app.institution_principal_id', true), '')::uuid
    OR p_actor_legacy_user_id::text IS DISTINCT FROM NULLIF(current_setting('app.legacy_user_id', true), '')
    OR p_session_generation <= 0
    OR substring(p_context_id::text from 15 for 1) <> '7'
    OR p_required_data_scope !~ '^[a-z][a-z0-9_.:-]{1,95}$'
    OR p_checked_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT true INTO authority_locked
  FROM public.institution_active_context_selections selection
  JOIN public.institution_relationships relationship
    ON relationship.tenant_id = selection.tenant_id
   AND relationship.id = selection.relationship_id
  JOIN public.principals principal
    ON principal.id = selection.principal_id
   AND principal.legacy_user_id = selection.legacy_user_id
  JOIN public.institution_memberships membership
    ON membership.tenant_id = selection.tenant_id
   AND membership.id = selection.membership_id
   AND membership.relationship_id = selection.relationship_id
   AND membership.principal_id = selection.principal_id
   AND membership.legacy_user_id = selection.legacy_user_id
  JOIN public.tenants tenant ON tenant.id = selection.tenant_id
  JOIN public.role_package_versions package ON package.id = membership.role_package_version_id
  JOIN public.role_definitions role_definition ON role_definition.id = package.role_definition_id
  JOIN public.policy_versions policy
    ON policy.tenant_id = selection.tenant_id
   AND policy.id = p_policy_version_id
   AND policy.version_number = p_policy_version
  JOIN public.role_package_capabilities capability_grant
    ON capability_grant.role_package_version_id = package.id
   AND capability_grant.capability_key = p_capability_key
   AND capability_grant.effect = 'ALLOW'
  JOIN public.capability_definitions capability
    ON capability.key = capability_grant.capability_key
  WHERE selection.tenant_id = p_tenant_id
    AND selection.relationship_id = p_relationship_id
    AND selection.id = p_selection_id
    AND selection.session_generation = p_session_generation
    AND selection.principal_id = p_actor_principal_id
    AND selection.membership_id = p_actor_membership_id
    AND selection.legacy_user_id = p_actor_legacy_user_id
    AND selection.status = 'ACTIVE'
    AND selection.impersonator_principal_id IS NULL
    AND selection.issued_at <= p_checked_at
    AND selection.expires_at > p_checked_at
    AND relationship.status = 'ACTIVE'
    AND relationship.purpose_code = 'admissions.review'
    AND relationship.policy_version = p_policy_version
    AND relationship.valid_from <= p_checked_at
    AND (relationship.valid_until IS NULL OR relationship.valid_until > p_checked_at)
    AND p_required_data_scope = ANY(relationship.data_scopes)
    AND principal.principal_type = 'HUMAN'
    AND principal.status = 'ACTIVE'
    AND principal.risk_state = 'NORMAL'
    AND tenant.status = 'ACTIVE'
    AND tenant.policy_version = p_policy_version
    AND membership.status = 'ACTIVE'
    AND membership.valid_from <= p_checked_at
    AND (membership.valid_until IS NULL OR membership.valid_until > p_checked_at)
    AND package.status = 'ACTIVE'
    AND package.effective_at <= p_checked_at
    AND (package.deprecated_at IS NULL OR package.deprecated_at > p_checked_at)
    AND role_definition.status = 'ACTIVE'
    AND role_definition.principal_type = 'HUMAN'
    AND role_definition.key = CASE membership.role_key
      WHEN 'INSTITUTION_ADMIN' THEN 'institution.admin'
      WHEN 'PROGRAM_INTAKE_MANAGER' THEN 'institution.program_intake_manager'
      WHEN 'ADMISSIONS_REVIEWER' THEN 'institution.admissions_reviewer'
      WHEN 'DECISION_APPROVER' THEN 'institution.decision_approver'
      WHEN 'INTEGRATION_ADMIN' THEN 'institution.integration_admin'
      WHEN 'INSTITUTION_AUDITOR' THEN 'institution.auditor'
      ELSE '__invalid__'
    END
    AND policy.state = 'ACTIVE'
    AND policy.effective_at <= p_checked_at
    AND policy.revoked_at IS NULL
    AND capability.status = 'ACTIVE'
  FOR SHARE OF selection,relationship,principal,membership,tenant,package,
    role_definition,policy,capability_grant,capability;

  RETURN coalesce(authority_locked, false);
END;
$$;

REVOKE ALL ON FUNCTION fas_institution_v1.lock_current_mutation_authority(
  uuid,uuid,uuid,bigint,uuid,uuid,uuid,integer,text,text,uuid,bigint,timestamptz
) FROM PUBLIC;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'institution_active_context_selections', 'institution_step_up_receipts',
    'institution_command_authorization_receipts', 'institution_membership_change_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
  END LOOP;
END;
$$;

CREATE POLICY institution_active_context_self_select
  ON public.institution_active_context_selections FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    AND legacy_user_id::text = NULLIF(current_setting('app.legacy_user_id', true), '')
  );
CREATE POLICY institution_step_up_self_select
  ON public.institution_step_up_receipts FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  );
CREATE POLICY institution_step_up_self_consume
  ON public.institution_step_up_receipts FOR UPDATE USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    AND status = 'ACTIVE'
  ) WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    AND status = 'CONSUMED'
  );

-- SELECT ... FOR SHARE also evaluates UPDATE visibility under FORCE RLS.
-- These policies expose only the exact current authority row to the definer
-- lock function while WITH CHECK(false) makes every actual row mutation fail.
CREATE POLICY institution_active_context_authority_lock_update
  ON public.institution_active_context_selections FOR UPDATE USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    AND principal_id = NULLIF(current_setting('app.institution_principal_id', true), '')::uuid
    AND legacy_user_id::text = NULLIF(current_setting('app.legacy_user_id', true), '')
  ) WITH CHECK (false);
CREATE POLICY institution_relationship_authority_lock_update
  ON public.institution_relationships FOR UPDATE USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  ) WITH CHECK (false);
CREATE POLICY institution_membership_authority_lock_update
  ON public.institution_memberships FOR UPDATE USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    AND principal_id = NULLIF(current_setting('app.institution_principal_id', true), '')::uuid
    AND legacy_user_id::text = NULLIF(current_setting('app.legacy_user_id', true), '')
  ) WITH CHECK (false);
CREATE POLICY institution_command_authorization_self_select
  ON public.institution_command_authorization_receipts FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND actor_membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
  );
CREATE POLICY institution_command_authorization_self_insert
  ON public.institution_command_authorization_receipts FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND actor_membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    AND actor_principal_id = NULLIF(current_setting('app.institution_principal_id', true), '')::uuid
    AND decision = 'ALLOW' AND decision_reason = 'allowed'
    AND fas_institution_v1.lock_current_mutation_authority(
      tenant_id,relationship_id,selection_id,session_generation,context_id,
      actor_principal_id,actor_membership_id,
      NULLIF(current_setting('app.legacy_user_id', true), '')::integer,
      capability_key,required_data_scope,policy_version_id,policy_version,now()
    )
    AND EXISTS (
      SELECT 1
      FROM public.institution_memberships m
      JOIN public.role_package_capabilities rpc
        ON rpc.role_package_version_id = m.role_package_version_id
       AND rpc.capability_key = institution_command_authorization_receipts.capability_key
       AND rpc.effect = 'ALLOW'
      JOIN public.capability_definitions cd
        ON cd.key = rpc.capability_key AND cd.status = 'ACTIVE'
      WHERE m.tenant_id = institution_command_authorization_receipts.tenant_id
        AND m.relationship_id = institution_command_authorization_receipts.relationship_id
        AND m.id = institution_command_authorization_receipts.actor_membership_id
        AND m.principal_id = institution_command_authorization_receipts.actor_principal_id
        AND m.status = 'ACTIVE' AND m.valid_from <= now()
        AND (m.valid_until IS NULL OR m.valid_until > now())
        AND (
          NOT cd.step_up_required
          OR EXISTS (
            SELECT 1 FROM public.institution_step_up_receipts su
            WHERE su.tenant_id = institution_command_authorization_receipts.tenant_id
              AND su.relationship_id = institution_command_authorization_receipts.relationship_id
              AND su.id = institution_command_authorization_receipts.step_up_receipt_id
              AND su.principal_id = institution_command_authorization_receipts.actor_principal_id
              AND su.membership_id = institution_command_authorization_receipts.actor_membership_id
              AND su.selection_id = institution_command_authorization_receipts.selection_id
              AND su.session_generation = institution_command_authorization_receipts.session_generation
              AND su.context_id = institution_command_authorization_receipts.context_id
              AND su.capability_key = institution_command_authorization_receipts.capability_key
              AND su.resource_type = institution_command_authorization_receipts.resource_type
              AND su.resource_id = institution_command_authorization_receipts.resource_id
              AND su.request_hash = institution_command_authorization_receipts.request_hash
              AND su.status = 'CONSUMED' AND su.consumed_at IS NOT NULL
          )
        )
    )
  );
CREATE POLICY institution_membership_change_requests_admin_select
  ON public.institution_membership_change_requests FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND NULLIF(current_setting('app.institution_role', true), '') = 'INSTITUTION_ADMIN'
  );
CREATE POLICY institution_membership_change_requests_admin_insert
  ON public.institution_membership_change_requests FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND maker_membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    AND NULLIF(current_setting('app.institution_role', true), '') = 'INSTITUTION_ADMIN'
    AND state = 'PENDING_CONTROL_PLANE'
    AND EXISTS (
      SELECT 1 FROM public.institution_command_authorization_receipts ar
      WHERE ar.tenant_id = institution_membership_change_requests.tenant_id
        AND ar.relationship_id = institution_membership_change_requests.relationship_id
        AND ar.id = institution_membership_change_requests.authorization_receipt_id
        AND ar.actor_membership_id = institution_membership_change_requests.maker_membership_id
        AND ar.capability_key = 'institution.team.request'
        AND ar.required_data_scope = 'relationship.membership'
        AND ar.resource_type = 'institution_membership_request'
        AND ar.resource_id = institution_membership_change_requests.id::text
        AND ar.request_hash = institution_membership_change_requests.request_hash
        AND ar.decision = 'ALLOW'
    )
  );

-- Institution executors may request a grant but cannot create active membership.
DROP POLICY institution_memberships_admin_insert ON public.institution_memberships;

-- Institution executors may draft an SLA request but cannot activate or retire
-- an SLA policy. Control Plane remains the only future apply corridor.
DROP POLICY institution_sla_policies_admin_insert ON public.institution_sla_policies;
CREATE POLICY institution_sla_policies_admin_insert
  ON public.institution_sla_policies FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND relationship_id = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND created_by_membership_id = NULLIF(current_setting('app.institution_membership_id', true), '')::uuid
    AND NULLIF(current_setting('app.institution_role', true), '') = 'INSTITUTION_ADMIN'
    AND status = 'DRAFT'
    AND request_hash IS NOT NULL
    AND authorization_receipt_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.institution_command_authorization_receipts ar
      WHERE ar.tenant_id = institution_sla_policies.tenant_id
        AND ar.relationship_id = institution_sla_policies.relationship_id
        AND ar.id = institution_sla_policies.authorization_receipt_id
        AND ar.actor_membership_id = institution_sla_policies.created_by_membership_id
        AND ar.capability_key = 'institution.sla.request'
        AND ar.required_data_scope = 'partner.operations'
        AND ar.resource_type = 'institution_sla_policy'
        AND ar.resource_id = institution_sla_policies.id::text
        AND ar.request_hash = institution_sla_policies.request_hash
        AND ar.decision = 'ALLOW'
    )
  );
DROP POLICY institution_sla_policies_scoped_update ON public.institution_sla_policies;

CREATE FUNCTION public.guard_institution_active_context_selection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'institution active context selections cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'ACTIVE' OR NEW.status NOT IN ('REVOKED', 'EXPIRED', 'REPLACED')
      OR NEW.terminated_at IS NULL
      OR ROW(NEW.id,NEW.tenant_id,NEW.relationship_id,NEW.membership_id,NEW.principal_id,
        NEW.legacy_user_id,NEW.session_fingerprint,NEW.session_generation,NEW.impersonator_principal_id,
        NEW.issued_at,NEW.expires_at,NEW.created_at)
        IS DISTINCT FROM
        ROW(OLD.id,OLD.tenant_id,OLD.relationship_id,OLD.membership_id,OLD.principal_id,
        OLD.legacy_user_id,OLD.session_fingerprint,OLD.session_generation,OLD.impersonator_principal_id,
        OLD.issued_at,OLD.expires_at,OLD.created_at)
    THEN RAISE EXCEPTION 'institution active context selection transition invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER institution_active_context_selection_guard
  BEFORE UPDATE OR DELETE ON public.institution_active_context_selections
  FOR EACH ROW EXECUTE FUNCTION public.guard_institution_active_context_selection();

CREATE FUNCTION public.guard_institution_step_up_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'institution step-up receipts cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status NOT IN ('CONSUMED', 'REVOKED', 'EXPIRED')
    OR ROW(NEW.id,NEW.tenant_id,NEW.relationship_id,NEW.principal_id,NEW.membership_id,
      NEW.selection_id,NEW.session_generation,NEW.context_id,NEW.capability_key,NEW.resource_type,
      NEW.resource_id,NEW.request_hash,NEW.issuer_reference_hash,NEW.receipt_hash,NEW.issued_at,
      NEW.expires_at,NEW.created_at)
      IS DISTINCT FROM
      ROW(OLD.id,OLD.tenant_id,OLD.relationship_id,OLD.principal_id,OLD.membership_id,
      OLD.selection_id,OLD.session_generation,OLD.context_id,OLD.capability_key,OLD.resource_type,
      OLD.resource_id,OLD.request_hash,OLD.issuer_reference_hash,OLD.receipt_hash,OLD.issued_at,
      OLD.expires_at,OLD.created_at)
  THEN RAISE EXCEPTION 'institution step-up receipt transition invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER institution_step_up_receipt_guard
  BEFORE UPDATE OR DELETE ON public.institution_step_up_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_institution_step_up_receipt();

CREATE TRIGGER institution_command_authorization_append_only
  BEFORE UPDATE OR DELETE ON public.institution_command_authorization_receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_institution_append_only_mutation();
CREATE FUNCTION public.guard_institution_membership_change_request() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'institution membership change requests cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.id,NEW.tenant_id,NEW.relationship_id,NEW.target_principal_id,
    NEW.target_legacy_user_id,NEW.requested_role_package_version_id,NEW.requested_role_key,
    NEW.requested_program_scope_ids,NEW.requested_intake_scopes,NEW.maker_membership_id,
    NEW.request_hash,NEW.authorization_receipt_id,NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.id,OLD.tenant_id,OLD.relationship_id,OLD.target_principal_id,
    OLD.target_legacy_user_id,OLD.requested_role_package_version_id,OLD.requested_role_key,
    OLD.requested_program_scope_ids,OLD.requested_intake_scopes,OLD.maker_membership_id,
    OLD.request_hash,OLD.authorization_receipt_id,OLD.created_at)
    OR NOT (
      (OLD.state = 'PENDING_CONTROL_PLANE' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELLED'))
      OR (OLD.state = 'APPROVED' AND NEW.state = 'APPLIED')
    )
  THEN
    RAISE EXCEPTION 'institution membership change request transition invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER institution_membership_change_request_guard
  BEFORE UPDATE OR DELETE ON public.institution_membership_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_institution_membership_change_request();

COMMENT ON TABLE public.institution_active_context_selections IS
  'Default-unwired external-institution session selection; never an internal staff membership.';
COMMENT ON TABLE public.institution_step_up_receipts IS
  'Single-use MFA/step-up evidence bound to exact context, capability, resource and request hash.';
COMMENT ON TABLE public.institution_membership_change_requests IS
  'Institution-created role grant request only; Control Plane maker-checker applies any membership separately.';
