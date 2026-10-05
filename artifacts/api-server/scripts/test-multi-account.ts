/**
 * Multi-account-per-channel test coverage (Task #554).
 *
 * Two layers are exercised:
 *
 *  1. Resolver unit checks (resolveInboundAccount / resolveOutboundConfig in
 *     src/lib/inbox/channelAccountConfig.ts) against real channel_accounts rows:
 *       - inbound resolution matches by (channel, externalAccountId) only when
 *         the account is active; returns null (legacy fallback) otherwise.
 *       - outbound resolution returns the referenced active account's config,
 *         and refuses it (falls back) when the account is inactive, missing,
 *         null, or on a different channel.
 *
 *  2. CRUD route invariants (routes/channelAccounts.ts) through Express with a
 *     mocked super_admin:
 *       - create returns 201, secrets are masked on the way out.
 *       - set-default keeps exactly one default per channel.
 *       - toggle-active flips isActive + status.
 *       - update with a still-masked secret preserves the stored credential
 *         (no credential loss — the core constraint of this task).
 *       - test runs in simulated mode without live network calls.
 *       - delete removes the row and never leaves a channel with >1 default.
 *
 * All tables are session-local TEMP shadows on one pinned local connection.
 * Public rows and serial sequences are never written. This exercises SQL and
 * HTTP contracts; one connection does not prove cross-connection concurrency.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:multi-account
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express, { type Express } from "express";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pool, channelAccountsTable } from "@workspace/db";
import { getZernioApiKey, isZernioAccountSendable } from "../src/lib/inbox/zernioSend.js";
import { encryptConfig } from "../src/lib/encryption.js";
import channelAccountsRouter from "../src/routes/channelAccounts.js";
import {
  legacyConfigMatchesAccount,
  resolveInboundAccount,
  resolveOutboundConfig,
  serializeAccountConfig,
  parseAccountConfig,
} from "../src/lib/inbox/channelAccountConfig.js";

const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const MOCK_USER = { id: 1, role: "super_admin", isActive: true, emailVerified: true };
const SID = `account_management_${RUN_ID}`;
let fixtureReady = false;
let originalPublicAccountCount = 0;
let fixtureConnectionCount = 0;
const TEMP_TABLES = ["users", "sessions", "audit_logs", "channel_accounts", "conversations", "integrations",
  "communication_pipelines", "communication_pipeline_accounts", "pipeline_stages", "pipeline_stage_message_dispatches", "message_campaign_recipients"] as const;
before(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || target.port !== "5433" || target.pathname !== "/fasos_apply_local"
    || target.username !== "postgres" || target.password || target.search || target.hash || process.env.NODE_ENV !== "test"
    || process.env.ALLOW_LIVE_INTEGRATIONS !== "false" || process.env.EMAIL_DELIVERY_DISABLED !== "true") throw new Error("Exact synthetic localhost/no-outbound target required");
  assert.equal(pool.totalCount, 0, "Fixture must pin the first connection before any database access");
  pool.options.max = 1;
  pool.options.idleTimeoutMillis = 0;
  pool.options.maxLifetimeSeconds = 0;
  pool.on("connect", () => {
    fixtureConnectionCount++;
    // pg-pool emits this before making a replacement client available to a
    // query. Abort the test instead of permitting lost TEMP shadows to fall
    // through to public tables after a dropped/recycled connection.
    if (fixtureConnectionCount !== 1) throw new Error("TEMP_FIXTURE_CONNECTION_REPLACED_PUBLIC_FALLBACK_FORBIDDEN");
  });
  const identity = (await pool.query("SELECT current_database() AS name,host(inet_server_addr()) AS address,inet_server_port() AS port")).rows[0];
  assert.deepEqual(identity, { name: "fasos_apply_local", address: "127.0.0.1", port: 5433 });
  originalPublicAccountCount = (await pool.query("SELECT count(*)::int AS count FROM public.channel_accounts")).rows[0].count;
  // LIKE copies defaults/indexes/checks, not triggers or foreign keys. Replace
  // every serial default before any insert so even public sequences stay intact.
  await pool.query("BEGIN");
  try {
    for (const table of TEMP_TABLES) {
      await pool.query(`CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING ALL) ON COMMIT PRESERVE ROWS`);
      const serials = (await pool.query("SELECT a.attname FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass($1) AND pg_get_expr(d.adbin,d.adrelid) LIKE 'nextval(%'", [table])).rows;
      for (const { attname } of serials) {
        assert.match(attname, /^[a-z_]+$/);
        const sequence = `fixture_${table}_${attname}_seq`;
        await pool.query(`CREATE TEMP SEQUENCE "${sequence}"`);
        await pool.query(`ALTER TABLE pg_temp."${table}" ALTER COLUMN "${attname}" SET DEFAULT nextval('pg_temp.${sequence}'::regclass)`);
      }
      const bound = (await pool.query("SELECT relnamespace=pg_my_temp_schema() AS temporary FROM pg_class WHERE oid=to_regclass($1)", [table])).rows[0];
      assert.equal(bound?.temporary, true, `Fixture table ${table} must resolve only to pg_temp`);
    }
    await pool.query("COMMIT");
  } catch (error) { await pool.query("ROLLBACK"); throw error; }
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM channel_accounts")).rows[0].count, 0);
  process.env.ENCRYPTION_KEY = "synthetic-account-management-test-key";
  const [user] = (await pool.query("INSERT INTO users(first_name,last_name,role,email,is_active,email_verified) VALUES('Synthetic','Accounts','super_admin',$1,true,true) RETURNING id", [`${SID}@example.test`])).rows;
  MOCK_USER.id = user.id;
  fixtureReady = true;
  await pool.query("INSERT INTO sessions(sid,sess,expire,user_id) VALUES($1,$2,now()+interval '1 hour',$3)", [SID, { user: MOCK_USER, access_token: "synthetic", issued_at: Date.now() }, user.id]);
  await pool.query("INSERT INTO sessions(sid,sess,expire,user_id) VALUES($1,$2,now()+interval '1 hour',$3)", [`${SID}_impersonated`, { user: MOCK_USER, access_token: "synthetic", issued_at: Date.now(), originalSid: SID }, user.id]);
});

const createdIds: number[] = [];

function tag(s: string): string {
  return `${s}_${RUN_ID}`;
}

function buildApp(options: { role?: string; apiToken?: boolean; impersonated?: boolean; noSession?: boolean } = {}): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { ...MOCK_USER, role: options.role ?? MOCK_USER.role };
    (req as any).apiTokenAuth = options.apiToken === true;
    (req as any).cookies = options.noSession ? {} : { sid: options.impersonated ? `${SID}_impersonated` : SID };
    next();
  });
  app.use("/api", channelAccountsRouter);
  return app;
}

function sendReq(
  server: http.Server,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const json = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(json !== undefined ? { "Content-Length": Buffer.byteLength(json) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: raw }); }
        });
      },
    );
    req.on("error", reject);
    if (json !== undefined) req.write(json);
    req.end();
  });
}

function listen(app: Express): Promise<http.Server> {
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

/** Insert a channel_accounts row directly (bypassing the route) for resolver tests. */
async function insertAccount(opts: {
  channel: string;
  externalAccountId: string;
  config: Record<string, any>;
  isActive: boolean;
  isDefault?: boolean;
}): Promise<number> {
  const [row] = await db.insert(channelAccountsTable).values({
    channel: opts.channel,
    displayName: tag(`acct_${opts.channel}`),
    externalAccountId: opts.externalAccountId,
    configEncrypted: serializeAccountConfig(opts.config),
    status: opts.isActive ? "active" : "inactive",
    isActive: opts.isActive,
    isDefault: opts.isDefault ?? false,
  }).returning();
  createdIds.push(row.id);
  return row.id;
}

