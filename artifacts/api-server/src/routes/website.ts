import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import type { PgTableWithColumns, TableConfig } from "drizzle-orm/pg-core";
import type { PgColumn } from "drizzle-orm/pg-core";
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
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();
const WEBSITE_ROLES = ["super_admin", "admin"] as const;
const adminOnly = [requireAuth, requireRole(...WEBSITE_ROLES)] as const;

type AnyPgTable = PgTableWithColumns<TableConfig>;

function registerCrud(
  basePath: string,
  table: AnyPgTable,
  idCol: PgColumn,
  orderCol?: PgColumn
) {
  router.get(basePath, ...adminOnly, async (_req: Request, res: Response) => {
    try {
      const rows = await db.select().from(table).orderBy(orderCol ? asc(orderCol) : asc(idCol));
      res.json(rows);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      res.status(500).json({ error: msg });
    }
  });

  router.get(`${basePath}/:id`, ...adminOnly, async (req: Request, res: Response) => {
    try {
      const [row] = await db.select().from(table).where(eq(idCol, Number(req.params.id)));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      res.status(500).json({ error: msg });
    }
  });

  router.post(basePath, ...adminOnly, async (req: Request, res: Response) => {
    try {
      const [row] = await db.insert(table).values(req.body).returning();
      res.status(201).json(row);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      res.status(500).json({ error: msg });
    }
  });

  router.put(`${basePath}/:id`, ...adminOnly, async (req: Request, res: Response) => {
    try {
      const [row] = await db.update(table).set(req.body).where(eq(idCol, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      res.status(500).json({ error: msg });
    }
  });

  router.delete(`${basePath}/:id`, ...adminOnly, async (req: Request, res: Response) => {
    try {
      const [row] = await db.delete(table).where(eq(idCol, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      res.status(500).json({ error: msg });
    }
  });
}

registerCrud("/website/pages", websitePagesTable, websitePagesTable.id, websitePagesTable.sortOrder);
registerCrud("/website/page-versions", websitePageVersionsTable, websitePageVersionsTable.id);
registerCrud("/website/page-blocks", websitePageBlocksTable, websitePageBlocksTable.id, websitePageBlocksTable.sortOrder);
registerCrud("/website/navigation-menus", websiteNavigationMenusTable, websiteNavigationMenusTable.id);
registerCrud("/website/navigation-items", websiteNavigationItemsTable, websiteNavigationItemsTable.id, websiteNavigationItemsTable.sortOrder);
registerCrud("/website/theme-tokens", websiteThemeTokensTable, websiteThemeTokensTable.id);
registerCrud("/website/global-components", websiteGlobalComponentsTable, websiteGlobalComponentsTable.id);
registerCrud("/website/forms", websiteFormsTable, websiteFormsTable.id);
registerCrud("/website/form-fields", websiteFormFieldsTable, websiteFormFieldsTable.id, websiteFormFieldsTable.sortOrder);
registerCrud("/website/blog-posts", websiteBlogPostsTable, websiteBlogPostsTable.id);
registerCrud("/website/blog-categories", websiteBlogCategoriesTable, websiteBlogCategoriesTable.id, websiteBlogCategoriesTable.sortOrder);
registerCrud("/website/blog-tags", websiteBlogTagsTable, websiteBlogTagsTable.id);
registerCrud("/website/blog-post-tags", websiteBlogPostTagsTable, websiteBlogPostTagsTable.id);
registerCrud("/website/collections/offices", websiteCollectionsOfficesTable, websiteCollectionsOfficesTable.id, websiteCollectionsOfficesTable.sortOrder);
registerCrud("/website/collections/team-members", websiteCollectionsTeamMembersTable, websiteCollectionsTeamMembersTable.id, websiteCollectionsTeamMembersTable.sortOrder);
registerCrud("/website/collections/faqs", websiteCollectionsFaqsTable, websiteCollectionsFaqsTable.id, websiteCollectionsFaqsTable.sortOrder);
registerCrud("/website/collections/testimonials", websiteCollectionsTestimonialsTable, websiteCollectionsTestimonialsTable.id, websiteCollectionsTestimonialsTable.sortOrder);

router.get("/website/pages/:pageId/blocks", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(websitePageBlocksTable)
      .where(eq(websitePageBlocksTable.pageId, Number(req.params.pageId)))
      .orderBy(asc(websitePageBlocksTable.sortOrder));
    res.json(rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.get("/website/pages/:pageId/versions", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const rows = await db.select({
      id: websitePageVersionsTable.id,
      pageId: websitePageVersionsTable.pageId,
      versionNumber: websitePageVersionsTable.versionNumber,
      blocksSnapshot: websitePageVersionsTable.blocksSnapshot,
      metaSnapshot: websitePageVersionsTable.metaSnapshot,
      publishedAt: websitePageVersionsTable.publishedAt,
      createdBy: websitePageVersionsTable.createdBy,
      createdAt: websitePageVersionsTable.createdAt,
      authorFirstName: usersTable.firstName,
      authorLastName: usersTable.lastName,
      authorEmail: usersTable.email,
    })
      .from(websitePageVersionsTable)
      .leftJoin(usersTable, eq(websitePageVersionsTable.createdBy, usersTable.id))
      .where(eq(websitePageVersionsTable.pageId, Number(req.params.pageId)))
      .orderBy(desc(websitePageVersionsTable.versionNumber));
    res.json(rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.get("/website/forms/:formId/fields", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(websiteFormFieldsTable)
      .where(eq(websiteFormFieldsTable.formId, Number(req.params.formId)))
      .orderBy(asc(websiteFormFieldsTable.sortOrder));
    res.json(rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.get("/website/menus/:menuId/items", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(websiteNavigationItemsTable)
      .where(eq(websiteNavigationItemsTable.menuId, Number(req.params.menuId)))
      .orderBy(asc(websiteNavigationItemsTable.sortOrder));
    res.json(rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.post("/website/pages/:id/publish", ...adminOnly, async (req: Request, res: Response) => {
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
        createdBy: req.user?.id,
      }).returning();

      return { page, version };
    });
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.post("/website/pages/:id/unpublish", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const [page] = await db.update(websitePagesTable)
      .set({ status: "draft", publishedAt: null })
      .where(eq(websitePagesTable.id, Number(req.params.id)))
      .returning();
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.post("/website/blog-posts/:id/publish", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const [post] = await db.update(websiteBlogPostsTable)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(websiteBlogPostsTable.id, Number(req.params.id)))
      .returning();
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.post("/website/blog-posts/:id/unpublish", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const [post] = await db.update(websiteBlogPostsTable)
      .set({ status: "draft", publishedAt: null })
      .where(eq(websiteBlogPostsTable.id, Number(req.params.id)))
      .returning();
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.put("/website/theme-tokens/batch", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const tokens: { tokenGroup: string; tokenKey: string; tokenValue: string | null; description?: string }[] = req.body.tokens;
    if (!Array.isArray(tokens)) return res.status(400).json({ error: "tokens array required" });
    for (const t of tokens) {
      if (typeof t.tokenGroup !== "string" || !t.tokenGroup || typeof t.tokenKey !== "string" || !t.tokenKey) {
        return res.status(400).json({ error: "Each token must have non-empty tokenGroup and tokenKey strings" });
      }
      if (t.tokenValue !== null && typeof t.tokenValue !== "string") {
        return res.status(400).json({ error: "tokenValue must be a string or null" });
      }
    }
    const results = await db.transaction(async (tx) => {
      const out = [];
      for (const t of tokens) {
        const existing = await tx.select().from(websiteThemeTokensTable)
          .where(eq(websiteThemeTokensTable.tokenGroup, t.tokenGroup))
          .then(rows => rows.find(r => r.tokenKey === t.tokenKey));

        if (t.tokenValue === null || t.tokenValue === "") {
          if (existing) {
            await tx.delete(websiteThemeTokensTable).where(eq(websiteThemeTokensTable.id, existing.id));
          }
          continue;
        }

        if (existing) {
          const [updated] = await tx.update(websiteThemeTokensTable)
            .set({ tokenValue: t.tokenValue, description: t.description || existing.description })
            .where(eq(websiteThemeTokensTable.id, existing.id))
            .returning();
          out.push(updated);
        } else {
          const [created] = await tx.insert(websiteThemeTokensTable)
            .values({ tokenGroup: t.tokenGroup, tokenKey: t.tokenKey, tokenValue: t.tokenValue, description: t.description })
            .returning();
          out.push(created);
        }
      }
      return out;
    });
    res.json(results);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.delete("/website/theme-tokens/all", ...adminOnly, async (_req: Request, res: Response) => {
  try {
    await db.delete(websiteThemeTokensTable);
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

const DEFAULT_PAGES = [
  { title: "Home", slug: "home", sortOrder: 0, template: "home" },
  { title: "About", slug: "about", sortOrder: 1, template: "about" },
  { title: "Countries", slug: "countries", sortOrder: 2, template: "countries" },
  { title: "Programs", slug: "programs", sortOrder: 3, template: "programs" },
  { title: "Blog", slug: "blog", sortOrder: 4, template: "blog" },
  { title: "Contact", slug: "contact", sortOrder: 5, template: "contact" },
];

router.post("/website/pages/seed", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const existing = await db.select().from(websitePagesTable);
    if (existing.length > 0) return res.json({ seeded: false, pages: existing });
    const pages = await db.insert(websitePagesTable).values(
      DEFAULT_PAGES.map(p => ({ ...p, status: "draft" as const, locale: "en", createdBy: req.user?.id }))
    ).returning();
    res.status(201).json({ seeded: true, pages });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.post("/website/pages/:pageId/save-draft", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const pageId = Number(req.params.pageId);
    const { blocks, meta } = req.body;

    await db.transaction(async (tx) => {
      if (meta) {
        await tx.update(websitePagesTable)
          .set({ ...meta, status: "draft" })
          .where(eq(websitePagesTable.id, pageId));
      } else {
        await tx.update(websitePagesTable)
          .set({ status: "draft" })
          .where(eq(websitePagesTable.id, pageId));
      }

      if (Array.isArray(blocks)) {
        await tx.delete(websitePageBlocksTable).where(eq(websitePageBlocksTable.pageId, pageId));
        if (blocks.length > 0) {
          await tx.insert(websitePageBlocksTable).values(
            blocks.map((b: { blockType: string; content: Record<string, unknown>; settings?: Record<string, unknown>; sortOrder: number; isVisible: boolean }, i: number) => ({
              pageId,
              blockType: b.blockType,
              content: b.content || {},
              settings: b.settings || {},
              sortOrder: b.sortOrder ?? i,
              isVisible: b.isVisible ?? true,
            }))
          );
        }
      }
    });

    const [page] = await db.select().from(websitePagesTable).where(eq(websitePagesTable.id, pageId));
    const savedBlocks = await db.select().from(websitePageBlocksTable)
      .where(eq(websitePageBlocksTable.pageId, pageId))
      .orderBy(asc(websitePageBlocksTable.sortOrder));
    res.json({ page, blocks: savedBlocks });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.post("/website/pages/:pageId/restore-version/:versionId", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const pageId = Number(req.params.pageId);
    const versionId = Number(req.params.versionId);

    const [version] = await db.select().from(websitePageVersionsTable)
      .where(eq(websitePageVersionsTable.id, versionId));
    if (!version || version.pageId !== pageId) return res.status(404).json({ error: "Version not found" });

    const snapshot = version.blocksSnapshot as Array<{
      blockType: string;
      content: Record<string, unknown>;
      settings: Record<string, unknown>;
      sortOrder: number;
      isVisible: boolean;
    }>;

    await db.transaction(async (tx) => {
      await tx.delete(websitePageBlocksTable).where(eq(websitePageBlocksTable.pageId, pageId));
      if (Array.isArray(snapshot) && snapshot.length > 0) {
        await tx.insert(websitePageBlocksTable).values(
          snapshot.map((b, i) => ({
            pageId,
            blockType: b.blockType,
            content: b.content || {},
            settings: b.settings || {},
            sortOrder: b.sortOrder ?? i,
            isVisible: b.isVisible ?? true,
          }))
        );
      }
      const metaSnap = version.metaSnapshot as Record<string, string> | null;
      if (metaSnap) {
        await tx.update(websitePagesTable)
          .set({ status: "draft", metaTitle: metaSnap.metaTitle || null, metaDescription: metaSnap.metaDescription || null })
          .where(eq(websitePagesTable.id, pageId));
      } else {
        await tx.update(websitePagesTable)
          .set({ status: "draft" })
          .where(eq(websitePagesTable.id, pageId));
      }
    });

    const [page] = await db.select().from(websitePagesTable).where(eq(websitePagesTable.id, pageId));
    const blocks = await db.select().from(websitePageBlocksTable)
      .where(eq(websitePageBlocksTable.pageId, pageId))
      .orderBy(asc(websitePageBlocksTable.sortOrder));
    res.json({ page, blocks });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

export default router;
