import { Router, type IRouter, type Request, type Response } from "express";
import { db, websiteCollectionsTeamMembersTable, websiteCollectionsOfficesTable, auditLogsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";

const router: IRouter = Router();
const adminOnly = [requireAuth, requireRole(...ADMIN_ROLES)] as const;

function validId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max) || null;
}

function boundedTranslations(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_TRANSLATIONS");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 131_072) throw new Error("INVALID_TRANSLATIONS");
  return value as Record<string, unknown>;
}

function sendCmsError(error: unknown, res: Response): void {
  if (error instanceof Error && error.message === "INVALID_TRANSLATIONS") {
    res.status(400).json({ error: "translationsJson must be a bounded object" });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}

async function writeCmsAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  req: Request,
  action: string,
  resource: string,
  resourceId: number,
  changedFields: string[],
): Promise<void> {
  await tx.insert(auditLogsTable).values({
    userId: req.user!.id,
    action,
    resource,
    resourceId,
    changes: JSON.stringify({ changedFields: [...changedFields].sort() }),
    ipAddress: req.ip || null,
  });
}

// ── Team Members ──────────────────────────────────────────────────────────────
// GET is public (no auth) — used by About page.
// POST / PATCH / DELETE require admin and emit audit log entries.

router.get("/cms/team-members", async (req: Request, res: Response): Promise<void> => {
  try {
    const lang = typeof req.query.lang === "string" ? req.query.lang.toLowerCase() : null;
    const rows = await db
      .select()
      .from(websiteCollectionsTeamMembersTable)
      .where(eq(websiteCollectionsTeamMembersTable.isActive, true))
      .orderBy(asc(websiteCollectionsTeamMembersTable.sortOrder), asc(websiteCollectionsTeamMembersTable.id));
    const resolved = rows.map(row => {
      if (!lang || !row.translationsJson) return row;
      const tx = (row.translationsJson as Record<string, Record<string, string>>)[lang] ?? {};
      return {
        ...row,
        name: tx.name ?? row.name,
        title: tx.title !== undefined ? tx.title : row.title,
        bio: tx.bio !== undefined ? tx.bio : row.bio,
      };
    });
    res.json(resolved);
  } catch (e: unknown) {
    sendCmsError(e, res);
  }
});

router.post("/cms/team-members", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, title, bio, photoUrl, email, linkedinUrl, sortOrder, isActive, translationsJson } = req.body as Record<string, unknown>;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" }); return;
    }
    const translations = boundedTranslations(translationsJson);
    const row = await db.transaction(async tx => {
      const [created] = await tx.insert(websiteCollectionsTeamMembersTable).values({
      name: name.trim().slice(0, 200),
      title: boundedText(title, 300),
      bio: boundedText(bio, 20_000),
      photoUrl: boundedText(photoUrl, 2_048),
      email: boundedText(email, 320),
      linkedinUrl: boundedText(linkedinUrl, 2_048),
      sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
      isActive: isActive !== false,
      ...(translations !== undefined ? { translationsJson: translations } : {}),
      }).returning();
      await writeCmsAudit(tx, req, "cms.team_member.create", "website_collections_team_members", created.id, ["created"]);
      return created;
    });
    res.status(201).json(row);
  } catch (e: unknown) {
    sendCmsError(e, res);
  }
});

router.patch("/cms/team-members/:id", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = validId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const body = req.body as Record<string, unknown>;
    if (body.name !== undefined && (typeof body.name !== "string" || !String(body.name).trim())) {
      res.status(400).json({ error: "name must be a non-empty string" }); return;
    }
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = String(body.name).trim().slice(0, 200);
    if (body.title !== undefined) updates.title = boundedText(body.title, 300);
    if (body.bio !== undefined) updates.bio = boundedText(body.bio, 20_000);
    if (body.photoUrl !== undefined) updates.photoUrl = boundedText(body.photoUrl, 2_048);
    if (body.email !== undefined) updates.email = boundedText(body.email, 320);
    if (body.linkedinUrl !== undefined) updates.linkedinUrl = boundedText(body.linkedinUrl, 2_048);
    if (body.sortOrder !== undefined) updates.sortOrder = typeof body.sortOrder === "number" ? body.sortOrder : parseInt(String(body.sortOrder), 10) || 0;
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
    if (body.translationsJson !== undefined) updates.translationsJson = boundedTranslations(body.translationsJson);
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
    const row = await db.transaction(async tx => {
      const [saved] = await tx.update(websiteCollectionsTeamMembersTable).set(updates).where(eq(websiteCollectionsTeamMembersTable.id, id)).returning();
      if (!saved) return null;
      await writeCmsAudit(tx, req, "cms.team_member.update", "website_collections_team_members", id, Object.keys(updates));
      return saved;
    });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e: unknown) {
    sendCmsError(e, res);
  }
});

