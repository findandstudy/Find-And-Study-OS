import { db, websitePagesTable, websitePageBlocksTable, websitePageVersionsTable } from "@workspace/db";
import { and, asc, desc, eq, isNotNull, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { defaultDetailLayout, parseDetailLayout, type DetailLayout, type DetailLayoutKind } from "./websiteDetailLayoutContract";

export { defaultDetailLayout, parseDetailLayout };
export const detailLayoutSlug = (kind: DetailLayoutKind) => `_detail-layout-${kind}`;
const PUBLISHED_LAYOUT_TTL_MS = 60_000;
const publishedLayoutCache = new Map<DetailLayoutKind, { value: DetailLayout; expiresAt: number }>();
const publishedLayoutInFlight = new Map<DetailLayoutKind, Promise<DetailLayout>>();
const publishedLayoutGeneration = new Map<DetailLayoutKind, number>();

export function invalidatePublishedDetailLayout(kind?: DetailLayoutKind): void {
  if (kind) {
    publishedLayoutGeneration.set(kind, (publishedLayoutGeneration.get(kind) ?? 0) + 1);
    publishedLayoutCache.delete(kind);
    publishedLayoutInFlight.delete(kind);
    return;
  }
  for (const value of ["program", "university", "destination", "city"] as const)
    publishedLayoutGeneration.set(value, (publishedLayoutGeneration.get(value) ?? 0) + 1);
  publishedLayoutCache.clear();
  publishedLayoutInFlight.clear();
}

/** Drafts never affect visitors. Existing version snapshots remain the publication authority. */
export async function readPublishedDetailLayout(kind: DetailLayoutKind) {
  const cached = publishedLayoutCache.get(kind);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = publishedLayoutInFlight.get(kind);
  if (pending) return pending;
  const generation = publishedLayoutGeneration.get(kind) ?? 0;
  const read = (async (): Promise<DetailLayout> => {
    const rows = await db.select({ snapshot: websitePageVersionsTable.blocksSnapshot })
      .from(websitePagesTable).innerJoin(websitePageVersionsTable, eq(websitePageVersionsTable.pageId, websitePagesTable.id))
      .where(and(eq(websitePagesTable.slug, detailLayoutSlug(kind)), eq(websitePagesTable.template, `detail:${kind}`),
        isNotNull(websitePageVersionsTable.publishedAt),
        lte(websitePageVersionsTable.publishedAt, new Date())))
      .orderBy(desc(websitePageVersionsTable.versionNumber)).limit(1);
    const blocks = rows[0]?.snapshot;
    const layout = Array.isArray(blocks) && blocks.length === 1 && blocks[0]?.blockType === "detail_layout"
      ? parseDetailLayout(blocks[0].content) : null;
    const value = layout?.kind === kind ? layout : defaultDetailLayout(kind);
    if ((publishedLayoutGeneration.get(kind) ?? 0) === generation)
      publishedLayoutCache.set(kind, { value, expiresAt: Date.now() + PUBLISHED_LAYOUT_TTL_MS });
    return value;
  })();
  publishedLayoutInFlight.set(kind, read);
  try { return await read; }
  finally { if (publishedLayoutInFlight.get(kind) === read) publishedLayoutInFlight.delete(kind); }
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
