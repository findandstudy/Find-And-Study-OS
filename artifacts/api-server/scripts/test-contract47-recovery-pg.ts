import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { applyRecovery47, assertRecovery47Database, canonicalJson, prepareRecovery47,
  readRecovery47Snapshot, recovery47InputDigest, sha256, type Recovery47Manifest } from "../src/lib/contract47Recovery";
import { testSnapshot, testManifest } from "./test-contract47-recovery";
const ownRequire = createRequire(import.meta.url);
const pg = createRequire(ownRequire.resolve("@workspace/db"))("pg");

test("isolated PostgreSQL: exact-record recovery transaction and races", async t => {
  const connectionString = process.env.CONTRACT47_TEST_DATABASE_URL;
  assert.ok(connectionString, "CONTRACT47_TEST_DATABASE_URL is required; no application database fallback");
  const url = new URL(connectionString);
  assert.equal(url.hostname, "127.0.0.1");
  assert.match(url.pathname, /^\/fas_contract47_test_[a-z0-9_]+$/);
  assert.equal(url.search, "");
  const client = new pg.Client({ connectionString });
  const second = new pg.Client({ connectionString });
  await client.connect(); await second.connect();
  const fixture = testSnapshot();
  const tableNames = { contract: "signed_contracts", session: "signing_sessions", application: "agent_applications" } as const;
  const isJson = (key: string) => ["intake_data", "template_intake_schema_snapshot", "template_signing_page_config_snapshot"].includes(key);
  const type = (key: string, value: unknown) => isJson(key) ? "jsonb" : key === "email_verification_required" ? "boolean"
    : key === "id" || key.endsWith("_id") || key === "template_version_snapshot" ? "integer"
    : key.endsWith("_at") ? "timestamptz" : "text";
  try {
    assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'")).rows[0].count, 0,
      "fixture requires a brand-new disposable database");
    for (const [section, table] of Object.entries(tableNames)) {
      const entries = Object.entries(fixture[section as keyof typeof fixture]);
      await client.query(`CREATE TABLE ${table} (${entries.map(([key, value]) => `"${key}" ${type(key, value)}${key === "id" ? " PRIMARY KEY" : ""}`).join(",")})`);
    }
    const reset = async () => {
      for (const table of Object.values(tableNames)) await client.query(`DELETE FROM ${table}`);
      for (const [section, table] of Object.entries(tableNames)) {
        const data = fixture[section as keyof typeof fixture];
        const keys = Object.keys(data);
        await client.query(`INSERT INTO ${table} (${keys.map(key => `"${key}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
          keys.map(key => isJson(key) && data[key] !== null ? JSON.stringify(data[key]) : data[key]));
      }
      await client.query("INSERT INTO signed_contracts SELECT (jsonb_populate_record(NULL::signed_contracts, to_jsonb(sc) || '{\"id\":48,\"signing_session_id\":166}'::jsonb)).* FROM signed_contracts sc WHERE id = 47");
    };
    const identity = (await client.query("SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port, current_user AS role")).rows[0];
    const pdf = Buffer.from(`%PDF-1.7\n${"TEST SYNTHETIC PDF ".repeat(20)}`);
    const approved = async (): Promise<Recovery47Manifest> => {
      const snapshot = await readRecovery47Snapshot(client);
      return { ...testManifest(snapshot), database: identity, candidate: { pdfSha256: sha256(pdf), evidenceHash: "3".repeat(64),
        renderedHtmlSha256: sha256(prepareRecovery47(snapshot, recovery47InputDigest(snapshot)).bodyHtml) } };
    };
    const install = async (_bytes: Uint8Array, hash: string) => `/objects/signed-contracts/recovery47-${hash}.pdf`;
    const allRows = async () => {
      const output: Record<string, unknown> = {};
      for (const table of Object.values(tableNames)) output[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`)).rows;
      return output;
    };
    await t.test("read-only preflight changes no rows", async () => {
      await reset(); const before = canonicalJson(await allRows());
      await client.query("BEGIN READ ONLY");
      await assertRecovery47Database(client, identity);
      const snapshot = await readRecovery47Snapshot(client); prepareRecovery47(snapshot, recovery47InputDigest(snapshot));
      await client.query("ROLLBACK"); assert.equal(canonicalJson(await allRows()), before);
    });
    await t.test("database identity mismatch writes nothing", async () => {
      await reset(); const manifest = await approved(); manifest.database = { ...identity, database: "wrong" };
      const before = canonicalJson(await allRows());
      await assert.rejects(applyRecovery47(client, manifest, pdf, install), /database_identity_mismatch/);
      assert.equal(canonicalJson(await allRows()), before);
    });
    await t.test("success updates only final key/hash on contract47; repeat cannot replace", async () => {
      await reset(); const before = await allRows(); const manifest = await approved();
      await applyRecovery47(client, manifest, pdf, install);
      const after: any = await allRows();
      assert.equal(after.signed_contracts[0].row.pdf_object_key, await install(pdf, sha256(pdf)));
      assert.equal(after.signed_contracts[0].row.evidence_hash, manifest.candidate!.evidenceHash);
      after.signed_contracts[0].row.pdf_object_key = null; after.signed_contracts[0].row.evidence_hash = null;
      assert.equal(canonicalJson(after), canonicalJson(before));
      await assert.rejects(applyRecovery47(client, manifest, pdf, () => { throw new Error("must not install"); }), /input_digest_mismatch/);
    });
    await t.test("two connections race: one success, one immutable-final rejection", async () => {
      await reset(); const manifest = await approved(); let installCount = 0;
      let entered!: () => void; let release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      const first = applyRecovery47(client, manifest, pdf, async (...args) => { installCount++; entered(); await wait; return install(...args); });
      await started;
      const contender = applyRecovery47(second, manifest, pdf, async (...args) => { installCount++; return install(...args); });
      const rejected = assert.rejects(contender, /input_digest_mismatch/);
      release(); await first; await rejected; assert.equal(installCount, 1);
    });
    await t.test("crash after immutable install rolls back lease and all DB changes", async () => {
      await reset(); const before = canonicalJson(await allRows()); const manifest = await approved();
      await assert.rejects(applyRecovery47(client, manifest, pdf, async () => { throw new Error("TEST crash after durable artifact"); }), /TEST crash/);
      assert.equal(canonicalJson(await allRows()), before);
      await applyRecovery47(client, manifest, pdf, install);
    });
    await t.test("snapshot changed during installation aborts and rolls back", async () => {
      await reset(); const before = canonicalJson(await allRows()); const manifest = await approved();
      await assert.rejects(applyRecovery47(client, manifest, pdf, async (...args) => {
        await client.query("UPDATE signing_sessions SET intake_data = '{\"companyName\":\"TEST changed\"}'::jsonb WHERE id = 165");
        return install(...args);
      }), /input_changed_during_install/);
      assert.equal(canonicalJson(await allRows()), before);
    });
    await t.test("wrong installation key cannot be persisted", async () => {
      await reset(); const before = canonicalJson(await allRows()); const manifest = await approved();
      await assert.rejects(applyRecovery47(client, manifest, pdf, async () => "/objects/other.pdf"), /object_key_mismatch/);
      assert.equal(canonicalJson(await allRows()), before);
    });
  } finally { await second.end(); await client.end(); }
});
