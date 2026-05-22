import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  aiPersonasTable,
  aiPersonaRunsTable,
  aiActionQueueTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import { listScopes } from "../lib/scopeRegistry";
import { listTools, TOOL_REGISTRY } from "../lib/toolRegistry";
import { runPersona } from "../lib/personaService";

const router: IRouter = Router();

const personaSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/i, "slug must be alphanumeric/hyphens"),
  personaType: z.enum(["advisor", "operator"]),
  description: z.string().optional().nullable(),
  avatarUrl: z.string().optional().nullable(),
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().min(1),
  systemPrompt: z.string().default(""),
  guidelines: z.string().default(""),
  negativePrompt: z.string().default(""),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
  maxTokens: z.coerce.number().int().min(64).max(32000).default(2048),
  allowedDataScopes: z.array(z.string()).default([]),
  toolsEnabled: z.array(z.string()).default([]),
  triggerMode: z.enum(["manual", "scheduled", "event_driven"]).default("manual"),
  scheduleCron: z.string().optional().nullable(),
  eventSubscriptions: z.array(z.string()).optional().nullable(),
  outputTargets: z.array(z.string()).default([]),
  monthlyCostCapUsd: z.coerce.number().nullable().optional(),
  isActive: z.boolean().default(false),
});

function guardToolsForType(
  personaType: "advisor" | "operator",
  tools: string[],
): { ok: boolean; offending?: string } {
  if (personaType !== "advisor") return { ok: true };
  for (const t of tools) {
    const def = TOOL_REGISTRY[t];
    if (def?.sideEffect) return { ok: false, offending: t };
  }
  return { ok: true };
}

// Registry endpoints
router.get(
  "/ai-personas/registry/scopes",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  (_req, res): void => {
    res.json({ scopes: listScopes() });
  },
);

router.get(
  "/ai-personas/registry/tools",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  (_req, res): void => {
    res.json({ tools: listTools() });
  },
);

// List
router.get(
  "/ai-personas",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(aiPersonasTable)
      .orderBy(desc(aiPersonasTable.createdAt));
    res.json({ personas: rows });
  },
);

// Get one
router.get(
  "/ai-personas/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db.select().from(aiPersonasTable).where(eq(aiPersonasTable.id, id));
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ persona: row });
  },
);

// Create
router.post(
  "/ai-personas",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const parsed = personaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    const guard = guardToolsForType(data.personaType, data.toolsEnabled);
    if (!guard.ok) {
      res.status(400).json({
        error: `Advisor persona cannot enable side-effect tool: ${guard.offending}`,
      });
      return;
    }
    try {
      const [inserted] = await db
        .insert(aiPersonasTable)
        .values({
          name: data.name,
          slug: data.slug,
          personaType: data.personaType,
          description: data.description ?? null,
          avatarUrl: data.avatarUrl ?? null,
          provider: data.provider,
          model: data.model,
          systemPrompt: data.systemPrompt,
          guidelines: data.guidelines,
          negativePrompt: data.negativePrompt,
          temperature: String(data.temperature),
          maxTokens: data.maxTokens,
          allowedDataScopes: data.allowedDataScopes,
          toolsEnabled: data.toolsEnabled,
          triggerMode: data.triggerMode,
          scheduleCron: data.scheduleCron ?? null,
          eventSubscriptions: data.eventSubscriptions ?? null,
          outputTargets: data.outputTargets,
          monthlyCostCapUsd:
            data.monthlyCostCapUsd == null ? null : String(data.monthlyCostCapUsd),
          isActive: data.isActive,
          createdBy: req.user!.id,
        })
        .returning();
      logAudit(req.user!.id, "create_ai_persona", "ai_persona", inserted.id, {
        name: inserted.name,
      });
      res.status(201).json({ persona: inserted });
    } catch (e) {
      const msg = (e as Error).message;
      if (/unique|duplicate/i.test(msg)) {
        res.status(409).json({ error: "Slug already exists" });
        return;
      }
      res.status(500).json({ error: msg });
    }
  },
);

