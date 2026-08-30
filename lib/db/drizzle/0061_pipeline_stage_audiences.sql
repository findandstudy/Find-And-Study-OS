ALTER TABLE "pipeline_stages"
  ADD COLUMN "visible_to_roles" jsonb NOT NULL
  DEFAULT '["super_admin","admin","staff","agent","sub_agent","agent_staff"]'::jsonb;
--> statement-breakpoint
ALTER TABLE "pipeline_stages"
  ADD COLUMN "transition_allowed_roles" jsonb NOT NULL
  DEFAULT '["super_admin","admin","staff","agent","sub_agent","agent_staff"]'::jsonb;
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
