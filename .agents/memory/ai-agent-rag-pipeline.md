---
name: AI Agent Faz 2 RAG pipeline
description: Knowledge-source ingestion (PDF/docx/xlsx/url/text) → chunk → embed (pgvector) → retrieval injected into bot system prompt.
---

Architecture: `knowledgeExtract.ts` (format-specific text extraction) → `knowledgeEmbed.ts` (chunk + OpenAI embeddings) → `knowledgeIngest.ts` (orchestrator, sets status pending/processing/ready/error) → `knowledgeChunksTable` (pgvector `vector(1536)`, ivfflat cosine index) → `knowledgeRetrieval.ts` (top-K cosine `<=>` search, MAX_DISTANCE cutoff, never throws) → `botBrain.ts` injects a guarded "Retrieved excerpts" block into the system prompt.

**Why:** keeps retrieval failure-safe (bot must still reply if RAG has no hits or embedding API is down) and keeps ingestion synchronous-enough for admins to see status without a queue.

**How to apply:** any new knowledge source type must go through the same extract→ingest pipeline, not a bespoke path; both live-reply (`maybeAutoReply`) and the admin test endpoint (`runBotReplyTest`) must call retrieval before building the prompt, or one path silently loses RAG context.

pdf-parse v2.x quirk: no default export — use `const { PDFParse } = await import("pdf-parse"); const p = new PDFParse({ data: buffer }); const { text } = await p.getText(); await p.destroy();`. The v1 `pdf(buffer)` functional API is gone.

jsdom needs `@types/jsdom` as an explicit devDependency for tsc — the runtime package doesn't ship its own types under this pnpm resolution.
