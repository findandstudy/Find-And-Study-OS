import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as databaseSchema from "@workspace/db/schema";
import {
  activeSessionContextSelectionsTable,
  agentApplicationsTable,
  agentIntegrationsTable,
  changeSetCommandAuditEventsTable,
  changeSetsTable,
  tenantsTable,
} from "@workspace/db/schema";

test("live product schema exports remain available", () => {
  assert.equal(getTableName(agentApplicationsTable), "agent_applications");
  assert.equal(getTableName(agentIntegrationsTable), "agent_integrations");
});

test("default-unwired authorization schema bindings match canonical tables", () => {
  assert.equal(getTableName(tenantsTable), "tenants");
  assert.equal(
    getTableName(activeSessionContextSelectionsTable),
    "active_session_context_selections",
  );
  assert.deepEqual(
    Object.keys(getTableColumns(tenantsTable)).slice(0, 4),
    ["id", "slug", "legalName", "displayName"],
  );
});

test("default-unwired Control Plane schema bindings match canonical tables", () => {
  assert.equal(getTableName(changeSetsTable), "change_sets");
  assert.equal(
    getTableName(changeSetCommandAuditEventsTable),
    "change_set_command_audit_events",
  );
  assert.ok("tenantId" in getTableColumns(changeSetsTable));
  assert.ok("status" in getTableColumns(changeSetsTable));
});

test("default-unwired Student Journey G45 schema bindings match all canonical tables", () => {
  const tables = [
    databaseSchema.journeySubjectsTable,
    databaseSchema.journeyRequirementSetsTable,
    databaseSchema.journeyRequirementItemsTable,
    databaseSchema.journeyDossiersTable,
    databaseSchema.journeyDossierRevisionsTable,
    databaseSchema.journeyApplicationCasesTable,
    databaseSchema.journeyRequirementResultsTable,
    databaseSchema.journeyVerifiedEvidenceReceiptsTable,
    databaseSchema.journeyConsentReceiptsTable,
    databaseSchema.journeyCommunicationPreferenceReceiptsTable,
    databaseSchema.journeyCommunicationSuppressionReceiptsTable,
    databaseSchema.journeyNotificationIntentsTable,
    databaseSchema.journeyCommunicationDecisionReceiptsTable,
    databaseSchema.journeyDocumentRequestsTable,
    databaseSchema.journeyDocumentIngestReceiptsTable,
    databaseSchema.journeyDocumentAccessReceiptsTable,
    databaseSchema.journeyDocumentResponseReceiptsTable,
    databaseSchema.journeyDocumentResponseAuditsTable,
    databaseSchema.journeyDocumentIngestConsumptionsTable,
    databaseSchema.journeyDocumentResponseCommandsTable,
    databaseSchema.journeyStateTransitionReceiptsTable,
    databaseSchema.journeyMilestoneEventsTable,
    databaseSchema.journeyMilestoneEvidenceTable,
    databaseSchema.journeyQavjpSnapshotsTable,
    databaseSchema.journeyQavjpItemsTable,
    databaseSchema.journeyOutboxEventsTable,
  ];
  assert.deepEqual(tables.map(getTableName), [
    "journey_subjects",
    "journey_requirement_sets",
    "journey_requirement_items",
    "journey_dossiers",
    "journey_dossier_revisions",
    "journey_application_cases",
    "journey_requirement_results",
    "journey_verified_evidence_receipts",
    "journey_consent_receipts",
    "journey_communication_preference_receipts",
    "journey_communication_suppression_receipts",
    "journey_notification_intents",
    "journey_communication_decision_receipts",
    "journey_document_requests",
    "journey_document_ingest_receipts",
    "journey_document_access_receipts",
    "journey_document_response_receipts",
    "journey_document_response_audits",
    "journey_document_ingest_consumptions",
    "journey_document_response_commands",
    "journey_state_transition_receipts",
    "journey_milestone_events",
    "journey_milestone_evidence",
    "journey_qavjp_snapshots",
    "journey_qavjp_items",
    "journey_outbox_events",
  ]);
  assert.ok(
    "aggregateVersion" in
      getTableColumns(databaseSchema.journeyApplicationCasesTable),
  );
  assert.ok(
    "receiptHash" in
      getTableColumns(databaseSchema.journeyDocumentResponseReceiptsTable),
  );
  assert.ok(
    "denominatorWeightBps" in
      getTableColumns(databaseSchema.journeyQavjpSnapshotsTable),
  );
});
