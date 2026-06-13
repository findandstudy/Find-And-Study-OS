/**
 * portalMgmt.ts — Portal Otomasyon Yönetim Route'ları
 *
 * Kapsam:
 *   GET  /portal-automation/settings           — ayarları getir
 *   PUT  /portal-automation/settings           — ayarları kaydet (upsert)
 *   GET  /portal-universities                  — üniversite listesi (filtre + paginasyon)
 *   POST /portal-universities                  — üniversite ekle
 *   PATCH /portal-universities/:id             — üniversite güncelle
 *   DELETE /portal-universities/:id            — üniversite sil (soft)
 *   PATCH /portal-universities/:id/active      — isActive toggle
 *
 * Kurallar: validate+getValidated (ASLA req.body), zod, logAudit,
 *           requireRole(STAFF|ADMIN), izolasyon: yok (yönetim-only).
 *           Kimlik bilgileri (şifre/token) ASLA response'a girmez.
 */

import { Router, type IRouter } from "express";
import { and, asc, count, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  portalAutomationSettingsTable,
  portalUniversitiesTable,
} from "@workspace/db";
import { buildPageMeta, parsePaginationParams } from "@workspace/pagination";
import { logAudit, requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES, STAFF_ROLES } from "../lib/roles";
import { getValidated, validate } from "../middlewares/validate";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Shared id param schema
// ---------------------------------------------------------------------------
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
type IdSchemas = { params: typeof idParamsSchema };

// ===========================================================================
// SETTINGS
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /portal-automation/settings
// ---------------------------------------------------------------------------
router.get(
  "/portal-automation/settings",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const [row] = await db
      .select()
      .from(portalAutomationSettingsTable)
      .orderBy(asc(portalAutomationSettingsTable.id))
      .limit(1);

    if (!row) {
      // Return default values when table is empty (no row yet)
      res.json({
        id: null,
        isEnabled: false,
        triggerStages: [],
        mode: "dry",
        scope: "only_applied",
        selectedUniversityKeys: [],
        createdAt: null,
        updatedAt: null,
      });
      return;
    }

    res.json(row);
  },
);

// ---------------------------------------------------------------------------
// PUT /portal-automation/settings
// ---------------------------------------------------------------------------
const putSettingsBodySchema = z.object({
  isEnabled: z.boolean(),
  triggerStages: z.array(z.string().min(1)),
  mode: z.enum(["dry", "real"]),
  scope: z.enum(["only_applied", "selected", "all"]),
  selectedUniversityKeys: z.array(z.string()),
});
type PutSettingsSchemas = { body: typeof putSettingsBodySchema };

