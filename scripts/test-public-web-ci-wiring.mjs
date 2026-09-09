import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const convergenceWorkflowUrl = new URL(
  "../.github/workflows/live-first-convergence.yml",
  import.meta.url,
);
const stagingWorkflowUrl = new URL(
  "../.github/workflows/staging-adoption.yml",
  import.meta.url,
);
const stagingEnvironmentUrl = new URL(
  "../deploy/staging/app.env.example",
  import.meta.url,
);

const purePublicWebChecks = [
  "test:public-web-foundation",
  "test:public-web-command",
  "test:public-web-publication-store",
  "test:public-web-publication-read-model",
  "test:public-web-draft-intake",
  "test:public-web-draft-intake-builder",
  "test:public-web-draft-batch-planner",
  "test:public-web-draft-source-resolver",
  "test:public-web-draft-intake-store",
  "test:public-localized-entities",
  "test:public-catalog-list-scaling",
  "test:public-catalog-pages",
  "test:public-catalog-render",
  "test:public-web-discovery",
  "test:public-web-scale",
];

const postgresPublicWebChecks = [
  "test:postgres-public-web-foundation",
  "test:postgres-public-web-draft-intake",
  "test:postgres-public-web-draft-source-resolver",
  "test:postgres-catalog-entity-graph",
  "test:postgres-public-catalog-render",
  "test:postgres-public-web-discovery",
];

function assertExactlyOnce(source, needle, context) {
  assert.equal(
    source.split(needle).length - 1,
    1,
    `${context} must include ${needle} exactly once`,
  );
}

function assertLineExactlyOnce(source, line, context) {
  assert.equal(
    source.split(/\r?\n/).filter((candidate) => candidate.trim() === line).length,
    1,
    `${context} must include ${line} exactly once`,
  );
}

test("public web pure checks are wired into convergence and staging gates", async () => {
  const [convergence, staging] = await Promise.all([
    readFile(convergenceWorkflowUrl, "utf8"),
    readFile(stagingWorkflowUrl, "utf8"),
  ]);

  for (const script of purePublicWebChecks) {
    assertLineExactlyOnce(convergence, `pnpm --filter @workspace/api-server run ${script}`, "convergence workflow");
    assertLineExactlyOnce(staging, `pnpm --filter @workspace/api-server run ${script}`, "staging workflow");
  }

  const publicTemplateCommand =
    "pnpm --filter @workspace/edcons run test:public-detail-templates";
  assertExactlyOnce(convergence, publicTemplateCommand, "convergence workflow");
  assertExactlyOnce(staging, publicTemplateCommand, "staging workflow");
  assertExactlyOnce(
    convergence,
    "pnpm --filter @workspace/edcons run build",
    "convergence workflow",
  );
  assertExactlyOnce(
    staging,
    "pnpm --filter @workspace/edcons run build",
    "staging workflow",
  );
});

test("public web PostgreSQL checks run once before disposable database reset", async () => {
  const convergence = await readFile(convergenceWorkflowUrl, "utf8");
  const resetIndex = convergence.indexOf(
    "Reset the disposable database after foundation fixtures",
  );
  assert.ok(resetIndex > 0, "convergence workflow must retain the database reset boundary");

  for (const script of postgresPublicWebChecks) {
    const command = `run ${script}`;
    assertExactlyOnce(convergence, command, "convergence workflow");
    assert.ok(
      convergence.indexOf(command) < resetIndex,
      `${script} must run before the disposable database reset`,
    );
  }

  for (const variable of [
    "PG_CATALOG_GRAPH_ADMIN_URL",
    "PG_PUBLIC_CATALOG_RENDER_ADMIN_URL",
    "PG_PUBLIC_WEB_ADMIN_URL",
    "PG_PUBLIC_WEB_DISCOVERY_URL",
  ]) {
    assertExactlyOnce(convergence, `${variable}:`, "convergence workflow");
  }
});

test("migration gate labels do not freeze a stale ledger count", async () => {
  const convergence = await readFile(convergenceWorkflowUrl, "utf8");
  assert.doesNotMatch(convergence, /Apply all \d+ migrations/);
  assert.doesNotMatch(convergence, /canonical \d+\/\d+ adoption/);
});

test("staging public web environment remains explicitly fail closed", async () => {
  const environment = await readFile(stagingEnvironmentUrl, "utf8");
  for (const assignment of [
    "PUBLIC_WEB_RENDER_MODE=off",
    "PUBLIC_WEB_RENDER_ALLOWLIST=",
    "PUBLIC_WEB_INTERNAL_LINK_MODE=off",
    "PUBLIC_WEB_SITEMAP_MODE=off",
    "PUBLIC_WEB_ROBOTS_MODE=disallow",
    "PUBLIC_WEB_TENANT_ID=",
    "PUBLIC_WEB_ORGANIZATION_ID=",
    "PUBLIC_WEB_DRAFT_INTAKE_MODE=off",
    "PUBLIC_WEB_DRAFT_INTAKE_TENANT_ALLOWLIST=",
  ]) {
    assertExactlyOnce(environment, assignment, "staging environment");
  }
});
