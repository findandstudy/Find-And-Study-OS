-- PREPARED ONLY: intentionally absent from Drizzle journal / automatic startup.
-- No seeds, grants, ownership inference, provider activation or legacy backfill.
CREATE TABLE ai_persona_projects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  organization_id uuid NOT NULL,
  label text NOT NULL,
  cap_micros bigint CHECK (cap_micros > 0),
  mock_bound_micros bigint CHECK (mock_bound_micros > 0),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK (period_end > period_start),
  costs_verified boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, organization_id, id),
  FOREIGN KEY (tenant_id,organization_id) REFERENCES organizations(tenant_id,id)
);
-- Narrows existing assignments to project resources; creates NO new grants.
CREATE TABLE ai_persona_project_assignments (
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  PRIMARY KEY(project_id,assignment_id),
  FOREIGN KEY(tenant_id,organization_id,project_id) REFERENCES ai_persona_projects(tenant_id,organization_id,id),
  FOREIGN KEY(tenant_id,assignment_id) REFERENCES access_assignments(tenant_id,id)
);
CREATE TABLE ai_persona_ownership (
  persona_id integer PRIMARY KEY REFERENCES ai_personas(id),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  cap_micros bigint CHECK (cap_micros > 0),
  active boolean NOT NULL DEFAULT false,
  evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 256),
  maker uuid NOT NULL REFERENCES principals(id),
  checker uuid NOT NULL REFERENCES principals(id) CHECK(checker <> maker),
  bound_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,organization_id,project_id,persona_id),
  FOREIGN KEY(tenant_id,organization_id,project_id) REFERENCES ai_persona_projects(tenant_id,organization_id,id)
);
CREATE TABLE ai_persona_approval_bindings (
  action_id integer PRIMARY KEY REFERENCES ai_action_queue(id),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  persona_id integer NOT NULL,
  intent jsonb NOT NULL,
  digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
  config_digest text NOT NULL CHECK(config_digest ~ '^[a-f0-9]{64}$'),
  maker uuid NOT NULL REFERENCES principals(id),
  reviewer uuid REFERENCES principals(id) CHECK(reviewer <> maker),
  reviewed_at timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_by uuid UNIQUE,
  CHECK ((reviewer IS NULL) = (reviewed_at IS NULL)),
  CHECK (consumed_by IS NULL OR reviewer IS NOT NULL),
  UNIQUE(tenant_id,organization_id,project_id,action_id),
  UNIQUE(tenant_id,organization_id,project_id,action_id,persona_id),
  FOREIGN KEY(tenant_id,organization_id,project_id,persona_id) REFERENCES ai_persona_ownership(tenant_id,organization_id,project_id,persona_id)
);
CREATE TABLE ai_persona_executions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  persona_id integer NOT NULL,
  approval_id integer NOT NULL UNIQUE,
  run_id integer NOT NULL UNIQUE REFERENCES ai_persona_runs(id),
  actor uuid NOT NULL REFERENCES principals(id),
  reserved_micros bigint NOT NULL CHECK(reserved_micros > 0),
  actual_micros bigint CHECK(actual_micros BETWEEN 0 AND reserved_micros),
  state text NOT NULL CHECK(state IN ('RESERVED','DISPATCHED','UNCERTAIN','SUCCEEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,organization_id,project_id,id),
  UNIQUE(tenant_id,organization_id,project_id,approval_id,id),
  CHECK ((state='SUCCEEDED') = (actual_micros IS NOT NULL)),
  FOREIGN KEY(tenant_id,organization_id,project_id,approval_id,persona_id) REFERENCES ai_persona_approval_bindings(tenant_id,organization_id,project_id,action_id,persona_id),
  FOREIGN KEY(tenant_id,organization_id,project_id,persona_id) REFERENCES ai_persona_ownership(tenant_id,organization_id,project_id,persona_id)
);
ALTER TABLE ai_persona_approval_bindings ADD CONSTRAINT persona_consumed_execution_fk
  FOREIGN KEY(tenant_id,organization_id,project_id,action_id,consumed_by) REFERENCES ai_persona_executions(tenant_id,organization_id,project_id,approval_id,id);
-- Synthetic provider evidence, never accepts a client-authored completion receipt.
CREATE TABLE ai_persona_mock_receipts (
  execution_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  digest text NOT NULL,
  output text NOT NULL,
  actual_micros bigint NOT NULL CHECK(actual_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,organization_id,project_id,execution_id) REFERENCES ai_persona_executions(tenant_id,organization_id,project_id,id)
);
CREATE INDEX persona_execution_budget_idx ON ai_persona_executions(project_id,persona_id,created_at);
CREATE FUNCTION ai_persona_phase1_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'persona_evidence_immutable'; END IF;
  IF TG_TABLE_NAME IN ('ai_persona_mock_receipts','ai_persona_ownership') THEN RAISE EXCEPTION 'persona_evidence_immutable'; END IF;
  IF TG_TABLE_NAME='ai_persona_approval_bindings' THEN
    IF (to_jsonb(OLD)-'reviewer'-'reviewed_at'-'consumed_by') IS DISTINCT FROM (to_jsonb(NEW)-'reviewer'-'reviewed_at'-'consumed_by')
      OR (OLD.reviewer IS NOT NULL AND OLD.reviewer IS DISTINCT FROM NEW.reviewer)
      OR (OLD.reviewed_at IS NOT NULL AND OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at)
      OR (OLD.consumed_by IS NOT NULL AND OLD.consumed_by IS DISTINCT FROM NEW.consumed_by)
      THEN RAISE EXCEPTION 'persona_approval_immutable'; END IF;
  ELSIF TG_TABLE_NAME='ai_persona_executions' THEN
    IF (to_jsonb(OLD)-'state'-'actual_micros') IS DISTINCT FROM (to_jsonb(NEW)-'state'-'actual_micros')
      OR OLD.state='SUCCEEDED'
      OR (NEW.state='DISPATCHED' AND OLD.state<>'RESERVED')
      OR (NEW.state='SUCCEEDED' AND (OLD.state NOT IN ('DISPATCHED','UNCERTAIN') OR NEW.actual_micros IS NULL))
      OR (NEW.state<>'SUCCEEDED' AND NEW.actual_micros IS NOT NULL)
      OR NEW.state='RESERVED' THEN RAISE EXCEPTION 'persona_execution_transition_invalid'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_persona_projects','ai_persona_project_assignments','ai_persona_ownership','ai_persona_approval_bindings','ai_persona_executions','ai_persona_mock_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY persona_scoped ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid AND %I = nullif(current_setting(''app.persona_project_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid AND %I = nullif(current_setting(''app.persona_project_id'',true),'''')::uuid)',t, CASE WHEN t='ai_persona_projects' THEN 'id' ELSE 'project_id' END, CASE WHEN t='ai_persona_projects' THEN 'id' ELSE 'project_id' END);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ai_persona_ownership','ai_persona_approval_bindings','ai_persona_executions','ai_persona_mock_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER persona_evidence_guard BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_persona_phase1_immutable()',t);
  END LOOP;
END $$;
REVOKE ALL ON ai_persona_projects,ai_persona_project_assignments,ai_persona_ownership,ai_persona_approval_bindings,ai_persona_executions,ai_persona_mock_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_persona_phase1_immutable() FROM PUBLIC;
