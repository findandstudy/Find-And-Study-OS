import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomBytes } from "node:crypto";

const target = new URL(process.env.DATABASE_URL || "postgres://invalid");
if (process.env.ALLOW_DISPOSABLE_CATALOG_INVENTORY_TEST !== "true" || process.env.NODE_ENV !== "test" || process.env.ALLOW_LIVE_INTEGRATIONS !== "false"
  || !["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.port !== "5433" || target.pathname !== "/fasos_apply_local" || target.search || target.hash) {
  throw new Error("Inventory test requires explicit opt-in and only disposable 127.0.0.1:5433/fasos_apply_local with disabled live integrations");
}

test("dynamic inventory HTTP is private, bounded, current and does not create CMS copies", { timeout: 45_000 }, async () => {
  const oldMode = process.env.PUBLIC_WEB_SITEMAP_MODE;
  process.env.PUBLIC_WEB_SITEMAP_MODE = "off";
  const { pool } = await import("@workspace/db");
  const { default: router } = await import("../src/routes/website");
  const run = `inventory-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const app = express();
  app.use((req, _res, next) => {
    const role = req.header("x-fixture-role");
    if (role) req.user = { id: 2147483000, role, isActive: true, replitId: "fixture", email: null, firstName: null, lastName: null, avatarUrl: null, language: "en" };
    next();
  });
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const get = (query: string, role?: string) => fetch(`http://127.0.0.1:${address.port}/api/website/catalog-pages?${query}`, { headers: role ? { "x-fixture-role": role } : {} });
  let countryId: number | undefined, cityId: number | undefined, universityId: number | undefined;
  const programIds: number[] = [];
  try {
    const identity = await pool.query("SELECT current_database() AS name,host(inet_server_addr()) AS address,inet_server_port() AS port");
    assert.deepEqual(identity.rows[0], { name: "fasos_apply_local", address: "127.0.0.1", port: 5433 });
    assert.equal((await get("kind=program")).status, 401);
    for (const role of ["student", "agent", "staff", "manager"]) assert.equal((await get("kind=program", role)).status, 403);
    assert.equal((await get("kind=users", "admin")).status, 400);
    assert.equal((await get("kind=program&pageSize=500", "admin")).status, 400);
    assert.equal((await get("kind=program&locale=unknown", "admin")).status, 400);
    countryId = (await pool.query("INSERT INTO countries(name,code,is_active) VALUES ($1,'XY',true) RETURNING id", [run])).rows[0].id;
    cityId = (await pool.query("INSERT INTO cities(name,country_id,is_active) VALUES ($1,$2,true) RETURNING id", [run, countryId])).rows[0].id;
    universityId = (await pool.query("INSERT INTO universities(name,country,city,university_type,is_active,contact_person_email) VALUES ($1,$1,$1,'Private',false,'private-fixture@example.invalid') RETURNING id", [run])).rows[0].id;
    for (let index = 0; index < 2; index++) programIds.push((await pool.query("INSERT INTO programs(name,university_id,is_active) VALUES ($1,$2,true) RETURNING id", [`${run}-${index}`, universityId])).rows[0].id);
    const response = await get(`kind=program&q=${run}&pageSize=1`, "admin");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    const body = await response.json();
    assert.equal(body.pagination.total, 2);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].visible, false, "baseline public policy excludes an inactive university and its programs");
    assert.equal(body.items[0].admissionsOpen, false);
    assert.ok(body.items[0].issues.includes("CATALOG_POLICY_HIDDEN"));
    assert.equal(body.items[0].publication.status, "NOT_EVALUATED");
    assert.equal(body.items[0].publication.revisionNumber, null);
    assert.equal(body.items[0].seo, "NOT_EVALUATED");
    assert.ok(body.items[0].issues.includes("DESCRIPTION_MISSING"));
    assert.doesNotMatch(JSON.stringify(body), /private-fixture|contactPerson|commissionRate/);
    const second = await (await get(`kind=program&q=${run}&pageSize=1&page=2`, "super_admin")).json();
    assert.notEqual(second.items[0].sourceId, body.items[0].sourceId);
    const arabic = await (await get(`kind=program&q=${run}&locale=ar`, "admin")).json();
    assert.equal(arabic.items[0].contentDelivery, "SOURCE_FALLBACK");
    assert.match(arabic.items[0].canonicalPath, /^\/ar\/programs\//);
    const country = await (await get(`kind=country&q=${run}`, "admin")).json();
    assert.equal(country.items[0].sourceId, countryId);
    assert.equal(country.items[0].visible, false, "catalog-only country has no publicly eligible university under the retained baseline policy");
    assert.ok(country.items[0].issues.includes("COUNTRY_ROUTE_UNAVAILABLE"));
    assert.match(country.items[0].canonicalPath, /^\/en\/countries\//);
    const city = await (await get(`kind=city&q=${run}`, "admin")).json();
    assert.equal(city.items[0].sourceId, cityId);
    assert.equal(city.items[0].visible, true);
    await pool.query("UPDATE programs SET is_active=false WHERE id=$1", [programIds[0]]);
    const changed = await (await get(`kind=program&q=${programIds[0]}`, "admin")).json();
    assert.equal(changed.items[0].visible, false, "reads reflect source changes without generated-page synchronization");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM website_pages WHERE title LIKE $1 OR slug LIKE $1", [`%${run}%`])).rows[0].n, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const id of programIds) await pool.query("DELETE FROM programs WHERE id=$1", [id]);
    if (universityId) await pool.query("DELETE FROM universities WHERE id=$1", [universityId]);
    if (cityId) await pool.query("DELETE FROM cities WHERE id=$1", [cityId]);
    if (countryId) await pool.query("DELETE FROM countries WHERE id=$1", [countryId]);
    if (oldMode === undefined) delete process.env.PUBLIC_WEB_SITEMAP_MODE; else process.env.PUBLIC_WEB_SITEMAP_MODE = oldMode;
    await pool.end();
  }
});
