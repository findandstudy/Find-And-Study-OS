import crypto from "node:crypto";
import { auditLogsTable, db, integrationsTable, pool, settingsTable, usersTable, websiteTranslationJobsTable } from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { decryptConfig, isEncrypted } from "./encryption";
import { AiContentService } from "./aiService";
import { readWebsiteAiSettings } from "./websiteAiContentPolicy";
import { regenerateDetailContentDraft } from "./websiteDetailRegeneration";
import { publishDetailContentDraft, readDetailContentDraft } from "./websiteDetailContent";
import { invalidatePublicCatalogRenderCache } from "./publicCatalogRenderReadModel";

type QueueKind = "destination" | "city" | "university" | "program";
type Claimed = { id: number; kind: QueueKind; entityId: number; locale: string; attempts: number; createdBy: number; provider: string | null; model: string | null; phase: "translate" | "publish"; reviewedBy: number | null; generatedPageId: number | null; generatedDigest: string | null };

async function settingsAndProvider(job?: Claimed, forceFallback = false) {
  const [row] = await db.select({ featureFlags: settingsTable.featureFlags }).from(settingsTable).limit(1);
  const settings = readWebsiteAiSettings(row?.featureFlags);
  const rows = await db.select().from(integrationsTable).where(inArray(integrationsTable.key, ["openai", "claude"]));
  const preferred = job?.provider === "anthropic" ? "claude" : job?.provider === "openai" ? "openai" : settings.provider;
  const keys = preferred === "openai" ? ["openai"] : preferred === "claude" ? ["claude"] : ["openai", "claude"];
  const canaryBucket = job
    ? Number.parseInt(crypto.createHash("sha256").update(`${job.id}:${job.kind}:${job.entityId}:${job.locale}`).digest("hex").slice(0, 8), 16) % 100
    : 100;
  const configuredModel = !job?.model && settings.candidateModel && canaryBucket < settings.candidateTrafficPercent
    ? settings.candidateModel
    : settings.modelOverride;
  for (const key of keys) {
    const integration = rows.find(item => item.key === key && item.isEnabled);
    if (!integration) continue;
    const config = decryptConfig(integration.config as Record<string, string>);
    if (!config.apiKey || isEncrypted(config.apiKey)) continue;
    const model = forceFallback && settings.fallbackModel ? settings.fallbackModel : job?.model || configuredModel || config.model || undefined;
    return { settings, service: new AiContentService({ provider: key === "openai" ? "openai" : "anthropic", apiKey: config.apiKey, model, temperature: settings.temperature, guidance: settings.editorialGuidance || undefined, qualityMode: settings.qualityMode }), provider: key === "openai" ? "openai" : "anthropic", model: model || "provider-default" };
  }
  return { settings, service: null, provider: null, model: null };
}

export async function readWebsiteTranslationProviderStatus(): Promise<{
  configured: boolean;
  provider: string | null;
  model: string | null;
}> {
  const resolved = await settingsAndProvider();
  return {
    configured: resolved.settings.enabled && !!resolved.service,
    provider: resolved.provider,
    model: resolved.model,
  };
}