router.put(
  "/portal-automation/settings",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ body: putSettingsBodySchema }),
  async (req, res): Promise<void> => {
    const body = getValidated<PutSettingsSchemas>(req).body;
    const user = req.user!;

    const [existing] = await db
      .select({ id: portalAutomationSettingsTable.id })
      .from(portalAutomationSettingsTable)
      .orderBy(asc(portalAutomationSettingsTable.id))
      .limit(1);

    let row;
    if (existing) {
      [row] = await db
        .update(portalAutomationSettingsTable)
        .set({
          isEnabled:              body.isEnabled,
          triggerStages:          body.triggerStages,
          mode:                   body.mode,
          scope:                  body.scope,
          selectedUniversityKeys: body.selectedUniversityKeys,
          updatedAt:              new Date(),
        })
        .where(eq(portalAutomationSettingsTable.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(portalAutomationSettingsTable)
        .values({
          isEnabled:              body.isEnabled,
          triggerStages:          body.triggerStages,
          mode:                   body.mode,
          scope:                  body.scope,
          selectedUniversityKeys: body.selectedUniversityKeys,
        })
        .returning();
    }

    logAudit(
      user.id,
      "update_portal_automation_settings",
      "portal_automation_settings",
      row.id,
      {
        isEnabled: body.isEnabled,
        mode: body.mode,
        scope: body.scope,
        triggerStagesCount: body.triggerStages.length,
      },
      req.ip,
    );

    res.json(row);
  },
);

// ===========================================================================
// PORTAL UNIVERSITIES
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /portal-universities
// ---------------------------------------------------------------------------
const listUniversitiesQuerySchema = z.object({
  search:   z.string().optional(),
  isActive: z
    .string()
    .transform((v) => v === "true" ? true : v === "false" ? false : undefined)
    .optional(),
});
type ListUnisSchemas = { query: typeof listUniversitiesQuerySchema };

router.get(
  "/portal-universities",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ query: listUniversitiesQuerySchema }),
  async (req, res): Promise<void> => {
    const { search, isActive } = getValidated<ListUnisSchemas>(req).query;
    const pageParams = parsePaginationParams(req, { defaultLimit: 50, maxLimit: "large" });

    const conditions: (SQL | undefined)[] = [isNull(portalUniversitiesTable.deletedAt)];

    if (search && search.trim()) {
      const pattern = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(portalUniversitiesTable.universityName, pattern),
          ilike(portalUniversitiesTable.universityKey, pattern),
          ilike(portalUniversitiesTable.adapterKey, pattern),
        ),
      );
    }

    if (isActive !== undefined) {
      conditions.push(eq(portalUniversitiesTable.isActive, isActive));
    }

    const where = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(portalUniversitiesTable)
      .where(where);

    const rows = await db
      .select()
      .from(portalUniversitiesTable)
      .where(where)
      .orderBy(asc(portalUniversitiesTable.universityName))
      .limit(pageParams.limit)
      .offset(pageParams.offset);

    // Attach hasCredentials boolean; NEVER expose actual credential values
    const rowsWithCreds = rows.map((row) => {
      const K = row.adapterKey.toUpperCase().replace(/-/g, "_");
      const hasCredentials = !!(
        (process.env[`${K}_EMAIL`] || process.env[`${K}_USER`]) &&
        process.env[`${K}_PASSWORD`]
      );
      return { ...row, hasCredentials };
    });

    res.json({ data: rowsWithCreds, ...buildPageMeta(total, pageParams) });
  },
);

// ---------------------------------------------------------------------------
// POST /portal-universities
// ---------------------------------------------------------------------------
const createUniversityBodySchema = z.object({
  universityKey:    z.string().min(1).regex(/^[a-z0-9_-]+$/, "Only lowercase letters, digits, underscores and hyphens"),
  universityName:   z.string().min(1),
  adapterKey:       z.string().min(1),
  crmUniversityId:  z.coerce.number().int().positive().optional(),
  isActive:         z.boolean().optional(),
  defaults:         z.record(z.unknown()).optional(),
});
type CreateUniSchemas = { body: typeof createUniversityBodySchema };

router.post(
  "/portal-universities",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ body: createUniversityBodySchema }),
  async (req, res): Promise<void> => {
    const body = getValidated<CreateUniSchemas>(req).body;
    const user = req.user!;

    // Uniqueness check on universityKey
    const [existing] = await db
      .select({ id: portalUniversitiesTable.id })
      .from(portalUniversitiesTable)
      .where(eq(portalUniversitiesTable.universityKey, body.universityKey))
      .limit(1);

    if (existing) {
      res.status(409).json({
        error: "DUPLICATE_KEY",
        message: `universityKey '${body.universityKey}' already exists`,
      });
      return;
    }

    const [row] = await db
      .insert(portalUniversitiesTable)
      .values({
        universityKey:   body.universityKey,
        universityName:  body.universityName,
        adapterKey:      body.adapterKey,
        crmUniversityId: body.crmUniversityId ?? null,
        isActive:        body.isActive ?? true,
        defaults:        body.defaults ?? null,
      })
      .returning();

    logAudit(
      user.id,
      "create_portal_university",
      "portal_university",
      row.id,
      { universityKey: row.universityKey, adapterKey: row.adapterKey },
      req.ip,
    );

    res.status(201).json(row);
  },
);

// ---------------------------------------------------------------------------
// PATCH /portal-universities/:id/active  — toggle (must be BEFORE /:id)
// ---------------------------------------------------------------------------
const toggleActiveBodySchema = z.object({
  isActive: z.boolean(),
});
type ToggleSchemas = { params: typeof idParamsSchema; body: typeof toggleActiveBodySchema };

