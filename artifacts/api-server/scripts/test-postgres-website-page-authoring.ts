import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHash } from "node:crypto";

const localUrl = "postgresql://postgres@127.0.0.1:5433/fasos_apply_local";
if (process.env.DATABASE_URL !== localUrl || process.env.ALLOW_LIVE_INTEGRATIONS !== "false") {
  throw new Error("This test requires the exact disposable loopback database and disabled integrations");
}
let closePool: (() => Promise<void>) | undefined;
after(async () => { await closePool?.(); });

test("Pages draft and preview HTTP routes enforce roles and use current PostgreSQL catalogue data", async () => {
  const { pool } = await import("@workspace/db");
  closePool = () => pool.end();
  const { default: router } = await import("../src/routes/website");
  const { countryMatches, catalogName } = await import("../src/lib/websiteCatalogFilters");
  for (const alias of ["Turkey", "Türkiye", "Turkiye", "TR", "türkiye"]) assert.equal(countryMatches(alias, { name: "Turkey", code: "TR" }), true);
  assert.equal(countryMatches("GB", { name: "United Kingdom", code: "GB" }), true);
  assert.equal(catalogName("İstanbul"), catalogName("Istanbul"));
  const identity = await pool.query("SELECT current_database() AS name, inet_server_addr()::text AS address, inet_server_port() AS port");
  assert.deepEqual(identity.rows[0], { name: "fasos_apply_local", address: "127.0.0.1/32", port: 5433 });
  const slug = `authoring-fixture-${process.pid}`;
  const country = `Authoring Fixture ${process.pid}`;
  const app = express();
  const fixtureSid = (role: string) => createHash("sha256").update(`authoring-${process.pid}-${role}`).digest("hex");
  app.use(express.json({ limit: "16kb" }));
  // Synthetic request identity; production authentication is not reconfigured.
  app.use((req, _res, next) => {
    const role = req.header("x-fixture-role");
    if (role) req.cookies = { sid: fixtureSid(role) };
    if (req.header("x-fixture-api-token")) req.apiTokenAuth = true as any;
    if (role) req.user = { id: role === "super_admin" ? 2147483001 : 2147483000, role, isActive: true, replitId: "fixture", email: null, firstName: null, lastName: null, avatarUrl: null, language: "en" };
    next();
  });
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let universityId: number | null = null;
  let countryId: number | null = null;
  let inactiveGlobalId: number | null = null;
  const layoutIds: number[] = [];
  const request = (path: string, role?: string, body?: unknown, method = body ? "POST" : "GET") => fetch(`${origin}/api${path}`, {
    method,
    headers: { ...(role ? { "x-fixture-role": role } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const draft = { title: "Local authoring fixture", slug, starter: "universities", country };
  try {
    for (const role of ["admin", "super_admin"]) await pool.query("INSERT INTO sessions(sid,sess,expire) VALUES ($1,$2,$3)", [fixtureSid(role), { user: { id: role === "admin" ? 2147483000 : 2147483001 }, issued_at: Date.now(), access_token: "" }, new Date(Date.now() + 600_000)]);
    for (const [role, status] of [[undefined, 401], ["student", 403], ["agent", 403], ["staff", 403]] as const) {
      assert.equal((await request("/website/pages/drafts", role, draft)).status, status);
      assert.equal((await request("/website/catalog-preview?source=universities", role)).status, status);
      assert.equal((await request("/website/catalog-filters?source=universities", role)).status, status);
    }
    const attempts = await Promise.all([request("/website/pages/drafts", "admin", draft), request("/website/pages/drafts", "admin", draft)]);
    assert.deepEqual(attempts.map(response => response.status).sort(), [201, 409]);
    const created = await attempts.find(response => response.status === 201)!.json() as { id: number; status: string; robotsIndex: boolean; createdBy: number };
    assert.equal(created.status, "draft");
    assert.equal(created.robotsIndex, false);
    assert.equal(created.createdBy, 2147483000);
    assert.equal((await request(`/website/pages/${slug}`)).status, 404, "anonymous drafts are hidden");
    assert.equal((await request(`/website/pages/${created.id}`)).status, 401, "numeric authoring remains private");
    const blocks = await pool.query("SELECT block_type, content FROM website_page_blocks WHERE page_id=$1 ORDER BY sort_order", [created.id]);
    assert.deepEqual(blocks.rows.map(row => row.block_type), ["hero", "catalog_grid"]);
    assert.equal(blocks.rows[1].content.source, "universities");
    assert.equal(blocks.rows[1].content.items, undefined);
    assert.equal((await request("/website/pages/drafts", "admin", { ...draft, slug: "programs" })).status, 400);
    assert.equal((await request("/website/pages/drafts", "admin", { ...draft, status: "published" })).status, 400);
    assert.equal((await request("/website/catalog-preview?source=universities&limit=66", "admin")).status, 200);
    countryId = (await pool.query("INSERT INTO countries(name,code,is_active) VALUES ($1,'AF',true) RETURNING id", [country])).rows[0].id;
    const inserted = await pool.query("INSERT INTO universities(name,country,university_type,is_active) VALUES ('Authoring Before',$1,'Private',true) RETURNING id", [country]);
    universityId = inserted.rows[0].id;
    const definitions = await (await request("/website/catalog-filters?source=universities&locale=tr", "admin")).json();
    assert.deepEqual(definitions.map((f: any) => f.key), ["countryId", "cityId", "institutionType"]);
    assert.ok(definitions[0].options.some((o: any) => o.id === String(countryId)));
    assert.deepEqual((await (await request("/website/catalog-filters?source=cities", "admin")).json()).map((f: any) => f.key), ["countryId"]);
    assert.deepEqual(await (await request("/website/catalog-filters?source=destinations", "admin")).json(), []);
    const invalidFilter = await request("/website/catalog-preview?source=universities&countryId=NaN", "admin");
    assert.equal(invalidFilter.status, 400);
    assert.equal((await invalidFilter.json()).error, "Invalid countryId");
    const byId = await (await request(`/website/catalog-preview?source=universities&countryId=${countryId}`, "admin")).json();
    assert.deepEqual(byId.items.map((i: any) => i.id), [universityId]);
    assert.deepEqual((await (await request("/website/catalog-preview?source=universities&countryId=999999999", "admin")).json()).items, []);
    const previewPath = `/website/catalog-preview?source=universities&locale=ar&country=${encodeURIComponent(country)}`;
    const first = await request(previewPath, "admin");
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "private, no-store");
    assert.equal(first.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal((await first.json()).items[0].title, "Authoring Before");
    await pool.query("UPDATE universities SET name='Authoring After' WHERE id=$1", [universityId]);
    const second = await request(previewPath, "admin");
    const current = await second.json();
    assert.equal(current.items[0].title, "Authoring After");
    assert.match(current.items[0].canonicalPath, /^\/ar\/universities\/authoring-after-\d+$/);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM website_page_versions WHERE page_id=$1", [created.id])).rows[0].count, 0);

    // Real publication path, immutable snapshots, legacy slash slugs, locale fallback.
    await pool.query("INSERT INTO website_page_blocks(page_id,block_type,content,sort_order) VALUES ($1,'global_block','{}',2)", [created.id]);
    inactiveGlobalId = (await pool.query("INSERT INTO website_global_components(name,slug,component_type,content,is_active) VALUES ('Inactive fixture',$1,'cta_banner','{\"title\":\"Must not appear\"}',false) RETURNING id", [slug])).rows[0].id;
    await pool.query("INSERT INTO website_page_blocks(page_id,block_type,content,sort_order) VALUES ($1,'global_block',$2::jsonb,3)", [created.id, JSON.stringify({ globalComponentId: inactiveGlobalId })]);
    await pool.query("UPDATE website_pages SET slug=$2,og_title='Published OG',robots_follow=false WHERE id=$1", [created.id, `/${slug}`]);
    assert.equal((await request(`/website/pages/${created.id}/publish`, "admin", {})).status, 200);
    const published = await request(`/website/pages/${slug}?locale=en`);
    assert.equal(published.status, 200);
    const publishedBody = await published.json();
    assert.equal(publishedBody.data.blocks.length, 2, "unbound and inactive globals emit no empty section");
    assert.equal(publishedBody.data.seo.ogTitle, "Published OG");
    assert.equal(publishedBody.data.seo.robotsFollow, false);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM website_pages WHERE slug IN ('about','/about')")).rows[0].n, 0, "isolated fixture requires an unused About route");
    await pool.query("UPDATE website_pages SET slug='/about' WHERE id=$1", [created.id]);
    try {
      const about = await request("/website/pages/about?locale=en");
      assert.equal(about.status, 200);
      assert.equal((await about.json()).meta.canonicalPath, "/en/about");
    } finally { await pool.query("UPDATE website_pages SET slug=$2 WHERE id=$1", [created.id, `/${slug}`]); }
    await pool.query("UPDATE website_page_blocks SET content='{\"title\":\"Unpublished draft\"}' WHERE page_id=$1 AND block_type='hero'", [created.id]);
    assert.equal((await (await request(`/website/pages/${slug}`)).json()).data.blocks[0].content.title, draft.title);
    const fallback = await (await request(`/website/pages/${slug}?locale=tr`)).json();
    assert.equal(fallback.meta.indexable, false);
    assert.deepEqual(fallback.meta.alternatePaths, {});
    assert.equal((await request(`/website/pages/${created.id}/publish`, "admin", {})).status, 200);
    assert.equal((await (await request(`/website/pages/${slug}`)).json()).data.blocks[0].content.title, "Unpublished draft");
    assert.equal((await request(`/website/pages/${created.id}/unpublish`, "admin", {})).status, 200);
    assert.equal((await request(`/website/pages/${slug}`)).status, 404);
    await pool.query("UPDATE website_pages SET slug=$2 WHERE id=$1", [created.id, slug]);

    const { defaultDetailLayout } = await import("../src/lib/websiteDetailLayoutContract");
    const { readPublishedDetailLayout } = await import("../src/lib/websiteDetailLayouts");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM website_pages WHERE slug LIKE '_detail-layout-%'")).rows[0].n, 0, "fixture requires empty layout namespace");
    const cityLayout = defaultDetailLayout("city");
    const createdLayout = await request("/website/detail-layouts/draft", "admin", { expectedUpdatedAt: null, layout: cityLayout });
    assert.equal(createdLayout.status, 200);
    const entry = await createdLayout.json();
    layoutIds.push(entry.pageId);
    assert.equal((await request("/website/detail-layouts/draft", "admin", { expectedUpdatedAt: null, layout: cityLayout })).status, 409);
    const approval = { approved: true, selections: [{ pageId: entry.pageId, digest: entry.digest }] };
    assert.equal((await request("/website/detail-layouts/publish", "admin", approval)).status, 403, "self approval denied");
    await pool.query("UPDATE sessions SET sess=jsonb_set(sess::jsonb,'{originalSid}','\"impersonated\"'::jsonb) WHERE sid=$1", [fixtureSid("super_admin")]);
    assert.equal((await request("/website/detail-layouts/publish", "super_admin", approval)).status, 403, "impersonated reviewer denied");
    await pool.query("UPDATE sessions SET sess=sess::jsonb - 'originalSid' WHERE sid=$1", [fixtureSid("super_admin")]);
    assert.equal((await request(`/website/pages/${entry.pageId}/publish`, "super_admin", {})).status, 409, "legacy publish bypass denied");
    const layoutBlock = (await pool.query("SELECT id FROM website_page_blocks WHERE page_id=$1", [entry.pageId])).rows[0];
    const encodeId = (id: number) => String(id).split("").map(c => `%${c.charCodeAt(0).toString(16)}`).join("");
    for (const path of [`/WEBSITE/PAGES/${entry.pageId}`, `/website/PaGeS/${entry.pageId}`, `/website/PAGE-BLOCKS/${layoutBlock.id}`, `/website/pages/${encodeId(entry.pageId)}`, `/website/page-blocks/${encodeId(layoutBlock.id)}`]) {
      for (const method of ["PUT", "DELETE"]) {
        assert.equal((await request(path, "super_admin", { title: "bypass attempt" }, method)).status, 409, `${method} ${path} must not bypass review`);
      }
    }
    assert.equal((await request(`/WEBSITE/PAGES/${entry.pageId}/PUBLISH`, "super_admin", {})).status, 409);
    assert.equal((await request(`/website/pages/${encodeId(entry.pageId)}/publish`, "super_admin", {})).status, 409);
    assert.equal((await request("/website/page-versions", "super_admin", { pageId: entry.pageId, versionNumber: 1 })).status, 409);
    for (const path of ["/website/pages", "/website/page-blocks", "/website/page-versions"]) {
      assert.equal((await request(path, "super_admin", [{ pageId: entry.pageId, template: "detail:city", blockType: "detail_layout" }])).status, 400, "generic bulk insertion is rejected");
    }
    assert.equal((await request("/website/detail-layouts/publish", "super_admin", { ...approval, selections: [{ pageId: entry.pageId, digest: "a".repeat(64) }] })).status, 409);
    assert.equal((await request("/website/detail-layouts/publish", "super_admin", approval)).status, 200);
    assert.equal((await request("/website/detail-layouts/publish", "super_admin", approval)).status, 409, "replay cannot create another publication");
    const currentLayout = (await (await request("/website/detail-layouts", "admin")).json()).find((x: any) => x.layout.kind === "city");
    const changed = { ...cityLayout, hidden: ["programs"] };
    assert.equal((await request("/website/detail-layouts/draft", "admin", { expectedUpdatedAt: currentLayout.updatedAt, layout: changed })).status, 200);
    assert.deepEqual(await readPublishedDetailLayout("city"), cityLayout, "draft does not change published snapshot");
    const latest = (await (await request("/website/detail-layouts", "admin")).json()).find((x: any) => x.layout.kind === "city");
    assert.equal((await request("/website/detail-layouts/publish", "super_admin", { approved: true, selections: [{ pageId: latest.pageId, digest: latest.digest }, { pageId: 2147482000, digest: "b".repeat(64) }] })).status, 409);
    assert.deepEqual(await readPublishedDetailLayout("city"), cityLayout, "batch failure rolls back all members");
    assert.equal((await request("/website/detail-layouts/publish", "super_admin", { approved: true, selections: [{ pageId: latest.pageId, digest: latest.digest }] })).status, 200);
    assert.deepEqual(await readPublishedDetailLayout("city"), changed);
    const { readPublishedDetailContent } = await import("../src/lib/websiteDetailContent");
    assert.ok(countryId);
    const content = { version: 1, kind: "destination", entityId: countryId, locale: "en", sections: [{ key: "faq", title: "Synthetic questions", body: "Synthetic local fixture only", sources: [{ label: "Synthetic", url: "https://example.org/fixture" }], reviewedOn: "2026-09-01" }] };
    assert.equal((await request("/website/detail-content/draft", "agent", { content, expectedUpdatedAt: null })).status, 403);
    assert.equal((await request("/website/detail-content/draft", "admin", { content: { ...content, entityId: 2147482000 }, expectedUpdatedAt: null })).status, 404);
    const editorialResponse = await request("/website/detail-content/draft", "admin", { content, expectedUpdatedAt: null });
    assert.equal(editorialResponse.status, 200);
    const editorial = await editorialResponse.json();
    layoutIds.push(editorial.pageId);
    await pool.query("UPDATE sessions SET sess=jsonb_set(sess::jsonb,'{originalSid}','\"impersonated\"'::jsonb) WHERE sid=$1", [fixtureSid("admin")]);
    assert.equal((await request("/website/detail-content/draft", "admin", { content, expectedUpdatedAt: editorial.updatedAt })).status, 403);
    assert.equal((await request("/website/detail-layouts/draft", "admin", { layout: cityLayout, expectedUpdatedAt: null })).status, 403);
    await pool.query("UPDATE sessions SET sess=sess::jsonb - 'originalSid' WHERE sid=$1", [fixtureSid("admin")]);
    for (const extra of [{ authorization: "Bearer fixture" }, { "x-fixture-api-token": "true" }]) for (const [path, body] of [["/website/detail-content/draft", { content, expectedUpdatedAt: editorial.updatedAt }], ["/website/detail-layouts/draft", { layout: cityLayout, expectedUpdatedAt: null }]] as const) {
      assert.equal((await fetch(`${origin}/api${path}`, { method: "POST", headers: { "x-fixture-role": "admin", "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) })).status, 403);
    }
    assert.equal(await readPublishedDetailContent("destination", countryId, "en"), null, "draft never public");
    assert.equal((await request(`/website/pages/${editorial.pageId}`, "admin", { status: "published" }, "PUT")).status, 409);
    const encodedEditorialId = String(editorial.pageId).split("").map(digit => `%${digit.charCodeAt(0).toString(16)}`).join("");
    for (const path of [`/website/pages/${editorial.pageId}/publish`, `/website/pages/${editorial.pageId}/unpublish`, `/website/pages/${editorial.pageId}/save-draft`, `/website/pages/${editorial.pageId}/restore-version/1`, `/WEBSITE/PAGES/${encodedEditorialId}/publish/`]) {
      assert.equal((await request(path, "super_admin", {})).status, 409, `reserved editorial protected: ${path}`);
    }
    for (const path of ["/website/pages", "/website/page-blocks", "/website/page-versions"]) {
      assert.equal((await request(path, "admin", [{ pageId: editorial.pageId }])).status, 400);
    }
    assert.equal((await request("/website/detail-content/draft", "admin", { content, expectedUpdatedAt: null })).status, 409);
    const approve = { pageId: editorial.pageId, digest: editorial.digest, approved: true };
    assert.equal((await request("/website/detail-content/publish", "admin", approve)).status, 403);
    await pool.query("UPDATE sessions SET sess=jsonb_set(sess::jsonb,'{originalSid}','\"impersonated\"'::jsonb) WHERE sid=$1", [fixtureSid("super_admin")]);
    assert.equal((await request("/website/detail-content/publish", "super_admin", approve)).status, 403);
    await pool.query("UPDATE sessions SET sess=sess::jsonb - 'originalSid' WHERE sid=$1", [fixtureSid("super_admin")]);
    assert.equal((await request("/website/detail-content/publish", "super_admin", { ...approve, digest: "a".repeat(64) })).status, 409);
    assert.equal((await request("/website/detail-content/publish", "super_admin", approve)).status, 200);
    assert.deepEqual(await readPublishedDetailContent("destination", countryId, "en"), content);
    assert.equal(await readPublishedDetailContent("destination", countryId, "tr"), null, "exact locale only");
    assert.equal((await request("/website/detail-content/publish", "super_admin", approve)).status, 409, "replay denied");
    const saved = await (await request(`/website/detail-content?kind=destination&entityId=${countryId}&locale=en`, "admin")).json();
    assert.equal((await request("/website/detail-content/draft", "admin", { content: { ...content, sections: [] }, expectedUpdatedAt: saved.updatedAt })).status, 200);
    assert.deepEqual(await readPublishedDetailContent("destination", countryId, "en"), content, "new draft preserves approved version");
    const nextDraft = await (await request(`/website/detail-content?kind=destination&entityId=${countryId}&locale=en`, "admin")).json();
    const race = await Promise.all([request("/website/detail-content/publish", "super_admin", { pageId: nextDraft.pageId, digest: nextDraft.digest, approved: true }), request("/website/detail-content/publish", "super_admin", { pageId: nextDraft.pageId, digest: nextDraft.digest, approved: true })]);
    assert.deepEqual(race.map(response => response.status).sort(), [200, 409], "exact approval concurrency publishes once");
    assert.deepEqual((await readPublishedDetailContent("destination", countryId, "en"))?.sections, [], "explicit empty publication removes supplemental sections");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.query("DELETE FROM website_pages WHERE slug IN ($1,$2)", [slug, `/${slug}`]);
    if (universityId !== null) await pool.query("DELETE FROM universities WHERE id=$1", [universityId]);
    if (countryId !== null) await pool.query("DELETE FROM countries WHERE id=$1", [countryId]);
    if (inactiveGlobalId !== null) await pool.query("DELETE FROM website_global_components WHERE id=$1", [inactiveGlobalId]);
    for (const id of layoutIds) await pool.query("DELETE FROM website_pages WHERE id=$1", [id]);
    for (const role of ["admin", "super_admin"]) await pool.query("DELETE FROM sessions WHERE sid=$1", [fixtureSid(role)]);
    await pool.end();
    closePool = undefined;
  }
});
