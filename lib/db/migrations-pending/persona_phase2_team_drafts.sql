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