// Update
router.put(
  "/ai-personas/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = personaSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    if (data.personaType && data.toolsEnabled) {
      const guard = guardToolsForType(data.personaType, data.toolsEnabled);
      if (!guard.ok) {
        res.status(400).json({
          error: `Advisor persona cannot enable side-effect tool: ${guard.offending}`,
        });
        return;
      }
    } else if (data.toolsEnabled || data.personaType) {
      const [existing] = await db
        .select()
        .from(aiPersonasTable)
        .where(eq(aiPersonasTable.id, id));
      if (existing) {
        const t = (data.personaType ?? existing.personaType) as "advisor" | "operator";
        const tools = data.toolsEnabled ?? (existing.toolsEnabled as string[]) ?? [];
        const guard = guardToolsForType(t, tools);
        if (!guard.ok) {
          res.status(400).json({
            error: `Advisor persona cannot enable side-effect tool: ${guard.offending}`,
          });
          return;
        }
      }
    }
    const updates: Record<string, unknown> = { ...data };
    if (data.temperature != null) updates.temperature = String(data.temperature);
    if (data.monthlyCostCapUsd !== undefined)
      updates.monthlyCostCapUsd =
        data.monthlyCostCapUsd == null ? null : String(data.monthlyCostCapUsd);
    const [updated] = await db
      .update(aiPersonasTable)
      .set(updates)
      .where(eq(aiPersonasTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    logAudit(req.user!.id, "update_ai_persona", "ai_persona", id, data);
    res.json({ persona: updated });
  },
);

// Delete
router.delete(
  "/ai-personas/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [deleted] = await db
      .delete(aiPersonasTable)
      .where(eq(aiPersonasTable.id, id))
      .returning({ id: aiPersonasTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    logAudit(req.user!.id, "delete_ai_persona", "ai_persona", id);
    res.json({ ok: true });
  },
);

// Manual run
router.post(
  "/ai-personas/:id/run",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const input = typeof req.body?.input === "string" ? req.body.input : undefined;
    try {
      const result = await runPersona({
        personaId: id,
        input,
        triggeredBy: "manual",
        triggerActor: req.user!.id,
      });
      logAudit(req.user!.id, "run_ai_persona", "ai_persona", id, {
        runId: result.runId,
        status: result.status,
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

// Runs history
router.get(
  "/ai-personas/:id/runs",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const runs = await db
      .select({
        id: aiPersonaRunsTable.id,
        triggeredBy: aiPersonaRunsTable.triggeredBy,
        triggerActor: aiPersonaRunsTable.triggerActor,
        model: aiPersonaRunsTable.model,
        promptTokens: aiPersonaRunsTable.promptTokens,
        completionTokens: aiPersonaRunsTable.completionTokens,
        costUsd: aiPersonaRunsTable.costUsd,
        latencyMs: aiPersonaRunsTable.latencyMs,
        status: aiPersonaRunsTable.status,
        errorMessage: aiPersonaRunsTable.errorMessage,
        outputPayload: aiPersonaRunsTable.outputPayload,
        createdAt: aiPersonaRunsTable.createdAt,
      })
      .from(aiPersonaRunsTable)
      .where(eq(aiPersonaRunsTable.personaId, id))
      .orderBy(desc(aiPersonaRunsTable.createdAt))
      .limit(50);
    const [agg] = await db
      .select({
        totalRuns: sql<number>`count(*)::int`,
        totalPromptTokens: sql<number>`coalesce(sum(${aiPersonaRunsTable.promptTokens}),0)::int`,
        totalCompletionTokens: sql<number>`coalesce(sum(${aiPersonaRunsTable.completionTokens}),0)::int`,
        totalCostUsd: sql<string>`coalesce(sum(${aiPersonaRunsTable.costUsd}),0)::text`,
      })
      .from(aiPersonaRunsTable)
      .where(eq(aiPersonaRunsTable.personaId, id));
    res.json({ runs, summary: agg });
  },
);

// Action queue list
router.get(
  "/ai-personas/queue/actions",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        id: aiActionQueueTable.id,
        personaId: aiActionQueueTable.personaId,
        runId: aiActionQueueTable.runId,
        actionType: aiActionQueueTable.actionType,
        preview: aiActionQueueTable.preview,
        status: aiActionQueueTable.status,
        createdAt: aiActionQueueTable.createdAt,
        reviewedAt: aiActionQueueTable.reviewedAt,
        personaName: aiPersonasTable.name,
        reviewerEmail: usersTable.email,
      })
      .from(aiActionQueueTable)
      .leftJoin(aiPersonasTable, eq(aiActionQueueTable.personaId, aiPersonasTable.id))
      .leftJoin(usersTable, eq(aiActionQueueTable.reviewedBy, usersTable.id))
      .orderBy(desc(aiActionQueueTable.createdAt))
      .limit(100);
    res.json({ actions: rows });
  },
);

export default router;