export async function enqueueWebsiteTranslations(input: { kind: QueueKind; entityIds: number[]; locales: string[]; actorId: number }) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('website-translation-enqueue-budget'))`);
    const [row] = await tx.select({ featureFlags: settingsTable.featureFlags }).from(settingsTable).limit(1);
    const settings = readWebsiteAiSettings(row?.featureFlags);
    const publicKind = input.kind === "destination" ? "country" : input.kind;
    if (!settings.enabled || !settings.allowedKinds.includes(publicKind) || input.locales.some(locale => !settings.allowedLocales.includes(locale) || locale === "en")) throw new Error("POLICY_DENIED");
    if (input.entityIds.length * input.locales.length > 500) throw new Error("BATCH_TOO_LARGE");
    const [recent, [pending]] = await Promise.all([
      tx.select({ changes: auditLogsTable.changes }).from(auditLogsTable).where(and(eq(auditLogsTable.action, "website_ai_content_execute"), gte(auditLogsTable.createdAt, new Date(Date.now() - 86_400_000)))),
      tx.select({ count: sql<number>`count(*)::int` }).from(websiteTranslationJobsTable).where(inArray(websiteTranslationJobsTable.status, ["queued", "processing", "retrying"])),
    ]);
    let requests = 0, estimatedTokens = 0;
    for (const entry of recent) try { const value = JSON.parse(entry.changes || "{}"); requests += Number(value.requests ?? 1); estimatedTokens += Number(value.estimatedTokens ?? 0); } catch { requests += 1; }
    const requested = input.entityIds.length * input.locales.length;
    const callsPerJob = settings.fallbackModel ? 2 : 1;
    const reserved = Number(pending?.count || 0) * callsPerJob;
    const requestedCalls = requested * callsPerJob;
    if (requests + reserved + requestedCalls > settings.dailyRequestLimit || estimatedTokens + (reserved + requestedCalls) * 4_000 > settings.dailyEstimatedTokenLimit) throw new Error("BUDGET_EXCEEDED");
    const batchId = crypto.randomUUID();
    const values = input.entityIds.flatMap(entityId => input.locales.map(locale => ({ batchId, kind: input.kind, entityId, locale, qualityMode: settings.qualityMode, createdBy: input.actorId })));
    const inserted = values.length ? await tx.insert(websiteTranslationJobsTable).values(values).onConflictDoNothing().returning({ id: websiteTranslationJobsTable.id }) : [];
    await tx.insert(auditLogsTable).values({ userId: input.actorId, action: "website_translation_batch_enqueue", resource: "website_translation_batch", changes: JSON.stringify({ batchId, kind: input.kind, entityCount: input.entityIds.length, locales: input.locales, queued: inserted.length }) });
    return { batchId, queued: inserted.length };
  });
}

export async function claimWebsiteTranslation(workerId: string): Promise<Claimed | null> {
  const result = await pool.query<any>(`WITH candidate AS (
    SELECT id, status AS original_status FROM website_translation_jobs
     WHERE (status='publish_queued' OR (status='publishing' AND lease_expires_at <= now()) OR (attempts < 8 AND ((status IN ('queued','retrying') AND next_attempt_at <= now()) OR (status='processing' AND lease_expires_at <= now()))))
     ORDER BY CASE WHEN status IN ('processing','publishing') THEN 0 WHEN status='publish_queued' THEN 1 ELSE 2 END, next_attempt_at, id
     FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE website_translation_jobs job SET status=CASE WHEN candidate.original_status IN ('publish_queued','publishing') THEN 'publishing' ELSE 'processing' END, attempts=CASE WHEN candidate.original_status IN ('publish_queued','publishing') THEN job.attempts ELSE job.attempts+1 END, leased_at=now(), lease_expires_at=now()+interval '3 minutes', worker_id=$1, error_code=NULL, updated_at=now()
    FROM candidate WHERE job.id=candidate.id RETURNING job.id, job.kind, job.entity_id, job.locale, job.attempts, job.created_by, job.provider, job.model, CASE WHEN candidate.original_status IN ('publish_queued','publishing') THEN 'publish' ELSE 'translate' END AS phase, job.reviewed_by, job.generated_page_id, job.generated_digest`, [workerId]);
  const row = result.rows[0];
  return row ? { id: row.id, kind: row.kind, entityId: row.entity_id, locale: row.locale, attempts: row.attempts, createdBy: row.created_by, provider: row.provider, model: row.model, phase: row.phase, reviewedBy: row.reviewed_by, generatedPageId: row.generated_page_id, generatedDigest: row.generated_digest } : null;
}

async function markFailure(job: Claimed, workerId: string, code: string, retryable: boolean, maxAttempts: number, providerCalls: number) {
  const delay = [30, 120, 600, 1800, 7200, 21600, 43200][Math.min(job.attempts - 1, 6)];
  const status = retryable && job.attempts < maxAttempts ? "retrying" : "failed";
  await pool.query(`UPDATE website_translation_jobs SET status=$3,error_code=$4,next_attempt_at=CASE WHEN $3='retrying' THEN now()+make_interval(secs=>$5) ELSE next_attempt_at END,leased_at=NULL,lease_expires_at=NULL,worker_id=NULL,updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='processing'`, [job.id, workerId, status, code, delay]);
  await db.insert(auditLogsTable).values({ userId: job.createdBy, action: "website_ai_content_execute", resource: "website_translation_job", resourceId: job.id, changes: JSON.stringify({ operation: "queued_translation", kind: job.kind, locales: [job.locale], requests: providerCalls, estimatedTokens: providerCalls * 4_000, succeeded: 0, failed: 1, provider: job.provider, model: job.model, errorCode: code, retrying: status === "retrying", publication: "draft_only" }) });
}

export async function processWebsiteTranslation(job: Claimed, workerId: string) {
  if (job.phase === "publish") {
    try {
      if (!job.reviewedBy || !job.generatedPageId || !job.generatedDigest) throw new Error("APPROVAL_MISSING");
      const [reviewer] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, job.reviewedBy)).limit(1);
      await publishDetailContentDraft(job.generatedPageId, job.generatedDigest, job.reviewedBy, reviewer?.role === "super_admin");
      await pool.query(`UPDATE website_translation_jobs SET status='published',error_code=NULL,leased_at=NULL,lease_expires_at=NULL,worker_id=NULL,updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='publishing'`, [job.id, workerId]);
      invalidatePublicCatalogRenderCache({ detailTemplate: job.kind });
    } catch (error) {
      await pool.query(`UPDATE website_translation_jobs SET status='approved',error_code=$3,leased_at=NULL,lease_expires_at=NULL,worker_id=NULL,updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='publishing'`, [job.id, workerId, error instanceof Error ? error.message.slice(0, 120) : "PUBLISH_FAILED"]);
    }
    return;
  }
  let resolved = await settingsAndProvider(job);
  if (!resolved.settings.enabled || !resolved.service) { await markFailure(job, workerId, "PROVIDER_UNAVAILABLE", true, resolved.settings.maxAttempts, 0); return; }
  let providerCalls = 0;
  try {
    await pool.query(`UPDATE website_translation_jobs SET provider=coalesce(provider,$3),model=coalesce(model,$4),updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='processing'`, [job.id, workerId, resolved.provider, resolved.model]);
    providerCalls += 1;
    let result = await regenerateDetailContentDraft({ kind: job.kind, entityId: job.entityId, locale: job.locale, actorId: job.createdBy, ai: resolved.service, mode: "regenerate" });
    if (result.status === "preserved" || result.error === "SOURCE_NOT_FOUND") providerCalls = 0;
    const fallbackEligible = result.status === "failed" && ["UNAVAILABLE", "INVALID_GENERATED_CONTENT"].includes(result.error || "");
    if (fallbackEligible && resolved.settings.fallbackModel && resolved.model !== resolved.settings.fallbackModel) {
      resolved = await settingsAndProvider(job, true);
      if (!resolved.service) throw new Error(result.error || "GENERATION_FAILED");
      await pool.query(`UPDATE website_translation_jobs SET model=$3,updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='processing'`, [job.id, workerId, resolved.model]);
      providerCalls += 1;
      result = await regenerateDetailContentDraft({ kind: job.kind, entityId: job.entityId, locale: job.locale, actorId: job.createdBy, ai: resolved.service, mode: "regenerate" });
    }
    if (result.status === "failed" || !result.pageId) throw new Error(result.error || "GENERATION_FAILED");
    const draft = await readDetailContentDraft(job.kind, job.entityId, job.locale);
    if (!draft.pageId || !draft.digest) throw new Error("DRAFT_MISSING");
    await pool.query(`UPDATE website_translation_jobs SET status='review_required',provider=$3,model=$4,generated_page_id=$5,generated_digest=$6,error_code=NULL,leased_at=NULL,lease_expires_at=NULL,worker_id=NULL,updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='processing'`, [job.id, workerId, resolved.provider, resolved.model, draft.pageId, draft.digest]);
    await db.insert(auditLogsTable).values({ userId: job.createdBy, action: "website_ai_content_execute", resource: "website_translation_job", resourceId: job.id, changes: JSON.stringify({ operation: "queued_translation", kind: job.kind, locales: [job.locale], requests: providerCalls, estimatedTokens: providerCalls * 4_000, succeeded: 1, failed: 0, provider: resolved.provider, model: resolved.model, publication: "draft_only" }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNEXPECTED";
    const retryable = !["SOURCE_NOT_FOUND", "INVALID_CONTENT", "INVALID_GENERATED_CONTENT", "POLICY_DENIED"].includes(message);
    await markFailure(job, workerId, message.slice(0, 120), retryable, resolved.settings.maxAttempts, providerCalls);
  }
}

export function startWebsiteTranslationQueueWorker() {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = 0;
  let concurrency = 2;
  let refreshAfter = 0;
  const workerId = `website-translation-${process.pid}-${crypto.randomUUID()}`;
  const tick = async () => {
    if (Date.now() >= refreshAfter) {
      const [row] = await db.select({ featureFlags: settingsTable.featureFlags }).from(settingsTable).limit(1);
      concurrency = readWebsiteAiSettings(row?.featureFlags).workerConcurrency;
      refreshAfter = Date.now() + 30_000;
    }
    while (inFlight < concurrency) {
      const job = await claimWebsiteTranslation(workerId);
      if (!job) break;
      inFlight += 1;
      void processWebsiteTranslation(job, workerId).finally(() => { inFlight -= 1; });
    }
  };
  timer = setInterval(() => void tick().catch(error => console.warn("[website-translation] queue tick failed", error)), 1_000); timer.unref?.(); void tick().catch(error => console.warn("[website-translation] initial queue tick failed", error));
  return () => { if (timer) clearInterval(timer); timer = null; };
}
