/**
 * portalProgramFallbacks.ts — Yedek Program (supersession) Kuralları CRUD
 *
 * Kapsam:
 *   GET    /portal-program-fallbacks?universityKey=...   — liste (soft-delete hariç)
 *   POST   /portal-program-fallbacks                     — kural ekle (kaynak başına tek)
 *   PATCH  /portal-program-fallbacks/:id                 — güncelle (sıra/enable/autoSubmit)
 *   DELETE /portal-program-fallbacks/:id                 — soft delete (deletedAt)
 *
 * Kurallar: validate+getValidated (ASLA req.body), zod, logAudit,
 *           requireRole(...ADMIN_ROLES), soft-delete, unique (universityKey,sourceProgramId).
 *           Program adları display için programs tablosundan çözülür.
 */

import { Router, type IRouter, type Request } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  portalProgramFallbacksTable,
  programsTable,
  auditLogsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import { getValidated, validate } from "../middlewares/validate";

const router: IRouter = Router();

class DuplicatePortalProgramFallbackError extends Error {
  constructor() {
    super("An active fallback rule already exists for this portal programme");
    this.name = "DuplicatePortalProgramFallbackError";
  }
}

function isFallbackUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "23505" &&
      candidate.constraint === "portal_prog_fallback_key_source_uniq"
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
type IdSchemas = { params: typeof idParamsSchema };

// ---------------------------------------------------------------------------
// Helper — resolve CRM program ids → { id: name } map for display
// ---------------------------------------------------------------------------
async function resolveProgramNames(
  ids: number[],
): Promise<Record<number, string>> {
  const unique = [...new Set(ids)].filter((n) => Number.isInteger(n));
  if (unique.length === 0) return {};
  const rows = await db
    .select({ id: programsTable.id, name: programsTable.name })
    .from(programsTable)
    .where(inArray(programsTable.id, unique));
  const map: Record<number, string> = {};
  for (const r of rows) map[r.id] = r.name;
  return map;
}

type FallbackRow = typeof portalProgramFallbacksTable.$inferSelect;

function serialize(row: FallbackRow, names: Record<number, string>) {
  return {
    id: row.id,
    universityKey: row.universityKey,
    sourceProgramId: row.sourceProgramId,
    sourceProgramName: names[row.sourceProgramId] ?? null,
    fallbackProgramIds: row.fallbackProgramIds,
    fallbackPrograms: row.fallbackProgramIds.map((id) => ({
      id,
      name: names[id] ?? null,
    })),
    autoSubmit: row.autoSubmit,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function writeFallbackAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  req: Request,
  action: string,
  resourceId: number,
  changedFields: string[],
): Promise<void> {
  await tx.insert(auditLogsTable).values({
    userId: req.user!.id,
    action,
    resource: "portal_program_fallback",
    resourceId,
    changes: JSON.stringify({ changedFields: [...changedFields].sort() }),
    ipAddress: req.ip || null,
  });
}

// ---------------------------------------------------------------------------
// GET /portal-program-fallbacks?universityKey=...
// ---------------------------------------------------------------------------
const listQuerySchema = z.object({
  universityKey: z.string().min(1).optional(),
});
type ListSchemas = { query: typeof listQuerySchema };

router.get(
  "/portal-program-fallbacks",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ query: listQuerySchema }),
  async (req, res): Promise<void> => {
    const { universityKey } = getValidated<ListSchemas>(req).query;

    const rows = await db
      .select()
      .from(portalProgramFallbacksTable)
      .where(
        and(
          isNull(portalProgramFallbacksTable.deletedAt),
          universityKey
            ? eq(portalProgramFallbacksTable.universityKey, universityKey)
            : undefined,
        ),
      )
      .orderBy(asc(portalProgramFallbacksTable.id));

    const allIds = rows.flatMap((r) => [
      r.sourceProgramId,
      ...r.fallbackProgramIds,
    ]);
    const names = await resolveProgramNames(allIds);

    res.json(rows.map((r) => serialize(r, names)));
  },
);

