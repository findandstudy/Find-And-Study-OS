import test, { after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { pool } from "@workspace/db";
import { matchPublicCatalogRenderPath } from "../src/lib/publicCatalogRenderContract";
import {
  getPublicCatalogRenderModel,
  invalidatePublicCatalogRenderCache,
} from "../src/lib/publicCatalogRenderReadModel";
import { publicCatalogRouteKey } from "../src/lib/publicCatalogRouteContract";

const { Client } = pg;
const ADMIN_URL = process.env.PG_PUBLIC_CATALOG_RENDER_ADMIN_URL
  ?? "postgresql://postgres@127.0.0.1:5433/fasos_apply_local";
const target = new URL(ADMIN_URL);
if (
  target.protocol !== "postgresql:"
  || target.hostname !== "127.0.0.1"
  || target.port !== "5433"
  || target.pathname !== "/fasos_apply_local"
  || target.username !== "postgres"
  || target.password !== ""
  || target.search !== ""
  || target.hash !== ""
) {
  throw new Error("Public catalogue render test requires the disposable local PostgreSQL 16 database");
}

after(async () => {
  await pool.end();
});

test("render read model serves bounded data and coalesces the same cold key", async () => {
  const client = new Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-public-catalog-render-test",
  });
  await client.connect();
  let universityId: number | null = null;
  let programId: number | null = null;
  let destinationId: number | null = null;
  let articleId: number | null = null;
  let pageId: number | null = null;
  try {
    const identity = await client.query(
      "SELECT current_database() AS database_name, current_user AS user_name, inet_server_port() AS server_port",
    );
    assert.deepEqual(identity.rows[0], {
      database_name: "fasos_apply_local",
      user_name: "postgres",
      server_port: 5433,
    });
    const university = await client.query<{ id: number }>(
      `INSERT INTO universities (name, country, city, university_type, is_active)
       VALUES ('Render Pilot University', 'Turkey', 'Istanbul', 'Private', true)
       RETURNING id`,
    );
    universityId = university.rows[0].id;
    const program = await client.query<{ id: number }>(
      `INSERT INTO programs (
         university_id, name, description, degree, field, language,
         duration, tuition_fee, currency, is_active
       ) VALUES ($1, 'Render Pilot Computer Science', 'A bounded synthetic pilot record.',
         'MSc', 'Computer Science', 'English', '2 years', 12000, 'USD', true)
       RETURNING id`,
      [universityId],
    );
    programId = program.rows[0].id;
    const destinationSlug = `render-pilot-destination-${process.pid}`;
    const destination = await client.query<{ id: number }>(
      `INSERT INTO destinations (name,slug,country,short_description,popular_cities,is_active)
       VALUES ('Render Pilot Destination',$1,'Turkey','A bounded synthetic destination.','Istanbul, Ankara',true)
       RETURNING id`,
      [destinationSlug],
    );
    destinationId = destination.rows[0].id;
    const article = await client.query<{ id: number }>(
      `INSERT INTO website_blog_posts
         (title,slug,excerpt,content,status,locale,published_at)
       VALUES ('Render Pilot Guide','render-pilot-guide','Verified guide summary',
         '{"body":"<p>Verified guide body</p>","readTime":3}'::jsonb,
         'published','en',now()) RETURNING id`,
    );
    articleId = article.rows[0].id;
    const pageSlug = `render-pilot-page-${process.pid}`;
    const page = await client.query<{ id: number }>(
      `INSERT INTO website_pages
         (title,slug,status,locale,published_at,meta_title,meta_description,translations_json)
       VALUES ('Published Snapshot Page',$1,'published','en',now(),'Snapshot SEO','Published snapshot description',
         jsonb_build_object('tr',jsonb_build_object(
           'fields',jsonb_build_object('title','Yayınlanmış Sayfa','metaTitle','Yayın SEO','metaDescription','Yayın özeti'),
           'blocks',jsonb_build_array(jsonb_build_object(
             'blockType','rich_text','content',jsonb_build_object('content','<p>Türkçe yayın gövdesi</p>'),
             'settings','{}'::jsonb,'sortOrder',0,'isVisible',true
           ))
         ))) RETURNING id`,
      [pageSlug],
    );
    pageId = page.rows[0].id;
    await client.query(
      `INSERT INTO website_page_versions
         (page_id,version_number,blocks_snapshot,meta_snapshot,published_at)
       VALUES ($1,1,$2::jsonb,$3::jsonb,now())`,
      [
        pageId,
        JSON.stringify([{ blockType: "rich_text", content: { content: "<p>Immutable published body</p>" }, settings: {}, sortOrder: 0, isVisible: true }]),
        JSON.stringify({
          title: "Published Snapshot Page",
          metaTitle: "Snapshot SEO",
          metaDescription: "Published snapshot description",
          translationsJson: {
            tr: {
              fields: { title: "Yayınlanmış Sayfa", metaTitle: "Yayın SEO", metaDescription: "Yayın özeti" },
              blocks: [{ blockType: "rich_text", content: { content: "<p>Türkçe yayın gövdesi</p>" }, settings: {}, sortOrder: 0, isVisible: true }],
            },
          },
        }),
      ],
    );
    await client.query("UPDATE website_pages SET title='Unpublished draft title' WHERE id=$1", [pageId]);

    const route = matchPublicCatalogRenderPath(
      `/en/programs/${publicCatalogRouteKey(programId, "Render Pilot Computer Science")}`,
    );
    assert.ok(route && route.kind === "program_detail");
    invalidatePublicCatalogRenderCache();
    const [first, second] = await Promise.all([
      getPublicCatalogRenderModel(route),
      getPublicCatalogRenderModel(route),
    ]);
    assert.deepEqual(new Set([first.cacheStatus, second.cacheStatus]), new Set(["MISS", "COALESCED"]));
    assert.equal(first.value.kind, "program_detail");
    assert.equal(first.value.kind === "program_detail" ? first.value.program.id : null, programId);
    assert.equal(first.value.indexable, false);
    const hit = await getPublicCatalogRenderModel(route);
    assert.equal(hit.cacheStatus, "HIT");

    const listRoute = matchPublicCatalogRenderPath("/en/programs");
    assert.ok(listRoute && listRoute.kind === "program_list");
    const list = await getPublicCatalogRenderModel(listRoute);
    assert.equal(list.value.kind, "program_list");
    assert.ok(list.value.kind === "program_list" && list.value.programs.length <= 12);
    assert.ok(list.value.kind === "program_list" && list.value.total >= 1);

    const universityRoute = matchPublicCatalogRenderPath(
      `/en/universities/${publicCatalogRouteKey(universityId, "Render Pilot University")}`,
    );
    assert.ok(universityRoute && universityRoute.kind === "university_detail");
    const universityDetail = await getPublicCatalogRenderModel(universityRoute);
    assert.equal(universityDetail.value.kind, "university_detail");
    assert.equal(
      universityDetail.value.kind === "university_detail"
        ? universityDetail.value.university.id
        : null,
      universityId,
    );
    assert.equal(
      universityDetail.value.kind === "university_detail"
        ? universityDetail.value.university.programs.length
        : 0,
      1,
    );
    assert.equal(universityDetail.value.indexable, false);

    const destinationRoute = matchPublicCatalogRenderPath(`/en/destinations/${destinationSlug}`);
    assert.ok(destinationRoute && destinationRoute.kind === "destination_detail");
    const destinationDetail = await getPublicCatalogRenderModel(destinationRoute);
    assert.equal(destinationDetail.value.kind, "destination_detail");
    assert.equal(
      destinationDetail.value.kind === "destination_detail"
        ? destinationDetail.value.destination.id
        : null,
      destinationId,
    );
    assert.equal(
      destinationDetail.value.kind === "destination_detail"
        ? destinationDetail.value.canonicalPath
        : null,
      `/en/destinations/${destinationSlug}`,
    );
    assert.equal(destinationDetail.value.indexable, false);

    const articleRoute = matchPublicCatalogRenderPath(
      `/en/guides/${publicCatalogRouteKey(articleId, "Render Pilot Guide")}`,
    );
    assert.ok(articleRoute && articleRoute.kind === "article_detail");
    const articleDetail = await getPublicCatalogRenderModel(articleRoute);
    assert.equal(articleDetail.value.kind, "article_detail");
    assert.equal(
      articleDetail.value.kind === "article_detail" ? articleDetail.value.article.id : null,
      articleId,
    );
    assert.equal(
      articleDetail.value.kind === "article_detail" ? articleDetail.value.article.readTime : null,
      3,
    );
    assert.equal(articleDetail.value.indexable, false);

    const pageRoute = matchPublicCatalogRenderPath(`/en/${pageSlug}`);
    assert.ok(pageRoute && pageRoute.kind === "page_detail");
    const pageDetail = await getPublicCatalogRenderModel(pageRoute);
    assert.equal(pageDetail.value.kind, "page_detail");
    assert.equal(pageDetail.value.kind === "page_detail" ? pageDetail.value.page.title : null, "Published Snapshot Page");
    assert.equal(pageDetail.value.kind === "page_detail" ? pageDetail.value.page.versionNumber : null, 1);
    assert.equal(pageDetail.value.kind === "page_detail" ? pageDetail.value.page.blocks[0]?.blockType : null, "rich_text");
    assert.equal(pageDetail.value.indexable, false);

    const translatedPageRoute = matchPublicCatalogRenderPath(`/tr/${pageSlug}`);
    assert.ok(translatedPageRoute && translatedPageRoute.kind === "page_detail");
    const translatedPage = await getPublicCatalogRenderModel(translatedPageRoute);
    assert.equal(translatedPage.value.kind === "page_detail" ? translatedPage.value.page.title : null, "Yayınlanmış Sayfa");
    assert.equal(translatedPage.value.kind === "page_detail" ? translatedPage.value.page.blocks.length : 0, 1);
  } finally {
    invalidatePublicCatalogRenderCache();
    if (pageId !== null) {
      await client.query("DELETE FROM website_pages WHERE id = $1", [pageId]);
    }
    if (articleId !== null) {
      await client.query("DELETE FROM website_blog_posts WHERE id = $1", [articleId]);
    }
    if (destinationId !== null) {
      await client.query("DELETE FROM destinations WHERE id = $1", [destinationId]);
    }
    if (programId !== null) {
      await client.query("DELETE FROM programs WHERE id = $1", [programId]);
    }
    if (universityId !== null) {
      await client.query("DELETE FROM universities WHERE id = $1", [universityId]);
    }
    await client.end();
  }
});
