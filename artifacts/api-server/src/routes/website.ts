import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { eq, asc, desc, inArray, and } from "drizzle-orm";
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
  websiteFormSubmissionsTable,
  websiteBlogPostsTable,
  websiteBlogCategoriesTable,
  websiteBlogTagsTable,
  websiteBlogPostTagsTable,
  websiteCollectionsOfficesTable,
  websiteCollectionsTeamMembersTable,
  websiteCollectionsFaqsTable,
  websiteCollectionsTestimonialsTable,
  usersTable,
  settingsTable,
  integrationsTable,
  leadsTable,
  pipelineStagesTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { applyLeadAssignmentRules } from "../lib/leadAssignment";
import { findOrUpsertPublicLead } from "../lib/leadDedup";

const router = Router();
const WEBSITE_ROLES = ["super_admin", "admin"] as const;
const adminOnly = [requireAuth, requireRole(...WEBSITE_ROLES)] as const;

const VALID_BLOCK_TYPES = new Set([
  "hero", "rich_text", "stats_strip", "feature_cards", "icon_cards",
  "cta_banner", "faq", "team_grid", "office_list", "logo_grid",
  "testimonials", "section_title", "spacer_divider", "global_block",
]);

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
    const { blocks, meta, translationsJson } = req.body;

    if (Array.isArray(blocks)) {
      const invalidBlock = blocks.find((b: { blockType: string }) => !VALID_BLOCK_TYPES.has(b.blockType));
      if (invalidBlock) {
        return res.status(400).json({ error: `Invalid block type: ${invalidBlock.blockType}` });
      }
    }

    await db.transaction(async (tx) => {
      const pageUpdate: Record<string, unknown> = { status: "draft" };
      if (meta) Object.assign(pageUpdate, meta);
      if (translationsJson !== undefined) pageUpdate.translationsJson = translationsJson;
      await tx.update(websitePagesTable)
        .set(pageUpdate)
        .where(eq(websitePagesTable.id, pageId));

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

registerCrud("/website/form-submissions", websiteFormSubmissionsTable, websiteFormSubmissionsTable.id);

router.get("/website/forms/:formId/submissions", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const formId = Number(req.params.formId);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(websiteFormSubmissionsTable)
      .where(eq(websiteFormSubmissionsTable.formId, formId));
    const rows = await db.select().from(websiteFormSubmissionsTable)
      .where(eq(websiteFormSubmissionsTable.formId, formId))
      .orderBy(desc(websiteFormSubmissionsTable.createdAt))
      .limit(limitNum).offset(offset);
    res.json({ data: rows, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.get("/public/website-forms/:slug/check", async (req: Request, res: Response) => {
  try {
    const [form] = await db.select({ id: websiteFormsTable.id })
      .from(websiteFormsTable)
      .where(and(eq(websiteFormsTable.slug, req.params.slug), eq(websiteFormsTable.isActive, true)));
    res.json({ exists: !!form });
  } catch {
    res.json({ exists: false });
  }
});

router.post("/public/website-forms/:slug/submit", async (req: Request, res: Response) => {
  let formRecord: typeof websiteFormsTable.$inferSelect | undefined;
  try {
    const { slug } = req.params;
    const [form] = await db.select().from(websiteFormsTable)
      .where(eq(websiteFormsTable.slug, slug));
    if (!form || !form.isActive) return res.status(404).json({ error: "Form not found" });
    formRecord = form;

    const { _hp, ...formData } = req.body;
    if (_hp) return res.json({ success: true });

    const fields = await db.select().from(websiteFormFieldsTable)
      .where(eq(websiteFormFieldsTable.formId, form.id))
      .orderBy(asc(websiteFormFieldsTable.sortOrder));

    for (const field of fields) {
      const val = formData[field.name];
      if (field.isRequired && !val) {
        return res.status(400).json({ error: `${field.label} is required` });
      }
      if (val) {
        const strVal = String(val);
        const rules = (field.validationRules || {}) as Record<string, string>;

        if (field.fieldType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
          return res.status(400).json({ error: `${field.label} must be a valid email address` });
        }
        if (field.fieldType === "url" && !/^https?:\/\/.+/.test(strVal)) {
          return res.status(400).json({ error: `${field.label} must be a valid URL` });
        }
        if (field.fieldType === "phone" && !/^[+\d\s()-]{6,20}$/.test(strVal)) {
          return res.status(400).json({ error: `${field.label} must be a valid phone number` });
        }
        if (rules.minLength && strVal.length < Number(rules.minLength)) {
          return res.status(400).json({ error: `${field.label} must be at least ${rules.minLength} characters` });
        }
        if (rules.maxLength && strVal.length > Number(rules.maxLength)) {
          return res.status(400).json({ error: `${field.label} must be at most ${rules.maxLength} characters` });
        }
        if (rules.pattern) {
          try {
            if (!new RegExp(rules.pattern).test(strVal)) {
              return res.status(400).json({ error: `${field.label} does not match the required format` });
            }
          } catch {}
        }
      }
    }

    let leadId: number | null = null;
    if (formData.email && formData.firstName) {
      let initialStatus = "new";
      if (form.crmPipelineStage) {
        const [stage] = await db.select({ key: pipelineStagesTable.key })
          .from(pipelineStagesTable)
          .where(and(
            eq(pipelineStagesTable.entityType, "lead"),
            eq(pipelineStagesTable.key, form.crmPipelineStage),
          ));
        if (stage) initialStatus = stage.key;
      }
      const resolvedSource = form.crmSource || `website-form:${form.slug}`;
      const { lead } = await findOrUpsertPublicLead({
        source: resolvedSource,
        uniqueKey: { kind: "emailSource" },
        fields: {
          firstName: String(formData.firstName).slice(0, 100),
          lastName: String(formData.lastName || "").slice(0, 100),
          email: String(formData.email).slice(0, 255),
          phone: formData.phone ? String(formData.phone).slice(0, 50) : null,
        },
        extras: { initialStatus },
        ip: req.ip,
      });
      leadId = lead.id;
    }

    const submissionData = { ...formData };
    if (form.pageSourceTag) submissionData._pageSourceTag = form.pageSourceTag;

    const [submission] = await db.insert(websiteFormSubmissionsTable).values({
      formId: form.id,
      data: submissionData,
      sourceUrl: req.headers.referer || null,
      ipAddress: (req.ip || req.headers["x-forwarded-for"] || "").toString().slice(0, 45),
      userAgent: (req.headers["user-agent"] || "").slice(0, 500),
      leadId,
      status: "new",
    }).returning();

    if (form.submitAction === "webhook" && form.submitWebhookUrl) {
      const webhookUrl = form.submitWebhookUrl;
      const isValidWebhook = /^https:\/\/[^\/]/.test(webhookUrl) && !/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01]))/i.test(webhookUrl);
      if (!isValidWebhook) {
        console.warn(`[FORM] Blocked webhook to private/non-HTTPS URL: ${webhookUrl}`);
      } else {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formSlug: form.slug, submissionId: submission.id, data: formData }),
        }).catch(err => console.error(`[FORM] Webhook delivery failed for ${form.slug}:`, err.message));
      }
    }

    if (form.submitAction === "email" && form.submitEmail) {
      console.log(`[FORM] Email notification queued for ${form.submitEmail} (form: ${form.slug}, submission: ${submission.id})`);
    }

    res.status(201).json({
      success: true,
      submissionId: submission.id,
      message: form.successMessage || "Thank you! Your submission has been received.",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({
      error: msg,
      message: formRecord?.errorMessage || "Something went wrong. Please try again later.",
    });
  }
});

