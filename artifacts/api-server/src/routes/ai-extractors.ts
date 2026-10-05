import { Router, type IRouter, json } from "express";
import { z } from "zod";
import { db, aiExtractorsTable, aiExtractorRunsTable, auditLogsTable, embedWidgetsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { getAnthropicClient, getClaudeConfig } from "@workspace/integrations-anthropic-ai";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import {
  buildExtractionPrompt,
  getExtractorById,
  getExtractorUsageStats,
  recordExtractorRun,
} from "../lib/aiExtractorService";
import { normalizeGpaEvidenceTo100 } from "../lib/gpaNormalize";

const router: IRouter = Router();
const jsonBody = json({ limit: "20mb" });
const configJsonBody = json({ limit: "256kb" });

const FIELD_TYPES = ["string", "number", "date", "boolean", "enum"] as const;
const SCOPES = ["public_apply", "embed", "staff", "agent"] as const;
const PROVIDERS = ["anthropic", "openai", "gemini"] as const;

const fieldSchema = z.object({
  key: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "key must be camelCase"),
  label: z.string().min(1).max(160),
  description: z.string().max(500).optional().default(""),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional().default(false),
  enumValues: z.array(z.string().max(160)).max(100).optional().default([]),
  normalize: z.enum(["gpa100", "dateYmd", "none"]).optional().default("none"),
  format: z.string().max(40).optional().default(""),
  labelByLang: z.record(z.string().max(16), z.string().max(160)).optional().default({}),
});

const extractorSchema = z.object({
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/i, "slug must be alphanumeric/hyphens"),
  description: z.string().max(2000).optional().nullable(),
  provider: z.enum(PROVIDERS).default("anthropic"),
  model: z.string().min(1).max(120),
  systemPrompt: z.string().max(32_000).default(""),
  systemPromptByLang: z.record(z.string().max(16), z.string().max(32_000)).default({}),
  fields: z.array(fieldSchema).min(1).max(200),
  rules: z
    .object({
      globalRules: z.array(z.string().max(2_000)).max(200).optional().default([]),
      perDocType: z.record(z.string().max(120), z.array(z.string().max(2_000)).max(200)).optional().default({}),
    })
    .default({ globalRules: [], perDocType: {} }),
  scopes: z.array(z.enum(SCOPES)).max(SCOPES.length).default([]),
  documentTypes: z.array(z.string().min(1).max(120)).max(200).default([]),
  temperature: z.coerce.number().min(0).max(2).default(0.2),
  maxTokens: z.coerce.number().int().min(256).max(32000).default(4096),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

// List
router.get(
  "/ai-extractors",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(aiExtractorsTable)
      .orderBy(desc(aiExtractorsTable.isDefault), desc(aiExtractorsTable.updatedAt));
    const usage = await getExtractorUsageStats();
    res.json({
      extractors: rows.map((r) => ({
        ...r,
        usage: usage[r.id] ?? { runs: 0, lastRunAt: null },
      })),
    });
  },
);

// Get one
router.get(
  "/ai-extractors/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const ext = await getExtractorById(id);
    if (!ext) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ extractor: ext });
  },
);

type ExtractorTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function clearOtherDefaultsForScopes(tx: ExtractorTransaction, scopes: string[], exceptId: number | null): Promise<void> {
  // Enforce one default per scope: clear the default flag on any active
  // extractor whose scope set overlaps the new defaults scope set.
  if (!scopes || scopes.length === 0) return;
  const rows = await tx.select().from(aiExtractorsTable).where(eq(aiExtractorsTable.isDefault, true));
  for (const r of rows) {
    if (exceptId != null && r.id === exceptId) continue;
    const overlap = Array.isArray(r.scopes) && (r.scopes as string[]).some((s) => scopes.includes(s));
    if (overlap) {
      await tx.update(aiExtractorsTable).set({ isDefault: false }).where(eq(aiExtractorsTable.id, r.id));
    }
  }
}

