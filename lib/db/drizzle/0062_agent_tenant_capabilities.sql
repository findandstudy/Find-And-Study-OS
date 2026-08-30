ALTER TABLE "agents" ADD COLUMN "plan_tier" text DEFAULT 'standard' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "feature_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "primary_brand_color" text DEFAULT '#1D4ED8' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "secondary_brand_color" text DEFAULT '#10B981' NOT NULL;
--> statement-breakpoint
CREATE TABLE "agent_integrations" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL,
  "kind" text NOT NULL,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_integrations" ADD CONSTRAINT "agent_integrations_agent_id_agents_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_integrations_agent_kind_uidx" ON "agent_integrations" ("agent_id", "kind");
--> statement-breakpoint
CREATE INDEX "agent_integrations_agent_idx" ON "agent_integrations" ("agent_id");