after(async () => {
  if (!fixtureReady) { await pool.end(); return; }
  // Clean up everything tagged with this run (route-created + direct inserts).
  if (createdIds.length > 0) {
    await db.delete(channelAccountsTable).where(inArray(channelAccountsTable.id, createdIds));
  }
  await db.delete(channelAccountsTable).where(like(channelAccountsTable.displayName, `%${RUN_ID}%`));
  await new Promise<void>(resolve => setImmediate(resolve));
  await pool.query("DELETE FROM sessions WHERE sid IN ($1,$2)", [SID, `${SID}_impersonated`]);
  await pool.query("DELETE FROM audit_logs WHERE user_id=$1", [MOCK_USER.id]);
  await pool.query("DELETE FROM users WHERE id=$1", [MOCK_USER.id]);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM public.channel_accounts")).rows[0].count, originalPublicAccountCount, "Public registry count is unchanged");
  assert.equal(fixtureConnectionCount, 1, "Exactly one session owns all temporary fixture tables");
  await pool.end();
});

// ---------------------------------------------------------------------------
// 1. Resolver unit checks
// ---------------------------------------------------------------------------

test("resolveInboundAccount matches active account by external id; null otherwise", async () => {
  const extActive = tag("wa_phone_active");
  const extInactive = tag("wa_phone_inactive");
  const secret = `INBOUND_SECRET_${RUN_ID}`;

  const activeId = await insertAccount({
    channel: "whatsapp",
    externalAccountId: extActive,
    config: { phoneNumberId: extActive, accessToken: "tok", appSecret: secret },
    isActive: true,
  });
  await insertAccount({
    channel: "whatsapp",
    externalAccountId: extInactive,
    config: { phoneNumberId: extInactive, accessToken: "tok", appSecret: secret },
    isActive: false,
  });

  const matched = await resolveInboundAccount<{ appSecret: string }>("whatsapp", extActive);
  assert.ok(matched, "active account should resolve");
  assert.equal(matched!.channelAccountId, activeId);
  assert.equal(matched!.config.appSecret, secret, "decrypted secret should round-trip");

  const inactive = await resolveInboundAccount("whatsapp", extInactive);
  assert.equal(inactive, null, "inactive account must NOT resolve (legacy fallback)");

  const unknown = await resolveInboundAccount("whatsapp", tag("never_seen"));
  assert.equal(unknown, null, "unknown external id must not resolve");

  const missing = await resolveInboundAccount("whatsapp", null);
  assert.equal(missing, null, "missing external id must not resolve");

  // Channel scoping: same external id on a different channel must not cross over.
  const crossChannel = await resolveInboundAccount("messenger", extActive);
  assert.equal(crossChannel, null, "external id is scoped to its channel");
});

