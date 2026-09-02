-- Institution Admissions v1 foundation.
-- Additive/default-off: no legacy application is backfilled, no user is granted
-- institution access, and no external message/submission worker is activated.

CREATE TABLE "institution_relationships" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "institution_id" integer NOT NULL REFERENCES "universities"("id") ON DELETE RESTRICT,
  "purpose_code" text NOT NULL,
  "data_scopes" text[] NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "policy_version" bigint NOT NULL DEFAULT 1,
  "valid_from" timestamptz NOT NULL DEFAULT now(),
  "valid_until" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_relationships_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_relationships_tenant_institution_uq" UNIQUE ("tenant_id", "institution_id"),
  CONSTRAINT "institution_relationships_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_relationships_status_chk" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT "institution_relationships_purpose_chk" CHECK ("purpose_code" ~ '^[a-z][a-z0-9._:-]{1,95}$'),
  CONSTRAINT "institution_relationships_policy_version_chk" CHECK ("policy_version" > 0),
  CONSTRAINT "institution_relationships_validity_chk" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from")
);
CREATE INDEX "institution_relationships_status_idx" ON "institution_relationships" ("tenant_id", "status");

CREATE TABLE "institution_memberships" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL REFERENCES "principals"("id") ON DELETE RESTRICT,
  "role_package_version_id" uuid NOT NULL REFERENCES "role_package_versions"("id") ON DELETE RESTRICT,
  "legacy_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "role_key" text NOT NULL,
  "program_scope_ids" integer[] NOT NULL DEFAULT '{}',
  "intake_scopes" text[] NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'PENDING',
  "valid_from" timestamptz NOT NULL DEFAULT now(),
  "valid_until" timestamptz,
  "version" bigint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_memberships_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_memberships_relationship_fk" FOREIGN KEY ("tenant_id", "relationship_id") REFERENCES "institution_relationships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_memberships_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_memberships_role_chk" CHECK ("role_key" IN ('INSTITUTION_ADMIN', 'PROGRAM_INTAKE_MANAGER', 'ADMISSIONS_REVIEWER', 'DECISION_APPROVER', 'INTEGRATION_ADMIN', 'INSTITUTION_AUDITOR')),
  CONSTRAINT "institution_memberships_status_chk" CHECK ("status" IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT "institution_memberships_version_chk" CHECK ("version" > 0),
  CONSTRAINT "institution_memberships_validity_chk" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from")
);
CREATE UNIQUE INDEX "institution_memberships_active_user_uidx"
  ON "institution_memberships" ("legacy_user_id")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "institution_memberships_user_status_idx" ON "institution_memberships" ("legacy_user_id", "status");
CREATE INDEX "institution_memberships_relationship_role_idx" ON "institution_memberships" ("tenant_id", "relationship_id", "role_key", "status");
CREATE INDEX "institution_memberships_role_package_idx" ON "institution_memberships" ("role_package_version_id", "status");

CREATE TABLE "institution_sla_policies" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "name" text NOT NULL,
  "timezone" text NOT NULL,
  "review_target_hours" integer NOT NULL,
  "decision_target_hours" integer NOT NULL,
  "information_response_hours" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "version" bigint NOT NULL DEFAULT 1,
  "created_by_membership_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_sla_policies_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_sla_policies_relationship_version_uq" UNIQUE ("tenant_id", "relationship_id", "version"),
  CONSTRAINT "institution_sla_policies_relationship_fk" FOREIGN KEY ("tenant_id", "relationship_id") REFERENCES "institution_relationships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_sla_policies_creator_fk" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_sla_policies_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_sla_policies_status_chk" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT "institution_sla_policies_targets_chk" CHECK ("review_target_hours" BETWEEN 1 AND 2160 AND "decision_target_hours" BETWEEN 1 AND 2160 AND "information_response_hours" BETWEEN 1 AND 2160),
  CONSTRAINT "institution_sla_policies_version_chk" CHECK ("version" > 0)
);

