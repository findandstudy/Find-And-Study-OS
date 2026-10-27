-- Persona workspace adoption: isolated staging mock runtime, no live providers.
-- Promotes the six reviewed prepared-schema phases without importing Pages migrations.
-- No seeds, grants or legacy ownership inference. Provisioning is a separate audited step.

-- Source: persona_phase1_scoped_mock.sql
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

--> statement-breakpoint

-- Source: persona_phase2_team_drafts.sql
-- Prepared only. Applied AFTER phase1 solely in disposable tests. No grants/seeds.
-- A team configuration draft belongs to a project, not an already-created
-- persona. Keep its immutable content and human review in this local aggregate;
-- the first team therefore needs no fabricated legacy persona/queue ownership.
CREATE TABLE ai_persona_team_drafts (
  action_id serial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document jsonb NOT NULL CHECK(octet_length(document::text)<=65536),
  digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
  maker uuid NOT NULL REFERENCES principals(id),
  reviewer uuid REFERENCES principals(id) CHECK(reviewer<>maker),
  reviewed_at timestamptz,
  CHECK((reviewer IS NULL)=(reviewed_at IS NULL)),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,organization_id,project_id) REFERENCES ai_persona_projects(tenant_id,organization_id,id)
);
ALTER TABLE ai_persona_team_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_persona_team_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY persona_team_scope ON ai_persona_team_drafts USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND
 project_id=nullif(current_setting('app.persona_project_id',true),'')::uuid
) WITH CHECK (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND
 project_id=nullif(current_setting('app.persona_project_id',true),'')::uuid
);
CREATE FUNCTION ai_persona_team_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'persona_team_immutable'; END IF;
 IF (to_jsonb(OLD)-'reviewer'-'reviewed_at') IS DISTINCT FROM (to_jsonb(NEW)-'reviewer'-'reviewed_at')
 OR OLD.reviewer IS NOT NULL THEN RAISE EXCEPTION 'persona_team_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER persona_team_guard BEFORE UPDATE OR DELETE ON ai_persona_team_drafts FOR EACH ROW EXECUTE FUNCTION ai_persona_team_immutable();
REVOKE ALL ON ai_persona_team_drafts FROM PUBLIC;
REVOKE ALL ON SEQUENCE ai_persona_team_drafts_action_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_persona_team_immutable() FROM PUBLIC;

--> statement-breakpoint

