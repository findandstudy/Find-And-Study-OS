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