router.delete("/cms/team-members/:id", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = validId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const row = await db.transaction(async tx => {
      const [deleted] = await tx.delete(websiteCollectionsTeamMembersTable).where(eq(websiteCollectionsTeamMembersTable.id, id)).returning();
      if (!deleted) return null;
      await writeCmsAudit(tx, req, "cms.team_member.delete", "website_collections_team_members", id, ["deleted"]);
      return deleted;
    });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (e: unknown) {
    sendCmsError(e, res);
  }
});

// ── Offices ───────────────────────────────────────────────────────────────────
// GET is public (no auth) — used by Contact page.

router.get("/cms/offices", async (req: Request, res: Response): Promise<void> => {
  try {
    const lang = typeof req.query.lang === "string" ? req.query.lang.toLowerCase() : null;
    const rows = await db
      .select()
      .from(websiteCollectionsOfficesTable)
      .where(eq(websiteCollectionsOfficesTable.isActive, true))
      .orderBy(asc(websiteCollectionsOfficesTable.sortOrder), asc(websiteCollectionsOfficesTable.id));
    const resolved = rows.map(row => {
      if (!lang || !row.translationsJson) return row;
      const tx = (row.translationsJson as Record<string, Record<string, string>>)[lang] ?? {};
      return {
        ...row,
        name: tx.name !== undefined ? tx.name : row.name,
        city: tx.city !== undefined ? tx.city : row.city,
        country: tx.country !== undefined ? tx.country : row.country,
        address: tx.address !== undefined ? tx.address : row.address,
      };
    });
    res.json(resolved);
  } catch (e: unknown) {
    sendCmsError(e, res);
  }
});

router.post("/cms/offices", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      res.status(400).json({ error: "name is required" }); return;
    }
    const translations = boundedTranslations(body.translationsJson);
    const row = await db.transaction(async tx => {
      const [created] = await tx.insert(websiteCollectionsOfficesTable).values({
      name: String(body.name).trim().slice(0, 200),
      city: boundedText(body.city, 200),
      country: boundedText(body.country, 200),
      address: boundedText(body.address, 2_000),
      phone: boundedText(body.phone, 100),
      email: boundedText(body.email, 320),
      mapEmbedUrl: boundedText(body.mapEmbedUrl, 2_048),
      imageUrl: boundedText(body.imageUrl, 2_048),
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      isActive: body.isActive !== false,
      ...(translations !== undefined ? { translationsJson: translations } : {}),
      }).returning();
      await writeCmsAudit(tx, req, "cms.office.create", "website_collections_offices", created.id, ["created"]);
      return created;
    });
    res.status(201).json(row);
  } catch (e: unknown) {
    sendCmsError(e, res);
  }
});

router.patch("/cms/offices/:id", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = validId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const body = req.body as Record<string, unknown>;
    if (body.name !== undefined && (typeof body.name !== "string" || !String(body.name).trim())) {
      res.status(400).json({ error: "name must be a non-empty string" }); return;
    }
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = String(body.name).trim().slice(0, 200);
    if (body.city !== undefined) updates.city = boundedText(body.city, 200);
    if (body.country !== undefined) updates.country = boundedText(body.country, 200);
    if (body.address !== undefined) updates.address = boundedText(body.address, 2_000);
    if (body.phone !== undefined) updates.phone = boundedText(body.phone, 100);
    if (body.email !== undefined) updates.email = boundedText(body.email, 320);
    if (body.mapEmbedUrl !== undefined) updates.mapEmbedUrl = boundedText(body.mapEmbedUrl, 2_048);
    if (body.imageUrl !== undefined) updates.imageUrl = boundedText(body.imageUrl, 2_048);
    if (body.sortOrder !== undefined) updates.sortOrder = typeof body.sortOrder === "number" ? body.sortOrder : parseInt(String(body.sortOrder), 10) || 0;
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
    if (body.translationsJson !== undefined) updates.translationsJson = boundedTranslations(body.translationsJson);
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
    const row = await db.transaction(async tx => {
      const [saved] = await tx.update(websiteCollectionsOfficesTable).set(updates).where(eq(websiteCollectionsOfficesTable.id, id)).returning();
      if (!saved) return null;
      await writeCmsAudit(tx, req, "cms.office.update", "website_collections_offices", id, Object.keys(updates));
      return saved;
    });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e: unknown) {
    sendCmsError(e, res);
  }
});

router.delete("/cms/offices/:id", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = validId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const row = await db.transaction(async tx => {
      const [deleted] = await tx.delete(websiteCollectionsOfficesTable).where(eq(websiteCollectionsOfficesTable.id, id)).returning();
      if (!deleted) return null;
      await writeCmsAudit(tx, req, "cms.office.delete", "website_collections_offices", id, ["deleted"]);
      return deleted;
    });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (e: unknown) {
    sendCmsError(e, res);
  }
});

export default router;
