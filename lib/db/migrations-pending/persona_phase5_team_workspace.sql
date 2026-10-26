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