// ---------------------------------------------------------------------------
// POST /portal-program-fallbacks
// ---------------------------------------------------------------------------
const createBodySchema = z.object({
  universityKey: z.string().trim().min(1).max(200),
  sourceProgramId: z.number().int().positive(),
  fallbackProgramIds: z.array(z.number().int().positive()).max(20).default([]),
  autoSubmit: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
type CreateSchemas = { body: typeof createBodySchema };

router.post(
  "/portal-program-fallbacks",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ body: createBodySchema }),
  async (req, res): Promise<void> => {
    const body = getValidated<CreateSchemas>(req).body;
    const fallbackProgramIds = [...new Set(body.fallbackProgramIds)];
    if (fallbackProgramIds.includes(body.sourceProgramId)) {
      res.status(400).json({ error: "SOURCE_CANNOT_BE_FALLBACK" });
      return;
    }

    let row: FallbackRow;
    try {
      row = await db.transaction(async (tx) => {
        // Serialize same-key creates before the active-row check. The partial
        // unique index remains the database-level final guard for writers that
        // do not use this route.
        const businessKey = `portal-program-fallback:${body.universityKey}:${body.sourceProgramId}`;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${businessKey}, 0))`,
        );

        const [existing] = await tx
          .select({ id: portalProgramFallbacksTable.id })
          .from(portalProgramFallbacksTable)
          .where(
            and(
              eq(portalProgramFallbacksTable.universityKey, body.universityKey),
              eq(portalProgramFallbacksTable.sourceProgramId, body.sourceProgramId),
              isNull(portalProgramFallbacksTable.deletedAt),
            ),
          )
          .limit(1);

        if (existing) {
          throw new DuplicatePortalProgramFallbackError();
        }

        const [created] = await tx
          .insert(portalProgramFallbacksTable)
          .values({
            universityKey: body.universityKey,
            sourceProgramId: body.sourceProgramId,
            fallbackProgramIds,
            autoSubmit: body.autoSubmit ?? true,
            enabled: body.enabled ?? true,
          })
          .returning();

        if (!created) {
          throw new Error("Portal program fallback insert returned no row");
        }
        await writeFallbackAudit(tx, req, "create_portal_program_fallback", created.id, ["created"]);
        return created;
      });
    } catch (error) {
      if (
        error instanceof DuplicatePortalProgramFallbackError ||
        isFallbackUniqueViolation(error)
      ) {
        res.status(409).json({
          error: "DUPLICATE_SOURCE",
          message: `A fallback rule for source program ${body.sourceProgramId} already exists for '${body.universityKey}'`,
        });
        return;
      }
      throw error;
    }

    const names = await resolveProgramNames([
      row.sourceProgramId,
      ...row.fallbackProgramIds,
    ]);
    res.status(201).json(serialize(row, names));
  },
);

// ---------------------------------------------------------------------------
// PATCH /portal-program-fallbacks/:id
// ---------------------------------------------------------------------------
const updateBodySchema = z
  .object({
    fallbackProgramIds: z.array(z.number().int().positive()).max(20).optional(),
    autoSubmit: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });
type UpdateSchemas = { params: typeof idParamsSchema; body: typeof updateBodySchema };

router.patch(
  "/portal-program-fallbacks/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ params: idParamsSchema, body: updateBodySchema }),
  async (req, res): Promise<void> => {
    const { id } = getValidated<UpdateSchemas>(req).params;
    const body = getValidated<UpdateSchemas>(req).body;
    const result = await db.transaction(async tx => {
      const [existing] = await tx.select().from(portalProgramFallbacksTable)
        .where(and(
          eq(portalProgramFallbacksTable.id, id),
          isNull(portalProgramFallbacksTable.deletedAt),
        ))
        .for("update");
      if (!existing) return { status: "missing" as const };
      const fallbackProgramIds = body.fallbackProgramIds === undefined
        ? undefined
        : [...new Set(body.fallbackProgramIds)];
      if (fallbackProgramIds?.includes(existing.sourceProgramId)) {
        return { status: "self_reference" as const };
      }
      const updates = {
        ...(fallbackProgramIds !== undefined && { fallbackProgramIds }),
        ...(body.autoSubmit !== undefined && { autoSubmit: body.autoSubmit }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        updatedAt: new Date(),
      };
      const [row] = await tx.update(portalProgramFallbacksTable).set(updates)
        .where(and(eq(portalProgramFallbacksTable.id, id), isNull(portalProgramFallbacksTable.deletedAt)))
        .returning();
      if (!row) return { status: "missing" as const };
      await writeFallbackAudit(tx, req, "update_portal_program_fallback", id,
        Object.keys(updates).filter(key => key !== "updatedAt"));
      return { status: "updated" as const, row };
    });

    if (result.status === "missing") {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (result.status === "self_reference") {
      res.status(400).json({ error: "SOURCE_CANNOT_BE_FALLBACK" });
      return;
    }
    const row = result.row;

    const names = await resolveProgramNames([
      row.sourceProgramId,
      ...row.fallbackProgramIds,
    ]);
    res.json(serialize(row, names));
  },
);

// ---------------------------------------------------------------------------
// DELETE /portal-program-fallbacks/:id  — soft delete
// ---------------------------------------------------------------------------
router.delete(
  "/portal-program-fallbacks/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ params: idParamsSchema }),
  async (req, res): Promise<void> => {
    const { id } = getValidated<IdSchemas>(req).params;
    const deleted = await db.transaction(async tx => {
      const [existing] = await tx.select({ id: portalProgramFallbacksTable.id })
        .from(portalProgramFallbacksTable)
        .where(and(
          eq(portalProgramFallbacksTable.id, id),
          isNull(portalProgramFallbacksTable.deletedAt),
        ))
        .for("update");
      if (!existing) return false;
      const [row] = await tx.update(portalProgramFallbacksTable)
        .set({ deletedAt: new Date() })
        .where(and(eq(portalProgramFallbacksTable.id, id), isNull(portalProgramFallbacksTable.deletedAt)))
        .returning({ id: portalProgramFallbacksTable.id });
      if (!row) return false;
      await writeFallbackAudit(tx, req, "delete_portal_program_fallback", id, ["deleted"]);
      return true;
    });

    if (!deleted) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    res.json({ ok: true });
  },
);

export default router;
