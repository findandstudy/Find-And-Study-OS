-- Additive, default-unwired Student Journey G45 foundation.
-- This migration creates no route, provider delivery, production rollout or
-- role-package grant. Runtime adoption remains behind explicit release gates.

DO $$
DECLARE
  existing capability_definitions%ROWTYPE;
BEGIN
  SELECT * INTO existing
  FROM capability_definitions
  WHERE "key" = 'student.journey.read';

  IF NOT FOUND THEN
    INSERT INTO capability_definitions (
      "key", "description", "risk_class", "delegable",
      "step_up_required", "approval_required", "status", "version"
    ) VALUES (
      'student.journey.read',
      'Read the authenticated student''s tenant-scoped Journey projection.',
      'LOW', false, false, false, 'ACTIVE', 1
    );
  ELSIF existing."description" <> 'Read the authenticated student''s tenant-scoped Journey projection.'
     OR existing."risk_class" <> 'LOW'
     OR existing."delegable"
     OR existing."step_up_required"
     OR existing."approval_required"
     OR existing."status" <> 'ACTIVE'
     OR existing."version" <> 1 THEN
    RAISE EXCEPTION 'student.journey.read capability conflicts with the reviewed G45 definition';
  END IF;

  SELECT * INTO existing
  FROM capability_definitions
  WHERE "key" = 'student.document_request.respond';

  IF NOT FOUND THEN
    INSERT INTO capability_definitions (
      "key", "description", "risk_class", "delegable",
      "step_up_required", "approval_required", "status", "version"
    ) VALUES (
      'student.document_request.respond',
      'Acknowledge an owned document request or bind a safe ingest receipt.',
      'MEDIUM', false, false, false, 'ACTIVE', 1
    );
  ELSIF existing."description" <> 'Acknowledge an owned document request or bind a safe ingest receipt.'
     OR existing."risk_class" <> 'MEDIUM'
     OR existing."delegable"
     OR existing."step_up_required"
     OR existing."approval_required"
     OR existing."status" <> 'ACTIVE'
     OR existing."version" <> 1 THEN
    RAISE EXCEPTION 'student.document_request.respond capability conflicts with the reviewed G45 definition';
  END IF;

  SELECT * INTO existing
  FROM capability_definitions
  WHERE "key" = 'student.dossier.verify';

  IF NOT FOUND THEN
    INSERT INTO capability_definitions (
      "key", "description", "risk_class", "delegable",
      "step_up_required", "approval_required", "status", "version"
    ) VALUES (
      'student.dossier.verify',
      'Verify a versioned dossier only from immutable reviewed evidence.',
      'HIGH', false, false, false, 'ACTIVE', 1
    );
  ELSIF existing."description" <> 'Verify a versioned dossier only from immutable reviewed evidence.'
     OR existing."risk_class" <> 'HIGH'
     OR existing."delegable"
     OR existing."step_up_required"
     OR existing."approval_required"
     OR existing."status" <> 'ACTIVE'
     OR existing."version" <> 1 THEN
    RAISE EXCEPTION 'student.dossier.verify capability conflicts with the reviewed G45 definition';
  END IF;
END;
$$;

