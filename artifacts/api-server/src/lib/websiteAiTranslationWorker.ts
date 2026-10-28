import { auditLogsTable, db, settingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { readWebsiteCatalogInventory } from "./websiteCatalogInventory";
import { mergeWebsiteAiSettings, readWebsiteAiSettings } from "./websiteAiContentPolicy";
import { enqueueWebsiteTranslations } from "./websiteTranslationQueue";

const POLL_MS = 15 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const [row] = await db.select().from(settingsTable).limit(1);
    if (!row) return;
    const settings = readWebsiteAiSettings(row.featureFlags);
    const now = new Date();
    if (!settings.enabled || !settings.automaticTranslationEnabled || now.getUTCHours() < settings.automaticRunHourUtc) return;
    const flags = (row.featureFlags && typeof row.featureFlags === "object" && !Array.isArray(row.featureFlags) ? row.featureFlags : {}) as Record<string, any>;
    const runtime = flags.aiContentTranslationRuntime && typeof flags.aiContentTranslationRuntime === "object" ? flags.aiContentTranslationRuntime : {};
    const today = now.toISOString().slice(0, 10);
    if (runtime.lastRunDate === today) return;
    const kinds = settings.allowedKinds.filter(kind => ["country", "city", "university", "program"].includes(kind)) as Array<"country" | "city" | "university" | "program">;
    const locales = settings.allowedLocales.filter(locale => locale !== "en") as any[];
    if (!kinds.length || !locales.length) return;
    const cursor = Number.isInteger(runtime.cursor) ? runtime.cursor : 0;
    const combinations = kinds.flatMap(kind => locales.map(locale => ({ kind, locale })));
    const selected = combinations[cursor % combinations.length];
    const pages = runtime.pages && typeof runtime.pages === "object" ? runtime.pages as Record<string, number> : {};
    const combinationKey = `${selected.kind}:${selected.locale}`;
    const requestedPage = Number.isInteger(pages[combinationKey]) && pages[combinationKey] > 0 ? pages[combinationKey] : 1;
    const batchSize = Math.min(50, settings.automaticBatchSize, settings.dailyRequestLimit, Math.max(1, Math.floor(settings.dailyEstimatedTokenLimit / 4_000)));
    const inventory = await readWebsiteCatalogInventory({ kind: selected.kind, locale: selected.locale, q: "", page: requestedPage, pageSize: batchSize, sort: "updated_desc" });
    const actor = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "super_admin")).orderBy(usersTable.id).limit(1);
    if (!actor[0]) return;
    const detailKind = selected.kind === "country" ? "destination" : selected.kind;
    const queued = await enqueueWebsiteTranslations({ kind: detailKind, entityIds: inventory.items.map(item => item.sourceId), locales: [selected.locale], actorId: actor[0].id });
    await db.transaction(async tx => {
      const [locked] = await tx.select().from(settingsTable).where(eq(settingsTable.id, row.id)).for("update");
      const currentFlags = (locked.featureFlags && typeof locked.featureFlags === "object" && !Array.isArray(locked.featureFlags) ? locked.featureFlags : {}) as Record<string, unknown>;
      const finishedCombination = requestedPage >= Math.max(1, inventory.pagination.totalPages);
      const nextPages = { ...pages, [combinationKey]: finishedCombination ? 1 : requestedPage + 1 };
      await tx.update(settingsTable).set({ featureFlags: { ...mergeWebsiteAiSettings(currentFlags, settings), aiContentTranslationRuntime: { lastRunDate: today, lastRunAt: now.toISOString(), cursor: finishedCombination ? (cursor + 1) % combinations.length : cursor, pages: nextPages, kind: selected.kind, locale: selected.locale, page: requestedPage, queued: queued.queued, batchId: queued.batchId } } }).where(eq(settingsTable.id, row.id));
      await tx.insert(auditLogsTable).values({ userId: actor[0].id, action: "website_ai_translation_schedule", resource: "website_translation_batch", changes: JSON.stringify({ batchId: queued.batchId, kind: selected.kind, locales: [selected.locale], queued: queued.queued, publication: "draft_only" }) });
    });
  } catch (error) { console.warn("[website-ai-translation] scheduled draft batch failed", error); }
  finally { running = false; }
}

export function startWebsiteAiTranslationWorker(): () => void {
  timer = setInterval(() => void tick(), POLL_MS);
  timer.unref?.();
  void tick();
  return () => { if (timer) clearInterval(timer); timer = null; };
}
