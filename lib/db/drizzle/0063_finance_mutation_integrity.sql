ALTER TABLE "financial_transactions"
  ADD CONSTRAINT "fin_tx_amount_positive_chk" CHECK ("amount" > 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "financial_transactions"
  ADD CONSTRAINT "fin_tx_type_chk" CHECK ("type" IN ('collection', 'agent_payment', 'sub_agent_payment')) NOT VALID;
--> statement-breakpoint
CREATE TABLE "finance_mutation_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "key_hash" text NOT NULL,
  "scope" text NOT NULL,
  "request_hash" text NOT NULL,
  "response" jsonb NOT NULL,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_mutation_requests" ADD CONSTRAINT "finance_mutation_requests_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_mutation_requests_key_uidx" ON "finance_mutation_requests" ("key_hash");
--> statement-breakpoint
CREATE INDEX "finance_mutation_requests_created_at_idx" ON "finance_mutation_requests" ("created_at");
