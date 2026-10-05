-- Additive: no historic mail/config backfill and no modification of the WhatsApp outbox.
ALTER TABLE pipeline_stages ADD COLUMN automatic_email jsonb;
--> statement-breakpoint
CREATE TABLE message_template_email_versions (
 id serial PRIMARY KEY,
 template_id integer NOT NULL REFERENCES message_templates(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK (version > 0),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','retired')),
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 500),
 content text NOT NULL CHECK (length(content) BETWEEN 1 AND 100000),
 language text NOT NULL,
 variables jsonb NOT NULL DEFAULT '[]',
 created_by_id integer NOT NULL,
 approved_by_id integer,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (approved_by_id IS NULL OR approved_by_id <> created_by_id),
 CHECK (status <> 'approved' OR (approved_by_id IS NOT NULL AND approved_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX message_template_email_version_uidx ON message_template_email_versions(template_id, version);
--> statement-breakpoint
CREATE FUNCTION guard_email_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EMAIL_VERSION_IMMUTABLE'; END IF;
 IF TG_OP = 'INSERT' THEN
   IF NEW.status <> 'draft' OR NEW.approved_by_id IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
     RAISE EXCEPTION 'EMAIL_VERSION_REQUIRES_REVIEW';
   END IF;
   RETURN NEW;
 END IF;
 IF (to_jsonb(NEW) - 'status' - 'approved_by_id' - 'approved_at') IS DISTINCT FROM
    (to_jsonb(OLD) - 'status' - 'approved_by_id' - 'approved_at') THEN
   RAISE EXCEPTION 'EMAIL_VERSION_IMMUTABLE';
 END IF;
 IF NOT ((OLD.status = 'draft' AND NEW.status = 'review') OR
         (OLD.status = 'review' AND NEW.status = 'approved') OR
         (OLD.status = 'approved' AND NEW.status = 'retired')) THEN
   RAISE EXCEPTION 'EMAIL_VERSION_INVALID_TRANSITION';
 END IF;
 IF NEW.status <> 'approved' AND (NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id OR
    NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
   RAISE EXCEPTION 'EMAIL_VERSION_REVIEW_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER email_template_version_guard BEFORE INSERT OR UPDATE OR DELETE ON message_template_email_versions
 FOR EACH ROW EXECUTE FUNCTION guard_email_template_version();
--> statement-breakpoint
ALTER TABLE email_queue
 ADD COLUMN sender_account_id integer REFERENCES channel_accounts(id),
 ADD COLUMN sender_revision integer,
 ADD COLUMN template_version_id integer REFERENCES message_template_email_versions(id),
 ADD COLUMN idempotency_key text,
 ADD COLUMN claim_token text,
 ADD COLUMN claimed_at timestamptz,
 ADD COLUMN delivery_error_code text,
 ADD COLUMN provider_message_id text,
 ADD COLUMN attachments jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX email_queue_idempotency_uidx ON email_queue(idempotency_key);
--> statement-breakpoint
CREATE TABLE pipeline_stage_email_dispatches (
 id serial PRIMARY KEY,
 application_id integer NOT NULL,
 student_id integer NOT NULL,
 agent_id integer,
 stage_key text NOT NULL,
 template_version_id integer NOT NULL REFERENCES message_template_email_versions(id),
 sender_account_id integer NOT NULL REFERENCES channel_accounts(id),
 sender_revision integer NOT NULL CHECK (sender_revision > 0),
 origin text NOT NULL CHECK (origin IN ('direct','agent','sub_agent')),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','enqueued','skipped','failed')),
 email_queue_id integer REFERENCES email_queue(id),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX pipeline_stage_email_dispatch_uidx ON pipeline_stage_email_dispatches(application_id, stage_key);
--> statement-breakpoint
CREATE INDEX pipeline_stage_email_dispatch_claim_idx ON pipeline_stage_email_dispatches(status, id);
--> statement-breakpoint
CREATE FUNCTION enqueue_pipeline_stage_automatic_email() RETURNS trigger LANGUAGE plpgsql AS $$
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
--> statement-breakpoint
CREATE TRIGGER application_stage_automatic_email AFTER INSERT OR UPDATE OF stage ON applications
 FOR EACH ROW EXECUTE FUNCTION enqueue_pipeline_stage_automatic_email();
