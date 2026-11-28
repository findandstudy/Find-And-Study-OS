-- Additive, no historic dispatch backfill. Existing v1 configurations retain their legacy corridor.
ALTER TABLE users ADD COLUMN notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE TABLE pipeline_notice_dispatches (
 id bigserial PRIMARY KEY,
 entity_kind text NOT NULL CHECK(entity_kind IN ('lead','student','application','work')),
 entity_id text NOT NULL CHECK(length(entity_id) BETWEEN 1 AND 80),
 tenant_id uuid, board_id uuid,
 stage_key text NOT NULL CHECK(length(stage_key) BETWEEN 1 AND 160),
 channel text NOT NULL CHECK(channel IN ('email','whatsapp')),
 policy jsonb NOT NULL, sender_revision integer,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','enqueued','sent','skipped','failed','unknown')),
 claim_token text, claimed_at timestamptz,
 email_queue_id integer REFERENCES email_queue(id),
 recipient_hash text, context_hash text, error_code text, provider_message_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((entity_kind='work' AND tenant_id IS NOT NULL AND board_id IS NOT NULL) OR (entity_kind<>'work' AND tenant_id IS NULL AND board_id IS NULL)),
 UNIQUE NULLS NOT DISTINCT(entity_kind,entity_id,tenant_id,board_id,stage_key,channel)
);
--> statement-breakpoint
CREATE INDEX pipeline_notice_claim_idx ON pipeline_notice_dispatches(status,id);
--> statement-breakpoint
ALTER TABLE pipeline_notice_dispatches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pipeline_notice_dispatches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_notice_scope ON pipeline_notice_dispatches USING(tenant_id IS NULL OR tenant_id::text=current_setting('app.work_pipeline_tenant',true)) WITH CHECK(tenant_id IS NULL OR tenant_id::text=current_setting('app.work_pipeline_tenant',true));
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON pipeline_notice_dispatches TO fas_app;
--> statement-breakpoint
GRANT USAGE,SELECT ON SEQUENCE pipeline_notice_dispatches_id_seq TO fas_app;
--> statement-breakpoint
CREATE FUNCTION enqueue_pipeline_notice_v2() RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE k text; eid text; sk text; oldsk text; tid uuid; bid uuid; policies jsonb; pol jsonb; ch text;
BEGIN
 IF TG_TABLE_SCHEMA='local_work_pipelines' AND TG_TABLE_NAME='cards' THEN
   k:='work'; eid:=NEW.id::text; sk:=NEW.document->>'stageId'; tid:=NEW.tenant_id; bid:=NEW.board_id;
   IF TG_OP='UPDATE' THEN oldsk:=OLD.document->>'stageId'; END IF;
   SELECT jsonb_build_object('email',st->'automaticEmail','whatsapp',st->'automaticMessage') INTO policies
    FROM local_work_pipelines.boards b CROSS JOIN LATERAL jsonb_array_elements(b.document->'stages') st
    WHERE b.tenant_id=tid AND b.id=bid AND b.document->>'archived'='false' AND st->>'id'=sk LIMIT 1;
 ELSE
   k:=CASE TG_TABLE_NAME WHEN 'leads' THEN 'lead' WHEN 'students' THEN 'student' WHEN 'applications' THEN 'application' ELSE NULL END;
   IF k IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
   eid:=NEW.id::text; sk:=CASE WHEN k='application' THEN to_jsonb(NEW)->>'stage' ELSE to_jsonb(NEW)->>'status' END;
   IF TG_OP='UPDATE' THEN oldsk:=CASE WHEN k='application' THEN to_jsonb(OLD)->>'stage' ELSE to_jsonb(OLD)->>'status' END; END IF;
   SELECT jsonb_build_object('email',automatic_email,'whatsapp',automatic_message) INTO policies FROM pipeline_stages WHERE entity_type=k AND key=sk LIMIT 1;
 END IF;
 IF TG_OP='UPDATE' AND oldsk IS NOT DISTINCT FROM sk THEN RETURN NEW; END IF;
 FOREACH ch IN ARRAY ARRAY['email','whatsapp'] LOOP
   pol:=policies->ch;
   IF pol->'enabled'='true'::jsonb AND pol->>'policyVersion'='2' THEN
     INSERT INTO pipeline_notice_dispatches(entity_kind,entity_id,tenant_id,board_id,stage_key,channel,policy,sender_revision)
       VALUES(k,eid,tid,bid,sk,ch,pol,CASE WHEN ch='email' THEN (SELECT (metadata->'emailSender'->>'revision')::int FROM channel_accounts WHERE id=(pol->>'senderAccountId')::int) ELSE NULL END) ON CONFLICT DO NOTHING;
   END IF;
 END LOOP;
 RETURN NEW;
