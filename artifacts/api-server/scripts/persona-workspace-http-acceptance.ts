import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createPersonaWorkspaceApplication, type PersonaWorkspaceApplicationOptions } from "../src/lib/personaWorkspaceApplication";
import { assertPersonaWorkspaceOsBrowser } from "./persona-workspace-os-browser-acceptance";

type Options = {
  pool: Pool;
  databaseName: string;
  runtimeRole: string;
  projectId: string;
  foreignProjectId: string;
  makerSid: string;
  reviewerSid: string;
  makerUserId: number;
  reviewerUserId: number;
  approvedTeamActionId: number;
  completedExecutionId: string;
  /** The caller supplies the canonical PostgreSQL cookie/session adapter,
   * freshly constructed for this exact loopback HTTP origin. Never a role stub. */
  sessionOptions(origin: string): PersonaWorkspaceApplicationOptions["session"];
};

/** Real-DB acceptance slice called only after the full canonical-chain fixture
 * is ready. It creates no database, role, key, grant or provider, and owns only
 * its bounded loopback HTTP servers. The caller retains DROP cleanup. */
export async function assertPersonaWorkspaceHttpRestart(options: Options) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.ALLOW_DISPOSABLE_PERSONA_DB, "true");
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
  const identity = (await options.pool.query(
    "SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user",
  )).rows[0];
  assert.match(identity.db, /^codex_persona_flow_test_\d+_\d+$/);
  assert.equal(identity.host, "127.0.0.1");
  assert.equal(identity.port, 5433);
  assert.equal(identity.rolsuper, false);
  assert.equal(identity.rolbypassrls, false);
  assert.equal(identity.db, options.databaseName);
  assert.match(options.runtimeRole, /^persona_test_\d+_\d+$/);

  // The normal OS auth path uses its existing pool. Pin it before importing
  // that module; only this synthetic test DB and the non-owner fixture role
  // are permitted. Never load a .env or inherit a database URL.
  const oldDatabaseUrl = process.env.DATABASE_URL;
  const authUrl = new URL(`postgresql://postgres@127.0.0.1:5433/${options.databaseName}`);
  authUrl.searchParams.set("options", `-c role=${options.runtimeRole}`);
  process.env.DATABASE_URL = authUrl.toString();
  let authPool: Pool | undefined;
  let authMiddleware: typeof import("../src/middlewares/authMiddleware").authMiddleware;
  let authRouter: typeof import("../src/routes/auth").default;
  const osBrowser = process.env.PERSONA_OS_BROWSER_ACCEPTANCE === "true";
  const publicDirectory = fileURLToPath(new URL("../../edcons/dist/public/", import.meta.url));

  let server: Server | undefined;
  async function closeServer() {
    const current = server;
    if (!current) return;
    server = undefined;
    current.closeIdleConnections();
    await new Promise<void>((resolve, reject) => {
      current.close((error) => error ? reject(error) : resolve());
    });
  }
  async function openServer() {
    assert.equal(server, undefined);
    const app = express();
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const host = `127.0.0.1:${address.port}`;
    const origin = `http://${host}`;
    app.use((request, response, next) => {
      if (request.headers.host !== host) { response.sendStatus(403); return; }
      next();
    });
    app.use(cookieParser());
    // Both the service and cookie context cache are recreated, while PostgreSQL
    // remains the only owner of workspace/approval/execution state.
    app.use("/api/persona-workspace", createPersonaWorkspaceApplication({
      pool: options.pool, session: options.sessionOptions(origin),
    }));
    // Expose only the real read endpoint from the normal auth router. Login,
    // registration, email and password endpoints are deliberately not mounted.
    app.use("/api", (request, response, next) => {
      if (request.method !== "GET" || request.path !== "/auth/me") { next(); return; }
      void authMiddleware(request, response, () => authRouter(request, response, next)).catch(next);
    });
    app.use("/api", (_request, response) => response.status(404).json({ error: "TEST_ROUTE_NOT_MOUNTED" }));
    if (osBrowser) {
      assert.ok(existsSync(`${publicDirectory}/index.html`), "Build normal Edcons OS before running its browser acceptance test");
      app.use(express.static(publicDirectory, { index: false }));
      app.get(/^\/admin\/agent-team-workspace(?:\/[a-f0-9-]{36})?$/, (_request, response) =>
        response.sendFile(`${publicDirectory}/index.html`));
    }
    const call = async (
      path: string,
      sid = options.makerSid,
      method = "GET",
      body?: unknown,
      project = options.projectId,
    ) => {
      const response = await fetch(path === "/auth/me" ? `${origin}/api/auth/me` : `${origin}/api/persona-workspace/${project}${path}`, {
        method,
        headers: {
          cookie: `sid=${sid}; csrf_token=${"c".repeat(64)}`,
          origin,
          "x-csrf-token": "c".repeat(64),
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      if (path !== "/auth/me") assert.equal(response.headers.get("cache-control"), "private, no-store");
      return { status: response.status, data: await response.json() as any };
    };
    return Object.assign(call, { origin });
  }

  try {
    const db = await import("@workspace/db");
    authPool = db.pool;
    const authIdentity = (await authPool.query(
      "SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_user AS role,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user",
    )).rows[0];
    assert.deepEqual(authIdentity, {
      db: options.databaseName, host: "127.0.0.1", port: 5433, role: options.runtimeRole,
      rolsuper: false, rolbypassrls: false,
    });
    ({ authMiddleware } = await import("../src/middlewares/authMiddleware"));
    ({ default: authRouter } = await import("../src/routes/auth"));
    const first = await openServer();
    const makerAccount = await first("/auth/me");
    const reviewerAccount = await first("/auth/me", options.reviewerSid);
    assert.equal(makerAccount.status, 200);
    assert.equal(makerAccount.data.id, options.makerUserId);
    assert.equal(makerAccount.data.role, "staff", "normal auth must not turn the synthetic fixture into a super-admin bypass");
    assert.equal(reviewerAccount.status, 200);
    assert.equal(reviewerAccount.data.id, options.reviewerUserId);
    assert.equal(reviewerAccount.data.role, "staff");
    const original = await first("/team-workspace");
    assert.equal(original.status, 200, JSON.stringify(original.data));
    assert.ok(original.data.workspace);
    const before = original.data.workspace;
    const reviewerOriginal = await first("/team-workspace", options.reviewerSid);
    assert.equal(reviewerOriginal.status, 200);
    const reviewedBefore = await first("/team-drafts");
    assert.equal(reviewedBefore.status, 200);
    const immutableTeam = reviewedBefore.data.find((row: any) => row.action_id === options.approvedTeamActionId);
    assert.ok(immutableTeam?.reviewer);
    const historyBefore = await first("/history");
    assert.equal(historyBefore.status, 200);
    const completed = historyBefore.data.find((row: any) => row.id === options.completedExecutionId);
    assert.equal(completed?.state, "SUCCEEDED");

    const input = {
      expectedRevision: before.revision,
      document: { ...before.document, name: "Synthetic HTTP-reopened team workspace" },
      layout: { positions: [{ key: "research", x: 777, y: 333 }], zoom: 0.75, selectedKey: "research" },
    };
    const saved = await first("/team-workspace", options.makerSid, "PUT", input);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.workspace.revision, before.revision + 1);
    assert.equal(saved.data.approved, false);
    assert.equal(saved.data.activated, false);
    const refreshed = await first("/team-workspace");
    assert.equal(refreshed.status, 200);
    assert.deepEqual(refreshed.data.workspace, saved.data.workspace);

    const stale = await first("/team-workspace", options.makerSid, "PUT", input);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error, "PERSONA_WORKSPACE_CONFLICT");
    const foreignRead = await first("/team-workspace", options.makerSid, "GET", undefined, options.foreignProjectId);
    const foreignWrite = await first("/team-workspace", options.makerSid, "PUT", input, options.foreignProjectId);
    assert.equal(foreignRead.status, 409);
    assert.equal(foreignWrite.status, 409);
    assert.equal(foreignRead.data.workspace, undefined);
    assert.equal(foreignWrite.data.workspace, undefined);

    await closeServer();
    const reopened = await openServer();
    assert.equal((await reopened("/auth/me")).data.id, options.makerUserId);
    const restored = await reopened("/team-workspace");
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.data.workspace, saved.data.workspace,
      "new HTTP server, service and session adapter must recover the exact database-owned workspace");
    assert.deepEqual((await reopened("/team-workspace", options.reviewerSid)).data, reviewerOriginal.data,
      "maker changes must not overwrite the reviewer's private workspace");
    const reopenedTeams = await reopened("/team-drafts");
    assert.equal(reopenedTeams.status, 200);
    assert.deepEqual(reopenedTeams.data.find((row: any) => row.action_id === options.approvedTeamActionId), immutableTeam,
      "editing/reopening workspace must not change the approved team snapshot");
    const reopenedHistory = await reopened("/history");
    assert.equal(reopenedHistory.status, 200);
    assert.deepEqual(reopenedHistory.data.find((row: any) => row.id === options.completedExecutionId), completed,
      "successful receipt, execution and budget settlement must survive HTTP/service recreation");
    assert.equal(reopenedHistory.data.length, historyBefore.data.length,
      "reopening must not dispatch an additional task");
    const staleAfterRestart = await reopened("/team-workspace", options.makerSid, "PUT", input);
    assert.equal(staleAfterRestart.status, 409);
    assert.equal(staleAfterRestart.data.error, "PERSONA_WORKSPACE_CONFLICT");
    // Restore only the fixture's editable document; revision remains monotonic.
    const restoredFixture = await reopened("/team-workspace", options.makerSid, "PUT", {
      expectedRevision: saved.data.workspace.revision,
      document: before.document,
      layout: before.layout,
    });
    assert.equal(restoredFixture.status, 200);
    assert.equal(restoredFixture.data.workspace.revision, before.revision + 2);
    if (osBrowser) await assertPersonaWorkspaceOsBrowser({
      origin: reopened.origin, projectId: options.projectId, foreignProjectId: options.foreignProjectId,
      makerSid: options.makerSid, makerUserId: options.makerUserId,
      readWorkspace: () => reopened("/team-workspace"),
      saveWorkspace: (body) => reopened("/team-workspace", options.makerSid, "PUT", body),
    });
    console.info("Real PostgreSQL HTTP/service/session recreation: workspace refresh/reopen, revision conflict, cross-project deny, actor isolation, unchanged approval and completed execution PASS");
  } finally {
    await closeServer();
    await authPool?.end();
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldDatabaseUrl;
  }
}
