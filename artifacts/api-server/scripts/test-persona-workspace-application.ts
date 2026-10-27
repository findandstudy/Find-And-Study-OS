import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createPersonaWorkspaceApplication } from "../src/lib/personaWorkspaceApplication";

test("normal product mount remains closed without explicit server composition", async () => {
  const app = express();
  app.use("/api/persona-workspace", createPersonaWorkspaceApplication());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const method of ["GET", "PUT", "POST", "DELETE"]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/persona-workspace/018f6000-0000-7000-8000-000000000100/team-workspace`, { method });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await response.json(), { error: "PERSONA_WORKSPACE_NOT_CONFIGURED" });
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("configured application cannot mint a test runtime in production", () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createPersonaWorkspaceApplication({} as never), /PERSONA_MOCK_ONLY/);
  } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});
