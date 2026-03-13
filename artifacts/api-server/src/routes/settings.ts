import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

const SETTINGS_PATCH_FIELDS = [
  "defaultLanguage", "supportedLanguages", "companyName", "companyEmail",
  "companyPhone", "companyAddress", "smtpHost", "smtpPort", "smtpUser",
  "smtpPassword", "whatsappEnabled", "whatsappToken",
  "metaLeadEnabled", "n8nWebhookUrl", "googleSheetsId",
];

router.get("/settings", requireAuth, async (req, res): Promise<void> => {
  const [settings] = await db.select().from(settingsTable);
  if (!settings) {
    const [created] = await db.insert(settingsTable).values({
      defaultLanguage: "en",
      supportedLanguages: "en,tr,ar,fr,ru",
      whatsappEnabled: false,
      metaLeadEnabled: false,
    }).returning();
    res.json(created);
    return;
  }
  const { smtpPassword, whatsappToken, ...safe } = settings;
  res.json(safe);
});

router.patch("/settings", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const updates: Record<string, unknown> = {};
  for (const key of SETTINGS_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [existing] = await db.select().from(settingsTable);
  let updated;
  if (!existing) {
    const [created] = await db.insert(settingsTable).values({
      defaultLanguage: "en",
      supportedLanguages: "en,tr,ar,fr,ru",
      whatsappEnabled: false,
      metaLeadEnabled: false,
      ...updates,
    }).returning();
    updated = created;
  } else {
    const [u] = await db.update(settingsTable).set(updates).where(eq(settingsTable.id, existing.id)).returning();
    updated = u;
  }
  const { smtpPassword, whatsappToken, ...safe } = updated;
  res.json(safe);
});

export default router;
