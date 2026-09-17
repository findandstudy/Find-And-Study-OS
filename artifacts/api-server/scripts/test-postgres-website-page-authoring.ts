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
    }
    const attempts = await Promise.all([request("/website/pages/drafts", "admin", draft), request("/website/pages/drafts", "admin", draft)]);
    assert.deepEqual(attempts.map(response => response.status).sort(), [201, 409]);
    const created = await attempts.find(response => response.status === 201)!.json() as { id: number; status: string; robotsIndex: boolean; createdBy: number };
    assert.equal(created.status, "draft");
    assert.equal(created.robotsIndex, false);
    assert.equal(created.createdBy, 2147483000);
    const blocks = await pool.query("SELECT block_type, content FROM website_page_blocks WHERE page_id=$1 ORDER BY sort_order", [created.id]);
    assert.deepEqual(blocks.rows.map(row => row.block_type), ["hero", "catalog_grid"]);
    assert.equal(blocks.rows[1].content.source, "universities");
    assert.equal(blocks.rows[1].content.items, undefined);
    assert.equal((await request("/website/pages/drafts", "admin", { ...draft, slug: "programs" })).status, 400);
    assert.equal((await request("/website/pages/drafts", "admin", { ...draft, status: "published" })).status, 400);
    assert.equal((await request("/website/catalog-preview?source=universities&limit=13", "admin")).status, 400);
    const inserted = await pool.query("INSERT INTO universities(name,country,university_type,is_active) VALUES ('Authoring Before',$1,'Private',true) RETURNING id", [country]);
    universityId = inserted.rows[0].id;
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
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.query("DELETE FROM website_pages WHERE slug=$1", [slug]);
    if (universityId !== null) await pool.query("DELETE FROM universities WHERE id=$1", [universityId]);
    for (const id of layoutIds) await pool.query("DELETE FROM website_pages WHERE id=$1", [id]);
    for (const role of ["admin", "super_admin"]) await pool.query("DELETE FROM sessions WHERE sid=$1", [fixtureSid(role)]);
    await pool.end();
    closePool = undefined;
  }
});