test("resolveOutboundConfig returns active account config, refuses inactive/null/mismatch", async () => {
  const ext = tag("ig_acct_out");
  const secret = `OUTBOUND_TOKEN_${RUN_ID}`;
  const activeId = await insertAccount({
    channel: "instagram",
    externalAccountId: ext,
    config: { igBusinessAccountId: ext, pageAccessToken: secret },
    isActive: true,
  });
  const inactiveId = await insertAccount({
    channel: "instagram",
    externalAccountId: tag("ig_acct_out_off"),
    config: { igBusinessAccountId: tag("ig_acct_out_off"), pageAccessToken: secret },
    isActive: false,
  });

  const active = await resolveOutboundConfig<{ pageAccessToken: string }>("instagram", activeId);
  assert.ok(active, "active account should resolve a config");
  assert.equal(active!.pageAccessToken, secret, "outbound returns the account's own secret");

  // Explicit inactive/missing/wrong-channel identities fail closed; no legacy escape.
  const inactive = await resolveOutboundConfig<{ pageAccessToken?: string }>("instagram", inactiveId);
  assert.equal(inactive, null, "inactive pinned account must fail closed");
  assert.equal(await resolveOutboundConfig("instagram", 2147483647), null, "missing pinned account must fail closed");

  // Null id → legacy fallback, never this account's secret.
  const legacy = await resolveOutboundConfig<{ pageAccessToken?: string }>("instagram", null);
  assert.notEqual(legacy?.pageAccessToken, secret, "null id must not return a per-account secret");

  // Channel mismatch (instagram account id queried as whatsapp) → fallback.
  const mismatch = await resolveOutboundConfig<{ pageAccessToken?: string }>("whatsapp", activeId);
  assert.equal(mismatch, null, "channel mismatch must fail closed");
});

// ---------------------------------------------------------------------------
// 2. CRUD route invariants
// ---------------------------------------------------------------------------

