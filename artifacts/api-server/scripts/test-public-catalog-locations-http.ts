import test from "node:test";
import assert from "node:assert/strict";
const target = new URL(process.env.DATABASE_URL || "http://invalid");
if (target.hostname !== "127.0.0.1" || target.port !== "5433" || target.pathname !== "/fasos_apply_local"
  || process.env.NODE_ENV !== "test" || process.env.ALLOW_LIVE_INTEGRATIONS !== "false") throw Error("Disposable local database required");

test("catalog-only country and city are reachable, noindex, and inactive entities stay closed", async () => {
  const { pool } = await import("@workspace/db");
  const { default: express } = await import("express");
  const { default: destinations } = await import("../src/routes/destinations");
  const { default: publicWeb } = await import("../src/routes/public-web");
  const { getPublicCatalogPolicy } = await import("../src/lib/publicCatalogQueryPolicy");
  const { publicCatalogSlug, publicCatalogRouteKey } = await import("../src/lib/publicCatalogRouteContract");
  const { invalidatePublicCatalogRenderCache, getPublicCatalogRenderModel } = await import("../src/lib/publicCatalogRenderReadModel");
  const { matchPublicCatalogRenderPath } = await import("../src/lib/publicCatalogRenderContract");
  const run = `Locations fixture ${Date.now()}`;
  let countryId: number | undefined, createdCountry = false, universityId: number | undefined, cityId: number | undefined, destinationId: number | undefined;
  let server: import("node:http").Server | undefined;
  try {
    const policy = await getPublicCatalogPolicy();
    const name = policy.allowedCountries[0] || run;
    const existing = await pool.query("SELECT id,is_active FROM countries WHERE name=$1", [name]);
    if (existing.rows.length) { countryId = existing.rows[0].id; assert.equal(existing.rows[0].is_active, true); }
    else { countryId = (await pool.query("INSERT INTO countries(name,code) VALUES($1,$2) RETURNING id", [name, `fixture-${Date.now()}`])).rows[0].id; createdCountry = true; }
    assert.equal((await pool.query("SELECT count(*)::int n FROM destinations WHERE country=$1", [name])).rows[0].n, 0, "Fixture requires a country without a destination; never changes existing publication");
    universityId = (await pool.query("INSERT INTO universities(name,country,city,university_type) VALUES($1,$2,$1,'Private') RETURNING id", [run, name])).rows[0].id;
    cityId = (await pool.query("INSERT INTO cities(name,country_id) VALUES($1,$2) RETURNING id", [run, countryId])).rows[0].id;
    const app = express(); app.use("/api", destinations, publicWeb);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const slug = publicCatalogSlug(name);
    const listing = await (await fetch(`${base}/public/destinations?locale=en`)).json() as any[];
    const listed = listing.find(row => row.catalogCountryId === countryId);
    assert.ok(listed); assert.equal(listed.id, null); assert.equal(listed.indexable, false);
    const response = await fetch(`${base}/public/destinations/${slug}?locale=en`);
    assert.equal(response.status, 200);
    const detail = await response.json() as any;
    assert.equal(detail.meta.indexable, false); assert.deepEqual(detail.meta.alternatePaths, {});
    assert.equal(detail.destination.source, "catalog");
    assert.equal(detail.universities.find((row: any) => row.id === universityId)?.programCount, 0);
    assert.ok(detail.cities.some((city: any) => city.id === cityId));
    const cityRoute = publicCatalogRouteKey(cityId!, run);
    const cityResponse = await fetch(`${base}/public/web/cities/${cityRoute}?locale=en`);
    assert.equal(cityResponse.status, 200);
    const city = await cityResponse.json() as any;
    assert.equal(city.meta.indexable, false); assert.deepEqual(city.meta.alternatePaths, {});
    assert.equal(city.data.countryPath, listed.canonicalPath);
    const route = matchPublicCatalogRenderPath(listed.canonicalPath); assert.ok(route);
    const rendered = await getPublicCatalogRenderModel(route);
    assert.equal(rendered.value.kind, "destination_detail"); assert.equal(rendered.value.indexable, false);
    await pool.query("UPDATE cities SET is_active=false WHERE id=$1", [cityId]);
    invalidatePublicCatalogRenderCache({ entityType: "catalog" });
    assert.equal((await fetch(`${base}/public/web/cities/${cityRoute}?locale=en`)).status, 404);
    destinationId = (await pool.query("INSERT INTO destinations(name,slug,country,is_active) VALUES($1,$2,$3,false) RETURNING id", [run, slug, name])).rows[0].id;
    assert.equal((await fetch(`${base}/public/destinations/${slug}?locale=en`)).status, 404, "Inactive destination cannot be bypassed by catalog fallback");
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (destinationId) await pool.query("DELETE FROM destinations WHERE id=$1", [destinationId]);
    if (universityId) await pool.query("DELETE FROM universities WHERE id=$1", [universityId]);
    if (cityId) await pool.query("DELETE FROM cities WHERE id=$1", [cityId]);
    if (createdCountry && countryId) await pool.query("DELETE FROM countries WHERE id=$1", [countryId]);
    invalidatePublicCatalogRenderCache({ entityType: "catalog" });
    await pool.end();
  }
});
