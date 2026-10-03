import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, aiDefaultConfigsTable, auditLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import {
  HARDCODED_DEFAULTS,
  ALL_DEFAULT_KEYS,
  type AiDefaultKey,
} from "../lib/aiDefaultConfigs";

const router: IRouter = Router();

router.get(
  "/ai-defaults",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const rows = await db.select().from(aiDefaultConfigsTable);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const defaults = ALL_DEFAULT_KEYS.map((key) => {
      const dbRow = byKey.get(key);
      return {
        key,
        value: dbRow?.value ?? HARDCODED_DEFAULTS[key],
        hardcoded: HARDCODED_DEFAULTS[key],
        isCustom: Boolean(dbRow),
        updatedAt: dbRow?.updatedAt ?? null,
      };
    });
    res.json({ defaults });
  },
);

router.get(
  "/ai-defaults/:key",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const key = req.params.key as AiDefaultKey;
    if (!HARDCODED_DEFAULTS[key]) {
      res.status(404).json({ error: "Unknown key" });
      return;
    }
    const [dbRow] = await db
      .select()
      .from(aiDefaultConfigsTable)
      .where(eq(aiDefaultConfigsTable.key, key));
    res.json({
      key,
      value: dbRow?.value ?? HARDCODED_DEFAULTS[key],
      hardcoded: HARDCODED_DEFAULTS[key],
      isCustom: Boolean(dbRow),
      updatedAt: dbRow?.updatedAt ?? null,
    });
  },
);

const expectedVersionSchema = z.string().datetime({ offset: true }).nullable().optional();
const putSchema = z.object({
  value: z.record(z.string(), z.unknown()),
  expectedUpdatedAt: expectedVersionSchema,
});
const resetSchema = z.object({ expectedUpdatedAt: expectedVersionSchema }).default({});

function sameVersion(actual: Date | null | undefined, expected: string | null | undefined): boolean {
  if (expected === undefined) return true;
  if (expected === null) return !actual;
  return Boolean(actual) && actual!.getTime() === new Date(expected).getTime();
}

router.put(
  "/ai-defaults/:key",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const key = req.params.key as AiDefaultKey;
    if (!HARDCODED_DEFAULTS[key]) {
      res.status(404).json({ error: "Unknown key" });
      return;
    }
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const value = parsed.data.value;
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 65_536) {
      res.status(413).json({ error: "AI default configuration exceeds 64 KiB" });
      return;
    }
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ai-default-config'), hashtext(${key}))`);
      const [current] = await tx.select().from(aiDefaultConfigsTable).where(eq(aiDefaultConfigsTable.key, key));
      if (!sameVersion(current?.updatedAt, parsed.data.expectedUpdatedAt)) return null;
      const [saved] = current
        ? await tx.update(aiDefaultConfigsTable)
          .set({ value, updatedBy: req.user!.id, updatedAt: new Date() })
          .where(eq(aiDefaultConfigsTable.key, key)).returning()
        : await tx.insert(aiDefaultConfigsTable)
          .values({ key, value, updatedBy: req.user!.id }).returning();
      await tx.insert(auditLogsTable).values({
        userId: req.user!.id,
        action: "update_ai_default",
        resource: "ai_default_config",
        changes: JSON.stringify({ key, previousUpdatedAt: current?.updatedAt?.toISOString() ?? null, updatedAt: saved.updatedAt.toISOString() }),
        ipAddress: req.ip || null,
      });
      return saved;
    });
    if (!row) {
      res.status(409).json({ error: "ai_default_version_conflict" });
      return;
    }
    res.json({
      key: row.key,
      value: row.value,
      hardcoded: HARDCODED_DEFAULTS[key],
      isCustom: true,
      updatedAt: row.updatedAt,
    });
  },
);

router.delete(
  "/ai-defaults/:key",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const key = req.params.key as AiDefaultKey;
    if (!HARDCODED_DEFAULTS[key]) {
      res.status(404).json({ error: "Unknown key" });
      return;
    }
    const parsed = resetSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const reset = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ai-default-config'), hashtext(${key}))`);
      const [current] = await tx.select().from(aiDefaultConfigsTable).where(eq(aiDefaultConfigsTable.key, key));
      if (!sameVersion(current?.updatedAt, parsed.data.expectedUpdatedAt)) return false;
      if (current) await tx.delete(aiDefaultConfigsTable).where(eq(aiDefaultConfigsTable.key, key));
      await tx.insert(auditLogsTable).values({
        userId: req.user!.id,
        action: "reset_ai_default",
        resource: "ai_default_config",
        changes: JSON.stringify({ key, previousUpdatedAt: current?.updatedAt?.toISOString() ?? null, changed: Boolean(current) }),
        ipAddress: req.ip || null,
      });
      return true;
    });
    if (!reset) {
      res.status(409).json({ error: "ai_default_version_conflict" });
      return;
    }
    res.json({ ok: true, key, hardcoded: HARDCODED_DEFAULTS[key] });
  },
);

export default router;
