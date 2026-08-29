-- Additive, default-unwired receipt-only repair queue for selection consumption.
-- No login role, scheduler registration, runtime bootstrap or grant is created.

CREATE TABLE public.active_context_selection_consumption_repair_jobs (
  tenant_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  status text DEFAULT 'PENDING' NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 5 NOT NULL,
  available_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
  lease_token_hash text,
  leased_at timestamp with time zone,
  lease_expires_at timestamp with time zone,
  resolution text,
  last_error_code text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
  updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
  PRIMARY KEY (tenant_id, attempt_id),
  CONSTRAINT active_context_selection_consumption_repair_attempt_fk
    FOREIGN KEY (tenant_id, attempt_id)
    REFERENCES public.active_context_selection_consumption_attempts(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT active_context_selection_consumption_repair_status_chk
    CHECK (status IN ('PENDING', 'LEASED', 'RESOLVED', 'ESCALATED')),
  CONSTRAINT active_context_selection_consumption_repair_attempts_chk
    CHECK (
      attempt_count BETWEEN 0 AND 12
      AND max_attempts BETWEEN 1 AND 12
      AND attempt_count <= max_attempts
    ),
  CONSTRAINT active_context_selection_consumption_repair_lease_chk
    CHECK (
      (
        status = 'LEASED'
        AND lease_token_hash ~ '^[0-9a-f]{64}$'
        AND leased_at IS NOT NULL
        AND lease_expires_at > leased_at
      )
      OR (
        status <> 'LEASED'
        AND lease_token_hash IS NULL
        AND leased_at IS NULL
        AND lease_expires_at IS NULL
      )
    ),
  CONSTRAINT active_context_selection_consumption_repair_resolution_chk
    CHECK (
      (
        status IN ('PENDING', 'LEASED')
        AND resolution IS NULL
        AND resolved_at IS NULL
      )
      OR (
        status = 'RESOLVED'
        AND resolution = 'RECEIPT_CONFIRMED'
        AND last_error_code IS NULL
        AND resolved_at IS NOT NULL
      )
      OR (
        status = 'ESCALATED'
        AND resolution IN ('NO_RECEIPT', 'INCOMPLETE_RECEIPT', 'INVALID_RECEIPT')
        AND last_error_code IN ('OUTCOME_NOT_FOUND', 'OUTCOME_IN_PROGRESS', 'OUTCOME_INVALID')
        AND resolved_at IS NOT NULL
      )
    ),
  CONSTRAINT active_context_selection_consumption_repair_error_chk
    CHECK (
      last_error_code IS NULL
      OR last_error_code IN ('OUTCOME_NOT_FOUND', 'OUTCOME_IN_PROGRESS', 'OUTCOME_INVALID')
    )
);

CREATE INDEX active_context_selection_consumption_repair_due_idx
  ON public.active_context_selection_consumption_repair_jobs
  (tenant_id, status, available_at, created_at);

ALTER TABLE public.active_context_selection_consumption_repair_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_context_selection_consumption_repair_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY active_context_selection_consumption_repair_select
  ON public.active_context_selection_consumption_repair_jobs FOR SELECT
  USING (
    current_user = 'fas_session_repair_owner'
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY active_context_selection_consumption_repair_owner
  ON public.active_context_selection_consumption_repair_jobs FOR ALL
  USING (current_user = 'fas_session_repair_owner')
  WITH CHECK (current_user = 'fas_session_repair_owner');

CREATE FUNCTION public.schedule_active_context_selection_consumption_repair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.phase = 'RECONCILIATION'
    AND NEW.outcome = 'PENDING'
    AND NEW.reason_code = 'COMMIT_OUTCOME_UNKNOWN'
  THEN
    INSERT INTO public.active_context_selection_consumption_repair_jobs (
      tenant_id, attempt_id
    ) VALUES (NEW.tenant_id, NEW.attempt_id)
    ON CONFLICT (tenant_id, attempt_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER active_context_selection_consumption_schedule_repair
AFTER INSERT ON public.active_context_selection_consumption_attempt_receipts
FOR EACH ROW EXECUTE FUNCTION public.schedule_active_context_selection_consumption_repair();

CREATE SCHEMA fas_session_repair_v1;
REVOKE ALL ON SCHEMA fas_session_repair_v1 FROM PUBLIC;

CREATE FUNCTION fas_session_repair_v1.assert_tenant(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_tenant IS NULL
    OR NULLIF(current_setting('app.tenant_id', true), '')::uuid IS DISTINCT FROM p_tenant
  THEN
    RAISE EXCEPTION 'selection consumption repair tenant context mismatch'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION fas_session_repair_v1.claim_due_attempt(
  p_tenant uuid,
  p_lease_token_hash text,
  p_lease_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job_row public.active_context_selection_consumption_repair_jobs%ROWTYPE;
  attempt_row public.active_context_selection_consumption_attempts%ROWTYPE;
BEGIN
  PERFORM fas_session_repair_v1.assert_tenant(p_tenant);
  IF p_lease_token_hash IS NULL
    OR p_lease_token_hash !~ '^[0-9a-f]{64}$'
    OR p_lease_seconds NOT BETWEEN 30 AND 300
  THEN
    RAISE EXCEPTION 'invalid selection consumption repair lease request';
  END IF;

  SELECT job.* INTO job_row
  FROM public.active_context_selection_consumption_repair_jobs job
  JOIN public.active_context_selection_consumption_attempts attempt
    ON attempt.tenant_id = job.tenant_id
   AND attempt.id = job.attempt_id
  WHERE job.tenant_id = p_tenant
    AND attempt.status = 'PENDING'
    AND (
      (job.status = 'PENDING' AND job.available_at <= statement_timestamp())
      OR (job.status = 'LEASED' AND job.lease_expires_at <= statement_timestamp())
    )
    AND job.attempt_count < job.max_attempts
  ORDER BY job.available_at, job.created_at, job.attempt_id
  LIMIT 1
  FOR UPDATE OF job SKIP LOCKED;

  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.active_context_selection_consumption_repair_jobs
  SET status = 'LEASED',
      attempt_count = attempt_count + 1,
      lease_token_hash = p_lease_token_hash,
      leased_at = statement_timestamp(),
      lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = statement_timestamp()
  WHERE tenant_id = job_row.tenant_id AND attempt_id = job_row.attempt_id
  RETURNING * INTO job_row;

  SELECT * INTO STRICT attempt_row
  FROM public.active_context_selection_consumption_attempts
  WHERE tenant_id = job_row.tenant_id AND id = job_row.attempt_id;

  RETURN jsonb_build_object(
    'attemptId', attempt_row.id,
    'tenantId', attempt_row.tenant_id,
    'contextId', attempt_row.context_id,
    'selectionId', attempt_row.selection_id,
    'sessionGeneration', attempt_row.session_generation,
    'principalId', attempt_row.principal_id,
    'membershipId', attempt_row.membership_id,
    'idempotencyKeyHash', attempt_row.idempotency_key_hash,
    'requestHash', attempt_row.request_hash,
    'environmentId', attempt_row.environment_id,
    'cellId', attempt_row.cell_id,
    'outcomeSource', attempt_row.outcome_source,
    'status', attempt_row.status,
    'attemptCount', job_row.attempt_count,
    'maxAttempts', job_row.max_attempts
  );
END;
$$;

CREATE FUNCTION fas_session_repair_v1.load_selection_command_outcome(
  p_tenant uuid,
  p_attempt uuid,
  p_lease_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job_row public.active_context_selection_consumption_repair_jobs%ROWTYPE;
  attempt_row public.active_context_selection_consumption_attempts%ROWTYPE;
  selection_row public.active_session_context_selections%ROWTYPE;
  receipt_row public.active_session_context_selection_command_receipts%ROWTYPE;
BEGIN
  PERFORM fas_session_repair_v1.assert_tenant(p_tenant);
  SELECT * INTO job_row
  FROM public.active_context_selection_consumption_repair_jobs job
  WHERE job.tenant_id = p_tenant AND job.attempt_id = p_attempt
  FOR UPDATE;
  IF NOT FOUND
    OR job_row.status <> 'LEASED'
    OR job_row.lease_token_hash IS DISTINCT FROM p_lease_token_hash
    OR job_row.lease_expires_at <= statement_timestamp()
  THEN
    RAISE EXCEPTION 'selection consumption repair lease is not active';
  END IF;

  SELECT * INTO STRICT attempt_row
  FROM public.active_context_selection_consumption_attempts
  WHERE tenant_id = p_tenant AND id = p_attempt;
  SELECT * INTO STRICT selection_row
  FROM public.active_session_context_selections
  WHERE tenant_id = p_tenant AND id = attempt_row.selection_id;

  SELECT * INTO receipt_row
  FROM public.active_session_context_selection_command_receipts receipt
  WHERE receipt.session_fingerprint = selection_row.session_fingerprint
    AND receipt.idempotency_key_hash = attempt_row.idempotency_key_hash;

  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'NOT_FOUND'); END IF;
  IF attempt_row.outcome_source <> 'ACTIVE_SESSION_SELECTION_COMMAND_RECEIPT_V1'
    OR receipt_row.tenant_id IS DISTINCT FROM attempt_row.tenant_id
    OR receipt_row.actor_principal_id IS DISTINCT FROM attempt_row.principal_id
    OR receipt_row.actor_membership_id IS DISTINCT FROM attempt_row.membership_id
    OR receipt_row.expected_selection_id IS DISTINCT FROM attempt_row.selection_id
    OR receipt_row.expected_generation IS DISTINCT FROM attempt_row.session_generation
    OR receipt_row.request_hash IS DISTINCT FROM attempt_row.request_hash
    OR receipt_row.environment_id IS DISTINCT FROM attempt_row.environment_id
    OR receipt_row.cell_id IS DISTINCT FROM attempt_row.cell_id
    OR receipt_row.result_hash !~ '^[0-9a-f]{64}$'
  THEN
    RETURN jsonb_build_object('state', 'INVALID');
  END IF;
  RETURN jsonb_build_object('state', 'COMPLETED', 'resultHash', receipt_row.result_hash);
END;
$$;

CREATE FUNCTION fas_session_repair_v1.reschedule_attempt(
  p_tenant uuid,
  p_attempt uuid,
  p_lease_token_hash text,
  p_delay_seconds integer,
  p_error_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM fas_session_repair_v1.assert_tenant(p_tenant);
  IF p_delay_seconds NOT BETWEEN 1 AND 3600
    OR p_error_code NOT IN ('OUTCOME_NOT_FOUND', 'OUTCOME_IN_PROGRESS')
  THEN
    RAISE EXCEPTION 'invalid selection consumption repair retry request';
  END IF;
  UPDATE public.active_context_selection_consumption_repair_jobs job
  SET status = 'PENDING', available_at = statement_timestamp() + make_interval(secs => p_delay_seconds),
      lease_token_hash = NULL, leased_at = NULL, lease_expires_at = NULL,
      last_error_code = p_error_code, updated_at = statement_timestamp()
  WHERE job.tenant_id = p_tenant AND job.attempt_id = p_attempt
    AND job.status = 'LEASED' AND job.lease_token_hash = p_lease_token_hash
    AND job.lease_expires_at > statement_timestamp()
    AND job.attempt_count < job.max_attempts;
  IF NOT FOUND THEN RAISE EXCEPTION 'selection consumption repair retry lease is not active'; END IF;
END;
$$;

CREATE FUNCTION fas_session_repair_v1.complete_attempt(
  p_tenant uuid,
  p_attempt uuid,
  p_lease_token_hash text,
  p_status text,
  p_resolution text,
  p_error_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  attempt_row public.active_context_selection_consumption_attempts%ROWTYPE;
BEGIN
  PERFORM fas_session_repair_v1.assert_tenant(p_tenant);
  IF NOT (
    (p_status = 'RESOLVED' AND p_resolution = 'RECEIPT_CONFIRMED' AND p_error_code IS NULL)
    OR (
      p_status = 'ESCALATED'
      AND p_resolution IN ('NO_RECEIPT', 'INCOMPLETE_RECEIPT', 'INVALID_RECEIPT')
      AND p_error_code IN ('OUTCOME_NOT_FOUND', 'OUTCOME_IN_PROGRESS', 'OUTCOME_INVALID')
    )
  ) THEN
    RAISE EXCEPTION 'invalid selection consumption repair completion';
  END IF;

  SELECT * INTO STRICT attempt_row
  FROM public.active_context_selection_consumption_attempts
  WHERE tenant_id = p_tenant AND id = p_attempt;
  IF attempt_row.status <> 'TERMINAL'
    OR (
      p_status = 'RESOLVED'
      AND (
        attempt_row.outcome <> 'COMPLETED'
        OR attempt_row.reason_code <> 'COMMAND_RECONCILED'
      )
    )
    OR (
      p_status = 'ESCALATED'
      AND attempt_row.outcome NOT IN ('CONFLICT', 'ERROR')
    )
  THEN
    RAISE EXCEPTION 'selection consumption repair attempt is not terminal';
  END IF;

  UPDATE public.active_context_selection_consumption_repair_jobs job
  SET status = p_status, resolution = p_resolution, last_error_code = p_error_code,
      lease_token_hash = NULL, leased_at = NULL, lease_expires_at = NULL,
      resolved_at = statement_timestamp(), updated_at = statement_timestamp()
  WHERE job.tenant_id = p_tenant AND job.attempt_id = p_attempt
    AND job.status = 'LEASED' AND job.lease_token_hash = p_lease_token_hash
    AND job.lease_expires_at > statement_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'selection consumption repair completion lease is not active'; END IF;
END;
$$;

REVOKE ALL ON TABLE public.active_context_selection_consumption_repair_jobs FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_active_context_selection_consumption_repair() FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fas_session_repair_v1 FROM PUBLIC;

COMMENT ON TABLE public.active_context_selection_consumption_repair_jobs IS
  'Default-unwired bounded lease queue for receipt-only selection-consumption repair.';