test("CRUD: create masks secrets, set-default is exclusive, toggle + masked-update preserve credentials, delete keeps <=1 default", async () => {
  const app = buildApp();
  const server = await listen(app);
  const channel = "instagram";
  const secretA = `PAT_A_${RUN_ID}`;
  const secretB = `PAT_B_${RUN_ID}`;

  try {
    // --- create A ---
    const createA = await sendReq(server, "POST", "/api/channel-accounts", {
      channel,
      displayName: tag("crud_A"),
      config: { igBusinessAccountId: tag("ig_A"), pageAccessToken: secretA, appSecret: `AS_A_${RUN_ID}` },
    });
    assert.equal(createA.status, 201, `create A: ${JSON.stringify(createA.body)}`);
    const idA = createA.body.id as number;
    createdIds.push(idA);
    assert.equal(createA.body.externalAccountId, tag("ig_A"), "external id derived from igBusinessAccountId");
    assert.ok(
      typeof createA.body.config.pageAccessToken === "string" && createA.body.config.pageAccessToken.includes("•"),
      "secret must be masked in the response",
    );
    assert.ok(!createA.body.config.pageAccessToken.includes(secretA), "raw secret must never be returned");

    // --- create B ---
    const createB = await sendReq(server, "POST", "/api/channel-accounts", {
      channel,
      displayName: tag("crud_B"),
      config: { igBusinessAccountId: tag("ig_B"), pageAccessToken: secretB },
    });
    assert.equal(createB.status, 201, `create B: ${JSON.stringify(createB.body)}`);
    const idB = createB.body.id as number;
    createdIds.push(idB);

    // --- set-default A, then B: exactly one default per channel ---
    const setA = await sendReq(server, "PATCH", `/api/channel-accounts/${idA}/set-default`);
    assert.equal(setA.status, 200);
    assert.equal(setA.body.isDefault, true);

    let list = await sendReq(server, "GET", `/api/channel-accounts?channel=${channel}`);
    assert.equal(list.status, 200);
    let defaults = (list.body.accounts as any[]).filter((a) => a.isDefault);
    assert.equal(defaults.length, 1, "exactly one default after set-default A");
    assert.equal(defaults[0].id, idA, "A is the default");

    const setB = await sendReq(server, "PATCH", `/api/channel-accounts/${idB}/set-default`);
    assert.equal(setB.status, 200);
    list = await sendReq(server, "GET", `/api/channel-accounts?channel=${channel}`);
    defaults = (list.body.accounts as any[]).filter((a) => a.isDefault);
    assert.equal(defaults.length, 1, "exactly one default after set-default B");
    assert.equal(defaults[0].id, idB, "B is now the default, A cleared");

    // --- toggle-active B ---
    const beforeB = (list.body.accounts as any[]).find((a) => a.id === idB);
    const toggle = await sendReq(server, "PATCH", `/api/channel-accounts/${idB}/toggle-active`);
    assert.equal(toggle.status, 200);
    assert.equal(toggle.body.isActive, !beforeB.isActive, "isActive flips");
    assert.equal(toggle.body.status, toggle.body.isActive ? "active" : "inactive", "status mirrors isActive");

    // --- masked update of A must preserve the stored credential ---
    const maskedA = createA.body.config.pageAccessToken; // contains "•"
    const updateA = await sendReq(server, "PUT", `/api/channel-accounts/${idA}`, {
      displayName: tag("crud_A_renamed"),
      config: { igBusinessAccountId: tag("ig_A"), pageAccessToken: maskedA },
    });
    assert.equal(updateA.status, 200, `update A: ${JSON.stringify(updateA.body)}`);
    assert.equal(updateA.body.displayName, tag("crud_A_renamed"));
    const [rowA] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, idA));
    const plainA = parseAccountConfig(rowA.configEncrypted);
    assert.equal(plainA.pageAccessToken, secretA, "masked update must NOT overwrite the stored secret");

    // --- test endpoint in simulated mode (no live network) ---
    const testRes = await sendReq(server, "POST", `/api/channel-accounts/${idA}/test`);
    assert.equal(testRes.status, 200);
    assert.equal(testRes.body.success, false, "simulation must never claim verified credentials");
    assert.equal(testRes.body.simulated, true);

    // --- delete B then A; channel must never have >1 default ---
    const delB = await sendReq(server, "DELETE", `/api/channel-accounts/${idB}`);
    assert.equal(delB.status, 200);
    const delA = await sendReq(server, "DELETE", `/api/channel-accounts/${idA}`);
    assert.equal(delA.status, 200);

    const finalList = await sendReq(server, "GET", `/api/channel-accounts?channel=${channel}`);
    const stillThere = (finalList.body.accounts as any[]).filter((a) => a.id === idA || a.id === idB);
    assert.equal(stillThere.length, 0, "both deleted rows are gone");
    const finalDefaults = (finalList.body.accounts as any[]).filter((a) => a.isDefault);
    assert.ok(finalDefaults.length <= 1, "channel never has more than one default");
  } finally {
    await close(server);
  }
});

