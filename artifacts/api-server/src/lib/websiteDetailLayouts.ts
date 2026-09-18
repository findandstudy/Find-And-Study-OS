import { db, websitePagesTable, websitePageBlocksTable, websitePageVersionsTable } from "@workspace/db";
import { and, asc, desc, eq, isNotNull, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { defaultDetailLayout, parseDetailLayout, type DetailLayoutKind } from "./websiteDetailLayoutContract";

export { defaultDetailLayout, parseDetailLayout };
export const detailLayoutSlug = (kind: DetailLayoutKind) => `_detail-layout-${kind}`;

/** Drafts never affect visitors. Existing version snapshots remain the publication authority. */
export async function readPublishedDetailLayout(kind: DetailLayoutKind) {
  const rows = await db.select({ snapshot: websitePageVersionsTable.blocksSnapshot })
    .from(websitePagesTable).innerJoin(websitePageVersionsTable, eq(websitePageVersionsTable.pageId, websitePagesTable.id))
    .where(and(eq(websitePagesTable.slug, detailLayoutSlug(kind)), eq(websitePagesTable.template, `detail:${kind}`),
      isNotNull(websitePageVersionsTable.publishedAt),
      lte(websitePageVersionsTable.publishedAt, new Date())))
    .orderBy(desc(websitePageVersionsTable.versionNumber)).limit(1);
  const blocks = rows[0]?.snapshot;
  const layout = Array.isArray(blocks) && blocks.length === 1 && blocks[0]?.blockType === "detail_layout"
    ? parseDetailLayout(blocks[0].content) : null;
  return layout?.kind === kind ? layout : defaultDetailLayout(kind);
}

export async function readDetailLayoutDraft(kind: DetailLayoutKind) {
  const [page] = await db.select().from(websitePagesTable).where(eq(websitePagesTable.slug, detailLayoutSlug(kind))).limit(1);
  const blocks = page ? await db.select().from(websitePageBlocksTable).where(eq(websitePageBlocksTable.pageId, page.id)).orderBy(asc(websitePageBlocksTable.sortOrder)) : [];
  const layout = blocks.length === 1 ? parseDetailLayout(blocks[0].content) : null;
  const value = layout?.kind === kind ? layout : defaultDetailLayout(kind);
  return { pageId: page?.id ?? null, updatedAt: page?.updatedAt?.toISOString() ?? null, status: page?.status ?? "absent",
    digest: page ? createHash("sha256").update(JSON.stringify({ pageId: page.id, updatedAt: page.updatedAt.toISOString(), layout: value })).digest("hex") : null,
    layout: value, published: await readPublishedDetailLayout(kind) };
}
