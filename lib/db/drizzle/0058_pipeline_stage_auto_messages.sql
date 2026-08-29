ALTER TABLE "pipeline_stages"
  ADD COLUMN "automatic_message" jsonb;
--> statement-breakpoint
ALTER TABLE "message_campaigns"
  ADD COLUMN "automation_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "message_campaigns_automation_key_uidx"
  ON "message_campaigns" USING btree ("automation_key");
--> statement-breakpoint
CREATE TABLE "pipeline_stage_message_dispatches" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "stage_key" text NOT NULL,
  "template_id" integer,
  "channel_account_id" integer,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "campaign_id" integer,
  "error_code" text,
  "error_detail" text,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_stage_message_dispatches"
  ADD CONSTRAINT "pipeline_stage_message_dispatches_template_id_message_templates_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pipeline_stage_message_dispatches"
  ADD CONSTRAINT "pipeline_stage_message_dispatches_channel_account_id_channel_accounts_id_fk"
  FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pipeline_stage_message_dispatches"
  ADD CONSTRAINT "pipeline_stage_message_dispatches_campaign_id_message_campaigns_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."message_campaigns"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stage_message_dispatch_entity_stage_uidx"
  ON "pipeline_stage_message_dispatches" USING btree ("entity_type", "entity_id", "stage_key");
--> statement-breakpoint
CREATE INDEX "pipeline_stage_message_dispatch_claim_idx"
  ON "pipeline_stage_message_dispatches" USING btree ("status", "next_attempt_at", "id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_pipeline_stage_automatic_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  configured_message jsonb;
  current_stage text;
  current_entity_type text;
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    current_entity_type := 'lead';
    current_stage := NEW.status;
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'students' THEN
    current_entity_type := 'student';
    current_stage := NEW.status;
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'applications' THEN
    current_entity_type := 'application';
    current_stage := NEW.stage;
    IF TG_OP = 'UPDATE' AND OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL OR current_stage IS NULL OR btrim(current_stage) = '' THEN
    RETURN NEW;
  END IF;

  SELECT ps.automatic_message
    INTO configured_message
    FROM pipeline_stages ps
   WHERE ps.entity_type = current_entity_type
     AND ps.key = current_stage
   LIMIT 1;

  IF configured_message IS NULL
     OR COALESCE((configured_message ->> 'enabled')::boolean, false) IS NOT TRUE
     OR COALESCE(configured_message ->> 'templateId', '') !~ '^[1-9][0-9]*$'
     OR COALESCE(configured_message ->> 'channelAccountId', '') !~ '^[1-9][0-9]*$' THEN
    RETURN NEW;
  END IF;

  INSERT INTO pipeline_stage_message_dispatches (
    entity_type,
    entity_id,
    stage_key,
    template_id,
    channel_account_id,
    status,
    next_attempt_at,
    created_at,
    updated_at
  ) VALUES (
    current_entity_type,
    NEW.id,
    current_stage,
    (configured_message ->> 'templateId')::integer,
    (configured_message ->> 'channelAccountId')::integer,
    'queued',
    now(),
    now(),
    now()
  ) ON CONFLICT (entity_type, entity_id, stage_key) DO NOTHING;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "leads_stage_automatic_message_trigger"
  AFTER INSERT OR UPDATE OF "status" ON "leads"
  FOR EACH ROW EXECUTE FUNCTION enqueue_pipeline_stage_automatic_message();
--> statement-breakpoint
CREATE TRIGGER "students_stage_automatic_message_trigger"
  AFTER INSERT OR UPDATE OF "status" ON "students"
  FOR EACH ROW EXECUTE FUNCTION enqueue_pipeline_stage_automatic_message();
--> statement-breakpoint
CREATE TRIGGER "applications_stage_automatic_message_trigger"
  AFTER INSERT OR UPDATE OF "stage" ON "applications"
  FOR EACH ROW EXECUTE FUNCTION enqueue_pipeline_stage_automatic_message();
