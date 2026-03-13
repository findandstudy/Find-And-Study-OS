import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

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

router.patch("/settings", requireAuth, async (req, res): Promise<void> => {
  const [existing] = await db.select().from(settingsTable);
  let updated;
  if (!existing) {
    const [created] = await db.insert(settingsTable).values({
      defaultLanguage: "en",
      supportedLanguages: "en,tr,ar,fr,ru",
      whatsappEnabled: false,
      metaLeadEnabled: false,
      ...req.body,
    }).returning();
    updated = created;
  } else {
    const [u] = await db.update(settingsTable).set(req.body).returning();
    updated = u;
  }
  const { smtpPassword, whatsappToken, ...safe } = updated;
  res.json(safe);
});

export default router;