test("CRUD: rejects unsupported channel and missing displayName", async () => {
  const app = buildApp();
  const server = await listen(app);
  try {
    const badChannel = await sendReq(server, "POST", "/api/channel-accounts", {
      channel: "fax",
      displayName: tag("bad"),
      config: {},
    });
    assert.equal(badChannel.status, 400, "unsupported channel rejected");

    const noName = await sendReq(server, "POST", "/api/channel-accounts", {
      channel: "whatsapp",
      displayName: "   ",
      config: {},
    });
    assert.equal(noName.status, 400, "blank displayName rejected");
  } finally {
    await close(server);
  }
});

test("credential-free webhook accounts use only their exact enabled legacy identity", async () => {
  const cases = [
    { channel: "whatsapp", key: "whatsapp", identityKey: "phoneNumberId", tokenKey: "accessToken" },
    { channel: "messenger", key: "facebook_messenger", identityKey: "pageId", tokenKey: "pageAccessToken" },
    { channel: "instagram", key: "instagram", identityKey: "igBusinessAccountId", tokenKey: "pageAccessToken" },
  ];
  for (const item of cases) {
    const externalId = tag(`legacy_${item.channel}`);
    const config = { [item.identityKey]: externalId, [item.tokenKey]: "synthetic_legacy_token" };
    const [account] = await db.insert(channelAccountsTable).values({ channel: item.channel, provider: "direct",
      externalAccountId: externalId, displayName: tag("legacy_registration"), isActive: true }).returning();
    createdIds.push(account.id);
    await pool.query("INSERT INTO integrations(key,name,category,is_enabled,config) VALUES($1,'Synthetic','communication',true,$2)", [item.key, encryptConfig(config)]);
    try {
      assert.equal((await resolveOutboundConfig(item.channel, account.id))?.[item.tokenKey], config[item.tokenKey]);
      await db.update(channelAccountsTable).set({ isActive: false }).where(eq(channelAccountsTable.id, account.id));
      assert.equal(await resolveOutboundConfig(item.channel, account.id), null, "disabled row cannot use matching legacy credentials");
      await db.update(channelAccountsTable).set({ isActive: true, externalAccountId: `${externalId}_other` }).where(eq(channelAccountsTable.id, account.id));
      assert.equal(await resolveOutboundConfig(item.channel, account.id), null, "different external identity cannot inherit credentials");
      await db.update(channelAccountsTable).set({ externalAccountId: externalId, provider: "zernio" }).where(eq(channelAccountsTable.id, account.id));
      assert.equal(await resolveOutboundConfig(item.channel, account.id), null, "provider identity cannot inherit direct credentials");
      await db.update(channelAccountsTable).set({ provider: "direct" }).where(eq(channelAccountsTable.id, account.id));
      await pool.query("UPDATE integrations SET is_enabled=false WHERE key=$1", [item.key]);
      assert.equal(await resolveOutboundConfig(item.channel, account.id), null, "disabled integration cannot be a credential source");
      await pool.query("UPDATE integrations SET is_enabled=true,config=$2 WHERE key=$1", [item.key, encryptConfig({ [item.identityKey]: externalId })]);
      assert.equal(await resolveOutboundConfig(item.channel, account.id), null, "missing credential cannot pass identity-only checks");
      await pool.query("UPDATE integrations SET config=$2 WHERE key=$1", [item.key, encryptConfig(config)]);
      const [duplicate] = await db.insert(channelAccountsTable).values({ channel: item.channel, provider: "direct",
        externalAccountId: externalId, displayName: tag("duplicate_legacy_registration"), isActive: false }).returning();
      createdIds.push(duplicate.id);
      assert.equal(await resolveOutboundConfig(item.channel, account.id), null, "ambiguous identity is not a safe legacy binding");
      await db.delete(channelAccountsTable).where(eq(channelAccountsTable.id, duplicate.id));
      await db.update(channelAccountsTable).set({ configEncrypted: "invalid-json" }).where(eq(channelAccountsTable.id, account.id));
      assert.notEqual((await resolveOutboundConfig(item.channel, account.id))?.[item.tokenKey], config[item.tokenKey], "corrupt per-account config cannot escape into legacy credentials");
      assert.equal(await resolveOutboundConfig(item.channel, 2147483647), null, "missing account cannot inherit matching integration");
    } finally { await pool.query("DELETE FROM integrations WHERE key=$1", [item.key]); }
  }
  const instagram = { igBusinessAccountId: "ig-identity", pageId: "page-identity", pageAccessToken: "synthetic" };
  assert.equal(legacyConfigMatchesAccount("instagram", "ig-identity", instagram), true);
  assert.equal(legacyConfigMatchesAccount("instagram", "page-identity", instagram), false, "business identity outranks associated page identity");
  assert.equal(legacyConfigMatchesAccount("instagram", "page-identity", { pageId: "page-identity", pageAccessToken: "synthetic" }), true);
  assert.equal(legacyConfigMatchesAccount("whatsapp", null, { phoneNumberId: "1", accessToken: "synthetic" }), false);
  for (const token of ["", "  ", "enc::unreadable", "••••••••"]) {
    assert.equal(legacyConfigMatchesAccount("whatsapp", "1", { phoneNumberId: "1", accessToken: token }), false);
  }
});