CREATE TABLE "institution_application_cases" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "legacy_application_id" integer NOT NULL REFERENCES "applications"("id") ON DELETE RESTRICT,
  "institution_id" integer NOT NULL REFERENCES "universities"("id") ON DELETE RESTRICT,
  "program_id" integer REFERENCES "programs"("id") ON DELETE RESTRICT,
  "intake_key" text,
  "masked_student_ref" text NOT NULL,
  "shared_profile" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "lifecycle_state" text NOT NULL DEFAULT 'RECEIVED',
  "priority" text NOT NULL DEFAULT 'NORMAL',
  "readiness_percent" integer NOT NULL DEFAULT 0,
  "blocker_code" text,
  "assigned_reviewer_membership_id" uuid,
  "sla_policy_id" uuid,
  "review_due_at" timestamptz,
  "decision_due_at" timestamptz,
  "aggregate_version" bigint NOT NULL DEFAULT 1,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "last_activity_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_application_cases_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_application_cases_relationship_id_id_uq" UNIQUE ("tenant_id", "relationship_id", "id"),
  CONSTRAINT "institution_application_cases_legacy_uq" UNIQUE ("tenant_id", "relationship_id", "legacy_application_id"),
  CONSTRAINT "institution_application_cases_relationship_fk" FOREIGN KEY ("tenant_id", "relationship_id") REFERENCES "institution_relationships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_application_cases_reviewer_fk" FOREIGN KEY ("tenant_id", "assigned_reviewer_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_application_cases_sla_fk" FOREIGN KEY ("tenant_id", "sla_policy_id") REFERENCES "institution_sla_policies"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_application_cases_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_application_cases_state_chk" CHECK ("lifecycle_state" IN ('RECEIVED', 'REVIEWING', 'INFORMATION_REQUESTED', 'READY_FOR_DECISION', 'DECISION_PENDING_APPROVAL', 'DECIDED', 'OFFER_ISSUED', 'ENROLMENT_PENDING', 'ENROLLED', 'CLOSED')),
  CONSTRAINT "institution_application_cases_priority_chk" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  CONSTRAINT "institution_application_cases_readiness_chk" CHECK ("readiness_percent" BETWEEN 0 AND 100),
  CONSTRAINT "institution_application_cases_version_chk" CHECK ("aggregate_version" > 0)
);
CREATE INDEX "institution_application_cases_queue_idx" ON "institution_application_cases" ("tenant_id", "relationship_id", "lifecycle_state", "review_due_at");
CREATE INDEX "institution_application_cases_reviewer_idx" ON "institution_application_cases" ("tenant_id", "assigned_reviewer_membership_id", "lifecycle_state");

CREATE TABLE "institution_requirement_sets" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "program_id" integer NOT NULL REFERENCES "programs"("id") ON DELETE RESTRICT,
  "intake_key" text NOT NULL,
  "version_number" bigint NOT NULL,
  "state" text NOT NULL DEFAULT 'DRAFT',
  "source_ref" text NOT NULL,
  "source_hash" text NOT NULL,
  "content_hash" text NOT NULL,
  "effective_from" timestamptz,
  "effective_until" timestamptz,
  "created_by_membership_id" uuid NOT NULL,
  "approved_by_membership_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz,
  CONSTRAINT "institution_requirement_sets_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_requirement_sets_scope_version_uq" UNIQUE ("tenant_id", "relationship_id", "program_id", "intake_key", "version_number"),
  CONSTRAINT "institution_requirement_sets_relationship_fk" FOREIGN KEY ("tenant_id", "relationship_id") REFERENCES "institution_relationships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_requirement_sets_creator_fk" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_requirement_sets_approver_fk" FOREIGN KEY ("tenant_id", "approved_by_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_requirement_sets_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_requirement_sets_state_chk" CHECK ("state" IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT "institution_requirement_sets_version_chk" CHECK ("version_number" > 0),
  CONSTRAINT "institution_requirement_sets_hash_chk" CHECK ("source_hash" ~ '^[0-9a-f]{64}$' AND "content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "institution_requirement_sets_checker_chk" CHECK ("approved_by_membership_id" IS NULL OR "approved_by_membership_id" <> "created_by_membership_id")
);

CREATE TABLE "institution_requirements" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "requirement_set_id" uuid NOT NULL,
  "requirement_code" text NOT NULL,
  "title" text NOT NULL,
  "evidence_type" text NOT NULL,
  "mandatory" boolean NOT NULL DEFAULT true,
  "rule" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_requirements_pk" PRIMARY KEY ("tenant_id", "id"),
  CONSTRAINT "institution_requirements_set_code_uq" UNIQUE ("tenant_id", "requirement_set_id", "requirement_code"),
  CONSTRAINT "institution_requirements_set_fk" FOREIGN KEY ("tenant_id", "requirement_set_id") REFERENCES "institution_requirement_sets"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_requirements_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_requirements_code_chk" CHECK ("requirement_code" ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

