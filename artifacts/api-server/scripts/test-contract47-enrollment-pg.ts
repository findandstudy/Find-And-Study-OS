/** Must target a brand-new loopback-only disposable PostgreSQL database. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { canonicalJson, readRecovery47Snapshot } from "../src/lib/contract47Recovery";
import { enrollRecovery47 } from "../src/lib/contract47DeliveryEnrollment";
import { enrollmentTestSnapshot, enrollmentTestEvidence, ENROLLMENT_TEST_ENV } from "./test-contract47-enrollment";

test("disposable PostgreSQL verifies one-case prepared enrollment, race and rollback with actual queue triggers", async t => {
  const connectionString = process.env.CONTRACT47_ENROLLMENT_TEST_DATABASE_URL;
  assert.ok(connectionString, "dedicated disposable test URL required");
  const url = new URL(connectionString);
  assert.equal(url.protocol, "postgres:"); assert.equal(url.hostname, "127.0.0.1");
  assert.match(url.pathname, /^\/fas_contract47_enroll_test_[a-z0-9_]+$/); assert.equal(url.search, ""); assert.equal(url.hash, "");
  const requireOwn = createRequire(import.meta.url);
  const pg = createRequire(requireOwn.resolve("@workspace/db"))("pg");
  const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
  await a.connect(); await b.connect();
  const fixture = enrollmentTestSnapshot();
  const tables = { contract: "signed_contracts", session: "signing_sessions", application: "agent_applications" } as const;
  const isJson = (key: string) => ["intake_data", "template_intake_schema_snapshot", "template_signing_page_config_snapshot"].includes(key);
  try {
    assert.equal((await a.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count, 0, "requires empty database");
    for (const [section, table] of Object.entries(tables)) {
      const columns = Object.keys(fixture[section as keyof typeof fixture]).map(key => {
        const type = isJson(key) ? "jsonb" : key === "email_verification_required" ? "boolean"
          : key === "id" || key.endsWith("_id") || key === "template_version_snapshot" ? "integer" : key.endsWith("_at") ? "timestamptz" : "text";
        return `"${key}" ${type}${key === "id" ? " PRIMARY KEY" : ""}`;
      });
      await a.query(`CREATE TABLE public.${table} (${columns.join(",")})`);
    }
    const migration = await readFile(new URL("../../../deploy/prepared-migrations/apply/0067_signed_contract_delivery.sql", import.meta.url), "utf8");
    await a.query(migration);
    const identity = (await a.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_user AS role")).rows[0];
    const all = async () => {
      const result: Record<string, unknown> = {};
      for (const table of [...Object.values(tables), "signed_contract_deliveries"]) result[table] = (await a.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY 1::text`)).rows;
      return result;
    };
    const reset = async (preserveWhatsAppBlank = false) => {
      await a.query("TRUNCATE public.signed_contract_deliveries,public.signed_contracts,public.signing_sessions,public.agent_applications");
      for (const [section, table] of Object.entries(tables)) {
        const row = enrollmentTestSnapshot(preserveWhatsAppBlank)[section as keyof typeof fixture], keys = Object.keys(row);
        await a.query(`INSERT INTO public.${table} (${keys.map(k => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
          keys.map(k => isJson(k) && row[k] !== null ? JSON.stringify(row[k]) : row[k]));
      }
      await a.query("INSERT INTO public.signing_sessions SELECT (jsonb_populate_record(NULL::signing_sessions,to_jsonb(ss)||'{\"id\":166}'::jsonb)).* FROM public.signing_sessions ss WHERE id=165");
      await a.query("INSERT INTO public.signed_contracts SELECT (jsonb_populate_record(NULL::signed_contracts,to_jsonb(sc)||'{\"id\":48,\"signing_session_id\":166}'::jsonb)).* FROM public.signed_contracts sc WHERE id=47");
      return enrollmentTestEvidence(await readRecovery47Snapshot(a), identity, preserveWhatsAppBlank ? ["whatsapp_phone"] : undefined);
    };
    await t.test("default dry run reads and verifies but changes zero source/queue rows", async () => {
      const { manifest, evidence } = await reset(), before = canonicalJson(await all());
      await enrollRecovery47(a, manifest, async () => evidence, false, ENROLLMENT_TEST_ENV);
      assert.equal(canonicalJson(await all()), before);
    });
    await t.test("success freezes only47 READY with disclosure, keeps original rows unchanged and rejects replay", async () => {
      const { manifest, evidence } = await reset(), before = await all();
      await enrollRecovery47(a, manifest, async () => evidence, true, ENROLLMENT_TEST_ENV);
      const after: any = await all(), delivery = after.signed_contract_deliveries[0].row;
      assert.equal(after.signed_contract_deliveries.length, 1); assert.equal(delivery.state, "ready");
      assert.equal(delivery.signed_contract_id, 47); assert.equal(delivery.signing_session_id, 165);
      assert.equal(delivery.pdf_sha256, manifest.pdfSha256); assert.equal(delivery.message_id, manifest.messageId);
      assert.equal(delivery.text_body, manifest.email.text); assert.match(delivery.html_body, /historical logo image bytes have not been established/);
      assert.equal(delivery.claim_id, null); assert.equal(delivery.sending_at, null); assert.equal(delivery.accepted_at, null);
      after.signed_contract_deliveries = [];
      assert.equal(canonicalJson(after), canonicalJson(before));
      await assert.rejects(enrollRecovery47(a, manifest, async () => evidence, true, ENROLLMENT_TEST_ENV), /existing_delivery_no_retry/);
    });
    await t.test("any preexisting delivery state blocks, including unrelated content under same signing session", async () => {
      const { manifest, evidence } = await reset();
      await a.query("INSERT INTO public.signed_contract_deliveries(signed_contract_id,signing_session_id,recipient,message_id) VALUES(48,165,'test@example.invalid','<existing@example.invalid>')");
      const before = canonicalJson(await all());
      await assert.rejects(enrollRecovery47(a, manifest, async () => evidence, true, ENROLLMENT_TEST_ENV), /existing_delivery_no_retry/);
      assert.equal(canonicalJson(await all()), before);
    });
    await t.test("explicit blank WhatsApp recovery becomes READY with matching frozen disclosure and unchanged snapshot", async () => {
      const { manifest, evidence } = await reset(true), before = await all();
      await enrollRecovery47(a, manifest, async () => evidence, true, ENROLLMENT_TEST_ENV);
      const after: any = await all(), delivery = after.signed_contract_deliveries[0].row;
      assert.equal(delivery.state, "ready");
      assert.match(delivery.html_body, /original frozen WhatsApp value is absent and is preserved blank/);
      assert.match(delivery.text_body, /no telephone number has been inferred/);
      after.signed_contract_deliveries = []; assert.equal(canonicalJson(after), canonicalJson(before));
    });
    await t.test("two concurrent operators cannot enroll twice; waiting/preparing are never externally visible", async () => {
      const { manifest, evidence } = await reset(); let entered!: () => void, release!: () => void, reads = 0;
      const enteredPromise = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
      const first = enrollRecovery47(a, manifest, async () => { if (++reads === 2) { entered(); await held; } return evidence; }, true, ENROLLMENT_TEST_ENV);
      await enteredPromise;
      assert.equal((await b.query("SELECT count(*)::int AS n FROM public.signed_contract_deliveries")).rows[0].n, 0);
      const second = enrollRecovery47(b, manifest, async () => evidence, true, ENROLLMENT_TEST_ENV);
      const denied = assert.rejects(second, /existing_delivery_no_retry/);
      release(); await first; await denied;
      assert.equal((await a.query("SELECT count(*)::int AS n FROM public.signed_contract_deliveries")).rows[0].n, 1);
    });
    await t.test("crash after insertion rolls back entire enrollment without touching signed evidence", async () => {
      const { manifest, evidence } = await reset(), before = canonicalJson(await all()); let reads = 0;
      await assert.rejects(enrollRecovery47(a, manifest, async () => { if (++reads === 2) throw new Error("TEST crash"); return evidence; }, true, ENROLLMENT_TEST_ENV), /TEST crash/);
      assert.equal(canonicalJson(await all()), before);
    });
    await t.test("file tampering or application drift during transaction rolls back preparation", async () => {
      for (const kind of ["file", "application"]) {
        const { manifest, evidence } = await reset(), before = canonicalJson(await all()); let reads = 0;
        await assert.rejects(enrollRecovery47(a, manifest, async () => {
          if (++reads === 1 && kind === "application") await a.query("UPDATE public.agent_applications SET status='approved' WHERE id=12");
          if (reads === 2 && kind === "file") return { ...evidence, pdf: Buffer.from("TEST altered") };
          return evidence;
        }, true, ENROLLMENT_TEST_ENV));
        assert.equal(canonicalJson(await all()), before);
      }
    });
    await t.test("wrong database identity blocks before source read and writes", async () => {
      const { manifest, evidence } = await reset(), before = canonicalJson(await all());
      await assert.rejects(enrollRecovery47(a, { ...manifest, database: { ...identity, database: "wrong" } }, async () => evidence, true, ENROLLMENT_TEST_ENV), /database_identity_mismatch/);
      assert.equal(canonicalJson(await all()), before);
    });
  } finally { await b.end(); await a.end(); }
});
