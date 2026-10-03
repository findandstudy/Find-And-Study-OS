/** Message-campaign retry audit tests with rollback-capable DB doubles. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import express from "express";
import http from "node:http";
import { once } from "node:events";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5433/fasos_apply_local";
process.env.NODE_ENV = "test";
const schema = await import("@workspace/db");
const { db, pool } = schema;
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });

type Row = Record<string, any>;
let campaigns: Row[] = [];
let recipients: Row[] = [];
let audits: Row[] = [];
let failAudit = false;

mock.method(db, "select", () => ({
  from: (table: unknown) => ({
    where: () => ({
      limit: async () => table === schema.messageCampaignsTable ? campaigns : [],
    }),
  }),
}));
mock.method(db, "insert", (table: unknown) => ({ values: (input: Row | Row[]) => {
  const values = Array.isArray(input) ? input : [input];
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push(...values.map(value => ({ ...value })));
    return Promise.resolve();
  }
  return { returning: async () => [] };
} }));
mock.method(db, "update", (table: unknown) => ({ set: (values: Row) => ({ where: () => {
  const execute = async () => {
    const target = table === schema.messageCampaignRecipientsTable ? recipients : campaigns;
    const eligible = table === schema.messageCampaignRecipientsTable
      ? target.filter(row => ["failed", "retrying"].includes(row.status))
      : target;
    for (const row of eligible) Object.assign(row, values);
    return eligible;
  };
  const query: any = { returning: async () => execute() };
  query.then = (resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) => execute().then(resolve, reject);
  return query;
} }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const campaignSnapshot = campaigns.map(row => ({ ...row }));
  const recipientSnapshot = recipients.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try {
    return await callback(db);
  } catch (error) {
    campaigns = campaignSnapshot;
    recipients = recipientSnapshot;
    audits = auditSnapshot;
    throw error;
  }
});

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, role: "super_admin", isActive: true, email: "admin@example.test" } as any;
  next();
});
const router = (await import("../src/routes/messageCampaigns")).default;
app.use("/api", router);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "fixture_failure", detail: error instanceof Error ? error.message : String(error) });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

function request(path: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${path}`, method: "POST" }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeEach(() => {
  campaigns = [{ id: 1, createdById: 7, status: "completed", completedAt: new Date(), queuedCount: 0, failedCount: 1 }];
  recipients = [{ id: 10, campaignId: 1, status: "failed", errorCode: "no_zernio_account", attempts: 1 }];
  audits = [];
  failAudit = false;
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
  mock.restoreAll();
});

test("safe retry and campaign counters roll back when audit persistence fails", async () => {
  failAudit = true;
  const response = await request("/message-campaigns/1/retry-failed");
  assert.equal(response.status, 500);
  assert.equal(recipients[0].status, "failed");
  assert.equal(recipients[0].attempts, 1);
  assert.equal(campaigns[0].status, "completed");
  assert.equal(audits.length, 0);
});

test("successful safe retry commits one bounded audit receipt", async () => {
  const response = await request("/message-campaigns/1/retry-failed");
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.retried, 1);
  assert.equal(recipients[0].status, "queued");
  assert.equal(campaigns[0].status, "queued");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "message_campaign.retry_safe_failures");
  assert.deepEqual(JSON.parse(audits[0].changes), { retriedCount: 1 });
});
