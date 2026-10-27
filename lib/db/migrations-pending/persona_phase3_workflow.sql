-- PREPARED ONLY: scoped dependency metadata around existing queue/approval/run.
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