CREATE TABLE "institution_evidence_assessments" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "requirement_id" uuid,
  "evidence_ref_hash" text NOT NULL,
  "result" text NOT NULL,
  "reason_code" text NOT NULL,
  "notes" text,
  "reviewer_membership_id" uuid NOT NULL,
  "supersedes_assessment_id" uuid,
  "assessment_hash" text NOT NULL,
  "assessed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_evidence_assessments_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_evidence_assessments_case_fk" FOREIGN KEY ("tenant_id", "relationship_id", "application_case_id") REFERENCES "institution_application_cases"("tenant_id", "relationship_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_evidence_assessments_requirement_fk" FOREIGN KEY ("tenant_id", "requirement_id") REFERENCES "institution_requirements"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_evidence_assessments_reviewer_fk" FOREIGN KEY ("tenant_id", "reviewer_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_evidence_assessments_supersedes_fk" FOREIGN KEY ("tenant_id", "supersedes_assessment_id") REFERENCES "institution_evidence_assessments"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_evidence_assessments_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_evidence_assessments_result_chk" CHECK ("result" IN ('PENDING', 'VERIFIED', 'NEEDS_INFORMATION', 'REJECTED')),
  CONSTRAINT "institution_evidence_assessments_hash_chk" CHECK ("evidence_ref_hash" ~ '^[0-9a-f]{64}$' AND "assessment_hash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "institution_evidence_assessments_case_idx" ON "institution_evidence_assessments" ("tenant_id", "application_case_id", "assessed_at");

CREATE TABLE "institution_information_requests" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "requirement_code" text NOT NULL,
  "request_code" text NOT NULL,
  "message" text NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "created_by_membership_id" uuid NOT NULL,
  "due_at" timestamptz,
  "version" bigint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "responded_at" timestamptz,
  "closed_at" timestamptz,
  CONSTRAINT "institution_information_requests_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_information_requests_case_fk" FOREIGN KEY ("tenant_id", "relationship_id", "application_case_id") REFERENCES "institution_application_cases"("tenant_id", "relationship_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_information_requests_creator_fk" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_information_requests_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_information_requests_status_chk" CHECK ("status" IN ('OPEN', 'RESPONDED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT "institution_information_requests_code_chk" CHECK ("request_code" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT "institution_information_requests_version_chk" CHECK ("version" > 0)
);
CREATE INDEX "institution_information_requests_case_status_idx" ON "institution_information_requests" ("tenant_id", "application_case_id", "status");

CREATE TABLE "institution_decisions" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "version_number" bigint NOT NULL,
  "decision_type" text NOT NULL,
  "state" text NOT NULL DEFAULT 'DRAFT',
  "reason_code" text NOT NULL,
  "rationale" text NOT NULL,
  "conditions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "maker_membership_id" uuid NOT NULL,
  "checker_membership_id" uuid,
  "previous_decision_id" uuid,
  "content_hash" text NOT NULL,
  "effective_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "submitted_at" timestamptz,
  "decided_at" timestamptz,
  CONSTRAINT "institution_decisions_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_decisions_case_version_uq" UNIQUE ("tenant_id", "application_case_id", "version_number"),
  CONSTRAINT "institution_decisions_case_fk" FOREIGN KEY ("tenant_id", "relationship_id", "application_case_id") REFERENCES "institution_application_cases"("tenant_id", "relationship_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_decisions_maker_fk" FOREIGN KEY ("tenant_id", "maker_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_decisions_checker_fk" FOREIGN KEY ("tenant_id", "checker_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_decisions_previous_fk" FOREIGN KEY ("tenant_id", "previous_decision_id") REFERENCES "institution_decisions"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_decisions_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_decisions_type_chk" CHECK ("decision_type" IN ('WAITLISTED', 'CONDITIONAL_OFFER', 'UNCONDITIONAL_OFFER', 'REJECTED')),
  CONSTRAINT "institution_decisions_state_chk" CHECK ("state" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'SUPERSEDED')),
  CONSTRAINT "institution_decisions_hash_chk" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "institution_decisions_checker_chk" CHECK ("checker_membership_id" IS NULL OR "checker_membership_id" <> "maker_membership_id"),
  CONSTRAINT "institution_decisions_version_chk" CHECK ("version_number" > 0)
);
CREATE INDEX "institution_decisions_approval_queue_idx" ON "institution_decisions" ("tenant_id", "relationship_id", "state", "submitted_at");

CREATE TABLE "institution_decision_approvals" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "decision_id" uuid NOT NULL,
  "checker_membership_id" uuid NOT NULL,
  "outcome" text NOT NULL,
  "reason_code" text NOT NULL,
  "comment" text,
  "previous_hash" text,
  "receipt_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_decision_approvals_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_decision_approvals_decision_uq" UNIQUE ("tenant_id", "decision_id"),
  CONSTRAINT "institution_decision_approvals_receipt_hash_uq" UNIQUE ("tenant_id", "receipt_hash"),
  CONSTRAINT "institution_decision_approvals_decision_fk" FOREIGN KEY ("tenant_id", "decision_id") REFERENCES "institution_decisions"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_decision_approvals_checker_fk" FOREIGN KEY ("tenant_id", "checker_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_decision_approvals_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_decision_approvals_outcome_chk" CHECK ("outcome" IN ('APPROVED', 'RETURNED', 'REJECTED')),
  CONSTRAINT "institution_decision_approvals_hash_chk" CHECK ("receipt_hash" ~ '^[0-9a-f]{64}$' AND ("previous_hash" IS NULL OR "previous_hash" ~ '^[0-9a-f]{64}$'))
);

CREATE TABLE "institution_offers" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "decision_id" uuid NOT NULL,
  "state" text NOT NULL DEFAULT 'DRAFT',
  "conditions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "acceptance_deadline" timestamptz,
  "issued_by_membership_id" uuid,
  "receipt_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "issued_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_offers_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_offers_decision_uq" UNIQUE ("tenant_id", "decision_id"),
  CONSTRAINT "institution_offers_case_fk" FOREIGN KEY ("tenant_id", "relationship_id", "application_case_id") REFERENCES "institution_application_cases"("tenant_id", "relationship_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_offers_decision_fk" FOREIGN KEY ("tenant_id", "decision_id") REFERENCES "institution_decisions"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_offers_issuer_fk" FOREIGN KEY ("tenant_id", "issued_by_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_offers_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_offers_state_chk" CHECK ("state" IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'DECLINED', 'LAPSED', 'SUPERSEDED')),
  CONSTRAINT "institution_offers_receipt_chk" CHECK (("state" = 'DRAFT' AND "receipt_hash" IS NULL AND "issued_at" IS NULL) OR ("state" <> 'DRAFT' AND "receipt_hash" ~ '^[0-9a-f]{64}$' AND "issued_at" IS NOT NULL))
);

CREATE TABLE "institution_enrolments" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "application_case_id" uuid NOT NULL,
  "state" text NOT NULL DEFAULT 'PENDING_EVIDENCE',
  "evidence_ref_hash" text,
  "verified_by_membership_id" uuid,
  "receipt_hash" text,
  "version" bigint NOT NULL DEFAULT 1,
  "effective_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_enrolments_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_enrolments_case_uq" UNIQUE ("tenant_id", "application_case_id"),
  CONSTRAINT "institution_enrolments_case_fk" FOREIGN KEY ("tenant_id", "relationship_id", "application_case_id") REFERENCES "institution_application_cases"("tenant_id", "relationship_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_enrolments_verifier_fk" FOREIGN KEY ("tenant_id", "verified_by_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_enrolments_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_enrolments_state_chk" CHECK ("state" IN ('PENDING_EVIDENCE', 'CONFIRMED', 'DEFERRED', 'NOT_ENROLLED')),
  CONSTRAINT "institution_enrolments_evidence_chk" CHECK ("state" <> 'CONFIRMED' OR ("evidence_ref_hash" ~ '^[0-9a-f]{64}$' AND "receipt_hash" ~ '^[0-9a-f]{64}$' AND "verified_by_membership_id" IS NOT NULL AND "effective_at" IS NOT NULL)),
  CONSTRAINT "institution_enrolments_version_chk" CHECK ("version" > 0)
);

CREATE TABLE "institution_admission_events" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "application_case_id" uuid,
  "event_type" text NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "aggregate_version" bigint NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "previous_hash" text,
  "event_hash" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "institution_admission_events_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "institution_admission_events_hash_uq" UNIQUE ("tenant_id", "relationship_id", "event_hash"),
  CONSTRAINT "institution_admission_events_relationship_fk" FOREIGN KEY ("tenant_id", "relationship_id") REFERENCES "institution_relationships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_admission_events_case_fk" FOREIGN KEY ("tenant_id", "relationship_id", "application_case_id") REFERENCES "institution_application_cases"("tenant_id", "relationship_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_admission_events_actor_fk" FOREIGN KEY ("tenant_id", "actor_membership_id") REFERENCES "institution_memberships"("tenant_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "institution_admission_events_id_v7_chk" CHECK (substring("id"::text from 15 for 1) = '7'),
  CONSTRAINT "institution_admission_events_event_type_chk" CHECK ("event_type" ~ '^institution\.[a-z][a-z0-9_.-]{1,94}\.v1$'),
  CONSTRAINT "institution_admission_events_hash_chk" CHECK ("event_hash" ~ '^[0-9a-f]{64}$' AND ("previous_hash" IS NULL OR "previous_hash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "institution_admission_events_version_chk" CHECK ("aggregate_version" > 0)
);
CREATE INDEX "institution_admission_events_case_idx" ON "institution_admission_events" ("tenant_id", "application_case_id", "occurred_at");

-- Built-in versioned packages. They define capability vocabulary only; this
-- migration creates no institution membership and therefore grants no access.
INSERT INTO "capability_definitions" ("key", "description", "risk_class", "delegable", "step_up_required", "approval_required", "status", "version") VALUES
  ('institution.workspace.read', 'Read the scoped institution workspace', 'LOW', false, false, false, 'ACTIVE', 1),
  ('institution.applications.review', 'Review assigned institution applications', 'MEDIUM', true, false, false, 'ACTIVE', 1),
  ('institution.evidence.assess', 'Record versioned evidence assessments', 'HIGH', false, false, false, 'ACTIVE', 1),
  ('institution.information.request', 'Create structured information requests', 'MEDIUM', true, false, false, 'ACTIVE', 1),
  ('institution.decisions.draft', 'Draft an institution admission decision', 'HIGH', false, false, true, 'ACTIVE', 1),
  ('institution.decisions.approve', 'Approve an institution admission decision', 'CRITICAL', false, true, true, 'ACTIVE', 1),
  ('institution.offers.issue', 'Issue an approved offer', 'CRITICAL', false, true, true, 'ACTIVE', 1),
  ('institution.enrolment.confirm', 'Confirm enrolment with verified evidence', 'CRITICAL', false, true, true, 'ACTIVE', 1),
  ('institution.catalog.manage', 'Manage scoped programs and intakes', 'HIGH', false, false, true, 'ACTIVE', 1),
  ('institution.requirements.manage', 'Manage versioned admission requirements', 'HIGH', false, false, true, 'ACTIVE', 1),
  ('institution.sla.manage', 'Manage institution SLA policy versions', 'HIGH', false, false, true, 'ACTIVE', 1),
  ('institution.integrations.manage', 'Manage institution integration mappings and secret references', 'CRITICAL', false, true, true, 'ACTIVE', 1),
  ('institution.analytics.read', 'Read PII-minimized institution analytics', 'LOW', false, false, false, 'ACTIVE', 1),
  ('institution.team.manage', 'Manage institution relationship memberships', 'CRITICAL', false, true, true, 'ACTIVE', 1),
  ('institution.audit.read', 'Read masked institution audit evidence', 'MEDIUM', false, false, false, 'ACTIVE', 1)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_definitions" ("id", "key", "display_name", "purpose", "principal_type", "status", "version") VALUES
  ('018f9000-0000-7000-8000-000000000001', 'institution.admin', 'Institution Admin', 'Institution operations, team, SLA and scoped configuration', 'HUMAN', 'ACTIVE', 1),
  ('018f9000-0000-7000-8000-000000000002', 'institution.program_intake_manager', 'Program / Intake Manager', 'Scoped program, intake and requirement management', 'HUMAN', 'ACTIVE', 1),
  ('018f9000-0000-7000-8000-000000000003', 'institution.admissions_reviewer', 'Admissions Reviewer', 'Assigned application and evidence review without final decision authority', 'HUMAN', 'ACTIVE', 1),
  ('018f9000-0000-7000-8000-000000000004', 'institution.decision_approver', 'Decision Approver', 'Maker-checker approval of versioned institution decisions', 'HUMAN', 'ACTIVE', 1),
  ('018f9000-0000-7000-8000-000000000005', 'institution.integration_admin', 'Integration Admin', 'Scoped integration mapping and receipt operations', 'HUMAN', 'ACTIVE', 1),
  ('018f9000-0000-7000-8000-000000000006', 'institution.auditor', 'Institution Auditor', 'Masked read-only institution audit review', 'HUMAN', 'ACTIVE', 1)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_package_versions" ("id", "role_definition_id", "version_number", "status", "default_scope_type", "constraint_document", "checksum", "effective_at") VALUES
  ('018f9000-0000-7000-8000-000000000011', '018f9000-0000-7000-8000-000000000001', 1, 'ACTIVE', 'TENANT', '{"relationshipType":"INSTITUTION","scope":"institution"}'::jsonb, repeat('1', 64), now()),
  ('018f9000-0000-7000-8000-000000000012', '018f9000-0000-7000-8000-000000000002', 1, 'ACTIVE', 'TENANT', '{"relationshipType":"INSTITUTION","scope":"program_intake"}'::jsonb, repeat('2', 64), now()),
  ('018f9000-0000-7000-8000-000000000013', '018f9000-0000-7000-8000-000000000003', 1, 'ACTIVE', 'TENANT', '{"relationshipType":"INSTITUTION","scope":"assigned_case"}'::jsonb, repeat('3', 64), now()),
  ('018f9000-0000-7000-8000-000000000014', '018f9000-0000-7000-8000-000000000004', 1, 'ACTIVE', 'TENANT', '{"relationshipType":"INSTITUTION","scope":"decision_queue","makerChecker":true}'::jsonb, repeat('4', 64), now()),
  ('018f9000-0000-7000-8000-000000000015', '018f9000-0000-7000-8000-000000000005', 1, 'ACTIVE', 'TENANT', '{"relationshipType":"INSTITUTION","scope":"integration"}'::jsonb, repeat('5', 64), now()),
  ('018f9000-0000-7000-8000-000000000016', '018f9000-0000-7000-8000-000000000006', 1, 'ACTIVE', 'TENANT', '{"relationshipType":"INSTITUTION","scope":"masked_read_only"}'::jsonb, repeat('6', 64), now())
ON CONFLICT ("role_definition_id", "version_number") DO NOTHING;

INSERT INTO "role_package_capabilities" ("role_package_version_id", "capability_key", "effect") VALUES
  ('018f9000-0000-7000-8000-000000000011', 'institution.workspace.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000011', 'institution.applications.review', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000011', 'institution.analytics.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000011', 'institution.sla.manage', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000011', 'institution.team.manage', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000011', 'institution.audit.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000012', 'institution.workspace.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000012', 'institution.catalog.manage', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000012', 'institution.requirements.manage', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000013', 'institution.workspace.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000013', 'institution.applications.review', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000013', 'institution.evidence.assess', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000013', 'institution.information.request', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000013', 'institution.decisions.draft', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000014', 'institution.workspace.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000014', 'institution.decisions.approve', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000014', 'institution.offers.issue', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000014', 'institution.enrolment.confirm', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000015', 'institution.workspace.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000015', 'institution.integrations.manage', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000016', 'institution.workspace.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000016', 'institution.analytics.read', 'ALLOW'),
  ('018f9000-0000-7000-8000-000000000016', 'institution.audit.read', 'ALLOW')
ON CONFLICT ("role_package_version_id", "capability_key") DO NOTHING;

CREATE FUNCTION "prevent_institution_append_only_mutation"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'institution append-only history cannot be mutated' USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION "enforce_institution_case_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'institution case version must increment by one' USING ERRCODE = '40001';
  END IF;
  IF NOT (
    (OLD.lifecycle_state = NEW.lifecycle_state) OR
    (OLD.lifecycle_state = 'RECEIVED' AND NEW.lifecycle_state IN ('REVIEWING', 'CLOSED')) OR
    (OLD.lifecycle_state = 'REVIEWING' AND NEW.lifecycle_state IN ('INFORMATION_REQUESTED', 'READY_FOR_DECISION', 'CLOSED')) OR
    (OLD.lifecycle_state = 'INFORMATION_REQUESTED' AND NEW.lifecycle_state IN ('REVIEWING', 'READY_FOR_DECISION', 'CLOSED')) OR
    (OLD.lifecycle_state = 'READY_FOR_DECISION' AND NEW.lifecycle_state IN ('DECISION_PENDING_APPROVAL', 'REVIEWING', 'CLOSED')) OR
    (OLD.lifecycle_state = 'DECISION_PENDING_APPROVAL' AND NEW.lifecycle_state IN ('DECIDED', 'READY_FOR_DECISION')) OR
    (OLD.lifecycle_state = 'DECIDED' AND NEW.lifecycle_state IN ('OFFER_ISSUED', 'CLOSED')) OR
    (OLD.lifecycle_state = 'OFFER_ISSUED' AND NEW.lifecycle_state IN ('ENROLMENT_PENDING', 'CLOSED')) OR
    (OLD.lifecycle_state = 'ENROLMENT_PENDING' AND NEW.lifecycle_state IN ('ENROLLED', 'CLOSED'))
  ) THEN
    RAISE EXCEPTION 'invalid institution case transition % -> %', OLD.lifecycle_state, NEW.lifecycle_state USING ERRCODE = '23514';
  END IF;
  IF OLD.lifecycle_state IN ('ENROLLED', 'CLOSED') THEN
    RAISE EXCEPTION 'terminal institution case cannot be updated' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  NEW.last_activity_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "institution_case_transition_guard"
  BEFORE UPDATE ON "institution_application_cases"
  FOR EACH ROW EXECUTE FUNCTION "enforce_institution_case_transition"();

CREATE FUNCTION "enforce_institution_decision_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.content_hash <> NEW.content_hash OR OLD.maker_membership_id <> NEW.maker_membership_id OR OLD.decision_type <> NEW.decision_type OR OLD.conditions <> NEW.conditions THEN
    RAISE EXCEPTION 'decision content is immutable; create a new version' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD.state = 'DRAFT' AND NEW.state = 'SUBMITTED' AND NEW.submitted_at IS NOT NULL) OR
    (OLD.state = 'SUBMITTED' AND NEW.state IN ('APPROVED', 'RETURNED', 'REJECTED') AND NEW.checker_membership_id IS NOT NULL AND NEW.checker_membership_id <> NEW.maker_membership_id)
  ) THEN
    RAISE EXCEPTION 'invalid institution decision transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'APPROVED' AND (NEW.decided_at IS NULL OR NEW.effective_at IS NULL) THEN
    RAISE EXCEPTION 'approved decision requires effective and decided timestamps' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "institution_decision_transition_guard"
  BEFORE UPDATE ON "institution_decisions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_institution_decision_transition"();

CREATE FUNCTION "enforce_institution_offer_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.decision_id <> NEW.decision_id OR OLD.application_case_id <> NEW.application_case_id OR OLD.conditions <> NEW.conditions THEN
    RAISE EXCEPTION 'offer content is immutable; create a superseding offer' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD.state = 'DRAFT' AND NEW.state = 'ISSUED' AND NEW.issued_at IS NOT NULL AND NEW.receipt_hash IS NOT NULL) OR
    (OLD.state = 'ISSUED' AND NEW.state IN ('ACCEPTED', 'DECLINED', 'LAPSED', 'SUPERSEDED'))
  ) THEN
    RAISE EXCEPTION 'invalid institution offer transition' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "institution_offer_transition_guard"
  BEFORE UPDATE ON "institution_offers"
  FOR EACH ROW EXECUTE FUNCTION "enforce_institution_offer_transition"();

CREATE FUNCTION "enforce_institution_enrolment_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.application_case_id <> NEW.application_case_id THEN
    RAISE EXCEPTION 'enrolment case binding is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.state <> 'PENDING_EVIDENCE' OR NEW.state NOT IN ('CONFIRMED', 'DEFERRED', 'NOT_ENROLLED') THEN
    RAISE EXCEPTION 'invalid institution enrolment transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'institution enrolment version must increment by one' USING ERRCODE = '40001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "institution_enrolment_transition_guard"
  BEFORE UPDATE ON "institution_enrolments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_institution_enrolment_transition"();

CREATE FUNCTION "enforce_institution_requirement_set_transition"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.content_hash <> NEW.content_hash OR OLD.source_hash <> NEW.source_hash OR OLD.created_by_membership_id <> NEW.created_by_membership_id THEN
    RAISE EXCEPTION 'requirement content is immutable; create a new version' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD.state = 'DRAFT' AND NEW.state = 'IN_REVIEW') OR
    (OLD.state = 'IN_REVIEW' AND NEW.state = 'PUBLISHED') OR
    (OLD.state = 'PUBLISHED' AND NEW.state = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'invalid requirement set transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'PUBLISHED' AND (NEW.approved_by_membership_id IS NULL OR NEW.approved_by_membership_id = NEW.created_by_membership_id OR NEW.published_at IS NULL OR NEW.effective_from IS NULL) THEN
    RAISE EXCEPTION 'published requirement set requires independent approval and effective time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "institution_requirement_set_transition_guard"
  BEFORE UPDATE ON "institution_requirement_sets"
  FOR EACH ROW EXECUTE FUNCTION "enforce_institution_requirement_set_transition"();

CREATE TRIGGER "institution_requirements_append_only"
  BEFORE UPDATE OR DELETE ON "institution_requirements"
  FOR EACH ROW EXECUTE FUNCTION "prevent_institution_append_only_mutation"();
CREATE TRIGGER "institution_evidence_assessments_append_only"
  BEFORE UPDATE OR DELETE ON "institution_evidence_assessments"
  FOR EACH ROW EXECUTE FUNCTION "prevent_institution_append_only_mutation"();
CREATE TRIGGER "institution_decision_approvals_append_only"
  BEFORE UPDATE OR DELETE ON "institution_decision_approvals"
  FOR EACH ROW EXECUTE FUNCTION "prevent_institution_append_only_mutation"();
CREATE TRIGGER "institution_admission_events_append_only"
  BEFORE UPDATE OR DELETE ON "institution_admission_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_institution_append_only_mutation"();

DO $$
DECLARE
  table_name text;
  all_tables constant text[] := ARRAY[
    'institution_relationships', 'institution_memberships',
    'institution_sla_policies', 'institution_application_cases',
    'institution_requirement_sets', 'institution_requirements',
    'institution_evidence_assessments', 'institution_information_requests',
    'institution_decisions', 'institution_decision_approvals',
    'institution_offers', 'institution_enrolments',
    'institution_admission_events'
  ];
BEGIN
  FOREACH table_name IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
  END LOOP;
END;
$$;

CREATE POLICY "institution_relationships_scoped_select" ON "institution_relationships" FOR SELECT USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
);
CREATE POLICY "institution_memberships_self_or_admin_select" ON "institution_memberships" FOR SELECT USING (
  "legacy_user_id"::text = NULLIF(current_setting('app.legacy_user_id', true), '')
  OR (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
    AND NULLIF(current_setting('app.institution_role', true), '') = 'INSTITUTION_ADMIN'
  )
);

DO $$
DECLARE
  table_name text;
  scoped_tables constant text[] := ARRAY[
    'institution_sla_policies', 'institution_application_cases',
    'institution_requirement_sets', 'institution_evidence_assessments',
    'institution_information_requests', 'institution_decisions',
    'institution_decision_approvals', 'institution_offers',
    'institution_enrolments', 'institution_admission_events'
  ];
BEGIN
  FOREACH table_name IN ARRAY scoped_tables LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND relationship_id = NULLIF(current_setting(''app.institution_relationship_id'', true), '''')::uuid)',
      table_name || '_scoped_select', table_name
    );
  END LOOP;
END;
$$;

CREATE POLICY "institution_memberships_admin_insert" ON "institution_memberships" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'INSTITUTION_ADMIN'
);
CREATE POLICY "institution_sla_policies_admin_insert" ON "institution_sla_policies" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'INSTITUTION_ADMIN'
);
CREATE POLICY "institution_requirement_sets_manager_insert" ON "institution_requirement_sets" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('PROGRAM_INTAKE_MANAGER', 'INSTITUTION_ADMIN')
);
CREATE POLICY "institution_evidence_assessments_reviewer_insert" ON "institution_evidence_assessments" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'ADMISSIONS_REVIEWER'
);
CREATE POLICY "institution_information_requests_reviewer_insert" ON "institution_information_requests" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'ADMISSIONS_REVIEWER'
);
CREATE POLICY "institution_decisions_reviewer_insert" ON "institution_decisions" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'ADMISSIONS_REVIEWER'
);
CREATE POLICY "institution_decision_approvals_approver_insert" ON "institution_decision_approvals" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'DECISION_APPROVER'
);
CREATE POLICY "institution_offers_approver_insert" ON "institution_offers" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'DECISION_APPROVER'
);
CREATE POLICY "institution_enrolments_approver_insert" ON "institution_enrolments" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('DECISION_APPROVER', 'INSTITUTION_ADMIN')
);
CREATE POLICY "institution_events_actor_insert" ON "institution_admission_events" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN (
    'INSTITUTION_ADMIN', 'PROGRAM_INTAKE_MANAGER', 'ADMISSIONS_REVIEWER',
    'DECISION_APPROVER', 'INTEGRATION_ADMIN'
  )
);

CREATE POLICY "institution_requirements_scoped_select" ON "institution_requirements" FOR SELECT USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM "institution_requirement_sets" s
    WHERE s."tenant_id" = "institution_requirements"."tenant_id"
      AND s."id" = "institution_requirements"."requirement_set_id"
      AND s."relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  )
);
CREATE POLICY "institution_requirements_scoped_insert" ON "institution_requirements" FOR INSERT WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('PROGRAM_INTAKE_MANAGER', 'INSTITUTION_ADMIN')
);

CREATE POLICY "institution_application_cases_scoped_update" ON "institution_application_cases" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('INSTITUTION_ADMIN', 'ADMISSIONS_REVIEWER', 'DECISION_APPROVER')
) WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
);
CREATE POLICY "institution_requirement_sets_scoped_update" ON "institution_requirement_sets" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('PROGRAM_INTAKE_MANAGER', 'INSTITUTION_ADMIN')
) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid);
CREATE POLICY "institution_information_requests_scoped_update" ON "institution_information_requests" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('ADMISSIONS_REVIEWER', 'INSTITUTION_ADMIN')
) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid);
CREATE POLICY "institution_decisions_scoped_update" ON "institution_decisions" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('ADMISSIONS_REVIEWER', 'DECISION_APPROVER')
) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid);
CREATE POLICY "institution_offers_scoped_update" ON "institution_offers" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'DECISION_APPROVER'
) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid);
CREATE POLICY "institution_enrolments_scoped_update" ON "institution_enrolments" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') IN ('DECISION_APPROVER', 'INSTITUTION_ADMIN')
) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid);
CREATE POLICY "institution_sla_policies_scoped_update" ON "institution_sla_policies" FOR UPDATE USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid
  AND NULLIF(current_setting('app.institution_role', true), '') = 'INSTITUTION_ADMIN'
) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND "relationship_id" = NULLIF(current_setting('app.institution_relationship_id', true), '')::uuid);