router.get("/website/seo-overview", ...adminOnly, async (_req: Request, res: Response) => {
  try {
    const pages = await db.select({
      id: websitePagesTable.id,
      title: websitePagesTable.title,
      slug: websitePagesTable.slug,
      status: websitePagesTable.status,
      metaTitle: websitePagesTable.metaTitle,
      metaDescription: websitePagesTable.metaDescription,
      ogImageUrl: websitePagesTable.ogImageUrl,
      canonicalUrl: websitePagesTable.canonicalUrl,
      robotsIndex: websitePagesTable.robotsIndex,
      robotsFollow: websitePagesTable.robotsFollow,
      ogTitle: websitePagesTable.ogTitle,
      ogDescription: websitePagesTable.ogDescription,
      twitterTitle: websitePagesTable.twitterTitle,
      twitterDescription: websitePagesTable.twitterDescription,
      twitterImageUrl: websitePagesTable.twitterImageUrl,
    }).from(websitePagesTable).orderBy(asc(websitePagesTable.sortOrder));
    res.json(pages);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.get("/website/pages/:id/seo", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const [page] = await db.select({
      slug: websitePagesTable.slug,
      metaTitle: websitePagesTable.metaTitle,
      metaDescription: websitePagesTable.metaDescription,
      canonicalUrl: websitePagesTable.canonicalUrl,
      robotsIndex: websitePagesTable.robotsIndex,
      robotsFollow: websitePagesTable.robotsFollow,
      ogTitle: websitePagesTable.ogTitle,
      ogDescription: websitePagesTable.ogDescription,
      ogImageUrl: websitePagesTable.ogImageUrl,
      twitterTitle: websitePagesTable.twitterTitle,
      twitterDescription: websitePagesTable.twitterDescription,
      twitterImageUrl: websitePagesTable.twitterImageUrl,
    }).from(websitePagesTable).where(eq(websitePagesTable.id, Number(req.params.id)));
    if (!page) return res.status(404).json({ error: "Page not found" });
    res.json(page);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.put("/website/pages/:id/seo", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const allowedFields = [
      "metaTitle", "metaDescription", "ogImageUrl", "canonicalUrl",
      "robotsIndex", "robotsFollow", "ogTitle", "ogDescription",
      "twitterTitle", "twitterDescription", "twitterImageUrl", "slug",
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const [page] = await db.update(websitePagesTable)
      .set(updates)
      .where(eq(websitePagesTable.id, Number(req.params.id)))
      .returning();
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

async function resolveAiIntegration(): Promise<{ provider: "openai" | "anthropic"; apiKey: string; model?: string } | null> {
  const integrations = await db.select().from(integrationsTable)
    .where(inArray(integrationsTable.key, ["openai", "claude"]));
  for (const integ of integrations) {
    if (!integ.isEnabled) continue;
    const config = integ.config as Record<string, string>;
    if (!config?.apiKey) continue;
    return {
      provider: integ.key === "openai" ? "openai" : "anthropic",
      apiKey: config.apiKey,
      model: config.model || undefined,
    };
  }
  return null;
}

router.post("/website/ai/generate", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const aiConfig = await resolveAiIntegration();
    if (!aiConfig) {
      return res.status(400).json({ error: "AI not configured. Enable OpenAI or Anthropic Claude in Settings > Integrations." });
    }

    const { action, context, locale } = req.body;
    if (!action) return res.status(400).json({ error: "action is required" });

    const { AiContentService } = await import("../lib/aiService");
    const aiService = new AiContentService(aiConfig);

    const result = await aiService.generate({ action, context, locale });
    res.json({ result, action });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.get("/website/ai/status", ...adminOnly, async (_req: Request, res: Response) => {
  try {
    const aiConfig = await resolveAiIntegration();
    res.json({ configured: !!aiConfig, provider: aiConfig?.provider || null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.get("/website/translations/status", ...adminOnly, async (_req: Request, res: Response) => {
  try {
    const [settings] = await db.select({ supportedLanguages: settingsTable.supportedLanguages }).from(settingsTable);
    const locales = (settings?.supportedLanguages || "en").split(",").map((l: string) => l.trim());

    const pages = await db.select({
      id: websitePagesTable.id,
      title: websitePagesTable.title,
      slug: websitePagesTable.slug,
      locale: websitePagesTable.locale,
      metaTitle: websitePagesTable.metaTitle,
      metaDescription: websitePagesTable.metaDescription,
      ogTitle: websitePagesTable.ogTitle,
      ogDescription: websitePagesTable.ogDescription,
      twitterTitle: websitePagesTable.twitterTitle,
      twitterDescription: websitePagesTable.twitterDescription,
      translationsJson: websitePagesTable.translationsJson,
    }).from(websitePagesTable).orderBy(asc(websitePagesTable.sortOrder));

    const posts = await db.select({
      id: websiteBlogPostsTable.id,
      title: websiteBlogPostsTable.title,
      slug: websiteBlogPostsTable.slug,
      locale: websiteBlogPostsTable.locale,
      excerpt: websiteBlogPostsTable.excerpt,
      metaTitle: websiteBlogPostsTable.metaTitle,
      metaDescription: websiteBlogPostsTable.metaDescription,
      translationsJson: websiteBlogPostsTable.translationsJson,
    }).from(websiteBlogPostsTable).orderBy(desc(websiteBlogPostsTable.createdAt));

    res.json({ locales, pages, posts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.put("/website/pages/:id/translations", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const [page] = await db.update(websitePagesTable)
      .set({ translationsJson: req.body.translations || {} })
      .where(eq(websitePagesTable.id, Number(req.params.id)))
      .returning();
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

router.put("/website/blog-posts/:id/translations", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const [post] = await db.update(websiteBlogPostsTable)
      .set({ translationsJson: req.body.translations || {} })
      .where(eq(websiteBlogPostsTable.id, Number(req.params.id)))
      .returning();
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    res.status(500).json({ error: msg });
  }
});

export default router;
