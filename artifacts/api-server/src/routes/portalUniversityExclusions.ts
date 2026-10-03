/**
 * portalUniversityExclusions.ts — Exclusive Bölge (uyruk istisnası) Kuralları CRUD
 *
 * Kapsam:
 *   GET    /portal-automation/university-exclusions?universityKey=...        — liste (soft-delete hariç)
 *   GET    /portal-automation/university-exclusions/nationality-suggestions  — öğrenci uyrukları (DISTINCT)
 *   POST   /portal-automation/university-exclusions                          — kural ekle
 *   PATCH  /portal-automation/university-exclusions/:id                      — güncelle (uyruk/acente/not/enable)
 *   DELETE /portal-automation/university-exclusions/:id                      — soft delete (deletedAt)
 *
 * Kurallar: validate+getValidated (ASLA req.body), zod, logAudit,
 *           requireRole(...ADMIN_ROLES), soft-delete, unique (universityKey,nationality)→409.
 */

import { Router, type IRouter, type Request } from "express";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  portalUniversityExclusionsTable,
  studentsTable,
  auditLogsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import { getValidated, validate } from "../middlewares/validate";

const router: IRouter = Router();

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
type IdSchemas = { params: typeof idParamsSchema };

type ExclusionRow = typeof portalUniversityExclusionsTable.$inferSelect;

function serialize(row: ExclusionRow) {
  return {
    id: row.id,
    universityKey: row.universityKey,
    nationality: row.nationality,
    agencyName: row.agencyName,
    note: row.note,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function writeExclusionAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  req: Request,
  action: string,
  resourceId: number,
  changedFields: string[],
): Promise<void> {
  await tx.insert(auditLogsTable).values({
    userId: req.user!.id,
    action,
    resource: "portal_university_exclusion",
    resourceId,
    changes: JSON.stringify({ changedFields: [...changedFields].sort() }),
    ipAddress: req.ip || null,
  });
}

// ---------------------------------------------------------------------------
// GET /portal-automation/university-exclusions/nationality-suggestions
// DISTINCT student nationalities — used as an autocomplete source (free text
// is still allowed by the client).
// ---------------------------------------------------------------------------
router.get(
  "/portal-automation/university-exclusions/nationality-suggestions",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const rows = await db
      .selectDistinct({ nationality: studentsTable.nationality })
      .from(studentsTable)
      .where(
        and(
          isNotNull(studentsTable.nationality),
          sql`length(trim(${studentsTable.nationality})) > 0`,
        ),
      )
      .orderBy(asc(studentsTable.nationality));

    res.json(
      rows
        .map((r) => (r.nationality ?? "").trim())
        .filter((n) => n.length > 0),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /portal-automation/university-exclusions?universityKey=...
// ---------------------------------------------------------------------------
const listQuerySchema = z.object({
  universityKey: z.string().min(1).optional(),
});
type ListSchemas = { query: typeof listQuerySchema };

router.get(
  "/portal-automation/university-exclusions",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ query: listQuerySchema }),
  async (req, res): Promise<void> => {
    const { universityKey } = getValidated<ListSchemas>(req).query;

    const rows = await db
      .select()
      .from(portalUniversityExclusionsTable)
      .where(
        and(
          isNull(portalUniversityExclusionsTable.deletedAt),
          universityKey
            ? eq(portalUniversityExclusionsTable.universityKey, universityKey)
            : undefined,
        ),
      )
      .orderBy(asc(portalUniversityExclusionsTable.id));

    res.json(rows.map(serialize));
  },
);

// ---------------------------------------------------------------------------
// POST /portal-automation/university-exclusions
// ---------------------------------------------------------------------------
const createBodySchema = z.object({
  universityKey: z.string().trim().min(1).max(200),
  nationality: z.string().trim().min(1).max(200),
  agencyName: z.string().trim().min(1).max(300).optional(),
  note: z.string().trim().min(1).max(4_000).optional(),
  enabled: z.boolean().optional(),
});
type CreateSchemas = { body: typeof createBodySchema };

router.post(
  "/portal-automation/university-exclusions",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ body: createBodySchema }),
  async (req, res): Promise<void> => {
    const body = getValidated<CreateSchemas>(req).body;
    const nationality = body.nationality.trim();
    const universityKey = body.universityKey.trim();
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${universityKey.toLowerCase()}\u0000${nationality.toLowerCase()}`}))`);
      const [existing] = await tx.select({ id: portalUniversityExclusionsTable.id })
        .from(portalUniversityExclusionsTable)
        .where(and(
          sql`lower(${portalUniversityExclusionsTable.universityKey}) = lower(${universityKey})`,
          sql`lower(${portalUniversityExclusionsTable.nationality}) = lower(${nationality})`,
          isNull(portalUniversityExclusionsTable.deletedAt),
        ))
        .limit(1);
      if (existing) return { status: "duplicate" as const };
      const [row] = await tx.insert(portalUniversityExclusionsTable).values({
          universityKey,
          nationality,
          agencyName: body.agencyName?.trim() || null,
          note: body.note?.trim() || null,
          enabled: body.enabled ?? true,
        }).returning();
      await writeExclusionAudit(tx, req, "create_portal_university_exclusion", row.id, ["created"]);
      return { status: "created" as const, row };
    });

    if (result.status === "duplicate") {
      res.status(409).json({
        error: "DUPLICATE_NATIONALITY",
        message: `An exclusion for '${nationality}' already exists for '${universityKey}'`,
      });
      return;
    }
    res.status(201).json(serialize(result.row));
  },
);

