// AI Agent Faz 2 — embeddings + chunking for the RAG knowledge pipeline.
//
// Embeddings are called DIRECTLY against the OpenAI API using OPENAI_API_KEY.
// The Replit AI Integrations proxy client (used elsewhere for chat) does NOT
// support the embeddings endpoint, so this module intentionally uses the raw
// `openai` SDK with the real API key instead of the proxy.
import OpenAI from "openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

let client: OpenAI | null = null;
function getOpenAiClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured — Faz 2 knowledge sources require it for embeddings.");
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// Chunking target: ~1000 characters (~250 tokens) per chunk with 150-char
// overlap so a fact that straddles a chunk boundary is still fully present in
// at least one chunk. Character-based (not token-based) chunking keeps this
// dependency-free; it's an approximation, good enough for retrieval quality.
const CHUNK_SIZE_CHARS = 1000;
const CHUNK_OVERLAP_CHARS = 150;

/**
 * Split normalized text into overlapping chunks. Splits on paragraph/sentence
 * boundaries where possible so chunks stay semantically coherent; falls back
 * to a hard cut when a single paragraph exceeds the chunk size.
 */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > CHUNK_SIZE_CHARS) {
      flush();
      // Hard-wrap an oversized paragraph with overlap.
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + CHUNK_SIZE_CHARS, para.length);
        chunks.push(para.slice(start, end).trim());
        if (end >= para.length) break;
        start = end - CHUNK_OVERLAP_CHARS;
      }
      continue;
    }
    if ((current + "\n\n" + para).length > CHUNK_SIZE_CHARS && current) {
      flush();
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();

  return chunks.filter((c) => c.length > 0);
}

/** Rough token-count estimate (chars/4) — used only for admin display, never billing. */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Embed a batch of text chunks in one OpenAI API call. Batches beyond 96
 * inputs are split to stay well under the API's request-size limits.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = getOpenAiClient();
  const BATCH = 96;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    for (const item of response.data) {
      results.push(item.embedding);
    }
  }
  return results;
}

/** Embed a single query string (e.g. the student's inbound message). */
export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
