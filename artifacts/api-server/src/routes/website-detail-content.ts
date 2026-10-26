import { Router } from "express";
import {
  db,
  websitePagesTable as pages,
  websitePageBlocksTable as blocks,
  websitePageVersionsTable as versions,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { getSession, getSessionId } from "../lib/replitAuth";
import { ensureDetailSeo, parseDetailContent } from "../lib/websiteDetailContentContract";
import {
  detailContentSlug,
  detailContentDigest,
  detailContentEntityExists,
  detailSeoFacts,
  readDetailContentEditorContext,
  readDetailContentDraft,
  publishDetailContentDraft,
} from "../lib/websiteDetailContent";
import { invalidatePublicCatalogRenderCache } from "../lib/publicCatalogRenderReadModel";

const router = Router();
router.use(
  requireAuth,
  requireRole("super_admin", "admin"),
  (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  },
);
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function fail(res: any, error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  const code = ["CONFLICT", "REVIEWER_REQUIRED"].includes(reason)
    ? reason
    : "UNAVAILABLE";
  res
    .status(
      code === "REVIEWER_REQUIRED" ? 403 : code === "CONFLICT" ? 409 : 503,
    )
    .json({
      code,
      error:
        code === "REVIEWER_REQUIRED"
          ? "A different administrator must review and approve"
          : "Refresh and review again",
    });
}
router.get("/", async (req, res) => {
  const content = parseDetailContent({
    version: 1,
    kind: req.query.kind,
    entityId: Number(req.query.entityId),
    locale: req.query.locale,
    sections: [],
  });
  if (
    !content ||
    typeof req.query.entityId !== "string" ||
    !/^\d+$/.test(req.query.entityId)
  ) {
    res.status(400).json({ error: "Invalid binding" });
    return;
  }
  try {
    if (!(await detailContentEntityExists(content.kind, content.entityId))) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const [entry, editorContext] = await Promise.all([
      readDetailContentDraft(
        content.kind,
        content.entityId,
        content.locale,
      ),
      readDetailContentEditorContext(
        content.kind,
        content.entityId,
        content.locale,
      ),
    ]);
    const facts = detailSeoFacts(content.kind, editorContext);
    res.json({
      ...entry,
      content: ensureDetailSeo(entry.content, facts),
      published: entry.published ? ensureDetailSeo(entry.published, facts) : null,
      editorContext,
    });
  } catch (error) {
    fail(res, error);
  }
});
router.post("/draft", async (req, res) => {
  try {
    const sid = getSessionId(req);
    const session =
      sid && !req.apiTokenAuth && !req.headers.authorization
        ? await getSession(sid)
        : null;
    if (!session || session.originalSid || session.user.id !== req.user!.id) {
      res
        .status(403)
        .json({
          code: "DIRECT_SESSION_REQUIRED",
          error: "Direct human session required",
        });
      return;
    }
  } catch {
    res
      .status(503)
      .json({ code: "UNAVAILABLE", error: "Authoring session unavailable" });
    return;
  }
  const parsedContent = parseDetailContent(req.body?.content);
  if (
    !object(req.body) ||
    Object.keys(req.body).sort().join() !== "content,expectedUpdatedAt" ||
      !parsedContent ||
    !(
      req.body.expectedUpdatedAt === null ||
      typeof req.body.expectedUpdatedAt === "string"
    )
  ) {
    res.status(400).json({ error: "Invalid content" });
    return;
  }
  try {
    if (!(await detailContentEntityExists(parsedContent.kind, parsedContent.entityId))) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const editorContext = await readDetailContentEditorContext(parsedContent.kind, parsedContent.entityId, parsedContent.locale);
    const content = ensureDetailSeo(parsedContent, detailSeoFacts(parsedContent.kind, editorContext));
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      if (
        !(await detailContentEntityExists(content.kind, content.entityId, tx))
      )
        throw new Error("CONFLICT");
      const slug = detailContentSlug(
        content.kind,
        content.entityId,
        content.locale,
      );
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${slug}))`);
      const [existing] = await tx
        .select()
        .from(pages)
        .where(eq(pages.slug, slug))
        .for("update");
      if (
        (existing?.updatedAt.toISOString() ?? null) !==
          req.body.expectedUpdatedAt ||
        (existing && existing.template !== `detail-content:${content.kind}`)
      )
        throw new Error("CONFLICT");
      const values = {
        title: `${content.kind} supplemental content`,
        template: `detail-content:${content.kind}`,
        locale: content.locale,
        status: "draft",
        robotsIndex: false,
        updatedBy: req.user!.id,
        updatedAt: new Date(),
      };
      const [page] = existing
        ? await tx
            .update(pages)
            .set(values)
            .where(eq(pages.id, existing.id))
            .returning()
        : await tx
            .insert(pages)
            .values({ ...values, slug, createdBy: req.user!.id })
            .returning();
      await tx.delete(blocks).where(eq(blocks.pageId, page.id));
      await tx
        .insert(blocks)
        .values({
          pageId: page.id,
          blockType: "detail_content",
          content,
          sortOrder: 0,
        });
    });
    res.json(
      await readDetailContentDraft(
        content.kind,
        content.entityId,
        content.locale,
      ),
    );
  } catch (error) {
    fail(res, error);
  }
});
router.post("/publish", async (req, res) => {
  if (
    !object(req.body) ||
    Object.keys(req.body).sort().join() !== "approved,digest,pageId" ||
    req.body.approved !== true ||
    !Number.isSafeInteger(req.body.pageId) ||
    typeof req.body.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(req.body.digest)
  ) {
    res.status(400).json({ error: "Exact snapshot approval required" });
    return;
  }
  try {
    const sid = getSessionId(req);
    const session =
      sid && !req.apiTokenAuth && !req.headers.authorization
        ? await getSession(sid)
        : null;
    if (!session || session.originalSid || session.user.id !== req.user!.id) {
      res
        .status(403)
        .json({
          code: "DIRECT_SESSION_REQUIRED",
          error: "Direct human session required",
        });
      return;
    }
    const content = await publishDetailContentDraft(req.body.pageId, req.body.digest, req.user!.id, req.user!.role === "super_admin");
    invalidatePublicCatalogRenderCache({ detailTemplate: content.kind });
    res.json(
      await readDetailContentDraft(
        content.kind,
        content.entityId,
        content.locale,
      ),
    );
  } catch (error) {
    fail(res, error);
  }
});
export default router;