// Create
router.post(
  "/ai-extractors",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  configJsonBody,
  async (req, res): Promise<void> => {
    const parsed = extractorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    if (Buffer.byteLength(JSON.stringify(data), "utf8") > 131_072) {
      res.status(413).json({ error: "AI extractor configuration exceeds 128 KiB" });
      return;
    }
    try {
      const row = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ai-extractor-management'), 0)`);
        if (data.isDefault) await clearOtherDefaultsForScopes(tx, data.scopes, null);
        const [created] = await tx.insert(aiExtractorsTable).values({
            name: data.name, slug: data.slug, description: data.description ?? null,
            provider: data.provider, model: data.model, systemPrompt: data.systemPrompt,
            systemPromptByLang: data.systemPromptByLang, fields: data.fields, rules: data.rules,
            scopes: data.scopes, documentTypes: data.documentTypes, temperature: String(data.temperature),
            maxTokens: data.maxTokens, isActive: data.isActive, isDefault: data.isDefault, createdBy: req.user!.id,
          }).returning();
        await tx.insert(auditLogsTable).values({ userId: req.user!.id, action: "create_ai_extractor", resource: "ai_extractor",
          resourceId: created.id, changes: JSON.stringify({ slug: created.slug, provider: created.provider, isActive: created.isActive, isDefault: created.isDefault }), ipAddress: req.ip || null });
        return created;
      });
      res.status(201).json({ extractor: row });
    } catch (e) {
      const msg = (e as Error).message;
      if (/unique|duplicate/i.test(msg)) {
        res.status(409).json({ error: "Slug already exists" });
        return;
      }
      res.status(503).json({ error: "AI_EXTRACTOR_OPERATION_UNAVAILABLE" });
    }
  },
);

// Update
router.put(
  "/ai-extractors/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  configJsonBody,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = extractorSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    if (Buffer.byteLength(JSON.stringify(data), "utf8") > 131_072) {
      res.status(413).json({ error: "AI extractor configuration exceeds 128 KiB" });
      return;
    }
    const updates: Record<string, unknown> = { ...data };
    if (data.temperature != null) updates.temperature = String(data.temperature);
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ai-extractor-management'), 0)`);
      const [current] = await tx.select().from(aiExtractorsTable).where(eq(aiExtractorsTable.id, id)).for("update");
      if (!current) return null;
      if (data.isDefault === true) {
        const scopes = data.scopes ?? current.scopes ?? [];
        await clearOtherDefaultsForScopes(tx, scopes as string[], id);
      }
      const [saved] = await tx.update(aiExtractorsTable).set(updates).where(eq(aiExtractorsTable.id, id)).returning();
      await tx.insert(auditLogsTable).values({ userId: req.user!.id, action: "update_ai_extractor", resource: "ai_extractor",
        resourceId: id, changes: JSON.stringify({ changedFields: Object.keys(data).sort(), slug: saved.slug, provider: saved.provider, isActive: saved.isActive, isDefault: saved.isDefault }), ipAddress: req.ip || null });
      return saved;
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ extractor: row });
  },
);