// ---------------------------------------------------------------------------
// PATCH /portal-automation/university-exclusions/:id
// ---------------------------------------------------------------------------
const updateBodySchema = z
  .object({
    nationality: z.string().trim().min(1).max(200).optional(),
    agencyName: z.string().trim().max(300).nullable().optional(),
    note: z.string().trim().max(4_000).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });
type UpdateSchemas = {
  params: typeof idParamsSchema;
  body: typeof updateBodySchema;
};

router.patch(
  "/portal-automation/university-exclusions/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ params: idParamsSchema, body: updateBodySchema }),
  async (req, res): Promise<void> => {
    const { id } = getValidated<UpdateSchemas>(req).params;
    const body = getValidated<UpdateSchemas>(req).body;
    const result = await db.transaction(async tx => {
      const [existing] = await tx.select().from(portalUniversityExclusionsTable)
        .where(and(
          eq(portalUniversityExclusionsTable.id, id),
          isNull(portalUniversityExclusionsTable.deletedAt),
        ))
        .limit(1)
        .for("update");
      if (!existing) return { status: "missing" as const };

      const nationality = body.nationality !== undefined ? body.nationality.trim() : undefined;
      if (nationality && nationality.toLowerCase() !== existing.nationality.toLowerCase()) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${existing.universityKey.toLowerCase()}\u0000${nationality.toLowerCase()}`}))`);
        const [clash] = await tx.select({ id: portalUniversityExclusionsTable.id })
          .from(portalUniversityExclusionsTable)
          .where(and(
            sql`lower(${portalUniversityExclusionsTable.universityKey}) = lower(${existing.universityKey})`,
            sql`lower(${portalUniversityExclusionsTable.nationality}) = lower(${nationality})`,
            isNull(portalUniversityExclusionsTable.deletedAt),
          ))
          .limit(1);
        if (clash) return { status: "duplicate" as const, universityKey: existing.universityKey, nationality };
      }

      const updates = {
        ...(nationality !== undefined && { nationality }),
        ...(body.agencyName !== undefined && { agencyName: body.agencyName?.trim() || null }),
        ...(body.note !== undefined && { note: body.note?.trim() || null }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        updatedAt: new Date(),
      };
      const [row] = await tx.update(portalUniversityExclusionsTable).set(updates)
        .where(and(eq(portalUniversityExclusionsTable.id, id), isNull(portalUniversityExclusionsTable.deletedAt)))
        .returning();
      if (!row) return { status: "missing" as const };
      await writeExclusionAudit(tx, req, "update_portal_university_exclusion", id,
        Object.keys(updates).filter(key => key !== "updatedAt"));
      return { status: "updated" as const, row };
    });

    if (result.status === "missing") {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (result.status === "duplicate") {
      res.status(409).json({
        error: "DUPLICATE_NATIONALITY",
        message: `An exclusion for '${result.nationality}' already exists for '${result.universityKey}'`,
      });
      return;
    }
    res.json(serialize(result.row));
  },
);

// ---------------------------------------------------------------------------
// DELETE /portal-automation/university-exclusions/:id  — soft delete
// ---------------------------------------------------------------------------
router.delete(
  "/portal-automation/university-exclusions/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ params: idParamsSchema }),
  async (req, res): Promise<void> => {
    const { id } = getValidated<IdSchemas>(req).params;
    const deleted = await db.transaction(async tx => {
      const [existing] = await tx.select({ id: portalUniversityExclusionsTable.id })
        .from(portalUniversityExclusionsTable)
        .where(and(
          eq(portalUniversityExclusionsTable.id, id),
          isNull(portalUniversityExclusionsTable.deletedAt),
        ))
        .for("update");
      if (!existing) return false;
      const [row] = await tx.update(portalUniversityExclusionsTable)
        .set({ deletedAt: new Date() })
        .where(and(eq(portalUniversityExclusionsTable.id, id), isNull(portalUniversityExclusionsTable.deletedAt)))
        .returning({ id: portalUniversityExclusionsTable.id });
      if (!row) return false;
      await writeExclusionAudit(tx, req, "delete_portal_university_exclusion", id, ["deleted"]);
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