-- Source: persona_phase2_team_instances.sql
-- PREPARED ONLY. No activation, grants, seeds or legacy adoption.
ALTER TABLE ai_persona_team_drafts ADD CONSTRAINT persona_team_draft_scope_uq UNIQUE(tenant_id,organization_id,project_id,action_id);
CREATE TABLE ai_persona_team_instances (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 draft_id integer NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'PAUSED' CHECK(status IN ('PAUSED','MOCK_READY')),
 created_by uuid NOT NULL REFERENCES principals(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,organization_id,project_id,id),
 FOREIGN KEY(tenant_id,organization_id,project_id,draft_id) REFERENCES ai_persona_team_drafts(tenant_id,organization_id,project_id,action_id)
);
CREATE TABLE ai_persona_team_members (
 tenant_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 team_id uuid NOT NULL,
 member_key text NOT NULL,
 parent_key text,
 persona_id integer NOT NULL UNIQUE,
 PRIMARY KEY(team_id,member_key),
 FOREIGN KEY(team_id,parent_key) REFERENCES ai_persona_team_members(team_id,member_key),
 FOREIGN KEY(tenant_id,organization_id,project_id,team_id) REFERENCES ai_persona_team_instances(tenant_id,organization_id,project_id,id),
 FOREIGN KEY(tenant_id,organization_id,project_id,persona_id) REFERENCES ai_persona_ownership(tenant_id,organization_id,project_id,persona_id)
);
CREATE FUNCTION ai_persona_team_instance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='ai_persona_team_members' THEN RAISE EXCEPTION 'persona_team_binding_immutable'; END IF;
 IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'persona_team_binding_immutable'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ai_persona_team_instances','ai_persona_team_members'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY persona_team_instance_scope ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid AND project_id=nullif(current_setting(''app.persona_project_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid AND project_id=nullif(current_setting(''app.persona_project_id'',true),'''')::uuid)',t);
 EXECUTE format('CREATE TRIGGER persona_team_binding_guard BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_persona_team_instance_guard()',t);
 END LOOP;
END $$;
REVOKE ALL ON ai_persona_team_instances,ai_persona_team_members FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_persona_team_instance_guard() FROM PUBLIC;

--> statement-breakpoint

-- Source: persona_phase3_workflow.sql
CREATE TABLE ai_persona_workflows (
 action_id integer PRIMARY KEY REFERENCES ai_action_queue(id),
 tenant_id uuid NOT NULL,organization_id uuid NOT NULL,project_id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 100),
 document jsonb NOT NULL CHECK(octet_length(document::text)<=32768), digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 maker uuid NOT NULL REFERENCES principals(id),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','CANCELLED')),
 UNIQUE(project_id,request_key),UNIQUE(tenant_id,organization_id,project_id,action_id),
 FOREIGN KEY(tenant_id,organization_id,project_id) REFERENCES ai_persona_projects(tenant_id,organization_id,id)
);
CREATE TABLE ai_persona_workflow_nodes (
 tenant_id uuid NOT NULL,organization_id uuid NOT NULL,project_id uuid NOT NULL,
 workflow_id integer NOT NULL,node_key text NOT NULL,approval_id integer NOT NULL UNIQUE,
 PRIMARY KEY(workflow_id,node_key),
 FOREIGN KEY(tenant_id,organization_id,project_id,workflow_id) REFERENCES ai_persona_workflows(tenant_id,organization_id,project_id,action_id),
 FOREIGN KEY(tenant_id,organization_id,project_id,approval_id) REFERENCES ai_persona_approval_bindings(tenant_id,organization_id,project_id,action_id)
);
CREATE FUNCTION ai_persona_workflow_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='ai_persona_workflow_nodes' THEN RAISE EXCEPTION 'persona_workflow_immutable'; END IF;
 IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR OLD.state='CANCELLED' THEN RAISE EXCEPTION 'persona_workflow_immutable'; END IF;RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ai_persona_workflows','ai_persona_workflow_nodes'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY persona_workflow_scope ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid AND project_id=nullif(current_setting(''app.persona_project_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid AND project_id=nullif(current_setting(''app.persona_project_id'',true),'''')::uuid)',t);
 EXECUTE format('CREATE TRIGGER persona_workflow_guard BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_persona_workflow_guard()',t);
 END LOOP;
END $$;
REVOKE ALL ON ai_persona_workflows,ai_persona_workflow_nodes FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_persona_workflow_guard() FROM PUBLIC;
CREATE TABLE ai_persona_workflow_reviews (
 tenant_id uuid NOT NULL,organization_id uuid NOT NULL,project_id uuid NOT NULL,
 workflow_id integer PRIMARY KEY,result_digest text NOT NULL CHECK(result_digest ~ '^[a-f0-9]{64}$'),
 reviewer uuid NOT NULL REFERENCES principals(id),reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,organization_id,project_id,workflow_id) REFERENCES ai_persona_workflows(tenant_id,organization_id,project_id,action_id)
);
ALTER TABLE ai_persona_workflow_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_persona_workflow_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY persona_review_scope ON ai_persona_workflow_reviews USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND project_id=nullif(current_setting('app.persona_project_id',true),'')::uuid
) WITH CHECK (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND project_id=nullif(current_setting('app.persona_project_id',true),'')::uuid
);
CREATE FUNCTION ai_persona_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'persona_review_immutable'; END $$;
CREATE TRIGGER persona_review_immutable BEFORE UPDATE OR DELETE ON ai_persona_workflow_reviews FOR EACH ROW EXECUTE FUNCTION ai_persona_review_immutable();
REVOKE ALL ON ai_persona_workflow_reviews FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_persona_review_immutable() FROM PUBLIC;

--> statement-breakpoint