test("identity-bound legacy registration preserves valid pipeline priority and rejects custom pipeline fallback", async () => {
  const externalId = tag("legacy_pipeline_wa");
  const [account] = await db.insert(channelAccountsTable).values({ channel: "whatsapp", provider: "direct",
    externalAccountId: externalId, displayName: tag("legacy_pipeline_registration"), isActive: true }).returning();
  createdIds.push(account.id);
  const senderId = await insertAccount({ channel: "whatsapp", externalAccountId: tag("pipeline_sender"),
    config: { phoneNumberId: tag("pipeline_sender"), accessToken: "synthetic_pipeline_token" }, isActive: true });
  await pool.query("INSERT INTO integrations(key,name,category,is_enabled,config) VALUES('whatsapp','Synthetic','communication',true,$1)",
    [encryptConfig({ phoneNumberId: externalId, accessToken: "synthetic_legacy_token" })]);
  const [pipeline] = (await pool.query("INSERT INTO communication_pipelines(name,slug,ai_bot_id,is_default,is_active) VALUES('Synthetic',$1,1,false,true) RETURNING id", [tag("pipeline")])).rows;
  try {
    assert.equal(await resolveOutboundConfig("whatsapp", account.id, pipeline.id), null, "custom pipeline without a sender must not escape to legacy");
    await pool.query("INSERT INTO communication_pipeline_accounts(pipeline_id,channel_account_id,can_send,can_receive,priority) VALUES($1,$2,true,false,1)", [pipeline.id, senderId]);
    assert.equal((await resolveOutboundConfig("whatsapp", account.id, pipeline.id))?.accessToken, "synthetic_pipeline_token", "valid pipeline priority is preserved");
    await db.update(channelAccountsTable).set({ isActive: false }).where(eq(channelAccountsTable.id, account.id));
    assert.equal(await resolveOutboundConfig("whatsapp", account.id, pipeline.id), null, "disabled pinned account is denied even with a pipeline sender");
    await db.update(channelAccountsTable).set({ isActive: true }).where(eq(channelAccountsTable.id, account.id));
    await pool.query("UPDATE communication_pipelines SET is_active=false WHERE id=$1", [pipeline.id]);
    assert.equal(await resolveOutboundConfig("whatsapp", account.id, pipeline.id), null, "disabled pipeline cannot escape to legacy");
  } finally {
    await pool.query("DELETE FROM communication_pipeline_accounts WHERE pipeline_id=$1", [pipeline.id]);
    await pool.query("DELETE FROM communication_pipelines WHERE id=$1", [pipeline.id]);
    await pool.query("DELETE FROM integrations WHERE key='whatsapp'");
  }
});

