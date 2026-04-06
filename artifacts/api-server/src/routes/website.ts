import { Router } from "express";
import { db } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import {
  websitePagesTable,
  websitePageVersionsTable,
  websitePageBlocksTable,
  websiteNavigationMenusTable,
  websiteNavigationItemsTable,
  websiteThemeTokensTable,
  websiteGlobalComponentsTable,
  websiteFormsTable,
  websiteFormFieldsTable,
  websiteBlogPostsTable,
  websiteBlogCategoriesTable,
  websiteBlogTagsTable,
  websiteBlogPostTagsTable,
  websiteCollectionsOfficesTable,
  websiteCollectionsTeamMembersTable,
  websiteCollectionsFaqsTable,
  websiteCollectionsTestimonialsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";

const router = Router();
const adminOnly = [requireAuth, requireRole(...ADMIN_ROLES)] as const;

function crudRoutes<T extends Record<string, any>>(
  basePath: string,
  table: T,
  orderCol?: any
) {
  router.get(basePath, ...adminOnly, async (_req, res) => {
    try {
      const rows = await db.select().from(table).orderBy(orderCol ? asc(orderCol) : asc((table as any).id));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get(`${basePath}/:id`, ...adminOnly, async (req, res) => {
    try {
      const [row] = await db.select().from(table).where(eq((table as any).id, Number(req.params.id)));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post(basePath, ...adminOnly, async (req, res) => {
    try {
      const [row] = await db.insert(table).values(req.body).returning();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put(`${basePath}/:id`, ...adminOnly, async (req, res) => {
    try {
      const [row] = await db.update(table).set(req.body).where(eq((table as any).id, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete(`${basePath}/:id`, ...adminOnly, async (req, res) => {
    try {
      const [row] = await db.delete(table).where(eq((table as any).id, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

crudRoutes("/website/pages", websitePagesTable, websitePagesTable.sortOrder);
crudRoutes("/website/page-versions", websitePageVersionsTable);
crudRoutes("/website/page-blocks", websitePageBlocksTable, websitePageBlocksTable.sortOrder);
crudRoutes("/website/navigation-menus", websiteNavigationMenusTable);
crudRoutes("/website/navigation-items", websiteNavigationItemsTable, websiteNavigationItemsTable.sortOrder);
crudRoutes("/website/theme-tokens", websiteThemeTokensTable);
crudRoutes("/website/global-components", websiteGlobalComponentsTable);
crudRoutes("/website/forms", websiteFormsTable);
crudRoutes("/website/form-fields", websiteFormFieldsTable, websiteFormFieldsTable.sortOrder);
crudRoutes("/website/blog-posts", websiteBlogPostsTable);
crudRoutes("/website/blog-categories", websiteBlogCategoriesTable, websiteBlogCategoriesTable.sortOrder);
crudRoutes("/website/blog-tags", websiteBlogTagsTable);
crudRoutes("/website/blog-post-tags", websiteBlogPostTagsTable);
crudRoutes("/website/collections/offices", websiteCollectionsOfficesTable, websiteCollectionsOfficesTable.sortOrder);
crudRoutes("/website/collections/team-members", websiteCollectionsTeamMembersTable, websiteCollectionsTeamMembersTable.sortOrder);
crudRoutes("/website/collections/faqs", websiteCollectionsFaqsTable, websiteCollectionsFaqsTable.sortOrder);
crudRoutes("/website/collections/testimonials", websiteCollectionsTestimonialsTable, websiteCollectionsTestimonialsTable.sortOrder);

router.get("/website/pages/:pageId/blocks", ...adminOnly, async (req, res) => {
  try {
    const rows = await db.select().from(websitePageBlocksTable)
      .where(eq(websitePageBlocksTable.pageId, Number(req.params.pageId)))
      .orderBy(asc(websitePageBlocksTable.sortOrder));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/website/pages/:pageId/versions", ...adminOnly, async (req, res) => {
  try {
    const rows = await db.select().from(websitePageVersionsTable)
      .where(eq(websitePageVersionsTable.pageId, Number(req.params.pageId)))
      .orderBy(desc(websitePageVersionsTable.versionNumber));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/website/forms/:formId/fields", ...adminOnly, async (req, res) => {
  try {
    const rows = await db.select().from(websiteFormFieldsTable)
      .where(eq(websiteFormFieldsTable.formId, Number(req.params.formId)))
      .orderBy(asc(websiteFormFieldsTable.sortOrder));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/website/menus/:menuId/items", ...adminOnly, async (req, res) => {
  try {
    const rows = await db.select().from(websiteNavigationItemsTable)
      .where(eq(websiteNavigationItemsTable.menuId, Number(req.params.menuId)))
      .orderBy(asc(websiteNavigationItemsTable.sortOrder));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/website/pages/:id/publish", ...adminOnly, async (req, res) => {
  try {
    const pageId = Number(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [page] = await tx.update(websitePagesTable)
        .set({ status: "published", publishedAt: new Date() })
        .where(eq(websitePagesTable.id, pageId))
        .returning();
      if (!page) return null;

      const blocks = await tx.select().from(websitePageBlocksTable)
        .where(eq(websitePageBlocksTable.pageId, pageId))
        .orderBy(asc(websitePageBlocksTable.sortOrder));

      const existingVersions = await tx.select().from(websitePageVersionsTable)
        .where(eq(websitePageVersionsTable.pageId, pageId))
        .orderBy(desc(websitePageVersionsTable.versionNumber));

      const nextVersion = (existingVersions[0]?.versionNumber || 0) + 1;

      const [version] = await tx.insert(websitePageVersionsTable).values({
        pageId,
        versionNumber: nextVersion,
        blocksSnapshot: blocks,
        metaSnapshot: { title: page.title, metaTitle: page.metaTitle, metaDescription: page.metaDescription },
        publishedAt: new Date(),
        createdBy: (req as any).user?.id,
      }).returning();

      return { page, version };
    });
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/website/pages/:id/unpublish", ...adminOnly, async (req, res) => {
  try {
    const [page] = await db.update(websitePagesTable)
      .set({ status: "draft", publishedAt: null })
      .where(eq(websitePagesTable.id, Number(req.params.id)))
      .returning();
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/website/blog-posts/:id/publish", ...adminOnly, async (req, res) => {
  try {
    const [post] = await db.update(websiteBlogPostsTable)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(websiteBlogPostsTable.id, Number(req.params.id)))
      .returning();
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/website/blog-posts/:id/unpublish", ...adminOnly, async (req, res) => {
  try {
    const [post] = await db.update(websiteBlogPostsTable)
      .set({ status: "draft", publishedAt: null })
      .where(eq(websiteBlogPostsTable.id, Number(req.params.id)))
      .returning();
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
