import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
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