test("new native accounts remain configuration-only with encrypted secrets and composed provider filtering", async () => {
  const server = await listen(buildApp());
  try {
    const botToken = "123456789:synthetic_TEST_BOT_token_012345";
    const telegram = await sendReq(server, "POST", "/api/channel-accounts", { channel: "telegram", provider: "direct", displayName: tag("telegram"), isActive: true, config: { botToken, defaultChatId: "-100123456789" } });
    assert.equal(telegram.status, 201, JSON.stringify(telegram.body)); createdIds.push(telegram.body.id);
    assert.equal(telegram.body.isActive, false); assert.equal(telegram.body.isDefault, false);
    assert.equal(telegram.body.capabilities.configurationOnly, true); assert.equal(telegram.body.capabilities.webhookPath, null);
    assert.equal(telegram.body.config.botToken, "••••••••");
    const [stored] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, telegram.body.id));
    assert.ok(!stored.configEncrypted!.includes(botToken)); assert.equal(parseAccountConfig(stored.configEncrypted).botToken, botToken);
    assert.equal((await sendReq(server, "PATCH", `/api/channel-accounts/${telegram.body.id}/toggle-active`)).status, 409);
    assert.equal((await sendReq(server, "PATCH", `/api/channel-accounts/${telegram.body.id}/set-default`)).status, 409);
    assert.equal((await sendReq(server, "POST", `/api/channel-accounts/${telegram.body.id}/test`)).body.status, "not_supported");
    const sms = await sendReq(server, "POST", "/api/channel-accounts", { channel: "sms", displayName: tag("sms"), config: { accountSid: `AC${"a".repeat(32)}`, authToken: "b".repeat(32), fromNumber: "+441234567890" } });
    assert.equal(sms.status, 201, JSON.stringify(sms.body)); createdIds.push(sms.body.id); assert.equal(sms.body.isActive, false);
    const list = await sendReq(server, "GET", "/api/channel-accounts?channel=telegram&provider=direct");
    assert.equal(list.status, 200); assert.deepEqual(list.body.accounts.map((row: any) => row.id), [telegram.body.id]);
    const updated = await sendReq(server, "PUT", `/api/channel-accounts/${telegram.body.id}`, { config: { botToken: "", defaultChatId: "@ExampleChannel" } });
    assert.equal(updated.status, 200); assert.equal(updated.body.config.botToken, "••••••••");
    assert.equal((await sendReq(server, "GET", "/api/channel-accounts?channel=email")).status, 400);
  } finally { await close(server); }
});

test("manager, API token, impersonated and sessionless users cannot mutate or test accounts", async () => {
  for (const options of [{ role: "manager" }, { apiToken: true }, { impersonated: true }, { noSession: true }]) {
    const server = await listen(buildApp(options));
    try {
      for (const [method, path] of [["POST", "/channel-accounts"], ["PUT", "/channel-accounts/1"], ["PATCH", "/channel-accounts/1/toggle-active"], ["PATCH", "/channel-accounts/1/set-default"], ["DELETE", "/channel-accounts/1"], ["POST", "/channel-accounts/1/test"]] as const) {
        assert.equal((await sendReq(server, method, `/api${path}`, {})).status, 403, `${JSON.stringify(options)} ${method} ${path}`);
      }
    } finally { await close(server); }
  }
});