// Delete
router.delete(
  "/ai-extractors/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ai-extractor-management'), 0)`);
      const [current] = await tx.select().from(aiExtractorsTable).where(eq(aiExtractorsTable.id, id)).for("update");
      if (!current) return { status: "missing" as const };
      const [[run], [widget]] = await Promise.all([
        tx.select({ id: aiExtractorRunsTable.id }).from(aiExtractorRunsTable).where(eq(aiExtractorRunsTable.extractorId, id)).limit(1),
        tx.select({ id: embedWidgetsTable.id }).from(embedWidgetsTable).where(eq(embedWidgetsTable.aiExtractorId, id)).limit(1),
      ]);
      if (run || widget) return { status: "in_use" as const };
      await tx.delete(aiExtractorsTable).where(eq(aiExtractorsTable.id, id));
      await tx.insert(auditLogsTable).values({ userId: req.user!.id, action: "delete_ai_extractor", resource: "ai_extractor",
        resourceId: id, changes: JSON.stringify({ slug: current.slug, provider: current.provider }), ipAddress: req.ip || null });
      return { status: "deleted" as const };
    });
    if (result.status === "in_use") {
      res.status(409).json({ error: "AI_EXTRACTOR_IN_USE", message: "Deactivate this extractor instead of deleting evidence or active references." });
      return;
    }
    const row = result.status === "deleted" ? { id } : null;
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// Test run (does not persist run)
router.post(
  "/ai-extractors/:id/test",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  jsonBody,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const ext = await getExtractorById(id);
    if (!ext) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { documents, lang } = req.body as {
      documents: Array<{ type: "image" | "pdf"; data: string; mediaType: string; label: string }>;
      lang?: string;
    };
    if (!Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: "No documents provided" });
      return;
    }
    if (ext.provider !== "anthropic") {
      res.status(400).json({
        error: `Provider "${ext.provider}" is not yet wired into the runtime. Switch the provider to "anthropic" or contact engineering to enable additional providers.`,
      });
      return;
    }
    let anthropic;
    try {
      anthropic = await getAnthropicClient();
      await getClaudeConfig();
    } catch (e: any) {
      res.status(503).json({ error: e?.message || "AI integration not configured" });
      return;
    }
    const prompt = buildExtractionPrompt(ext, { lang });
    const content: any[] = [{ type: "text", text: prompt }];
    for (const d of documents.slice(0, 4)) {
      content.push({ type: "text", text: `\n--- Document: ${d.label} ---` });
      if (d.type === "image") {
        const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        const mt = allowed.includes(d.mediaType) ? d.mediaType : "image/jpeg";
        content.push({ type: "image", source: { type: "base64", media_type: mt, data: d.data } });
      } else {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data } });
      }
    }
    const start = Date.now();
    try {
      const msg = await anthropic.messages.create({
        model: ext.model,
        max_tokens: ext.maxTokens,
        messages: [{ role: "user", content }],
      });
      const text = msg.content.find((b: any) => b.type === "text") as any;
      let extracted: any = {};
      try {
        const match = text?.text?.match(/\{[\s\S]*\}/);
        if (match) extracted = JSON.parse(match[0]);
      } catch {}
      // apply normalize rules
      for (const f of ext.fields as any[]) {
        if (f.normalize === "gpa100" && extracted[f.key] != null && extracted[f.key] !== "") {
          const pct = normalizeGpaEvidenceTo100(String(extracted[f.key]));
          if (!isNaN(pct)) {
            extracted[`${f.key}Raw`] = extracted[f.key];
            extracted[f.key] = (Math.round(pct * 10) / 10).toString();
            extracted[`${f.key}Scale`] = 100;
          }
        }
      }
      res.json({
        extracted,
        prompt,
        usage: {
          promptTokens: (msg as any).usage?.input_tokens ?? null,
          completionTokens: (msg as any).usage?.output_tokens ?? null,
          latencyMs: Date.now() - start,
          model: ext.model,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Extraction failed" });
    }
  },
);

// Recent runs (for detail page)
router.get(
  "/ai-extractors/:id/runs",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const runs = await db
      .select()
      .from(aiExtractorRunsTable)
      .where(eq(aiExtractorRunsTable.extractorId, id))
      .orderBy(desc(aiExtractorRunsTable.createdAt))
      .limit(50);
    const [agg] = await db
      .select({
        totalRuns: sql<number>`count(*)::int`,
        totalPromptTokens: sql<number>`coalesce(sum(${aiExtractorRunsTable.promptTokens}),0)::int`,
        totalCompletionTokens: sql<number>`coalesce(sum(${aiExtractorRunsTable.completionTokens}),0)::int`,
      })
      .from(aiExtractorRunsTable)
      .where(eq(aiExtractorRunsTable.extractorId, id));
    res.json({ runs, summary: agg });
  },
);

export default router;
