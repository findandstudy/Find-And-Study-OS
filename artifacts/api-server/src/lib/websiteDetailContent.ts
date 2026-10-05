import { db, websitePagesTable as pages, websitePageBlocksTable as blocks, websitePageVersionsTable as versions, programsTable, universitiesTable, countriesTable, citiesTable } from "@workspace/db";
import { and, eq, desc, isNotNull, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { parseDetailContent, type DetailContent, type DetailContentKind } from "./websiteDetailContentContract";

export const detailContentSlug = (kind: DetailContentKind, entityId: number, locale: string) => `_detail-content-${kind}-${entityId}-${locale}`;
export const detailContentDigest = (pageId: number, updatedAt: string, content: DetailContent) => createHash("sha256").update(JSON.stringify({ pageId, updatedAt, content })).digest("hex");
export async function detailContentEntityExists(kind: DetailContentKind, entityId: number, executor: Pick<typeof db, "select"> = db) {
  const table = kind === "program" ? programsTable : kind === "university" ? universitiesTable : kind === "destination" ? countriesTable : citiesTable;
  return !!(await executor.select({ id: table.id }).from(table).where(eq(table.id, entityId)).limit(1).for("share"))[0];
}
export async function readPublishedDetailContent(kind: DetailContentKind, entityId: number, locale: string): Promise<DetailContent | null> {
  const [row] = await db.select({ snapshot: versions.blocksSnapshot }).from(pages)
    .innerJoin(versions, eq(versions.pageId, pages.id))
    .where(and(eq(pages.slug, detailContentSlug(kind, entityId, locale)), eq(pages.template, `detail-content:${kind}`), isNotNull(versions.publishedAt), lte(versions.publishedAt, new Date())))
    .orderBy(desc(versions.versionNumber)).limit(1);
  const snapshot = row?.snapshot;
  const content = Array.isArray(snapshot) && snapshot.length === 1 && snapshot[0]?.blockType === "detail_content" ? parseDetailContent(snapshot[0].content) : null;
  return content?.kind === kind && content.entityId === entityId && content.locale === locale ? content : null;
}
export async function readDetailContentDraft(kind: DetailContentKind, entityId: number, locale: string) {
  const [page] = await db.select().from(pages).where(eq(pages.slug, detailContentSlug(kind, entityId, locale))).limit(1);
  const rows = page ? await db.select().from(blocks).where(eq(blocks.pageId, page.id)) : [];
  const parsed = rows.length === 1 && rows[0].blockType === "detail_content" ? parseDetailContent(rows[0].content) : null;
  if (page && (!parsed || parsed.kind !== kind || parsed.entityId !== entityId || parsed.locale !== locale || page.template !== `detail-content:${kind}`)) throw new Error("CONFLICT");
  const content: DetailContent = parsed ?? { version: 1, kind, entityId, locale, sections: [] };
  return { content, pageId: page?.id ?? null, updatedAt: page?.updatedAt.toISOString() ?? null,
    digest: page ? detailContentDigest(page.id, page.updatedAt.toISOString(), content) : null,
    published: await readPublishedDetailContent(kind, entityId, locale) };
}
