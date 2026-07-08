// AI Agent Faz 2 — ingestion orchestrator: extract → chunk → embed → store.
// Runs for a single knowledge_sources row (type='file'|'url'|'text') and is
// safe to re-run (reprocess replaces the row's chunks). Best-effort: any
// failure is recorded as status='error' with a message, never thrown to a
// caller that fired this fire-and-forget after an admin create/reprocess call.
import { db, knowledgeSourcesTable, knowledgeChunksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  extractFileText,
  extractUrlText,
  extractPlainText,
  type FileSourceConfig,
  type UrlSourceConfig,
  type TextSourceConfig,
} from "./knowledgeExtract";
import { chunkText, embedTexts, estimateTokenCount } from "./knowledgeEmbed";

const MAX_SOURCE_CHARS = 400_000; // guard against runaway ingestion cost

export async function ingestKnowledgeSource(sourceId: number): Promise<void> {
  const [source] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(eq(knowledgeSourcesTable.id, sourceId));
  if (!source) return;

  await db
    .update(knowledgeSourcesTable)
    .set({ status: "processing" })
    .where(eq(knowledgeSourcesTable.id, sourceId));

  try {
    const config = (source.config ?? {}) as Record<string, unknown>;
    let text = "";
    let extra: Record<string, unknown> = {};

    if (source.type === "file") {
      const fileConfig = config as unknown as FileSourceConfig;
      text = await extractFileText(fileConfig);
    } else if (source.type === "url") {
      const urlConfig = config as unknown as UrlSourceConfig;
      const result = await extractUrlText(urlConfig);
      text = result.text;
      extra = { title: result.title };
    } else if (source.type === "text") {
      const textConfig = config as unknown as TextSourceConfig;
      text = extractPlainText(textConfig);
    } else {
      throw new Error(`ingestKnowledgeSource called for unsupported type: ${source.type}`);
    }

    text = text.trim();
    if (!text) {
      throw new Error("No extractable text found in this source.");
    }
    if (text.length > MAX_SOURCE_CHARS) {
      text = text.slice(0, MAX_SOURCE_CHARS);
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error("Text could not be split into chunks.");
    }

    const embeddings = await embedTexts(chunks);

    await db.transaction(async (tx) => {
      await tx.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceId, sourceId));
      for (let i = 0; i < chunks.length; i++) {
        await tx.insert(knowledgeChunksTable).values({
          sourceId,
          content: chunks[i],
          embedding: embeddings[i],
          tokenCount: estimateTokenCount(chunks[i]),
          chunkIndex: i,
          metadata: {},
        });
      }
      await tx
        .update(knowledgeSourcesTable)
        .set({
          status: "ready",
          lastSyncedAt: new Date(),
          config: { ...config, ...extra, extractedChars: text.length, chunkCount: chunks.length },
        })
        .where(eq(knowledgeSourcesTable.id, sourceId));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown ingestion error";
    console.error(`[knowledge-ingest] source #${sourceId} failed:`, message);
    await db
      .update(knowledgeSourcesTable)
      .set({ status: "error", config: { ...(source.config as Record<string, unknown>), error: message } })
      .where(eq(knowledgeSourcesTable.id, sourceId));
  }
}

/**
 * Fire-and-forget wrapper for use in request handlers — never delays the HTTP
 * response on extraction/embedding latency (a PDF or a slow URL can take
 * several seconds). Errors are already handled inside ingestKnowledgeSource.
 */
export function triggerKnowledgeIngest(sourceId: number): void {
  ingestKnowledgeSource(sourceId).catch((err) => {
    console.error(`[knowledge-ingest] unexpected top-level failure for source #${sourceId}:`, err);
  });
}
