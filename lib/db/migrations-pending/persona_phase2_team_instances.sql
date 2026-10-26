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