END $body$;
--> statement-breakpoint
CREATE TRIGGER leads_notice_v2 AFTER INSERT OR UPDATE OF status ON leads FOR EACH ROW EXECUTE FUNCTION enqueue_pipeline_notice_v2();
--> statement-breakpoint
CREATE TRIGGER students_notice_v2 AFTER INSERT OR UPDATE OF status ON students FOR EACH ROW EXECUTE FUNCTION enqueue_pipeline_notice_v2();
--> statement-breakpoint
CREATE TRIGGER applications_notice_v2 AFTER INSERT OR UPDATE OF stage ON applications FOR EACH ROW EXECUTE FUNCTION enqueue_pipeline_notice_v2();
--> statement-breakpoint
CREATE TRIGGER work_cards_notice_v2 AFTER INSERT OR UPDATE OF document ON local_work_pipelines.cards FOR EACH ROW EXECUTE FUNCTION enqueue_pipeline_notice_v2();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_pipeline_stage_automatic_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  configured_message jsonb;
  current_stage text;
  current_entity_type text;
  current_agent_id integer;
  current_origin text;
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    current_entity_type := 'lead';
    current_stage := NEW.status;
    current_agent_id := NEW.agent_id;
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'students' THEN
    current_entity_type := 'student';
    current_stage := NEW.status;
    current_agent_id := NEW.agent_id;
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'applications' THEN
    current_entity_type := 'application';
    current_stage := NEW.stage;
    SELECT s.agent_id INTO current_agent_id FROM students s WHERE s.id = NEW.student_id;
    IF TG_OP = 'UPDATE' AND OLD.stage IS NOT DISTINCT FROM NEW.stage THEN RETURN NEW; END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL OR current_stage IS NULL OR btrim(current_stage) = '' THEN RETURN NEW; END IF;

  IF current_agent_id IS NULL THEN
    current_origin := 'direct';
  ELSIF EXISTS (SELECT 1 FROM agents a WHERE a.id = current_agent_id AND a.parent_agent_id IS NOT NULL) THEN
    current_origin := 'sub_agent';
  ELSE
    current_origin := 'agent';
  END IF;

  SELECT ps.automatic_message INTO configured_message
    FROM pipeline_stages ps
   WHERE ps.entity_type = current_entity_type AND ps.key = current_stage
   LIMIT 1;

  IF configured_message->>'policyVersion'='2' THEN RETURN NEW; END IF;
  IF configured_message IS NULL
     OR COALESCE((configured_message ->> 'enabled')::boolean, false) IS NOT TRUE
     OR COALESCE(configured_message ->> 'templateId', '') !~ '^[1-9][0-9]*$'
     OR COALESCE(configured_message ->> 'channelAccountId', '') !~ '^[1-9][0-9]*$'
     OR NOT COALESCE(configured_message -> 'originTypes', '["direct"]'::jsonb) ? current_origin THEN
    RETURN NEW;
  END IF;

  INSERT INTO pipeline_stage_message_dispatches (
    entity_type, entity_id, stage_key, template_id, channel_account_id,
    status, next_attempt_at, created_at, updated_at
  ) VALUES (
    current_entity_type, NEW.id, current_stage,
    (configured_message ->> 'templateId')::integer,
    (configured_message ->> 'channelAccountId')::integer,
    'queued', now(), now(), now()
  ) ON CONFLICT (entity_type, entity_id, stage_key) DO NOTHING;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_pipeline_stage_automatic_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 config jsonb;
 source_agent integer;
 record_origin text;
 version_id integer;
 sender_id integer;
 sender_revision integer;
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.stage IS NOT DISTINCT FROM NEW.stage THEN RETURN NEW; END IF;
 IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 SELECT automatic_email INTO config FROM pipeline_stages WHERE entity_type = 'application' AND key = NEW.stage;
 IF config->>'policyVersion'='2' THEN RETURN NEW; END IF;
 IF config IS NULL OR config->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN NEW; END IF;
 IF COALESCE(config->>'templateVersionId','') !~ '^[1-9][0-9]{0,8}$' OR
    COALESCE(config->>'senderAccountId','') !~ '^[1-9][0-9]{0,8}$' THEN RETURN NEW; END IF;
 SELECT agent_id INTO source_agent FROM students WHERE id = NEW.student_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN NEW; END IF;
 record_origin := CASE WHEN source_agent IS NULL THEN 'direct'
   WHEN EXISTS (SELECT 1 FROM agents WHERE id = source_agent AND parent_agent_id IS NOT NULL) THEN 'sub_agent'
   ELSE 'agent' END;
 IF NOT COALESCE(config->'originTypes','["direct"]'::jsonb) ? record_origin THEN RETURN NEW; END IF;
 version_id := (config->>'templateVersionId')::integer;
 sender_id := (config->>'senderAccountId')::integer;
 -- Fail closed for withdrawn approval/config; never call providers in a CRM transaction.
 IF NOT EXISTS (SELECT 1 FROM message_template_email_versions v JOIN message_templates t ON t.id = v.template_id
   WHERE v.id = version_id AND v.status = 'approved' AND t.is_active AND t.channel IN ('email','all')) THEN RETURN NEW; END IF;
 SELECT (metadata->'emailSender'->>'revision')::integer INTO sender_revision FROM channel_accounts
   WHERE id = sender_id AND channel = 'email' AND provider = 'smtp' AND is_active
     AND metadata->'emailSender'->'verified' = 'true'::jsonb
     AND COALESCE(metadata->'emailSender'->>'revision','') ~ '^[1-9][0-9]{0,8}$';
 IF sender_revision IS NULL THEN RETURN NEW; END IF;
 INSERT INTO pipeline_stage_email_dispatches(application_id,student_id,agent_id,stage_key,template_version_id,
   sender_account_id,sender_revision,origin) VALUES(NEW.id,NEW.student_id,source_agent,NEW.stage,version_id,sender_id,sender_revision,record_origin)
   ON CONFLICT (application_id,stage_key) DO NOTHING;
 RETURN NEW;
END $$;