-- Source: persona_phase4_conversation.sql
-- PREPARED ONLY. Scope/evidence for existing ai_persona_messages; no old-row adoption.
CREATE TABLE ai_persona_message_scope (
 message_id integer PRIMARY KEY REFERENCES ai_persona_messages(id),
 tenant_id uuid NOT NULL,organization_id uuid NOT NULL,project_id uuid NOT NULL,
 persona_id integer NOT NULL,conversation_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),actor uuid NOT NULL REFERENCES principals(id),
 source text NOT NULL CHECK(source IN ('text','confirmed_voice','document_note')),
 source_label text NOT NULL CHECK(length(source_label) BETWEEN 1 AND 200),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 purged_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days'),
 UNIQUE(project_id,conversation_id,version),
 FOREIGN KEY(tenant_id,organization_id,project_id,persona_id) REFERENCES ai_persona_ownership(tenant_id,organization_id,project_id,persona_id)
);
ALTER TABLE ai_persona_message_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_persona_message_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY persona_message_scope ON ai_persona_message_scope USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND project_id=nullif(current_setting('app.persona_project_id',true),'')::uuid
) WITH CHECK (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND project_id=nullif(current_setting('app.persona_project_id',true),'')::uuid
);
CREATE FUNCTION ai_persona_message_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(OLD)-'purged_at'-'source_label') IS DISTINCT FROM (to_jsonb(NEW)-'purged_at'-'source_label') OR OLD.purged_at IS NOT NULL OR NEW.purged_at IS NULL OR NEW.source_label<>'[expired]' OR OLD.expires_at>now() THEN RAISE EXCEPTION 'persona_message_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER persona_message_immutable BEFORE UPDATE OR DELETE ON ai_persona_message_scope FOR EACH ROW EXECUTE FUNCTION ai_persona_message_scope_guard();
REVOKE ALL ON ai_persona_message_scope FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_persona_message_scope_guard() FROM PUBLIC;

--> statement-breakpoint

-- Source: persona_phase5_team_workspace.sql
-- PREPARED ONLY. Apply solely to an explicitly disposable local mock database.
-- No seeds/grants, legacy ownership inference, approval or runtime activation.
-- The mutable workspace is actor-private editing state, never execution evidence.
CREATE TABLE ai_persona_team_workspaces (
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor uuid NOT NULL REFERENCES principals(id),
  revision integer NOT NULL CHECK(revision > 0),
  document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=32768),
  layout jsonb NOT NULL CHECK(jsonb_typeof(layout)='object' AND octet_length(layout::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,actor),
  FOREIGN KEY(tenant_id,organization_id,project_id) REFERENCES ai_persona_projects(tenant_id,organization_id,id)
);
ALTER TABLE ai_persona_team_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_persona_team_workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY persona_workspace_scope ON ai_persona_team_workspaces USING (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
  organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND
  project_id=nullif(current_setting('app.persona_project_id',true),'')::uuid AND
  actor=nullif(current_setting('app.persona_actor_id',true),'')::uuid
) WITH CHECK (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
  organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND
  project_id=nullif(current_setting('app.persona_project_id',true),'')::uuid AND
  actor=nullif(current_setting('app.persona_actor_id',true),'')::uuid
);
CREATE FUNCTION ai_persona_workspace_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'persona_workspace_delete_denied'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 THEN RAISE EXCEPTION 'persona_workspace_revision_invalid'; END IF;
    NEW.created_at:=clock_timestamp();
  ELSE
    IF (to_jsonb(OLD)-'document'-'layout'-'revision'-'updated_at') IS DISTINCT FROM
       (to_jsonb(NEW)-'document'-'layout'-'revision'-'updated_at')
       OR NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'persona_workspace_revision_invalid';
    END IF;
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER persona_workspace_guard BEFORE INSERT OR UPDATE OR DELETE ON ai_persona_team_workspaces
FOR EACH ROW EXECUTE FUNCTION ai_persona_workspace_guard();
REVOKE ALL ON ai_persona_team_workspaces FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_persona_workspace_guard() FROM PUBLIC;