router.patch(
  "/portal-universities/:id/active",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: idParamsSchema, body: toggleActiveBodySchema }),
  async (req, res): Promise<void> => {
    const { id } = getValidated<ToggleSchemas>(req).params;
    const { isActive } = getValidated<ToggleSchemas>(req).body;
    const user = req.user!;

    const [row] = await db
      .select({ id: portalUniversitiesTable.id })
      .from(portalUniversitiesTable)
      .where(and(
        eq(portalUniversitiesTable.id, id),
        isNull(portalUniversitiesTable.deletedAt),
      ));

    if (!row) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const [updated] = await db
      .update(portalUniversitiesTable)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(portalUniversitiesTable.id, id))
      .returning();

    logAudit(
      user.id,
      isActive ? "activate_portal_university" : "deactivate_portal_university",
      "portal_university",
      id,
      { isActive },
      req.ip,
    );

    res.json(updated);
  },
);

// ---------------------------------------------------------------------------
// PATCH /portal-universities/:id
// ---------------------------------------------------------------------------
const updateUniversityBodySchema = z.object({
  universityKey:   z.string().min(1).regex(/^[a-z0-9_-]+$/).optional(),
  universityName:  z.string().min(1).optional(),
  adapterKey:      z.string().min(1).optional(),
  crmUniversityId: z.coerce.number().int().positive().nullable().optional(),
  defaults:        z.record(z.unknown()).nullable().optional(),
}).strict();
type UpdateUniSchemas = { params: typeof idParamsSchema; body: typeof updateUniversityBodySchema };

router.patch(
  "/portal-universities/:id",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: idParamsSchema, body: updateUniversityBodySchema }),
  async (req, res): Promise<void> => {
    const { id } = getValidated<UpdateUniSchemas>(req).params;
    const body   = getValidated<UpdateUniSchemas>(req).body;
    const user   = req.user!;

    const [row] = await db
      .select()
      .from(portalUniversitiesTable)
      .where(and(
        eq(portalUniversitiesTable.id, id),
        isNull(portalUniversitiesTable.deletedAt),
      ));

    if (!row) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    // Check key uniqueness if changing it
    if (body.universityKey && body.universityKey !== row.universityKey) {
      const [dup] = await db
        .select({ id: portalUniversitiesTable.id })
        .from(portalUniversitiesTable)
        .where(eq(portalUniversitiesTable.universityKey, body.universityKey))
        .limit(1);
      if (dup) {
        res.status(409).json({
          error: "DUPLICATE_KEY",
          message: `universityKey '${body.universityKey}' already exists`,
        });
        return;
      }
    }

    const patch: Partial<typeof portalUniversitiesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.universityKey   !== undefined) patch.universityKey   = body.universityKey;
    if (body.universityName  !== undefined) patch.universityName  = body.universityName;
    if (body.adapterKey      !== undefined) patch.adapterKey      = body.adapterKey;
    if ("crmUniversityId" in body)          patch.crmUniversityId = body.crmUniversityId ?? null;
    if ("defaults"        in body)          patch.defaults        = body.defaults ?? null;

    const [updated] = await db
      .update(portalUniversitiesTable)
      .set(patch)
      .where(eq(portalUniversitiesTable.id, id))
      .returning();

    logAudit(
      user.id,
      "update_portal_university",
      "portal_university",
      id,
      body,
      req.ip,
    );

    res.json(updated);
  },
);

// ---------------------------------------------------------------------------
// DELETE /portal-universities/:id  (soft-delete)
// ---------------------------------------------------------------------------
router.delete(
  "/portal-universities/:id",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: idParamsSchema }),
  async (req, res): Promise<void> => {
    const { id } = getValidated<IdSchemas>(req).params;
    const user   = req.user!;

    const [row] = await db
      .select({ id: portalUniversitiesTable.id })
      .from(portalUniversitiesTable)
      .where(and(
        eq(portalUniversitiesTable.id, id),
        isNull(portalUniversitiesTable.deletedAt),
      ));

    if (!row) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    await db
      .update(portalUniversitiesTable)
      .set({ deletedAt: new Date() })
      .where(eq(portalUniversitiesTable.id, id));

    logAudit(
      user.id,
      "delete_portal_university",
      "portal_university",
      id,
      {},
      req.ip,
    );

    res.json({ ok: true });
  },
);

export default router;
