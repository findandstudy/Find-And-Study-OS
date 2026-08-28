-- Public agency application records and their review/signing links.
CREATE TABLE IF NOT EXISTS "agent_applications" (
  "id" serial PRIMARY KEY NOT NULL,
  "reference_code" text NOT NULL,
  "access_token_hash" text NOT NULL,
  "idempotency_key_hash" text,
  "status" text DEFAULT 'awaiting_signature' NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "phone_e164" text,
  "entity_type" text NOT NULL,
  "preferred_language" text NOT NULL,
  "company_name" text,
  "business_name" text,
  "tax_number" text,
  "country" text,
  "state" text,
  "city" text,
  "address" text,
  "website" text,
  "estimated_students" integer,
  "operating_countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recruitment_markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "extra_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "contract_template_id" integer NOT NULL,
  "signing_session_id" integer,
  "signed_contract_id" integer,
  "contract_data_hash" text NOT NULL,
  "assigned_staff_id" integer,
  "branch_id" integer,
  "review_notes" text,
  "change_request_message" text,
  "reviewed_by_user_id" integer,
  "approved_agent_id" integer,
  "consent_version" text DEFAULT 'agency-application-v1' NOT NULL,
  "consented_at" timestamp with time zone NOT NULL,
  "consent_ip_hash" text,
  "signed_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_assigned_staff_id_users_id_fk"
    FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_reviewed_by_user_id_users_id_fk"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_contract_template_id_contract_templates_id_fk"
    FOREIGN KEY ("contract_template_id") REFERENCES "public"."contract_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_signing_session_id_signing_sessions_id_fk"
    FOREIGN KEY ("signing_session_id") REFERENCES "public"."signing_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_signed_contract_id_signed_contracts_id_fk"
    FOREIGN KEY ("signed_contract_id") REFERENCES "public"."signed_contracts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_approved_agent_id_agents_id_fk"
    FOREIGN KEY ("approved_agent_id") REFERENCES "public"."agents"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_applications_reference_unique" ON "agent_applications" ("reference_code");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_applications_access_token_unique" ON "agent_applications" ("access_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_applications_idempotency_unique" ON "agent_applications" ("idempotency_key_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_applications_signing_session_unique" ON "agent_applications" ("signing_session_id");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_applications_signed_contract_unique" ON "agent_applications" ("signed_contract_id");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_applications_approved_agent_unique" ON "agent_applications" ("approved_agent_id");
CREATE INDEX IF NOT EXISTS "agent_applications_status_created_idx" ON "agent_applications" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "agent_applications_email_idx" ON "agent_applications" ("email");
CREATE INDEX IF NOT EXISTS "agent_applications_template_idx" ON "agent_applications" ("contract_template_id");
CREATE INDEX IF NOT EXISTS "agent_applications_assigned_staff_idx" ON "agent_applications" ("assigned_staff_id");