test("Zernio identity uniqueness is provider-wide and serialized; provider and inactive pin never escape to direct", async () => {
  const server = await listen(buildApp());
  try {
    const externalAccountId = tag("zernio_shared");
    const concurrent = await Promise.all(["whatsapp", "telegram"].map(channel => sendReq(server, "POST", "/api/channel-accounts", { channel, provider: "zernio", displayName: tag(`zernio_${channel}`), externalAccountId, config: {} })));
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
    const created = concurrent.find(r => r.status === 201)!.body; createdIds.push(created.id);
    assert.equal(created.isActive, false); assert.equal(await isZernioAccountSendable(externalAccountId), false);
    assert.equal((await sendReq(server, "PATCH", `/api/channel-accounts/${created.id}/toggle-active`)).status, 200);
    assert.equal(await isZernioAccountSendable(externalAccountId), true);
    assert.equal(await resolveOutboundConfig(created.channel, created.id), null);
    assert.equal(await resolveInboundAccount(created.channel, externalAccountId), null);
    assert.equal((await sendReq(server, "PUT", `/api/channel-accounts/${created.id}`, { displayName: tag("renamed_provider") })).body.isActive, true);
    assert.equal((await sendReq(server, "PUT", `/api/channel-accounts/${created.id}`, { externalAccountId: "replacement" })).status, 409);
    const [duplicate] = await db.insert(channelAccountsTable).values({ channel: "instagram", provider: "zernio", externalAccountId, displayName: tag("legacy_duplicate"), isActive: true }).returning();
    createdIds.push(duplicate.id);
    assert.equal(await isZernioAccountSendable(externalAccountId), false);
    await db.delete(channelAccountsTable).where(eq(channelAccountsTable.id, duplicate.id));
    assert.equal((await sendReq(server, "PATCH", `/api/channel-accounts/${created.id}/toggle-active`)).body.isActive, false);
    assert.equal(await isZernioAccountSendable(externalAccountId), false);
  } finally { await close(server); }
});

test("legacy facebook is projected as messenger and shares default grouping; stage references prevent deletion", async () => {
  const [legacy] = await db.insert(channelAccountsTable).values({ channel: "facebook", provider: "zernio", externalAccountId: tag("legacy_facebook"), displayName: tag("legacy_fb"), isActive: false, isDefault: true }).returning();
  createdIds.push(legacy.id);
  const server = await listen(buildApp());
  let stageId: number | undefined;
  try {
    const created = await sendReq(server, "POST", "/api/channel-accounts", { channel: "messenger", provider: "zernio", displayName: tag("new_fb"), externalAccountId: tag("new_fb"), isDefault: true });
    assert.equal(created.status, 201); createdIds.push(created.body.id);
    const listed = await sendReq(server, "GET", "/api/channel-accounts?channel=messenger&provider=zernio");
    assert.ok(listed.body.accounts.every((row: any) => row.channel === "messenger"));
    assert.equal(listed.body.accounts.filter((row: any) => row.isDefault).length, 1);
    assert.equal((await sendReq(server, "PUT", `/api/channel-accounts/${legacy.id}`, { channel: "messenger", displayName: tag("legacy_updated") })).status, 200);
    stageId = (await pool.query("INSERT INTO pipeline_stages(entity_type,key,label,automatic_message) VALUES('application',$1,'Synthetic',$2) RETURNING id", [tag("account_stage"), { enabled: false, channelAccountId: created.body.id }])).rows[0].id;
    const removed = await sendReq(server, "DELETE", `/api/channel-accounts/${created.body.id}`);
    assert.equal(removed.status, 409); assert.equal(removed.body.error, "ACCOUNT_IN_USE");
  } finally { if (stageId) await pool.query("DELETE FROM pipeline_stages WHERE id=$1", [stageId]); await close(server); }
});

test("Zernio global integration must be enabled with a decryptable key", async () => {
  const key = "synthetic-integration-key-never-outbound";
  await pool.query("INSERT INTO integrations(key,name,category,config,is_enabled) VALUES('zernio','Synthetic','messaging',$1,false)", [encryptConfig({ apiKey: key })]);
  try {
    assert.equal(await getZernioApiKey(), null);
    await pool.query("UPDATE integrations SET is_enabled=true WHERE key='zernio'");
    assert.equal(await getZernioApiKey(), key);
    await pool.query("UPDATE integrations SET config=$1 WHERE key='zernio'", [{ apiKey: "enc::v1::unreadable" }]);
    assert.equal(await getZernioApiKey(), null);
  } finally { await pool.query("DELETE FROM integrations WHERE key='zernio'"); }
});