CREATE TABLE "journey_subjects" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "legacy_branch_id" integer NOT NULL,
  "legacy_student_id" integer NOT NULL,
  "legacy_user_id" integer NOT NULL,
  "subject_ref" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_subjects_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_subjects_tenant_student_uq" UNIQUE ("tenant_id", "legacy_student_id"),
  CONSTRAINT "journey_subjects_tenant_user_uq" UNIQUE ("tenant_id", "legacy_user_id"),
  CONSTRAINT "journey_subjects_tenant_ref_uq" UNIQUE ("tenant_id", "subject_ref"),
  CONSTRAINT "journey_subjects_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_subjects_ref_chk" CHECK ("subject_ref" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT "journey_subjects_state_chk" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  CONSTRAINT "journey_subjects_version_chk" CHECK ("version" > 0),
  CONSTRAINT "journey_subjects_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "journey_subjects_org_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_subjects_branch_fk" FOREIGN KEY ("tenant_id", "organization_id", "legacy_branch_id") REFERENCES "tenant_organization_legacy_branches"("tenant_id", "organization_id", "legacy_branch_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_subjects_student_fk" FOREIGN KEY ("legacy_student_id") REFERENCES "students"("id") ON DELETE RESTRICT,
  CONSTRAINT "journey_subjects_user_fk" FOREIGN KEY ("legacy_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "journey_requirement_sets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "legacy_branch_id" integer NOT NULL,
  "corridor_code" text NOT NULL,
  "version_number" bigint NOT NULL,
  "authority_source" text NOT NULL,
  "authority_source_hash" text NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "effective_until" timestamp with time zone,
  "published_at" timestamp with time zone NOT NULL,
  "set_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_requirement_sets_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_requirement_sets_version_uq" UNIQUE ("tenant_id", "corridor_code", "version_number"),
  CONSTRAINT "journey_requirement_sets_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_requirement_sets_code_chk" CHECK ("corridor_code" ~ '^[a-z][a-z0-9._:-]{1,95}$'),
  CONSTRAINT "journey_requirement_sets_source_chk" CHECK ("authority_source" IN ('PROGRAM_INTAKE_POLICY', 'INSTITUTION_API', 'REVIEWED_MANUAL_IMPORT')),
  CONSTRAINT "journey_requirement_sets_hash_chk" CHECK ("authority_source_hash" ~ '^[0-9a-f]{64}$' AND "set_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_requirement_sets_version_chk" CHECK ("version_number" > 0),
  CONSTRAINT "journey_requirement_sets_window_chk" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "journey_requirement_sets_publish_chk" CHECK ("published_at" <= "effective_from"),
  CONSTRAINT "journey_requirement_sets_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "journey_requirement_sets_org_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_requirement_sets_branch_fk" FOREIGN KEY ("tenant_id", "organization_id", "legacy_branch_id") REFERENCES "tenant_organization_legacy_branches"("tenant_id", "organization_id", "legacy_branch_id") ON DELETE RESTRICT
);

CREATE TABLE "journey_requirement_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "requirement_set_id" uuid NOT NULL,
  "requirement_code" text NOT NULL,
  "evidence_kind" text NOT NULL,
  "mandatory" boolean DEFAULT true NOT NULL,
  "ordinal" integer NOT NULL,
  "item_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_requirement_items_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_requirement_items_code_uq" UNIQUE ("tenant_id", "requirement_set_id", "requirement_code"),
  CONSTRAINT "journey_requirement_items_ordinal_uq" UNIQUE ("tenant_id", "requirement_set_id", "ordinal"),
  CONSTRAINT "journey_requirement_items_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_requirement_items_code_chk" CHECK ("requirement_code" ~ '^[a-z][a-z0-9._:-]{1,95}$'),
  CONSTRAINT "journey_requirement_items_kind_chk" CHECK ("evidence_kind" ~ '^[a-z][a-z0-9._:-]{1,95}$'),
  CONSTRAINT "journey_requirement_items_ordinal_chk" CHECK ("ordinal" > 0 AND "ordinal" <= 250),
  CONSTRAINT "journey_requirement_items_hash_chk" CHECK ("item_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_requirement_items_set_fk" FOREIGN KEY ("tenant_id", "requirement_set_id") REFERENCES "journey_requirement_sets"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_dossiers" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_dossiers_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_dossiers_subject_uq" UNIQUE ("tenant_id", "subject_id"),
  CONSTRAINT "journey_dossiers_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_dossiers_status_chk" CHECK ("status" IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT "journey_dossiers_version_chk" CHECK ("version" > 0),
  CONSTRAINT "journey_dossiers_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_dossier_revisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "dossier_id" uuid NOT NULL,
  "requirement_set_id" uuid NOT NULL,
  "revision_number" bigint NOT NULL,
  "revision_state" text NOT NULL,
  "source_snapshot_hash" text NOT NULL,
  "revision_hash" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  CONSTRAINT "journey_dossier_revisions_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_dossier_revisions_dossier_uq" UNIQUE ("tenant_id", "id", "dossier_id"),
  CONSTRAINT "journey_dossier_revisions_binding_uq" UNIQUE ("tenant_id", "id", "dossier_id", "requirement_set_id"),
  CONSTRAINT "journey_dossier_revisions_number_uq" UNIQUE ("tenant_id", "dossier_id", "revision_number"),
  CONSTRAINT "journey_dossier_revisions_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_dossier_revisions_state_chk" CHECK ("revision_state" IN ('DRAFT', 'VERIFIED')),
  CONSTRAINT "journey_dossier_revisions_number_chk" CHECK ("revision_number" > 0),
  CONSTRAINT "journey_dossier_revisions_hash_chk" CHECK ("source_snapshot_hash" ~ '^[0-9a-f]{64}$' AND "revision_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_dossier_revisions_dossier_fk" FOREIGN KEY ("tenant_id", "dossier_id") REFERENCES "journey_dossiers"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_dossier_revisions_set_fk" FOREIGN KEY ("tenant_id", "requirement_set_id") REFERENCES "journey_requirement_sets"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_application_cases" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "legacy_branch_id" integer NOT NULL,
  "subject_id" uuid NOT NULL,
  "dossier_id" uuid NOT NULL,
  "legacy_application_id" integer NOT NULL,
  "corridor_code" text NOT NULL,
  "lifecycle_state" text DEFAULT 'DOSSIER_PREPARATION' NOT NULL,
  "active_dossier_revision_id" uuid,
  "owner_membership_id" uuid,
  "owner_legacy_user_id" integer,
  "next_action" text,
  "due_at" timestamp with time zone,
  "aggregate_version" bigint DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_application_cases_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_application_cases_subject_binding_uq" UNIQUE ("tenant_id", "id", "subject_id"),
  CONSTRAINT "journey_application_cases_legacy_uq" UNIQUE ("tenant_id", "legacy_application_id"),
  CONSTRAINT "journey_application_cases_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_application_cases_code_chk" CHECK ("corridor_code" ~ '^[a-z][a-z0-9._:-]{1,95}$'),
  CONSTRAINT "journey_application_cases_state_chk" CHECK ("lifecycle_state" IN ('DOSSIER_PREPARATION', 'DOSSIER_VERIFIED', 'APPLICATION_SUBMITTED')),
  CONSTRAINT "journey_application_cases_action_chk" CHECK ("next_action" IS NULL OR "next_action" ~ '^[a-z][a-z0-9._:-]{1,95}$'),
  CONSTRAINT "journey_application_cases_version_chk" CHECK ("aggregate_version" > 0),
  CONSTRAINT "journey_application_cases_revision_state_chk" CHECK (("lifecycle_state" = 'DOSSIER_PREPARATION') OR "active_dossier_revision_id" IS NOT NULL),
  CONSTRAINT "journey_application_cases_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_application_cases_dossier_fk" FOREIGN KEY ("tenant_id", "dossier_id") REFERENCES "journey_dossiers"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_application_cases_revision_fk" FOREIGN KEY ("tenant_id", "active_dossier_revision_id", "dossier_id") REFERENCES "journey_dossier_revisions"("tenant_id", "id", "dossier_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_application_cases_org_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_application_cases_branch_fk" FOREIGN KEY ("tenant_id", "organization_id", "legacy_branch_id") REFERENCES "tenant_organization_legacy_branches"("tenant_id", "organization_id", "legacy_branch_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_application_cases_owner_fk" FOREIGN KEY ("tenant_id", "owner_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_application_cases_legacy_app_fk" FOREIGN KEY ("legacy_application_id") REFERENCES "applications"("id") ON DELETE RESTRICT,
  CONSTRAINT "journey_application_cases_legacy_owner_fk" FOREIGN KEY ("owner_legacy_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "journey_requirement_results" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "dossier_revision_id" uuid NOT NULL,
  "dossier_id" uuid NOT NULL,
  "requirement_set_id" uuid NOT NULL,
  "requirement_code" text NOT NULL,
  "result_state" text NOT NULL,
  "evidence_receipt_id" uuid,
  "result_hash" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  CONSTRAINT "journey_requirement_results_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_requirement_results_code_uq" UNIQUE ("tenant_id", "dossier_revision_id", "requirement_code"),
  CONSTRAINT "journey_requirement_results_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_requirement_results_state_chk" CHECK ("result_state" IN ('MISSING', 'UPLOADED', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'UNKNOWN')),
  CONSTRAINT "journey_requirement_results_evidence_chk" CHECK (("result_state" = 'VERIFIED' AND "evidence_receipt_id" IS NOT NULL) OR ("result_state" <> 'VERIFIED' AND "evidence_receipt_id" IS NULL)),
  CONSTRAINT "journey_requirement_results_hash_chk" CHECK ("result_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_requirement_results_revision_fk" FOREIGN KEY ("tenant_id", "dossier_revision_id", "dossier_id", "requirement_set_id") REFERENCES "journey_dossier_revisions"("tenant_id", "id", "dossier_id", "requirement_set_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_requirement_results_item_fk" FOREIGN KEY ("tenant_id", "requirement_set_id", "requirement_code") REFERENCES "journey_requirement_items"("tenant_id", "requirement_set_id", "requirement_code") ON DELETE RESTRICT
);

ALTER TABLE "access_decision_receipts"
  ADD CONSTRAINT "access_decision_receipts_tenant_id_id_uq"
  UNIQUE ("tenant_id", "id");

CREATE TABLE "journey_verified_evidence_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "application_case_id" uuid,
  "dossier_revision_id" uuid NOT NULL,
  "dossier_id" uuid NOT NULL,
  "requirement_set_id" uuid NOT NULL,
  "requirement_code" text NOT NULL,
  "evidence_ref" text NOT NULL,
  "content_sha256" text NOT NULL,
  "verification_policy_version" text NOT NULL,
  "verifier_principal_id" uuid NOT NULL,
  "verifier_membership_id" uuid NOT NULL,
  "access_decision_receipt_id" uuid NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "receipt_hash" text NOT NULL,
  CONSTRAINT "journey_verified_evidence_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_verified_evidence_hash_uq" UNIQUE ("tenant_id", "receipt_hash"),
  CONSTRAINT "journey_verified_evidence_ref_uq" UNIQUE ("tenant_id", "evidence_ref", "content_sha256"),
  CONSTRAINT "journey_verified_evidence_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_verified_evidence_ref_chk" CHECK ("evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT "journey_verified_evidence_hash_chk" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$' AND "receipt_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_verified_evidence_policy_chk" CHECK ("verification_policy_version" ~ '^[a-z][a-z0-9._:-]{1,95}$'),
  CONSTRAINT "journey_verified_evidence_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_verified_evidence_case_fk" FOREIGN KEY ("tenant_id", "application_case_id", "subject_id") REFERENCES "journey_application_cases"("tenant_id", "id", "subject_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_verified_evidence_revision_fk" FOREIGN KEY ("tenant_id", "dossier_revision_id", "dossier_id", "requirement_set_id") REFERENCES "journey_dossier_revisions"("tenant_id", "id", "dossier_id", "requirement_set_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_verified_evidence_item_fk" FOREIGN KEY ("tenant_id", "requirement_set_id", "requirement_code") REFERENCES "journey_requirement_items"("tenant_id", "requirement_set_id", "requirement_code") ON DELETE RESTRICT,
  CONSTRAINT "journey_verified_evidence_actor_fk" FOREIGN KEY ("tenant_id", "verifier_membership_id", "verifier_principal_id") REFERENCES "memberships"("tenant_id", "id", "principal_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_verified_evidence_access_fk" FOREIGN KEY ("tenant_id", "access_decision_receipt_id") REFERENCES "access_decision_receipts"("tenant_id", "id") ON DELETE RESTRICT
);

ALTER TABLE "journey_requirement_results"
  ADD CONSTRAINT "journey_requirement_results_evidence_fk"
  FOREIGN KEY ("tenant_id", "evidence_receipt_id")
  REFERENCES "journey_verified_evidence_receipts"("tenant_id", "id")
  ON DELETE RESTRICT;

CREATE TABLE "journey_consent_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "purpose" text NOT NULL,
  "lawful_basis" text NOT NULL,
  "channel" text NOT NULL,
  "locale" text NOT NULL,
  "notice_version" text NOT NULL,
  "policy_version" text NOT NULL,
  "retention_policy_version" text NOT NULL,
  "action" text NOT NULL,
  "sequence" bigint NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "valid_until" timestamp with time zone,
  "previous_receipt_hash" text,
  "evidence_ref" text NOT NULL,
  "evidence_sha256" text NOT NULL,
  "receipt_hash" text NOT NULL,
  CONSTRAINT "journey_consent_receipts_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_consent_receipts_sequence_uq" UNIQUE ("tenant_id", "subject_id", "purpose", "channel", "sequence"),
  CONSTRAINT "journey_consent_receipts_hash_uq" UNIQUE ("tenant_id", "receipt_hash"),
  CONSTRAINT "journey_consent_receipts_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_consent_receipts_action_chk" CHECK ("action" IN ('CAPTURED', 'WITHDRAWN')),
  CONSTRAINT "journey_consent_receipts_channel_chk" CHECK ("channel" IN ('in_app', 'email')),
  CONSTRAINT "journey_consent_receipts_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "journey_consent_receipts_locale_chk" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  CONSTRAINT "journey_consent_receipts_window_chk" CHECK ("valid_until" IS NULL OR "valid_until" > "effective_at"),
  CONSTRAINT "journey_consent_receipts_time_chk" CHECK ("recorded_at" >= "effective_at"),
  CONSTRAINT "journey_consent_receipts_hash_chk" CHECK ("evidence_sha256" ~ '^[0-9a-f]{64}$' AND "receipt_hash" ~ '^[0-9a-f]{64}$' AND ("previous_receipt_hash" IS NULL OR "previous_receipt_hash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "journey_consent_receipts_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_communication_preference_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "preference_state" text NOT NULL,
  "sequence" bigint NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "policy_version" text NOT NULL,
  "previous_receipt_hash" text,
  "evidence_ref" text NOT NULL,
  "evidence_sha256" text NOT NULL,
  "receipt_hash" text NOT NULL,
  CONSTRAINT "journey_comm_preferences_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_comm_preferences_sequence_uq" UNIQUE ("tenant_id", "subject_id", "category", "channel", "sequence"),
  CONSTRAINT "journey_comm_preferences_hash_uq" UNIQUE ("tenant_id", "receipt_hash"),
  CONSTRAINT "journey_comm_preferences_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_comm_preferences_category_chk" CHECK ("category" IN ('ACTION_REQUIRED', 'DEADLINE')),
  CONSTRAINT "journey_comm_preferences_channel_chk" CHECK ("channel" IN ('in_app', 'email')),
  CONSTRAINT "journey_comm_preferences_state_chk" CHECK ("preference_state" IN ('ENABLED', 'DISABLED')),
  CONSTRAINT "journey_comm_preferences_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "journey_comm_preferences_time_chk" CHECK ("recorded_at" >= "effective_at"),
  CONSTRAINT "journey_comm_preferences_hash_chk" CHECK ("evidence_sha256" ~ '^[0-9a-f]{64}$' AND "receipt_hash" ~ '^[0-9a-f]{64}$' AND ("previous_receipt_hash" IS NULL OR "previous_receipt_hash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "journey_comm_preferences_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_communication_suppression_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "reason" text NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "retention_policy_version" text NOT NULL,
  "evidence_ref" text NOT NULL,
  "evidence_sha256" text NOT NULL,
  "receipt_hash" text NOT NULL,
  CONSTRAINT "journey_comm_suppressions_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_comm_suppressions_hash_uq" UNIQUE ("tenant_id", "receipt_hash"),
  CONSTRAINT "journey_comm_suppressions_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_comm_suppressions_channel_chk" CHECK ("channel" = 'email'),
  CONSTRAINT "journey_comm_suppressions_reason_chk" CHECK ("reason" IN ('UNSUBSCRIBE', 'COMPLAINT', 'HARD_BOUNCE')),
  CONSTRAINT "journey_comm_suppressions_time_chk" CHECK ("recorded_at" >= "effective_at"),
  CONSTRAINT "journey_comm_suppressions_hash_chk" CHECK ("evidence_sha256" ~ '^[0-9a-f]{64}$' AND "receipt_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_comm_suppressions_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_notification_intents" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "task_state_ref" text NOT NULL,
  "purpose" text NOT NULL,
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "locale" text NOT NULL,
  "intended_at" timestamp with time zone NOT NULL,
  "dedup_key" text NOT NULL,
  "policy_version" text NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_notification_intents_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_notification_intents_dedup_uq" UNIQUE ("tenant_id", "dedup_key"),
  CONSTRAINT "journey_notification_intents_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_notification_intents_category_chk" CHECK ("category" IN ('ACTION_REQUIRED', 'DEADLINE')),
  CONSTRAINT "journey_notification_intents_channel_chk" CHECK ("channel" IN ('in_app', 'email')),
  CONSTRAINT "journey_notification_intents_status_chk" CHECK ("status" IN ('DRAFT', 'BLOCKED', 'READY')),
  CONSTRAINT "journey_notification_intents_default_off_chk" CHECK ("status" <> 'READY' OR "channel" = 'in_app'),
  CONSTRAINT "journey_notification_intents_locale_chk" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  CONSTRAINT "journey_notification_intents_dedup_chk" CHECK ("dedup_key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_notification_intents_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_notification_intents_case_fk" FOREIGN KEY ("tenant_id", "application_case_id", "subject_id") REFERENCES "journey_application_cases"("tenant_id", "id", "subject_id") ON DELETE RESTRICT
);

CREATE TABLE "journey_communication_decision_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "notification_intent_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "active_consent_receipt_hash" text,
  "active_preference_receipt_hash" text,
  "matched_suppression_receipt_hash" text,
  "quiet_hours_policy_version" text NOT NULL,
  "frequency_policy_version" text NOT NULL,
  "dedup_policy_version" text NOT NULL,
  "state_input_hash" text NOT NULL,
  "decision_hash" text NOT NULL,
  "evaluated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "journey_comm_decisions_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_comm_decisions_intent_uq" UNIQUE ("tenant_id", "notification_intent_id"),
  CONSTRAINT "journey_comm_decisions_hash_uq" UNIQUE ("tenant_id", "decision_hash"),
  CONSTRAINT "journey_comm_decisions_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_comm_decisions_decision_chk" CHECK ("decision" IN ('ALLOW', 'DENY')),
  CONSTRAINT "journey_comm_decisions_reason_chk" CHECK ("reason" IN ('ELIGIBLE', 'SUPPRESSED', 'DUPLICATE_INTENT', 'CONTACT_UNVERIFIED', 'CONTACT_VERIFIED_AFTER_INTENT', 'CONSENT_MISSING', 'CONSENT_NOT_YET_EFFECTIVE', 'CONSENT_WITHDRAWN', 'CONSENT_EXPIRED', 'PREFERENCE_MISSING', 'PREFERENCE_NOT_YET_EFFECTIVE', 'PREFERENCE_DISABLED', 'QUIET_HOURS', 'FREQUENCY_CAP_REACHED')),
  CONSTRAINT "journey_comm_decisions_hash_chk" CHECK ("state_input_hash" ~ '^[0-9a-f]{64}$' AND "decision_hash" ~ '^[0-9a-f]{64}$' AND ("active_consent_receipt_hash" IS NULL OR "active_consent_receipt_hash" ~ '^[0-9a-f]{64}$') AND ("active_preference_receipt_hash" IS NULL OR "active_preference_receipt_hash" ~ '^[0-9a-f]{64}$') AND ("matched_suppression_receipt_hash" IS NULL OR "matched_suppression_receipt_hash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "journey_comm_decisions_intent_fk" FOREIGN KEY ("tenant_id", "notification_intent_id") REFERENCES "journey_notification_intents"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_comm_decisions_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_document_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "requirement_code" text NOT NULL,
  "state" text DEFAULT 'OPEN' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "requested_by_principal_id" uuid NOT NULL,
  "requested_by_membership_id" uuid NOT NULL,
  "due_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "responded_at" timestamp with time zone,
  "fulfilled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_document_requests_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_document_requests_scope_uq" UNIQUE ("tenant_id", "id", "subject_id", "application_case_id"),
  CONSTRAINT "journey_document_requests_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_document_requests_state_chk" CHECK ("state" IN ('OPEN', 'RESPONDED', 'FULFILLED', 'CANCELLED')),
  CONSTRAINT "journey_document_requests_version_chk" CHECK ("version" > 0),
  CONSTRAINT "journey_document_requests_time_chk" CHECK (("responded_at" IS NULL OR "acknowledged_at" IS NOT NULL) AND ("fulfilled_at" IS NULL OR "responded_at" IS NOT NULL)),
  CONSTRAINT "journey_document_requests_subject_fk" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "journey_subjects"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_requests_case_fk" FOREIGN KEY ("tenant_id", "application_case_id", "subject_id") REFERENCES "journey_application_cases"("tenant_id", "id", "subject_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_requests_actor_fk" FOREIGN KEY ("tenant_id", "requested_by_membership_id", "requested_by_principal_id") REFERENCES "memberships"("tenant_id", "id", "principal_id") ON DELETE RESTRICT
);

CREATE TABLE "journey_document_ingest_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "document_request_id" uuid NOT NULL,
  "object_ref" text NOT NULL,
  "content_sha256" text NOT NULL,
  "scan_status" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "receipt_hash" text NOT NULL,
  CONSTRAINT "journey_document_ingest_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_document_ingest_hash_uq" UNIQUE ("tenant_id", "receipt_hash"),
  CONSTRAINT "journey_document_ingest_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_document_ingest_object_chk" CHECK ("object_ref" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT "journey_document_ingest_status_chk" CHECK ("scan_status" IN ('QUARANTINED', 'SCANNING', 'PASSED')),
  CONSTRAINT "journey_document_ingest_hash_chk" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$' AND "receipt_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_document_ingest_request_fk" FOREIGN KEY ("tenant_id", "document_request_id", "subject_id", "application_case_id") REFERENCES "journey_document_requests"("tenant_id", "id", "subject_id", "application_case_id") ON DELETE RESTRICT
);

CREATE TABLE "journey_document_access_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "document_request_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "context_id" uuid NOT NULL,
  "selection_id" uuid NOT NULL,
  "session_generation" bigint NOT NULL,
  "actor_principal_id" uuid NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "capability_key" text NOT NULL,
  "decision" text NOT NULL,
  "correlation_id" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "journey_document_access_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_document_access_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_document_access_generation_chk" CHECK ("session_generation" > 0),
  CONSTRAINT "journey_document_access_capability_chk" CHECK ("capability_key" = 'student.document_request.respond'),
  CONSTRAINT "journey_document_access_decision_chk" CHECK ("decision" = 'ALLOW'),
  CONSTRAINT "journey_document_access_request_fk" FOREIGN KEY ("tenant_id", "document_request_id", "subject_id", "application_case_id") REFERENCES "journey_document_requests"("tenant_id", "id", "subject_id", "application_case_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_access_actor_fk" FOREIGN KEY ("tenant_id", "actor_membership_id", "actor_principal_id") REFERENCES "memberships"("tenant_id", "id", "principal_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_access_policy_fk" FOREIGN KEY ("tenant_id", "policy_version_id") REFERENCES "policy_versions"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_access_selection_fk" FOREIGN KEY ("tenant_id", "selection_id") REFERENCES "active_session_context_selections"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_access_capability_fk" FOREIGN KEY ("capability_key") REFERENCES "capability_definitions"("key") ON DELETE RESTRICT
);

CREATE TABLE "journey_document_response_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "document_request_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "command_id" uuid NOT NULL,
  "access_decision_receipt_id" uuid NOT NULL,
  "actor_principal_id" uuid NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "context_id" uuid NOT NULL,
  "selection_id" uuid NOT NULL,
  "session_generation" bigint NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "response_kind" text NOT NULL,
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "previous_version" bigint NOT NULL,
  "next_version" bigint NOT NULL,
  "acknowledged_at" timestamp with time zone NOT NULL,
  "responded_at" timestamp with time zone,
  "ingest_receipt_id" uuid,
  "ingest_receipt_hash" text,
  "idempotency_key_hash" text NOT NULL,
  "command_hash" text NOT NULL,
  "audit_correlation_id" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "receipt_hash" text NOT NULL,
  "receipt_payload" jsonb NOT NULL,
  CONSTRAINT "journey_document_responses_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_document_responses_command_uq" UNIQUE ("tenant_id", "command_id"),
  CONSTRAINT "journey_document_responses_hash_uq" UNIQUE ("tenant_id", "receipt_hash"),
  CONSTRAINT "journey_document_responses_idempotency_uq" UNIQUE ("tenant_id", "idempotency_key_hash"),
  CONSTRAINT "journey_document_responses_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7' AND substring("command_id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_document_responses_kind_chk" CHECK ("response_kind" IN ('ACKNOWLEDGE', 'EVIDENCE_SUBMITTED')),
  CONSTRAINT "journey_document_responses_state_chk" CHECK (("response_kind" = 'ACKNOWLEDGE' AND "from_state" = 'OPEN' AND "to_state" = 'OPEN' AND "responded_at" IS NULL AND "ingest_receipt_id" IS NULL AND "ingest_receipt_hash" IS NULL) OR ("response_kind" = 'EVIDENCE_SUBMITTED' AND "from_state" = 'OPEN' AND "to_state" = 'RESPONDED' AND "responded_at" IS NOT NULL AND "ingest_receipt_id" IS NOT NULL AND "ingest_receipt_hash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "journey_document_responses_version_chk" CHECK ("previous_version" > 0 AND "next_version" = "previous_version" + 1 AND "session_generation" > 0),
  CONSTRAINT "journey_document_responses_hash_chk" CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$' AND "command_hash" ~ '^[0-9a-f]{64}$' AND "receipt_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_document_responses_request_fk" FOREIGN KEY ("tenant_id", "document_request_id", "subject_id", "application_case_id") REFERENCES "journey_document_requests"("tenant_id", "id", "subject_id", "application_case_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_responses_access_fk" FOREIGN KEY ("tenant_id", "access_decision_receipt_id") REFERENCES "journey_document_access_receipts"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_responses_ingest_fk" FOREIGN KEY ("tenant_id", "ingest_receipt_id") REFERENCES "journey_document_ingest_receipts"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_document_response_audits" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "command_receipt_id" uuid NOT NULL,
  "access_decision_receipt_id" uuid NOT NULL,
  "actor_principal_id" uuid NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "context_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "document_request_id" uuid NOT NULL,
  "response_kind" text NOT NULL,
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "previous_version" bigint NOT NULL,
  "next_version" bigint NOT NULL,
  "ingest_receipt_id" uuid,
  "correlation_id" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "audit_hash" text NOT NULL,
  "audit_payload" jsonb NOT NULL,
  CONSTRAINT "journey_document_audits_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_document_audits_receipt_uq" UNIQUE ("tenant_id", "command_receipt_id"),
  CONSTRAINT "journey_document_audits_hash_uq" UNIQUE ("tenant_id", "audit_hash"),
  CONSTRAINT "journey_document_audits_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_document_audits_hash_chk" CHECK ("audit_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_document_audits_receipt_fk" FOREIGN KEY ("tenant_id", "command_receipt_id") REFERENCES "journey_document_response_receipts"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_audits_access_fk" FOREIGN KEY ("tenant_id", "access_decision_receipt_id") REFERENCES "journey_document_access_receipts"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_document_ingest_consumptions" (
  "tenant_id" uuid NOT NULL,
  "ingest_receipt_id" uuid NOT NULL,
  "command_receipt_id" uuid NOT NULL,
  "consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_document_consumptions_pk" PRIMARY KEY ("tenant_id", "ingest_receipt_id"),
  CONSTRAINT "journey_document_consumptions_command_uq" UNIQUE ("tenant_id", "command_receipt_id"),
  CONSTRAINT "journey_document_consumptions_ingest_fk" FOREIGN KEY ("tenant_id", "ingest_receipt_id") REFERENCES "journey_document_ingest_receipts"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_consumptions_response_fk" FOREIGN KEY ("tenant_id", "command_receipt_id") REFERENCES "journey_document_response_receipts"("tenant_id", "id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "journey_document_response_commands" (
  "tenant_id" uuid NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "command_hash" text NOT NULL,
  "status" text DEFAULT 'CLAIMED' NOT NULL,
  "response_receipt_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "journey_document_commands_pk" PRIMARY KEY ("tenant_id", "idempotency_key_hash"),
  CONSTRAINT "journey_document_commands_receipt_uq" UNIQUE ("tenant_id", "response_receipt_id"),
  CONSTRAINT "journey_document_commands_hash_chk" CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$' AND "command_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_document_commands_status_chk" CHECK (("status" = 'CLAIMED' AND "response_receipt_id" IS NULL AND "completed_at" IS NULL) OR ("status" = 'COMMITTED' AND "response_receipt_id" IS NOT NULL AND "completed_at" IS NOT NULL)),
  CONSTRAINT "journey_document_commands_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "journey_document_commands_receipt_fk" FOREIGN KEY ("tenant_id", "response_receipt_id") REFERENCES "journey_document_response_receipts"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_state_transition_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "actor_principal_id" uuid NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "previous_version" bigint NOT NULL,
  "next_version" bigint NOT NULL,
  "evidence_kind" text NOT NULL,
  "evidence_ref" text NOT NULL,
  "evidence_sha256" text NOT NULL,
  "policy_version" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "receipt_hash" text NOT NULL,
  CONSTRAINT "journey_state_transitions_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_state_transitions_version_uq" UNIQUE ("tenant_id", "application_case_id", "next_version"),
  CONSTRAINT "journey_state_transitions_hash_uq" UNIQUE ("tenant_id", "receipt_hash"),
  CONSTRAINT "journey_state_transitions_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_state_transitions_state_chk" CHECK (("from_state" = 'DOSSIER_PREPARATION' AND "to_state" = 'DOSSIER_VERIFIED') OR ("from_state" = 'DOSSIER_VERIFIED' AND "to_state" = 'APPLICATION_SUBMITTED')),
  CONSTRAINT "journey_state_transitions_version_chk" CHECK ("previous_version" > 0 AND "next_version" = "previous_version" + 1),
  CONSTRAINT "journey_state_transitions_evidence_chk" CHECK ("evidence_kind" IN ('VERIFIED_EVIDENCE', 'SYSTEM_EVENT', 'PARTNER_RECEIPT')),
  CONSTRAINT "journey_state_transitions_hash_chk" CHECK ("evidence_sha256" ~ '^[0-9a-f]{64}$' AND "receipt_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_state_transitions_case_fk" FOREIGN KEY ("tenant_id", "application_case_id") REFERENCES "journey_application_cases"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_state_transitions_actor_fk" FOREIGN KEY ("tenant_id", "actor_membership_id", "actor_principal_id") REFERENCES "memberships"("tenant_id", "id", "principal_id") ON DELETE RESTRICT
);

CREATE TABLE "journey_milestone_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "aggregate_version" bigint NOT NULL,
  "lifecycle_ref" text NOT NULL,
  "milestone_code" text NOT NULL,
  "owner_legacy_user_id" integer,
  "next_action" text,
  "due_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "on_time" boolean NOT NULL,
  "verification_kind" text NOT NULL,
  "quality_factor_bps" integer NOT NULL,
  "quality_policy_version" text NOT NULL,
  "quality_input_hash" text NOT NULL,
  "dedup_key" text NOT NULL,
  "event_hash" text NOT NULL,
  CONSTRAINT "journey_milestones_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_milestones_dedup_uq" UNIQUE ("tenant_id", "dedup_key"),
  CONSTRAINT "journey_milestones_hash_uq" UNIQUE ("tenant_id", "event_hash"),
  CONSTRAINT "journey_milestones_case_version_uq" UNIQUE ("tenant_id", "application_case_id", "aggregate_version", "milestone_code"),
  CONSTRAINT "journey_milestones_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_milestones_code_chk" CHECK ("lifecycle_ref" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND "milestone_code" ~ '^[a-z][a-z0-9._:-]{1,95}$' AND ("next_action" IS NULL OR "next_action" ~ '^[a-z][a-z0-9._:-]{1,95}$')),
  CONSTRAINT "journey_milestones_version_chk" CHECK ("aggregate_version" > 1),
  CONSTRAINT "journey_milestones_time_chk" CHECK ("recorded_at" >= "completed_at" AND "on_time" = ("completed_at" <= "due_at")),
  CONSTRAINT "journey_milestones_verification_chk" CHECK ("verification_kind" IN ('SYSTEM_EVENT', 'VERIFIED_EVIDENCE', 'PARTNER_RECEIPT')),
  CONSTRAINT "journey_milestones_quality_chk" CHECK ("quality_factor_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "journey_milestones_hash_chk" CHECK ("quality_input_hash" ~ '^[0-9a-f]{64}$' AND "dedup_key" ~ '^[0-9a-f]{64}$' AND "event_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_milestones_case_fk" FOREIGN KEY ("tenant_id", "application_case_id", "subject_id") REFERENCES "journey_application_cases"("tenant_id", "id", "subject_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_milestones_owner_fk" FOREIGN KEY ("owner_legacy_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "journey_milestone_evidence" (
  "tenant_id" uuid NOT NULL,
  "milestone_event_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "evidence_kind" text NOT NULL,
  "evidence_ref" text NOT NULL,
  "evidence_sha256" text NOT NULL,
  CONSTRAINT "journey_milestone_evidence_pk" PRIMARY KEY ("tenant_id", "milestone_event_id", "ordinal"),
  CONSTRAINT "journey_milestone_evidence_ref_uq" UNIQUE ("tenant_id", "milestone_event_id", "evidence_kind", "evidence_ref"),
  CONSTRAINT "journey_milestone_evidence_ordinal_chk" CHECK ("ordinal" BETWEEN 1 AND 20),
  CONSTRAINT "journey_milestone_evidence_kind_chk" CHECK ("evidence_kind" IN ('SYSTEM_EVENT', 'VERIFIED_EVIDENCE', 'PARTNER_RECEIPT')),
  CONSTRAINT "journey_milestone_evidence_hash_chk" CHECK ("evidence_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_milestone_evidence_event_fk" FOREIGN KEY ("tenant_id", "milestone_event_id") REFERENCES "journey_milestone_events"("tenant_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "journey_qavjp_snapshots" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "cohort_ref" text NOT NULL,
  "period_starts_at" timestamp with time zone NOT NULL,
  "period_ends_at" timestamp with time zone NOT NULL,
  "frozen_at" timestamp with time zone NOT NULL,
  "eligibility_policy_version" text NOT NULL,
  "source_snapshot_hash" text NOT NULL,
  "source_record_count" integer NOT NULL,
  "excluded_record_count" integer NOT NULL,
  "eligible_item_count" integer NOT NULL,
  "denominator_weight_bps" bigint NOT NULL,
  "owner_coverage_bps" integer NOT NULL,
  "next_action_coverage_bps" integer NOT NULL,
  "snapshot_hash" text NOT NULL,
  CONSTRAINT "journey_qavjp_snapshots_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_qavjp_snapshots_cohort_uq" UNIQUE ("tenant_id", "cohort_ref", "period_starts_at", "period_ends_at"),
  CONSTRAINT "journey_qavjp_snapshots_hash_uq" UNIQUE ("tenant_id", "snapshot_hash"),
  CONSTRAINT "journey_qavjp_snapshots_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_qavjp_snapshots_period_chk" CHECK ("period_ends_at" > "period_starts_at" AND "frozen_at" <= "period_starts_at"),
  CONSTRAINT "journey_qavjp_snapshots_count_chk" CHECK ("source_record_count" >= 0 AND "excluded_record_count" >= 0 AND "eligible_item_count" > 0 AND "source_record_count" = "excluded_record_count" + "eligible_item_count" AND "eligible_item_count" <= 1000),
  CONSTRAINT "journey_qavjp_snapshots_weight_chk" CHECK ("denominator_weight_bps" > 0 AND "owner_coverage_bps" BETWEEN 0 AND 10000 AND "next_action_coverage_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "journey_qavjp_snapshots_hash_chk" CHECK ("source_snapshot_hash" ~ '^[0-9a-f]{64}$' AND "snapshot_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_qavjp_snapshots_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT
);

CREATE TABLE "journey_qavjp_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "lifecycle_ref" text NOT NULL,
  "milestone_code" text NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "owner_legacy_user_id" integer,
  "next_action" text,
  "weight_bps" integer NOT NULL,
  "consent_evidence_kind" text NOT NULL,
  "consent_evidence_ref" text NOT NULL,
  "consent_evidence_sha256" text NOT NULL,
  "dedup_key" text NOT NULL,
  CONSTRAINT "journey_qavjp_items_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_qavjp_items_dedup_uq" UNIQUE ("tenant_id", "snapshot_id", "dedup_key"),
  CONSTRAINT "journey_qavjp_items_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_qavjp_items_weight_chk" CHECK ("weight_bps" BETWEEN 1 AND 10000),
  CONSTRAINT "journey_qavjp_items_consent_kind_chk" CHECK ("consent_evidence_kind" = 'VERIFIED_EVIDENCE'),
  CONSTRAINT "journey_qavjp_items_hash_chk" CHECK ("consent_evidence_sha256" ~ '^[0-9a-f]{64}$' AND "dedup_key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_qavjp_items_snapshot_fk" FOREIGN KEY ("tenant_id", "snapshot_id") REFERENCES "journey_qavjp_snapshots"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "journey_qavjp_items_case_fk" FOREIGN KEY ("tenant_id", "application_case_id", "subject_id") REFERENCES "journey_application_cases"("tenant_id", "id", "subject_id") ON DELETE RESTRICT,
  CONSTRAINT "journey_qavjp_items_owner_fk" FOREIGN KEY ("owner_legacy_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "journey_outbox_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "dedup_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  CONSTRAINT "journey_outbox_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "journey_outbox_dedup_uq" UNIQUE ("tenant_id", "event_type", "dedup_key"),
  CONSTRAINT "journey_outbox_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "journey_outbox_hash_chk" CHECK ("dedup_key" ~ '^[0-9a-f]{64}$' AND "payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "journey_outbox_status_chk" CHECK ("status" IN ('PENDING', 'PUBLISHED', 'FAILED')),
  CONSTRAINT "journey_outbox_attempt_chk" CHECK ("attempt_count" >= 0),
  CONSTRAINT "journey_outbox_publish_chk" CHECK (("status" = 'PUBLISHED' AND "published_at" IS NOT NULL) OR ("status" <> 'PUBLISHED' AND "published_at" IS NULL)),
  CONSTRAINT "journey_outbox_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT
);

CREATE INDEX "journey_subjects_scope_idx" ON "journey_subjects" ("tenant_id", "organization_id", "legacy_branch_id", "status");
CREATE INDEX "journey_application_cases_scope_idx" ON "journey_application_cases" ("tenant_id", "organization_id", "legacy_branch_id", "lifecycle_state");
CREATE INDEX "journey_document_requests_action_idx" ON "journey_document_requests" ("tenant_id", "subject_id", "state", "due_at");
CREATE INDEX "journey_milestones_period_idx" ON "journey_milestone_events" ("tenant_id", "completed_at", "milestone_code");
CREATE INDEX "journey_outbox_pending_idx" ON "journey_outbox_events" ("tenant_id", "status", "available_at") WHERE "status" = 'PENDING';

CREATE FUNCTION "prevent_journey_append_only_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'journey append-only record cannot be mutated';
END;
$$;

CREATE FUNCTION "enforce_journey_subject_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" <> OLD."id"
    OR NEW."tenant_id" <> OLD."tenant_id"
    OR NEW."organization_id" <> OLD."organization_id"
    OR NEW."legacy_branch_id" <> OLD."legacy_branch_id"
    OR NEW."legacy_student_id" <> OLD."legacy_student_id"
    OR NEW."legacy_user_id" <> OLD."legacy_user_id"
    OR NEW."subject_ref" <> OLD."subject_ref"
    OR NEW."created_at" <> OLD."created_at"
    OR NEW."version" <> OLD."version" + 1
    OR NOT (
      (OLD."status" = 'ACTIVE' AND NEW."status" IN ('SUSPENDED', 'CLOSED'))
      OR (OLD."status" = 'SUSPENDED' AND NEW."status" IN ('ACTIVE', 'CLOSED'))
    )
  THEN
    RAISE EXCEPTION 'invalid Student Journey subject update';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journey_subject_update_guard"
  BEFORE UPDATE ON "journey_subjects"
  FOR EACH ROW EXECUTE FUNCTION "enforce_journey_subject_update"();

CREATE FUNCTION "enforce_journey_dossier_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" <> OLD."id"
    OR NEW."tenant_id" <> OLD."tenant_id"
    OR NEW."subject_id" <> OLD."subject_id"
    OR NEW."created_at" <> OLD."created_at"
    OR NEW."version" <> OLD."version" + 1
    OR NOT (OLD."status" = 'ACTIVE' AND NEW."status" = 'CLOSED')
  THEN
    RAISE EXCEPTION 'invalid Student Journey dossier update';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journey_dossier_update_guard"
  BEFORE UPDATE ON "journey_dossiers"
  FOR EACH ROW EXECUTE FUNCTION "enforce_journey_dossier_update"();

CREATE FUNCTION "enforce_journey_notification_intent_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" <> OLD."id"
    OR NEW."tenant_id" <> OLD."tenant_id"
    OR NEW."subject_id" <> OLD."subject_id"
    OR NEW."application_case_id" <> OLD."application_case_id"
    OR NEW."task_state_ref" <> OLD."task_state_ref"
    OR NEW."purpose" <> OLD."purpose"
    OR NEW."category" <> OLD."category"
    OR NEW."channel" <> OLD."channel"
    OR NEW."locale" <> OLD."locale"
    OR NEW."intended_at" <> OLD."intended_at"
    OR NEW."dedup_key" <> OLD."dedup_key"
    OR NEW."policy_version" <> OLD."policy_version"
    OR NEW."created_at" <> OLD."created_at"
    OR NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('BLOCKED', 'READY'))
      OR (OLD."status" = 'BLOCKED' AND NEW."status" = 'READY')
    )
  THEN
    RAISE EXCEPTION 'invalid Student Journey notification-intent update';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journey_notification_intent_update_guard"
  BEFORE UPDATE ON "journey_notification_intents"
  FOR EACH ROW EXECUTE FUNCTION "enforce_journey_notification_intent_update"();

CREATE FUNCTION "enforce_journey_response_command_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."tenant_id" <> OLD."tenant_id"
    OR NEW."idempotency_key_hash" <> OLD."idempotency_key_hash"
    OR NEW."command_hash" <> OLD."command_hash"
    OR NEW."created_at" <> OLD."created_at"
    OR OLD."status" <> 'CLAIMED'
    OR NEW."status" <> 'COMMITTED'
  THEN
    RAISE EXCEPTION 'invalid Student Journey response-command update';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journey_response_command_update_guard"
  BEFORE UPDATE ON "journey_document_response_commands"
  FOR EACH ROW EXECUTE FUNCTION "enforce_journey_response_command_update"();

CREATE FUNCTION "enforce_journey_application_transition"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" <> OLD."id"
    OR NEW."tenant_id" <> OLD."tenant_id"
    OR NEW."organization_id" <> OLD."organization_id"
    OR NEW."legacy_branch_id" <> OLD."legacy_branch_id"
    OR NEW."subject_id" <> OLD."subject_id"
    OR NEW."dossier_id" <> OLD."dossier_id"
    OR NEW."legacy_application_id" <> OLD."legacy_application_id"
    OR NEW."corridor_code" <> OLD."corridor_code"
    OR NEW."created_at" <> OLD."created_at"
    OR NEW."aggregate_version" <> OLD."aggregate_version" + 1
    OR (
      OLD."lifecycle_state" = 'DOSSIER_VERIFIED'
      AND NEW."active_dossier_revision_id" IS DISTINCT FROM OLD."active_dossier_revision_id"
    )
    OR NOT (
      (OLD."lifecycle_state" = 'DOSSIER_PREPARATION' AND NEW."lifecycle_state" = 'DOSSIER_VERIFIED')
      OR (OLD."lifecycle_state" = 'DOSSIER_VERIFIED' AND NEW."lifecycle_state" = 'APPLICATION_SUBMITTED')
    )
  THEN
    RAISE EXCEPTION 'invalid Student Journey application transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journey_application_transition_guard"
  BEFORE UPDATE ON "journey_application_cases"
  FOR EACH ROW EXECUTE FUNCTION "enforce_journey_application_transition"();

CREATE FUNCTION "verify_journey_application_transition_receipts"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  verified_revision boolean;
BEGIN
  SELECT revision."revision_state" = 'VERIFIED'
    AND EXISTS (
      SELECT 1
      FROM "journey_requirement_items" item
      WHERE item."tenant_id" = NEW."tenant_id"
        AND item."requirement_set_id" = revision."requirement_set_id"
        AND item."mandatory"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "journey_requirement_items" item
      LEFT JOIN "journey_requirement_results" result
        ON result."tenant_id" = item."tenant_id"
       AND result."requirement_set_id" = item."requirement_set_id"
       AND result."requirement_code" = item."requirement_code"
       AND result."dossier_revision_id" = revision."id"
      WHERE item."tenant_id" = NEW."tenant_id"
        AND item."requirement_set_id" = revision."requirement_set_id"
        AND item."mandatory"
        AND (result."id" IS NULL OR result."result_state" <> 'VERIFIED')
    )
  INTO verified_revision
  FROM "journey_dossier_revisions" revision
  WHERE revision."tenant_id" = NEW."tenant_id"
    AND revision."id" = NEW."active_dossier_revision_id"
    AND revision."dossier_id" = NEW."dossier_id";

  IF verified_revision IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Journey transition requires a fully verified immutable dossier revision';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "journey_state_transition_receipts" receipt
    WHERE receipt."tenant_id" = NEW."tenant_id"
      AND receipt."application_case_id" = NEW."id"
      AND receipt."from_state" = OLD."lifecycle_state"
      AND receipt."to_state" = NEW."lifecycle_state"
      AND receipt."previous_version" = OLD."aggregate_version"
      AND receipt."next_version" = NEW."aggregate_version"
  ) THEN
    RAISE EXCEPTION 'Journey transition receipt is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "journey_milestone_events" event
    WHERE event."tenant_id" = NEW."tenant_id"
      AND event."application_case_id" = NEW."id"
      AND event."aggregate_version" = NEW."aggregate_version"
      AND event."lifecycle_ref" = NEW."lifecycle_state"
  ) THEN
    RAISE EXCEPTION 'Journey milestone event is missing';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journey_application_transition_receipt_guard"
  AFTER UPDATE ON "journey_application_cases"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "verify_journey_application_transition_receipts"();

CREATE FUNCTION "enforce_journey_document_request_transition"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."tenant_id" <> OLD."tenant_id"
    OR NEW."subject_id" <> OLD."subject_id"
    OR NEW."application_case_id" <> OLD."application_case_id"
    OR NEW."requirement_code" <> OLD."requirement_code"
    OR NEW."requested_by_principal_id" <> OLD."requested_by_principal_id"
    OR NEW."requested_by_membership_id" <> OLD."requested_by_membership_id"
    OR NEW."version" <> OLD."version" + 1
    OR NOT (
      (OLD."state" = 'OPEN' AND NEW."state" IN ('OPEN', 'RESPONDED', 'CANCELLED'))
      OR (OLD."state" = 'RESPONDED' AND NEW."state" IN ('FULFILLED', 'CANCELLED'))
    )
  THEN
    RAISE EXCEPTION 'invalid Student Journey document-request transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journey_document_request_transition_guard"
  BEFORE UPDATE ON "journey_document_requests"
  FOR EACH ROW EXECUTE FUNCTION "enforce_journey_document_request_transition"();

CREATE FUNCTION "enqueue_journey_receipt_outbox"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_type text;
  aggregate_type text;
  aggregate_id uuid;
  dedup text;
  payload jsonb;
  payload_hash text;
  recorded_timestamp timestamp with time zone;
BEGIN
  IF TG_TABLE_NAME = 'journey_document_response_receipts' THEN
    event_type := CASE WHEN NEW."response_kind" = 'ACKNOWLEDGE'
      THEN 'student.document_request.acknowledged.v1'
      ELSE 'student.document_request.responded.v1' END;
    aggregate_type := 'student_document_request';
    aggregate_id := NEW."document_request_id";
    dedup := NEW."receipt_hash";
    payload := NEW."receipt_payload";
    payload_hash := NEW."receipt_hash";
    recorded_timestamp := NEW."occurred_at";
  ELSIF TG_TABLE_NAME = 'journey_milestone_events' THEN
    event_type := 'journey.milestone.completed.v1';
    aggregate_type := 'journey_application_case';
    aggregate_id := NEW."application_case_id";
    dedup := NEW."dedup_key";
    payload := jsonb_build_object(
      'schemaVersion', 1,
      'eventId', NEW."id",
      'tenantId', NEW."tenant_id",
      'applicationRef', NEW."application_case_id",
      'subjectRef', NEW."subject_id",
      'aggregateVersion', NEW."aggregate_version",
      'lifecycleRef', NEW."lifecycle_ref",
      'milestoneCode', NEW."milestone_code",
      'eventHash', NEW."event_hash"
    );
    payload_hash := NEW."event_hash";
    recorded_timestamp := NEW."recorded_at";
  ELSE
    RAISE EXCEPTION 'unsupported Journey outbox source';
  END IF;

  INSERT INTO "journey_outbox_events" (
    "id", "tenant_id", "aggregate_type", "aggregate_id", "event_type",
    "dedup_key", "payload", "payload_hash", "recorded_at"
  ) VALUES (
    NEW."id", NEW."tenant_id", aggregate_type, aggregate_id, event_type,
    dedup, payload, payload_hash, recorded_timestamp
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journey_document_response_outbox"
  AFTER INSERT ON "journey_document_response_receipts"
  FOR EACH ROW EXECUTE FUNCTION "enqueue_journey_receipt_outbox"();

CREATE TRIGGER "journey_milestone_outbox"
  AFTER INSERT ON "journey_milestone_events"
  FOR EACH ROW EXECUTE FUNCTION "enqueue_journey_receipt_outbox"();

DO $$
DECLARE
  table_name text;
  mutable_tables constant text[] := ARRAY[
    'journey_subjects',
    'journey_dossiers',
    'journey_application_cases',
    'journey_notification_intents',
    'journey_document_requests',
    'journey_document_response_commands',
    'journey_outbox_events'
  ];
  all_tables constant text[] := ARRAY[
    'journey_subjects',
    'journey_requirement_sets',
    'journey_requirement_items',
    'journey_dossiers',
    'journey_dossier_revisions',
    'journey_application_cases',
    'journey_requirement_results',
    'journey_verified_evidence_receipts',
    'journey_consent_receipts',
    'journey_communication_preference_receipts',
    'journey_communication_suppression_receipts',
    'journey_notification_intents',
    'journey_communication_decision_receipts',
    'journey_document_requests',
    'journey_document_ingest_receipts',
    'journey_document_access_receipts',
    'journey_document_response_receipts',
    'journey_document_response_audits',
    'journey_document_ingest_consumptions',
    'journey_document_response_commands',
    'journey_state_transition_receipts',
    'journey_milestone_events',
    'journey_milestone_evidence',
    'journey_qavjp_snapshots',
    'journey_qavjp_items',
    'journey_outbox_events'
  ];
BEGIN
  FOREACH table_name IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_select_same_tenant', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_insert_same_tenant', table_name
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
  END LOOP;

  FOREACH table_name IN ARRAY mutable_tables LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_update_same_tenant', table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
  immutable_tables constant text[] := ARRAY[
    'journey_requirement_sets',
    'journey_requirement_items',
    'journey_dossier_revisions',
    'journey_requirement_results',
    'journey_verified_evidence_receipts',
    'journey_consent_receipts',
    'journey_communication_preference_receipts',
    'journey_communication_suppression_receipts',
    'journey_communication_decision_receipts',
    'journey_document_ingest_receipts',
    'journey_document_access_receipts',
    'journey_document_response_receipts',
    'journey_document_response_audits',
    'journey_document_ingest_consumptions',
    'journey_state_transition_receipts',
    'journey_milestone_events',
    'journey_milestone_evidence',
    'journey_qavjp_snapshots',
    'journey_qavjp_items'
  ];
BEGIN
  FOREACH table_name IN ARRAY immutable_tables LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_journey_append_only_mutation()',
      table_name || '_immutable_guard', table_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION "verify_journey_milestone_evidence"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "journey_milestone_evidence" evidence
    WHERE evidence."tenant_id" = NEW."tenant_id"
      AND evidence."milestone_event_id" = NEW."id"
      AND evidence."evidence_kind" = NEW."verification_kind"
  ) THEN
    RAISE EXCEPTION 'Journey milestone requires matching immutable evidence';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journey_milestone_evidence_guard"
  AFTER INSERT ON "journey_milestone_events"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "verify_journey_milestone_evidence"();

CREATE FUNCTION "verify_journey_qavjp_snapshot"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_count integer;
  total_weight bigint;
  owner_coverage integer;
  action_coverage integer;
BEGIN
  SELECT count(*)::integer,
         coalesce(sum("weight_bps"), 0)::bigint,
         round(10000.0 * count("owner_legacy_user_id") / nullif(count(*), 0))::integer,
         round(10000.0 * count("next_action") / nullif(count(*), 0))::integer
    INTO item_count, total_weight, owner_coverage, action_coverage
  FROM "journey_qavjp_items"
  WHERE "tenant_id" = NEW."tenant_id" AND "snapshot_id" = NEW."id";

  IF item_count <> NEW."eligible_item_count"
    OR total_weight <> NEW."denominator_weight_bps"
    OR owner_coverage <> NEW."owner_coverage_bps"
    OR action_coverage <> NEW."next_action_coverage_bps" THEN
    RAISE EXCEPTION 'QAVJP frozen denominator derived fields do not reconcile';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journey_qavjp_snapshot_reconciliation_guard"
  AFTER INSERT ON "journey_qavjp_snapshots"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "verify_journey_qavjp_snapshot"();

CREATE SCHEMA "fas_journey_v1";
REVOKE ALL ON SCHEMA "fas_journey_v1" FROM PUBLIC;

CREATE FUNCTION "fas_journey_v1"."revalidate_document_request_response_authority"(
  p_tenant_id uuid,
  p_selection_id uuid,
  p_session_generation bigint,
  p_actor_principal_id uuid,
  p_actor_membership_id uuid,
  p_occurred_at timestamp with time zone,
  p_policy_version_id uuid,
  p_subject_id uuid,
  p_application_case_id uuid,
  p_document_request_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO pg_catalog, public
SET row_security TO on
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.active_session_context_selections selection
    JOIN public.principals principal
      ON principal.id = selection.principal_id
     AND principal.legacy_user_id = selection.legacy_user_id
    JOIN public.memberships membership
      ON membership.tenant_id = selection.tenant_id
     AND membership.id = selection.membership_id
     AND membership.principal_id = selection.principal_id
    JOIN public.tenants tenant ON tenant.id = selection.tenant_id
    JOIN public.policy_versions policy
      ON policy.tenant_id = selection.tenant_id
     AND policy.id = p_policy_version_id
     AND policy.version_number = tenant.policy_version
    JOIN public.journey_subjects subject
      ON subject.tenant_id = selection.tenant_id
     AND subject.id = p_subject_id
     AND subject.legacy_user_id = selection.legacy_user_id
     AND subject.organization_id = selection.organization_id
     AND subject.legacy_branch_id = selection.legacy_branch_id
    JOIN public.journey_application_cases application_case
      ON application_case.tenant_id = subject.tenant_id
     AND application_case.id = p_application_case_id
     AND application_case.subject_id = subject.id
     AND application_case.organization_id = subject.organization_id
     AND application_case.legacy_branch_id = subject.legacy_branch_id
    JOIN public.journey_document_requests request
      ON request.tenant_id = application_case.tenant_id
     AND request.id = p_document_request_id
     AND request.subject_id = subject.id
     AND request.application_case_id = application_case.id
    JOIN public.access_assignments assignment
      ON assignment.tenant_id = membership.tenant_id
     AND assignment.membership_id = membership.id
    JOIN public.role_package_versions package
      ON package.id = assignment.role_package_version_id
    JOIN public.role_definitions role_definition
      ON role_definition.id = package.role_definition_id
    JOIN public.role_package_capabilities capability_grant
      ON capability_grant.role_package_version_id = package.id
     AND capability_grant.capability_key = 'student.document_request.respond'
     AND capability_grant.effect = 'ALLOW'
    JOIN public.capability_definitions capability
      ON capability.key = capability_grant.capability_key
    WHERE selection.tenant_id = p_tenant_id
      AND selection.id = p_selection_id
      AND selection.session_generation = p_session_generation
      AND selection.principal_id = p_actor_principal_id
      AND selection.membership_id = p_actor_membership_id
      AND selection.status = 'ACTIVE'
      AND selection.impersonator_principal_id IS NULL
      AND principal.id = p_actor_principal_id
      AND principal.status = 'ACTIVE'
      AND principal.risk_state = 'NORMAL'
      AND tenant.status = 'ACTIVE'
      AND membership.status = 'ACTIVE'
      AND membership.valid_from <= p_occurred_at
      AND (membership.valid_until IS NULL OR membership.valid_until > p_occurred_at)
      AND subject.status = 'ACTIVE'
      AND policy.state = 'ACTIVE'
      AND policy.effective_at <= p_occurred_at
      AND policy.revoked_at IS NULL
      AND assignment.status = 'ACTIVE'
      AND assignment.valid_from <= p_occurred_at
      AND (assignment.valid_until IS NULL OR assignment.valid_until > p_occurred_at)
      AND package.status = 'ACTIVE'
      AND package.effective_at <= p_occurred_at
      AND (package.deprecated_at IS NULL OR package.deprecated_at > p_occurred_at)
      AND role_definition.status = 'ACTIVE'
      AND capability.status = 'ACTIVE'
      AND (
        assignment.scope_type = 'TENANT'
        OR (
          assignment.scope_type = 'ORGANIZATION'
          AND assignment.organization_id = subject.organization_id
        )
        OR (
          assignment.scope_type = 'LEGACY_BRANCH'
          AND assignment.organization_id = subject.organization_id
          AND assignment.legacy_branch_id = subject.legacy_branch_id
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.access_assignments deny_assignment
        JOIN public.role_package_versions deny_package
          ON deny_package.id = deny_assignment.role_package_version_id
         AND deny_package.status = 'ACTIVE'
        JOIN public.role_package_capabilities deny_capability
          ON deny_capability.role_package_version_id = deny_package.id
         AND deny_capability.capability_key = 'student.document_request.respond'
         AND deny_capability.effect = 'DENY'
        WHERE deny_assignment.tenant_id = membership.tenant_id
          AND deny_assignment.membership_id = membership.id
          AND deny_assignment.status = 'ACTIVE'
          AND deny_assignment.valid_from <= p_occurred_at
          AND (deny_assignment.valid_until IS NULL OR deny_assignment.valid_until > p_occurred_at)
          AND (
            deny_assignment.scope_type = 'TENANT'
            OR (
              deny_assignment.scope_type = 'ORGANIZATION'
              AND deny_assignment.organization_id = subject.organization_id
            )
            OR (
              deny_assignment.scope_type = 'LEGACY_BRANCH'
              AND deny_assignment.organization_id = subject.organization_id
              AND deny_assignment.legacy_branch_id = subject.legacy_branch_id
            )
          )
      )
    FOR KEY SHARE OF selection, principal, membership, tenant, policy,
      subject, application_case, request, assignment, package,
      role_definition, capability_grant, capability
  );
$$;

REVOKE ALL ON FUNCTION "fas_journey_v1"."revalidate_document_request_response_authority"(
  uuid, uuid, bigint, uuid, uuid, timestamp with time zone,
  uuid, uuid, uuid, uuid
) FROM PUBLIC;
