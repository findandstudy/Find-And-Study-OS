/** Public catalogue settings/audit/cache invalidation tests with DB doubles. */
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
let setting: Row | null = null;
let audits: Row[] = [];
let failAudit = false;
let conflict = false;
let distinctCall = 0;

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "innerJoin"]) result[method] = () => result;
  return result;
};
mock.method(db, "selectDistinct", () => ({ from: () => {
  const index = distinctCall++;
  return chain(() => index % 2 === 0 ? [{ value: "Turkey" }] : [{ value: "Private" }]);
} }));
mock.method(db, "select", (projection?: Record<string, unknown>) => ({ from: (table: unknown) => chain(() => {
  if (table !== schema.settingsTable || !setting) return [];
  if (projection && "allowedCountries" in projection) {
    return [{
      allowedCountries: setting.publicCatalogAllowedCountries,
      allowedUniversityTypes: setting.publicCatalogAllowedUniversityTypes,
      countryRules: setting.publicCatalogCountryRules,
    }];
  }
  return [setting];
}) }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  if (conflict || !setting) return [];
  setting = { ...setting, ...values };
  return [{ id: setting.id }];
} }) }) }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values });
    return Promise.resolve();
  }
  setting = { id: 1, createdAt: new Date(), ...values };
  return { returning: async () => [{ id: 1 }] };
} }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const settingSnapshot = setting ? { ...setting } : null;
  const auditSnapshot = audits.map(row => ({ ...row }));
  try { return await callback(db); }
  catch (error) { setting = settingSnapshot; audits = auditSnapshot; throw error; }
});

const { clearPublicCatalogPolicyCache } = await import("../src/lib/publicCatalogQueryPolicy");
const router = (await import("../src/routes/course-finder")).default;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
app.use("/api", router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "fixture_failure" }));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

function request(body: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/course-finder/public-settings", method: "PATCH",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) } }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

const original = () => ({ id: 1, publicCatalogAllowedCountries: ["United Kingdom"], publicCatalogAllowedUniversityTypes: ["Private"], publicCatalogCountryRules: {}, updatedAt: new Date() });
const body = { allowedCountries: ["Turkey"], allowedUniversityTypes: ["Private"], countryRules: {} };
beforeEach(() => { setting = original(); audits = []; failAudit = false; conflict = false; distinctCall = 0; clearPublicCatalogPolicyCache(); });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

test("public settings update rolls back when its audit insert fails", async () => {
  failAudit = true;
  const result = await request(body);
  assert.equal(result.status, 500);
  assert.deepEqual(setting!.publicCatalogAllowedCountries, ["United Kingdom"]);
  assert.deepEqual(audits, []);
});

test("stale public settings update returns 409 without mutation", async () => {
  conflict = true;
  const result = await request(body);
  assert.equal(result.status, 409);
  assert.equal(result.data.error, "public_catalog_settings_version_conflict");
  assert.deepEqual(setting!.publicCatalogAllowedCountries, ["United Kingdom"]);
  assert.deepEqual(audits, []);
});

test("successful update commits one bounded audit and returns the new policy", async () => {
  const result = await request(body);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.allowedCountries, ["Turkey"]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "update_public_catalog_settings");
  assert.deepEqual(JSON.parse(audits[0].changes), {
    allowedCountries: ["Turkey"], allowedUniversityTypes: ["Private"], countryRules: {},
  });
});
