import { Router, type IRouter } from "express";
import {
  db,
  pool,
  conversationsTable,
  conversationParticipantsTable,
  messagesTable,
  messageReactionsTable,
  externalContactsTable,
  leadsTable,
  studentsTable,
  agentsTable,
  usersTable,
  messageTemplatesTable,
  pipelineStagesTable,
  notesTable,
  followUpsTable,
  channelAccountsTable,
  integrationsTable,
  documentsTable,
} from "@workspace/db";
import type { ConversationAiSummary } from "@workspace/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { ExternalContact } from "@workspace/db";
import { z } from "zod";
import { RateLimiterPostgres } from "rate-limiter-flexible";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";
import { validate, getValidated } from "../middlewares/validate";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { toLatinUpper, normalizePhoneField, containsNonLatinLetter, NON_LATIN_NAME_CODE } from "../lib/textNormalize";
import { STAFF_ROLES, ADMIN_ROLES, isAgentRole } from "../lib/roles";
import { resolveIdentity } from "../lib/inbox/identityResolver";
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  isWithin24hWindow,
  type WhatsAppConfig,
} from "../lib/inbox/channels/whatsapp";
import { sendMessengerText, type MessengerConfig } from "../lib/inbox/channels/messenger";
import { sendInstagramText, type InstagramConfig } from "../lib/inbox/channels/instagram";
import { isLiveIntegrationsEnabled } from "../lib/inbox/liveMode";
import { directOrigin } from "../lib/originHelper";
import { applyLeadAssignmentRules, cascadeLeadAssignment, cascadeStudentAssignment } from "../lib/leadAssignment";
import { userHasPermission } from "../lib/permissions";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { sendEmail } from "../lib/email";
import { resolveOutboundConfig } from "../lib/inbox/channelAccountConfig";
import { decryptConfig } from "../lib/encryption";
import { sendViaZernio, getZernioApiKey, resolveZernioAccount, sendZernioTemplate } from "../lib/inbox/zernioSend";
import { toE164 } from "../lib/inbox/phone";
import { parseContentDispositionFilename, persistAttachmentMeta, backfillConversationAttachmentNames } from "../lib/inbox/attachmentNames";
import { getChainOwner, syncConversationOwner, loadLink } from "../lib/inbox/assignmentSync";
import {
  listZernioWhatsAppTemplates,
  createZernioWhatsAppTemplate,
  deleteZernioWhatsAppTemplate,
  resolveZernioWhatsAppAccount,
} from "../lib/inbox/zernioTemplates";
import { sendZernioConversationMessage } from "../lib/inbox/outboundMessage";
import { inboxBus, type InboxBusEvent } from "../lib/inbox/eventBus";
import {
  getAiAgentConfig,
  writeAiAgentConfig,
  aiAgentConfigPatchSchema,
} from "../lib/inbox/aiAgentConfig";
import { runBotReplyTest } from "../lib/inbox/botAutoReply";
import {
  getProgramScopeSource,
  writeProgramScopeSource,
} from "../lib/inbox/knowledgeSources";
import {
  listRagSources,
  createRagSource,
  updateRagSource,
  deleteRagSource,
  reprocessRagSource,
} from "../lib/inbox/knowledgeSourcesAdmin";
import { ObjectStorageService } from "../lib/objectStorage";
import { validateUploadedFile, validateUploadedFileBuffer, sanitizeFileName } from "../lib/fileUploadValidation";
import { buildDocNameFromParts } from "../lib/docNaming";
import { writeAudit } from "../lib/auditLog";
import { recomputeStudentPhoto } from "../lib/studentPhoto";
import { META_API_VERSION } from "../lib/inbox/channels/meta-shared";

const router: IRouter = Router();

// Channels governed by Meta's 24h messaging window: free-form replies are only
// allowed within 24h of the last inbound message. WhatsApp, Messenger and
// Instagram all share this policy.
const CHANNELS_WITH_24H_WINDOW = new Set(["whatsapp", "messenger", "instagram"]);

// ---------------------------------------------------------------------------
// Inbox AI / notes / tasks helpers (Phase 2)
// ---------------------------------------------------------------------------

// Per-user rate limit for the AI summarize endpoint. Anthropic calls cost
// money and are slow, so each staff/admin user gets 10 summarize requests
// per minute. Shares the same `rate_limits` table as auth.ts; isolated by
// `keyPrefix`.
const summarizeRateLimiter = new RateLimiterPostgres({
  storeClient: pool,
  storeType: "pool",
  tableName: "rate_limits",
  keyPrefix: "inbox-summarize",
  points: 10,
  duration: 60,
});

function isAiSummary(value: unknown): value is ConversationAiSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.content === "string" &&
    typeof v.generatedAt === "string" &&
    typeof v.messageCount === "number" &&
    typeof v.model === "string" &&
    typeof v.generatedByUserId === "number"
  );
}

function readAiSummary(metadata: unknown): ConversationAiSummary | null {
  if (!metadata || typeof metadata !== "object") return null;
  const md = metadata as Record<string, unknown>;
  return isAiSummary(md.aiSummary) ? md.aiSummary : null;
}

// Injection seam: the AI summarize endpoint calls `generateConversationSummary`,
// which by default goes to Anthropic via `defaultGenerateSummary`. Tests can
// override `__aiSummaryOverride` to assert cache behavior without spending
// tokens or needing a live API key.
export interface SummarizeInput {
  messages: Array<{ direction: string; content: string; createdAt: Date | string | null }>;
}
let __aiSummaryOverride:
  | ((input: SummarizeInput) => Promise<{ content: string; model: string }>)
  | null = null;
export function __setAiSummaryOverrideForTests(
  fn: ((input: SummarizeInput) => Promise<{ content: string; model: string }>) | null,
): void {
  __aiSummaryOverride = fn;
}

const SUMMARIZE_MODEL = "claude-haiku-4-5-20251001";

async function defaultGenerateSummary(input: SummarizeInput): Promise<{ content: string; model: string }> {
  const anthropic = await getAnthropicClient();
  const transcript = input.messages
    .map((m) => {
      const who = m.direction === "inbound" ? "Customer" : m.direction === "outbound" ? "Agent" : "Internal";
      return `[${who}] ${m.content}`;
    })
    .join("\n");
  const systemPrompt =
    "You are a CRM assistant. Summarize the following customer conversation for staff " +
    "in 3-5 sentences. Cover: (1) the customer's core need, (2) progress so far, " +
    "(3) suggested next action. Respond in the same language the customer is using.";
  const message = await anthropic.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: "user", content: transcript }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI returned no text content");
  }
  return { content: textBlock.text.trim(), model: SUMMARIZE_MODEL };
}

async function generateConversationSummary(input: SummarizeInput): Promise<{ content: string; model: string }> {
  return __aiSummaryOverride ? __aiSummaryOverride(input) : defaultGenerateSummary(input);
}

// Injection seam: the lead-suggestion endpoint calls `extractLeadFromTranscript`,
// which by default goes to Anthropic. Tests can override this to assert field
// extraction + lowConfidence flag behavior without spending tokens or needing a key.
export interface LeadExtractionInput {
  transcript: string;
}
export interface LeadExtractionResult {
  fullName: string | null;
  email: string | null;
  fullNameConfidence: "high" | "low";
  emailConfidence: "high" | "low";
}
let __aiLeadSuggestionOverride:
  | ((input: LeadExtractionInput) => Promise<LeadExtractionResult>)
  | null = null;
export function __setAiLeadSuggestionOverrideForTests(
  fn: ((input: LeadExtractionInput) => Promise<LeadExtractionResult>) | null,
): void {
  __aiLeadSuggestionOverride = fn;
}

const LEAD_EXTRACTION_SYSTEM =
  "You are a CRM data extractor. Extract contact information from the conversation. " +
  "Return ONLY valid JSON with this exact shape — no markdown, no explanation:\n" +
  '{ "fullName": string|null, "email": string|null, "fullNameConfidence": "high"|"low", "emailConfidence": "high"|"low" }\n' +
  '"high" = information is explicitly and clearly stated in the conversation.\n' +
  '"low" = inferred, ambiguous, or uncertain.';

async function extractLeadFromTranscript(input: LeadExtractionInput): Promise<LeadExtractionResult> {
  if (__aiLeadSuggestionOverride) return __aiLeadSuggestionOverride(input);
  const anthropic = await getAnthropicClient();
  const aiResponse = await anthropic.messages.create({
    model: LEAD_EXTRACTION_MODEL,
    max_tokens: 200,
    system: LEAD_EXTRACTION_SYSTEM,
    messages: [{ role: "user", content: `Conversation:\n${input.transcript}` }],
  });
  const textBlock = aiResponse.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("AI returned no text");
  const aiResultSchema = z.object({
    fullName: z.string().nullable(),
    email: z.string().nullable(),
    fullNameConfidence: z.enum(["high", "low"]),
    emailConfidence: z.enum(["high", "low"]),
  });
  return aiResultSchema.parse(JSON.parse(textBlock.text.trim()));
}

interface ConversationLink {
  conversationId: number;
  leadId: number | null;
  studentId: number | null;
}

async function loadConversationLink(id: number): Promise<ConversationLink | null> {
  const [conv] = await db
    .select({ id: conversationsTable.id, externalContactId: conversationsTable.externalContactId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));
  if (!conv) return null;
  if (!conv.externalContactId) {
    return { conversationId: id, leadId: null, studentId: null };
  }
  const [contact] = await db
    .select({ leadId: externalContactsTable.leadId, studentId: externalContactsTable.studentId })
    .from(externalContactsTable)
    .where(eq(externalContactsTable.id, conv.externalContactId));

  // Re-resolve the lead/student against their live (non-soft-deleted) state
  // so summarize/notes/tasks treat a soft-deleted entity as "no link" — same
  // 400 they already return for an unmatched conversation. This keeps deleted
  // personal data from being re-attached to new notes/tasks.
  let liveLeadId: number | null = null;
  if (contact?.leadId != null) {
    const [row] = await db
      .select({ id: leadsTable.id })
      .from(leadsTable)
      .where(and(eq(leadsTable.id, contact.leadId), isNull(leadsTable.deletedAt)));
    if (row) liveLeadId = row.id;
  }
  let liveStudentId: number | null = null;
  if (contact?.studentId != null) {
    const [row] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(and(eq(studentsTable.id, contact.studentId), isNull(studentsTable.deletedAt)));
    if (row) liveStudentId = row.id;
  }
  return {
    conversationId: id,
    leadId: liveLeadId,
    studentId: liveStudentId,
  };
}

router.get("/inbox/live-mode", requireAuth, async (_req, res): Promise<void> => {
  res.json({ live: isLiveIntegrationsEnabled() });
});

/**
 * Media proxy for inbound Zernio attachments.
 *
 * Zernio media URLs (zernio.com/api/v1/.../media/...) require a Bearer apiKey,
 * so a plain <img src> in the browser renders as a broken image. This endpoint
 * fetches the media server-side with the key and streams it back with the
 * correct Content-Type. The key never reaches the browser.
 *
 * Index addresses the SAME combined list the UI renders:
 * [metadata.attachment (if any), ...metadata.attachments].
 * Only zernio.com URLs are proxied (SSRF guard) — everything else 404s
 * because the client can already load those URLs directly.
 */
router.get(
  "/inbox/media/:messageId/:index",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const messageId = Number(req.params.messageId);
    const index = Number(req.params.index);
    if (!Number.isInteger(messageId) || !Number.isInteger(index) || index < 0 || index > 50) {
      res.status(400).json({ error: "Invalid message or attachment index" });
      return;
    }

    const [msg] = await db
      .select({ metadata: messagesTable.metadata })
      .from(messagesTable)
      .where(eq(messagesTable.id, messageId));
    if (!msg) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const meta = (msg.metadata ?? {}) as {
      attachment?: { url?: string; fileUrl?: string };
      attachments?: Array<{ url?: string; fileUrl?: string }>;
    };
    const allAtts = [
      ...(meta.attachment ? [meta.attachment] : []),
      ...(meta.attachments ?? []),
    ];
    const att = allAtts[index];
    const rawUrl = att?.url ?? att?.fileUrl ?? "";

    // SSRF guard: only proxy Zernio-hosted media.
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "zernio.com") {
      res.status(404).json({ error: "Attachment not proxied" });
      return;
    }

    const apiKey = await getZernioApiKey();
    if (!apiKey) {
      res.status(502).json({ error: "Zernio API key not configured" });
      return;
    }

    try {
      const upstream = await fetch(parsed.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: "follow",
      });
      if (!upstream.ok) {
        const body = await upstream.text().catch(() => "");
        console.error(`[ZERNIO] media proxy upstream ${upstream.status} for message ${messageId}[${index}]:`, body.slice(0, 300));
        res.status(upstream.status === 404 ? 404 : 502).json({ error: "Failed to fetch media" });
        return;
      }
      res.status(200);
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
      const len = upstream.headers.get("content-length");
      if (len) res.setHeader("Content-Length", len);
      res.setHeader("Cache-Control", "private, max-age=300");
      // Forward the upstream filename (RFC 5987 aware) so browser downloads
      // get the real name, and persist name+size onto message.metadata so the
      // UI stops showing generic labels. Both steps are best-effort and can
      // never break the proxy stream.
      try {
        const dispo = upstream.headers.get("content-disposition");
        const filename = parseContentDispositionFilename(dispo);
        if (dispo) res.setHeader("Content-Disposition", dispo);
        const sizeNum = Number(len);
        void persistAttachmentMeta(messageId, index, {
          name: filename,
          size: Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : null,
        });
      } catch { /* best-effort only */ }
      if (upstream.body) {
        const { Readable } = await import("node:stream");
        Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      console.error(`[ZERNIO] media proxy error for message ${messageId}[${index}]:`, err?.message || err);
      res.status(502).json({ error: "Failed to fetch media" });
    }
  },
);

/**
 * WhatsApp-Web-style PDF preview: renders page 1 of a PDF attachment to a
 * JPEG thumbnail on the server and caches it on disk. The client shows the
 * <img> instantly and only falls back to client-side pdfjs rendering when
 * this endpoint 404s. Same SSRF guard as the media proxy (zernio.com only).
 * Page count (best-effort via pdfinfo) is exposed as X-Pdf-Page-Count.
 */
router.get(
  "/inbox/media/:messageId/:index/pdf-thumb",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const messageId = Number(req.params.messageId);
    const index = Number(req.params.index);
    if (!Number.isInteger(messageId) || !Number.isInteger(index) || index < 0 || index > 50) {
      res.status(400).json({ error: "Invalid message or attachment index" });
      return;
    }

    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const cacheDir = path.join(os.tmpdir(), "edcons-pdf-thumbs");
    const thumbPath = path.join(cacheDir, `${messageId}-${index}.jpg`);
    const metaPath = path.join(cacheDir, `${messageId}-${index}.json`);

    const sendThumb = async (): Promise<boolean> => {
      try {
        const buf = await fs.readFile(thumbPath);
        let pages: number | null = null;
        try {
          const metaRaw = await fs.readFile(metaPath, "utf8");
          pages = (JSON.parse(metaRaw) as { pages?: number }).pages ?? null;
        } catch { /* meta is best-effort */ }
        res.status(200);
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "private, max-age=86400");
        if (pages && Number.isFinite(pages)) res.setHeader("X-Pdf-Page-Count", String(pages));
        res.end(buf);
        return true;
      } catch {
        return false;
      }
    };
    if (await sendThumb()) return;

    const [msg] = await db
      .select({ metadata: messagesTable.metadata })
      .from(messagesTable)
      .where(eq(messagesTable.id, messageId));
    if (!msg) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    const meta = (msg.metadata ?? {}) as {
      attachment?: { url?: string; fileUrl?: string };
      attachments?: Array<{ url?: string; fileUrl?: string }>;
    };
    const allAtts = [
      ...(meta.attachment ? [meta.attachment] : []),
      ...(meta.attachments ?? []),
    ];
    const rawUrl = allAtts[index]?.url ?? allAtts[index]?.fileUrl ?? "";

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "zernio.com") {
      res.status(404).json({ error: "Attachment not proxied" });
      return;
    }
    const apiKey = await getZernioApiKey();
    if (!apiKey) {
      res.status(502).json({ error: "Zernio API key not configured" });
      return;
    }

    let tmpPdf: string | null = null;
    let tmpOutBase: string | null = null;
    try {
      // Follow redirects manually so every hop stays on https://zernio.com (SSRF guard).
      let hopUrl = parsed;
      let upstream: Response | null = null;
      for (let hop = 0; hop < 4; hop++) {
        const r = await fetch(hopUrl.toString(), {
          headers: { Authorization: `Bearer ${apiKey}` },
          redirect: "manual",
        });
        if (r.status >= 300 && r.status < 400) {
          const loc = r.headers.get("location");
          if (!loc) break;
          let next: URL;
          try {
            next = new URL(loc, hopUrl);
          } catch {
            break;
          }
          if (next.protocol !== "https:" || next.hostname !== "zernio.com") {
            res.status(404).json({ error: "Attachment not proxied" });
            return;
          }
          hopUrl = next;
          continue;
        }
        upstream = r;
        break;
      }
      if (!upstream || !upstream.ok) {
        res.status(404).json({ error: "Failed to fetch media" });
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      // Only render actual PDFs (magic check) and cap at 25 MB.
      if (buf.length > 25 * 1024 * 1024 || !buf.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
        res.status(404).json({ error: "Not a renderable PDF" });
        return;
      }

      await fs.mkdir(cacheDir, { recursive: true });
      tmpPdf = path.join(cacheDir, `src-${messageId}-${index}-${Date.now()}.pdf`);
      tmpOutBase = path.join(cacheDir, `out-${messageId}-${index}-${Date.now()}`);
      await fs.writeFile(tmpPdf, buf);

      let rendered = false;
      try {
        await execFileAsync("pdftoppm", ["-jpeg", "-f", "1", "-l", "1", "-scale-to", "480", "-singlefile", tmpPdf, tmpOutBase], { timeout: 20000 });
        await fs.rename(`${tmpOutBase}.jpg`, thumbPath);
        rendered = true;
      } catch {
        // Fallback: ghostscript
        try {
          await execFileAsync("gs", ["-dSAFER", "-dBATCH", "-dNOPAUSE", "-dFirstPage=1", "-dLastPage=1", "-sDEVICE=jpeg", "-r72", `-sOutputFile=${tmpOutBase}.jpg`, tmpPdf], { timeout: 20000 });
          await fs.rename(`${tmpOutBase}.jpg`, thumbPath);
          rendered = true;
        } catch { /* both renderers failed */ }
      }
      if (!rendered) {
        res.status(404).json({ error: "Thumbnail render failed" });
        return;
      }

      // Best-effort page count for the "N pages" label.
      try {
        const { stdout } = await execFileAsync("pdfinfo", [tmpPdf], { timeout: 10000 });
        const m = /^Pages:\s+(\d+)/m.exec(stdout);
        if (m) await fs.writeFile(metaPath, JSON.stringify({ pages: Number(m[1]) }));
      } catch { /* label is optional */ }

      if (!(await sendThumb())) {
        res.status(404).json({ error: "Thumbnail render failed" });
      }
    } catch (err: any) {
      console.error(`[INBOX] pdf-thumb error for message ${messageId}[${index}]:`, err?.message || err);
      res.status(404).json({ error: "Thumbnail render failed" });
    } finally {
      if (tmpPdf) void fs.unlink(tmpPdf).catch(() => {});
      if (tmpOutBase) void fs.unlink(`${tmpOutBase}.jpg`).catch(() => {});
    }
  },
);

/**
 * Live inbox stream (Server-Sent Events). Pushes `inbox_message` and
 * `inbox_assigned` frames to the client so the UI can refresh without
 * polling. Payloads carry just enough context for the client to decide
 * what to refetch (the conversation list and, if open, the conversation
 * detail). The connection emits a named `heartbeat` event every 25s so the
 * client can both defeat idle proxies AND surface a "last update" timestamp
 * — staff see the indicator turn amber if no heartbeat arrives for > 60s,
 * catching "looks live but isn't" failures where the socket stays open but
 * the push pipeline silently stops emitting.
 */
router.get(
  "/inbox/events",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  (req, res): void => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as { flushHeaders: () => void }).flushHeaders();
    }

    res.write(`retry: 5000\n\n`);

    const writeHeartbeat = () => {
      try {
        res.write(`event: heartbeat\n`);
        res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
      } catch {
        // ignored — close handler will tear down.
      }
    };

    // Send an initial heartbeat immediately so the client's "last update"
    // timestamp is populated before the first real event arrives.
    writeHeartbeat();

    const handler = (event: InboxBusEvent) => {
      const eventName = event.type === "message" ? "inbox_message" : "inbox_assigned";
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // socket may have closed mid-write; cleanup happens via 'close'.
      }
    };

    const unsubscribe = inboxBus.subscribe(handler);

    const ping = setInterval(writeHeartbeat, 25000);

    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
      try { res.end(); } catch {}
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
  },
);

router.get(
  "/inbox/conversations",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const userId = req.user!.id;
    const tab = String(req.query.tab || "mine"); // mine | unassigned | unmatched | all | archived
    const channel = req.query.channel ? String(req.query.channel) : null;
    const order = String(req.query.order || "desc") === "asc" ? "asc" : "desc";
    const showTests = String(req.query.showTests || "") === "true";

    const where: SQL[] = [
      tab === "archived"
        ? eq(conversationsTable.isArchived, true)
        : eq(conversationsTable.isArchived, false),
    ];

    // Test/junk conversations are hidden by default: e2e-suite artifacts and
    // quick-contact WhatsApp stubs that never left the queue. Toggle with
    // showTests=true (used by the cleanup UI).
    if (!showTests) {
      where.push(sql`NOT (
        COALESCE(${conversationsTable.title}, '') ILIKE 'Playwright Inbox%'
        OR COALESCE(${conversationsTable.title}, '') ILIKE 'automated e2e webhook%'
        OR (COALESCE(${conversationsTable.title}, '') ILIKE 'WhatsApp to %' AND ${conversationsTable.status} = 'queued')
      )`);
    }

    // Channel filter has full parity, including the value 'internal'. When NO
    // channel is requested, default the inbox scope to external channels only
    // so user-DMs (internal conversations) don't pollute the staff inbox feed
    // — internal conversations remain reachable by passing channel=internal.
    if (channel) {
      where.push(eq(conversationsTable.channel, channel));
    } else {
      where.push(sql`${conversationsTable.channel} != 'internal'`);
    }

    if (tab === "mine") where.push(eq(conversationsTable.assignedToId, userId));
    else if (tab === "unassigned") where.push(isNull(conversationsTable.assignedToId));
    else if (tab === "unmatched") where.push(eq(conversationsTable.unmatched, true));
    else if (tab === "unanswered") {
      where.push(eq(conversationsTable.status, "open"));
      where.push(isNotNull(conversationsTable.lastInboundAt));
      where.push(sql`NOT EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = ${conversationsTable.id}
        AND m.direction IN ('outbound', 'internal')
        AND m.created_at > ${conversationsTable.lastInboundAt}
      )`);
    } else if (tab === "subscribed") {
      where.push(sql`EXISTS (
        SELECT 1 FROM conversation_participants cp
        WHERE cp.conversation_id = ${conversationsTable.id} AND cp.user_id = ${userId}
      )`);
    } else if (tab === "starred") {
      where.push(sql`EXISTS (
        SELECT 1 FROM conversation_participants cp
        WHERE cp.conversation_id = ${conversationsTable.id}
        AND cp.user_id = ${userId} AND cp.is_starred = true
      )`);
    } else if (tab === "unread") {
      // Conversations with at least one inbound message the current user
      // hasn't seen (after their participant last_read_at, or ever if none).
      where.push(sql`EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = ${conversationsTable.id}
        AND m.direction = 'inbound'
        AND m.created_at > COALESCE((
          SELECT cp.last_read_at FROM conversation_participants cp
          WHERE cp.conversation_id = ${conversationsTable.id} AND cp.user_id = ${userId}
        ), 'epoch'::timestamptz)
      )`);
    } else if (tab === "awaiting") {
      // Last message is inbound → the contact is waiting on a staff reply.
      where.push(isNotNull(conversationsTable.lastInboundAt));
      where.push(sql`NOT EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = ${conversationsTable.id}
        AND m.direction IN ('outbound', 'internal')
        AND m.created_at > ${conversationsTable.lastInboundAt}
      )`);
    }
    // tab === "open" or "all": no extra filter beyond isArchived=false

    const rows = await db
      .select({
        id: conversationsTable.id,
        type: conversationsTable.type,
        title: conversationsTable.title,
        channel: conversationsTable.channel,
        externalContactId: conversationsTable.externalContactId,
        externalThreadId: conversationsTable.externalThreadId,
        unmatched: conversationsTable.unmatched,
        status: conversationsTable.status,
        assignedToId: conversationsTable.assignedToId,
        lastMessageAt: conversationsTable.lastMessageAt,
        lastMessagePreview: conversationsTable.lastMessagePreview,
        lastInboundAt: conversationsTable.lastInboundAt,
        createdAt: conversationsTable.createdAt,
        isStarred: sql<boolean>`EXISTS (
          SELECT 1 FROM conversation_participants cp
          WHERE cp.conversation_id = ${conversationsTable.id}
          AND cp.user_id = ${userId} AND cp.is_starred = true
        )`.as("is_starred"),
        isSubscribed: sql<boolean>`EXISTS (
          SELECT 1 FROM conversation_participants cp
          WHERE cp.conversation_id = ${conversationsTable.id} AND cp.user_id = ${userId}
        )`.as("is_subscribed"),
        // Per-user unread inbound count (WhatsApp-style badge). Correlated
        // subquery inside the SAME select — no N+1 round trips.
        unreadCount: sql<number>`(
          SELECT COUNT(*)::int FROM messages m
          WHERE m.conversation_id = ${conversationsTable.id}
          AND m.direction = 'inbound'
          AND m.created_at > COALESCE((
            SELECT cp.last_read_at FROM conversation_participants cp
            WHERE cp.conversation_id = ${conversationsTable.id} AND cp.user_id = ${userId}
          ), 'epoch'::timestamptz)
        )`.as("unread_count"),
        // Persistent "awaiting reply" flag derived from the LAST message's
        // direction (not lastInboundAt, which can drift out of sync with the
        // messages table — e.g. backfilled/imported rows). Orange dot shows
        // iff the newest message in the conversation is inbound.
        awaitingReply: sql<boolean>`(
          COALESCE((
            SELECT m.direction FROM messages m
            WHERE m.conversation_id = ${conversationsTable.id}
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
          ), '') = 'inbound'
        )`.as("awaiting_reply"),
      })
      .from(conversationsTable)
      .where(and(...where))
      .orderBy(
        order === "asc"
          ? asc(conversationsTable.lastMessageAt)
          : desc(conversationsTable.lastMessageAt),
      )
      .limit(200);

    const externalIds = rows.map((r) => r.externalContactId).filter((x): x is number => !!x);
    const assignedIds = rows.map((r) => r.assignedToId).filter((x): x is number => !!x);

    type AssignedUserSummary = {
      id: number;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
    };

    const contactsMap = new Map<number, ExternalContact>();
    if (externalIds.length > 0) {
      const contacts = await db
        .select()
        .from(externalContactsTable)
        .where(inArray(externalContactsTable.id, externalIds));
      for (const c of contacts) contactsMap.set(c.id, c);
    }
    const usersMap = new Map<number, AssignedUserSummary>();
    if (assignedIds.length > 0) {
      const users = await db
        .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable)
        .where(inArray(usersTable.id, assignedIds));
      for (const u of users) usersMap.set(u.id, u);
    }

    const data = rows.map((r) => ({
      ...r,
      externalContact: r.externalContactId ? contactsMap.get(r.externalContactId) : null,
      assignedTo: r.assignedToId ? usersMap.get(r.assignedToId) : null,
    }));

    res.json({ data });
  },
);

router.get(
  "/inbox/conversations/:id",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [externalContact] = conv.externalContactId
      ? await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId))
      : [null];
    // Single-owner rule: keep the conversation owner in lockstep with the CRM
    // chain owner (chain wins) so the header always shows the true owner. Runs
    // inline (cheap: 2-3 point selects) so THIS response already reflects it.
    if (conv.externalContactId) {
      const syncedOwner = await syncConversationOwner(id, req.user!.id, req.ip);
      if (syncedOwner !== (conv.assignedToId ?? null)) {
        conv.assignedToId = syncedOwner;
      }
    }
    // Old Zernio attachments were stored without name/size — opportunistically
    // backfill them for this conversation in the background (rate-limited).
    void backfillConversationAttachmentNames(id);
    // Opening a conversation marks it read for THIS staff user: bump their
    // participant lastReadAt. Atomic upsert (cp_conv_user_uniq unique index)
    // so concurrent opens can never race into duplicates. Powers unread badge.
    await db.execute(sql`
      INSERT INTO conversation_participants (conversation_id, user_id, last_read_at)
      VALUES (${id}, ${req.user!.id}, now())
      ON CONFLICT (conversation_id, user_id)
      DO UPDATE SET last_read_at = EXCLUDED.last_read_at
    `);
    const [assignedTo] = conv.assignedToId
      ? await db
          .select({
            id: usersTable.id,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(eq(usersTable.id, conv.assignedToId))
      : [null];
    // Windowed message fetch: newest `limit` messages by default; `before=<id>`
    // pages older history (WhatsApp-style load-older). Rows are returned in
    // ascending order for rendering.
    const rawLimit = parseInt(String(req.query.limit ?? ""), 10);
    const msgLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const beforeId = parseInt(String(req.query.before ?? ""), 10);
    const msgWhere: SQL[] = [eq(messagesTable.conversationId, id)];
    if (Number.isFinite(beforeId) && beforeId > 0) {
      msgWhere.push(sql`${messagesTable.id} < ${beforeId}`);
    }
    const newestFirst = await db
      .select()
      .from(messagesTable)
      .where(and(...msgWhere))
      .orderBy(desc(messagesTable.id))
      .limit(msgLimit + 1);
    const hasMoreMessages = newestFirst.length > msgLimit;
    const rawMessages = newestFirst.slice(0, msgLimit).reverse();

    // Enrich messages: reactions grouped by emoji + repliedMessage snippets.
    let messages: Array<typeof rawMessages[number] & {
      reactions: Array<{ emoji: string; count: number; userIds: number[] }>;
      repliedMessage: { id: number; snippet: string; senderName: string } | null;
    }>;
    if (rawMessages.length > 0) {
      const msgIds = rawMessages.map((m) => m.id);

      // Reactions: batch-fetch all for this message window.
      const reactRows = await pool.query<{ message_id: number; emoji: string; user_id: number }>(
        `SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id = ANY($1)`,
        [msgIds],
      );
      const reactMap: Record<number, Record<string, { emoji: string; count: number; userIds: number[] }>> = {};
      for (const r of reactRows.rows) {
        if (!reactMap[r.message_id]) reactMap[r.message_id] = {};
        if (!reactMap[r.message_id][r.emoji]) reactMap[r.message_id][r.emoji] = { emoji: r.emoji, count: 0, userIds: [] };
        reactMap[r.message_id][r.emoji].count++;
        reactMap[r.message_id][r.emoji].userIds.push(r.user_id);
      }

      // repliedMessage: fetch snippet for each unique replyToId.
      const replyToIds = [...new Set(rawMessages.map((m) => m.replyToId).filter(Boolean) as number[])];
      const repliedMap: Record<number, { id: number; snippet: string; senderName: string }> = {};
      if (replyToIds.length > 0) {
        const repliedRows = await pool.query<{ id: number; content: string; first_name: string | null; last_name: string | null }>(
          `SELECT m.id, m.content, u.first_name, u.last_name
           FROM messages m LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.id = ANY($1)`,
          [replyToIds],
        );
        for (const r of repliedRows.rows) {
          repliedMap[r.id] = {
            id: r.id,
            snippet: r.content.slice(0, 120),
            senderName: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
          };
        }
      }

      messages = rawMessages.map((m) => ({
        ...m,
        reactions: Object.values(reactMap[m.id] ?? {}),
        repliedMessage: m.replyToId ? (repliedMap[m.replyToId] ?? null) : null,
      }));
    } else {
      messages = rawMessages.map((m) => ({ ...m, reactions: [], repliedMessage: null }));
    }

    const leadId = externalContact?.leadId ?? null;
    const studentId = externalContact?.studentId ?? null;
    const agentId = externalContact?.agentId ?? null;

    const [lead] = leadId
      ? await db
          .select({
            id: leadsTable.id,
            firstName: leadsTable.firstName,
            lastName: leadsTable.lastName,
            email: leadsTable.email,
            phone: leadsTable.phone,
            motherName: leadsTable.motherName,
            fatherName: leadsTable.fatherName,
            status: leadsTable.status,
            interestedProgram: leadsTable.interestedProgram,
            interestedUniversity: leadsTable.interestedUniversity,
            interestedCountry: leadsTable.interestedCountry,
            estimatedValue: leadsTable.estimatedValue,
            source: leadsTable.source,
            originType: leadsTable.originType,
            originDisplayName: leadsTable.originDisplayName,
            agentId: leadsTable.agentId,
            assignedToId: leadsTable.assignedToId,
            createdAt: leadsTable.createdAt,
            convertedStudentId: leadsTable.convertedStudentId,
          })
          .from(leadsTable)
          .where(and(eq(leadsTable.id, leadId), isNull(leadsTable.deletedAt)))
      : [null];

    const [student] = studentId
      ? await db
          .select({
            id: studentsTable.id,
            firstName: studentsTable.firstName,
            lastName: studentsTable.lastName,
            email: studentsTable.email,
            phone: studentsTable.phone,
            motherName: studentsTable.motherName,
            fatherName: studentsTable.fatherName,
            status: studentsTable.status,
            agentId: studentsTable.agentId,
            assignedToId: studentsTable.assignedToId,
            interestedLevel: studentsTable.interestedLevel,
            originType: studentsTable.originType,
            originDisplayName: studentsTable.originDisplayName,
            createdAt: studentsTable.createdAt,
          })
          .from(studentsTable)
          .where(and(eq(studentsTable.id, studentId!), isNull(studentsTable.deletedAt)))
      : [null];

    const [agent] = agentId
      ? await db
          .select({
            id: agentsTable.id,
            firstName: agentsTable.firstName,
            lastName: agentsTable.lastName,
            companyName: agentsTable.companyName,
            email: agentsTable.email,
            phone: agentsTable.phone,
            status: agentsTable.status,
            entityType: agentsTable.entityType,
          })
          .from(agentsTable)
          .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deletedAt)))
      : [null];

    let stage: {
      key: string;
      label: string;
      color: string | null;
      variant: string | null;
      icon: string | null;
    } | null = null;
    const stageEntity: "lead" | "student" | null = lead ? "lead" : student ? "student" : null;
    const stageKey = lead?.status ?? student?.status ?? null;
    if (stageEntity && stageKey) {
      const [row] = await db
        .select({
          key: pipelineStagesTable.key,
          label: pipelineStagesTable.label,
          color: pipelineStagesTable.color,
          variant: pipelineStagesTable.variant,
          icon: pipelineStagesTable.icon,
        })
        .from(pipelineStagesTable)
        .where(and(
          eq(pipelineStagesTable.entityType, stageEntity),
          eq(pipelineStagesTable.key, stageKey),
        ));
      stage = row ?? null;
    }

    const aiSummary = readAiSummary(conv.metadata);

    res.json({
      conversation: { ...conv, assignedTo: assignedTo ?? null },
      externalContact,
      messages,
      hasMoreMessages,
      withinWindow: CHANNELS_WITH_24H_WINDOW.has(conv.channel) ? isWithin24hWindow(conv.lastInboundAt) : true,
      lead: lead ?? null,
      student: student ?? null,
      agent: agent ?? null,
      stage,
      aiSummary,
    });
  },
);

router.patch(
  "/inbox/conversations/:id/assign",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { userId } = req.body as { userId: number | null };
    if (!id) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const assignedToId = userId === null ? null : (typeof userId === "number" ? userId : req.user!.id);
    const [previous] = await db
      .select({ assignedToId: conversationsTable.assignedToId })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id));
    // Single-owner rule: when the linked CRM chain (lead/student) already has
    // an owner, only users with the cascade permission (admins/managers) may
    // change the assignment — everyone else gets a 403 with the owner id so
    // the UI can explain who owns the record.
    const chainLink = await loadConversationLink(id);
    const chainOwnerId = chainLink ? await getChainOwner(chainLink) : null;
    const actorIsAdmin = req.user!.role === "admin" || req.user!.role === "super_admin";
    const actorCanCascade = actorIsAdmin || await userHasPermission(
      { id: req.user!.id, role: req.user!.role },
      "records.cascade_assignment",
    );
    // Single-owner lock: only admins may override an existing chain owner
    // (matches the UI, where only admin/super_admin get the staff dropdown).
    if (chainOwnerId != null && assignedToId !== chainOwnerId && !actorIsAdmin) {
      res.status(403).json({ error: "ASSIGNMENT_LOCKED", ownerId: chainOwnerId });
      return;
    }
    const [updated] = await db
      .update(conversationsTable)
      .set({ assignedToId, status: assignedToId ? "open" : "open" })
      .where(eq(conversationsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logAudit(req.user!.id, "assign_conversation", "conversation", id, { assignedToId }, req.ip);

    // Cascade to linked lead / student (and their sibling applications).
    // Awaited BEFORE responding: the conversation-detail route runs a
    // chain-wins owner sync, so if the chain still held the old owner when
    // the client refetched, the reassignment would be silently reverted.
    const assignmentActuallyChanged = assignedToId !== (previous?.assignedToId ?? null);
    if (assignmentActuallyChanged) {
      try {
        const link = chainLink ?? await loadConversationLink(id);
        if (link) {
          const actor = req.user!;
          const canCascade = actorCanCascade;
          if (link.leadId != null) {
            const [lead] = await db
              .select({ id: leadsTable.id, convertedStudentId: leadsTable.convertedStudentId })
              .from(leadsTable)
              .where(and(eq(leadsTable.id, link.leadId), isNull(leadsTable.deletedAt)));
            if (lead && (canCascade || assignedToId !== null)) {
              await cascadeLeadAssignment({
                leadId: lead.id,
                convertedStudentId: lead.convertedStudentId ?? null,
                newAssignedToId: assignedToId,
                actorUserId: actor.id,
                ipAddress: req.ip,
                nullFillOnly: !canCascade,
              });
            }
          } else if (link.studentId != null && (canCascade || assignedToId !== null)) {
            await cascadeStudentAssignment({
              studentId: link.studentId,
              newAssignedToId: assignedToId,
              actorUserId: actor.id,
              ipAddress: req.ip,
              nullFillOnly: !canCascade,
            });
          }
        }
      } catch (err: any) {
        console.error("[inbox assign cascade]", err?.message || err);
      }
    }

    inboxBus.publish({
      type: "assigned",
      conversationId: id,
      assignedToId: updated.assignedToId ?? null,
      previousAssignedToId: previous?.assignedToId ?? null,
      actorUserId: req.user!.id,
    });
    if (assignedToId && assignedToId !== req.user!.id) {
      try {
        await dispatchNotification({
          event: "inbox.assigned",
          title: "Conversation assigned to you",
          body: updated.title || `${updated.channel} conversation`,
          actionUrl: `/staff/messages?conversation=${id}`,
          icon: "user",
          recipientUserIds: [assignedToId],
          actorUserId: req.user!.id,
          data: { conversationId: id },
        });
      } catch {}
    }
    res.json({ data: updated });
  },
);

router.patch(
  "/inbox/conversations/:id/bot",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { enabled } = req.body as { enabled: boolean };
    if (!id || typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }
    // Re-enabling the bot clears the needs-human flag: staff have acknowledged
    // any escalation and are handing the conversation back to the assistant.
    // Re-enabling resets the consecutive-reply counter so the handoff threshold
    // starts fresh for the next bot-led stretch.
    const [updated] = await db
      .update(conversationsTable)
      .set(enabled ? { botEnabled: true, needsHuman: false, botReplyCount: 0 } : { botEnabled: false })
      .where(eq(conversationsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logAudit(req.user!.id, "toggle_conversation_bot", "conversation", id, { enabled }, req.ip);
    res.json({ data: { id: updated.id, botEnabled: updated.botEnabled, needsHuman: updated.needsHuman } });
  },
);

router.post(
  "/inbox/conversations/:id/match",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { type, entityId } = req.body as { type: "lead" | "student" | "agent"; entityId: number };
    if (!id || !type || !entityId) {
      res.status(400).json({ error: "type and entityId are required" });
      return;
    }
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || !conv.externalContactId) {
      res.status(404).json({ error: "Conversation has no external contact" });
      return;
    }
    const updates: { leadId: number | null; studentId: number | null; agentId: number | null } = {
      leadId: null,
      studentId: null,
      agentId: null,
    };
    if (type === "lead") updates.leadId = entityId;
    if (type === "student") updates.studentId = entityId;
    if (type === "agent") updates.agentId = entityId;

    // When re-matching a lead-linked conversation to a student, the previous
    // lead link is dropped below — adopt the lead's staged documents onto the
    // student first so the application mandatory-doc gate keeps seeing them.
    if (type === "student") {
      const [contact] = await db
        .select({ leadId: externalContactsTable.leadId })
        .from(externalContactsTable)
        .where(eq(externalContactsTable.id, conv.externalContactId));
      if (contact?.leadId != null) {
        await db
          .update(documentsTable)
          .set({ studentId: entityId })
          .where(and(
            eq(documentsTable.leadId, contact.leadId),
            isNull(documentsTable.studentId),
            isNull(documentsTable.deletedAt),
          ));
        // Record the lead→student relationship (fill-only) so future doc
        // adoption and cross-entity lookups can traverse it.
        await db
          .update(leadsTable)
          .set({ convertedStudentId: entityId })
          .where(and(eq(leadsTable.id, contact.leadId), isNull(leadsTable.convertedStudentId)));
        await recomputeStudentPhoto(entityId);
      }
    }

    await db.update(externalContactsTable).set(updates).where(eq(externalContactsTable.id, conv.externalContactId));
    await db.update(conversationsTable).set({ unmatched: false }).where(eq(conversationsTable.id, id));
    // Single-owner rule: adopt the chain owner onto the conversation (or
    // null-fill the chain from the conversation owner) right after linking.
    await syncConversationOwner(id, req.user!.id, req.ip);
    await logAudit(req.user!.id, "match_conversation", "conversation", id, { type, entityId }, req.ip);
    res.json({ ok: true });
  },
);

router.get(
  "/inbox/conversations/:id/match-suggestions",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || !conv.externalContactId) {
      res.json({ outcome: "none", candidates: [] });
      return;
    }
    const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
    if (!contact) {
      res.json({ outcome: "none", candidates: [] });
      return;
    }
    const result = await resolveIdentity({ phone: contact.phone, email: contact.email });
    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// Shared param schema (used by Faz 1 routes below and Phase 2 routes further below)
// ---------------------------------------------------------------------------

const conversationIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Faz 1 — Smart lead creation from conversation (AI pre-fill + duplicate guard)
// ---------------------------------------------------------------------------

const LEAD_EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

router.get(
  "/inbox/conversations/:id/lead-suggestion",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  requireAgentStaffPermission("leads"),
  validate({ params: conversationIdParamSchema }),
  async (req, res): Promise<void> => {
    const { params } = getValidated<{ params: typeof conversationIdParamSchema }>(req);
    const id = params.id;

    const [conv] = await db
      .select({ id: conversationsTable.id, externalContactId: conversationsTable.externalContactId })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id));
    if (!conv) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const suggestion: Record<string, unknown> = {};

    if (conv.externalContactId) {
      const [contact] = await db
        .select()
        .from(externalContactsTable)
        .where(eq(externalContactsTable.id, conv.externalContactId));
      if (contact) {
        if (contact.phoneE164 || contact.phone) {
          suggestion.phone = contact.phoneE164 || contact.phone;
        }
        if (contact.displayName) {
          suggestion.displayName = contact.displayName;
        }
      }
    }

    // AI extraction from transcript — never throws (errors silently fold to empty suggestion)
    try {
      const transcript = await db
        .select({ direction: messagesTable.direction, content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, id))
        .orderBy(asc(messagesTable.createdAt))
        .limit(30);

      if (transcript.length > 0) {
        const text = transcript
          .map((m) => `[${m.direction === "inbound" ? "Customer" : "Agent"}] ${m.content}`)
          .join("\n");

        const extracted = await extractLeadFromTranscript({ transcript: text });
        if (extracted.fullName) {
          suggestion.fullName = extracted.fullName;
          if (extracted.fullNameConfidence === "low") suggestion.fullNameLowConfidence = true;
        }
        if (extracted.email) {
          suggestion.email = extracted.email;
          if (extracted.emailConfidence === "low") suggestion.emailLowConfidence = true;
        }
      }
    } catch {
      // Swallow all AI / parse errors — return partial suggestion
    }

    res.json({ suggestion });
  },
);

const createLeadFromConversationBodySchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
});

router.post(
  "/inbox/conversations/:id/create-lead",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  requireAgentStaffPermission("leads"),
  validate({ params: conversationIdParamSchema, body: createLeadFromConversationBodySchema }),
  async (req, res): Promise<void> => {
    const { params, body } = getValidated<{
      params: typeof conversationIdParamSchema;
      body: typeof createLeadFromConversationBodySchema;
    }>(req);
    const id = params.id;

    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || !conv.externalContactId) {
      res.status(404).json({ error: "Conversation not found or has no external contact" });
      return;
    }
    const [contact] = await db
      .select()
      .from(externalContactsTable)
      .where(eq(externalContactsTable.id, conv.externalContactId));
    if (!contact) {
      res.status(404).json({ error: "External contact not found" });
      return;
    }

    // Parse fullName into first/last
    const trimmedName = body.fullName.trim();
    // Latin-only name enforcement — reject non-Latin (Arabic/Cyrillic/CJK)
    // names before any record is created (mirrors embed/students/leads).
    if (containsNonLatinLetter(trimmedName)) {
      res.status(400).json({ error: `${NON_LATIN_NAME_CODE}:fullName: This field must contain only Latin letters.` });
      return;
    }
    const parts = trimmedName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || trimmedName;
    const lastName = parts.slice(1).join(" ") || "Contact";

    const email = body.email?.trim().toLowerCase() || contact.email || null;
    const phoneForCheck = body.phone?.trim() || contact.phone || null;

    // Duplicate lead guard — uses resolveIdentity to avoid re-implementing phone/email normalisation
    const resolution = await resolveIdentity({ phone: phoneForCheck, email });
    const existingLead = resolution.candidates.find((c) => c.type === "lead");
    if (existingLead) {
      const [candidate] = await db
        .select({
          id: leadsTable.id,
          firstName: leadsTable.firstName,
          lastName: leadsTable.lastName,
          email: leadsTable.email,
          phone: leadsTable.phone,
          status: leadsTable.status,
        })
        .from(leadsTable)
        .where(and(eq(leadsTable.id, existingLead.id), isNull(leadsTable.deletedAt)));
      if (candidate) {
        res.status(409).json({ error: "LEAD_EXISTS", candidate });
        return;
      }
    }

    // Single TX: insert lead + link external_contact + mark conversation matched
    const lead = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(leadsTable)
        .values({
          firstName: toLatinUpper(firstName).slice(0, 100),
          lastName: toLatinUpper(lastName).slice(0, 100),
          email: email || null,
          phone: phoneForCheck ? normalizePhoneField(phoneForCheck) : null,
          phoneE164: contact.phoneE164 || null,
          source: conv.channel,
          status: "new",
          ...directOrigin(),
        })
        .returning();

      await tx
        .update(externalContactsTable)
        .set({ leadId: inserted.id })
        .where(eq(externalContactsTable.id, contact.id));

      await tx
        .update(conversationsTable)
        .set({ unmatched: false })
        .where(eq(conversationsTable.id, id));

      return inserted;
    });

    await applyLeadAssignmentRules(lead, req.ip);
    // Single-owner rule: sync conversation ⇄ freshly created lead ownership.
    await syncConversationOwner(id, req.user!.id, req.ip);
    logAudit(
      req.user!.id,
      "create_lead_from_inbox_smart",
      "lead",
      lead.id,
      { conversationId: id, method: "ai_prefill" },
      req.ip,
    );

    res.status(201).json({ ok: true, leadId: lead.id });
  },
);

router.post(
  "/inbox/conversations/:id/match/new-lead",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || !conv.externalContactId) {
      res.status(404).json({ error: "Conversation has no external contact" });
      return;
    }
    const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
    if (!contact) {
      res.status(404).json({ error: "External contact not found" });
      return;
    }
    const displayName = contact.displayName || "Unknown";
    // Latin-only name enforcement — a non-Latin WhatsApp/chat display name must
    // not create a lead; staff can use the smart-new-lead flow to type a Latin name.
    if (containsNonLatinLetter(displayName)) {
      res.status(400).json({ error: `${NON_LATIN_NAME_CODE}:fullName: This field must contain only Latin letters.` });
      return;
    }
    const [firstName, ...rest] = displayName.split(/\s+/);
    const lastName = rest.join(" ") || "Contact";
    const [lead] = await db
      .insert(leadsTable)
      .values({
        firstName: toLatinUpper(firstName).slice(0, 100),
        lastName: toLatinUpper(lastName).slice(0, 100),
        email: contact.email || null,
        phone: contact.phone ? normalizePhoneField(contact.phone) : null,
        phoneE164: contact.phoneE164 || null,
        source: conv.channel,
        status: "new",
        ...directOrigin(),
      })
      .returning();
    await db.update(externalContactsTable).set({ leadId: lead.id }).where(eq(externalContactsTable.id, contact.id));
    await db.update(conversationsTable).set({ unmatched: false }).where(eq(conversationsTable.id, id));
    await applyLeadAssignmentRules(lead, req.ip);
    // Single-owner rule: sync conversation ⇄ freshly created lead ownership.
    await syncConversationOwner(id, req.user!.id, req.ip);
    await logAudit(req.user!.id, "create_lead_from_inbox", "lead", lead.id, { conversationId: id }, req.ip);
    res.status(201).json({ ok: true, leadId: lead.id });
  },
);

/**
 * Forward an existing message (content + attachments) to other conversations.
 * Body: { conversationIds: number[] } — max 10 targets per call.
 * Only Zernio-routed target conversations are supported (the shared transport
 * can deliver both text and re-hosted attachments); others fail per-target
 * with `unsupported_channel`. Meta-windowed channels enforce the 24h rule.
 */
router.post(
  "/inbox/messages/:messageId/forward",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const messageId = Number(req.params.messageId);
    const conversationIds = (req.body as { conversationIds?: unknown })?.conversationIds;
    if (
      !Number.isInteger(messageId) ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0 ||
      conversationIds.length > 10 ||
      !conversationIds.every((v) => Number.isInteger(v) && v > 0)
    ) {
      res.status(400).json({ error: "conversationIds must be 1-10 conversation ids" });
      return;
    }

    const [src] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
    if (!src) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    const srcMeta = (src.metadata ?? {}) as {
      attachment?: { url?: string; fileUrl?: string; type?: string; fileType?: string; name?: string; fileName?: string };
      attachments?: Array<{ url?: string; fileUrl?: string; type?: string; fileType?: string; name?: string; fileName?: string }>;
    };
    const attachments = [
      ...(srcMeta.attachment ? [srcMeta.attachment] : []),
      ...(srcMeta.attachments ?? []),
    ]
      .map((a) => ({
        url: a.url ?? a.fileUrl ?? "",
        type: a.type ?? a.fileType,
        name: a.name ?? a.fileName,
      }))
      .filter((a) => a.url);
    const content = src.content && src.content !== "[attachment]" ? src.content : undefined;
    if (!content && attachments.length === 0) {
      res.status(400).json({ error: "Message has no forwardable content" });
      return;
    }

    const results: Array<{ conversationId: number; ok: boolean; error?: string }> = [];
    for (const targetId of conversationIds as number[]) {
      const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, targetId));
      if (!conv) {
        results.push({ conversationId: targetId, ok: false, error: "not_found" });
        continue;
      }

      let zernioAcct: typeof channelAccountsTable.$inferSelect | undefined;
      if (conv.channelAccountId != null) {
        [zernioAcct] = await db
          .select()
          .from(channelAccountsTable)
          .where(
            and(
              eq(channelAccountsTable.id, conv.channelAccountId),
              eq(channelAccountsTable.provider, "zernio"),
            ),
          );
      }
      if (!zernioAcct) {
        results.push({ conversationId: targetId, ok: false, error: "unsupported_channel" });
        continue;
      }
      if (CHANNELS_WITH_24H_WINDOW.has(conv.channel) && !isWithin24hWindow(conv.lastInboundAt)) {
        results.push({ conversationId: targetId, ok: false, error: "outside_24h_window" });
        continue;
      }

      const result = await sendZernioConversationMessage({
        conv: {
          id: conv.id,
          channel: conv.channel,
          externalThreadId: conv.externalThreadId,
          assignedToId: conv.assignedToId ?? null,
          unmatched: conv.unmatched,
        },
        externalAccountId: zernioAcct.externalAccountId!,
        senderId: req.user!.id,
        content,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (result.ok && result.message?.id) {
        // Mark the new row as forwarded so the UI can show the label.
        await pool.query(
          `UPDATE messages SET metadata = coalesce(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
          [JSON.stringify({ forwarded: true, forwardedFromMessageId: messageId }), result.message.id],
        );
        results.push({ conversationId: targetId, ok: true });
      } else {
        results.push({ conversationId: targetId, ok: false, error: result.precondition ?? result.error ?? "send_failed" });
      }
    }

    await logAudit(req.user!.id, "forward_inbox_message", "message", messageId, { targets: conversationIds }, req.ip);
    res.status(200).json({ results });
  },
);

/**
 * Send an outbound message on a non-internal channel conversation.
 * Body: { content: string }
 */
router.post(
  "/inbox/conversations/:id/messages",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { content, attachments: bodyAttachments, replyToMessageId } = req.body as {
      content: string;
      attachments?: Array<{ url: string; type?: string; name?: string }>;
      replyToMessageId?: number;
    };
    const replyToId: number | null = (typeof replyToMessageId === "number" && replyToMessageId > 0) ? replyToMessageId : null;
    const hasContent = Boolean(content && content.trim());
    const hasAttachments = Array.isArray(bodyAttachments) && bodyAttachments.length > 0;
    if (!id || (!hasContent && !hasAttachments)) {
      res.status(400).json({ error: "content or attachments is required" });
      return;
    }
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Human takeover: a staff member manually replying disables the intake bot
    // for this conversation so the human and the bot never talk over each other.
    if (conv.botEnabled) {
      await db
        .update(conversationsTable)
        .set({ botEnabled: false, botReplyCount: 0 })
        .where(eq(conversationsTable.id, id));
    }

    // ── Zernio-routed conversations (provider='zernio') ──────────────────────
    // Check before channel-specific direct-API branches: same channel name
    // (whatsapp/instagram/facebook/telegram) but the account is Zernio-hosted.
    if (conv.channelAccountId != null) {
      const [zernioAcct] = await db
        .select()
        .from(channelAccountsTable)
        .where(
          and(
            eq(channelAccountsTable.id, conv.channelAccountId),
            eq(channelAccountsTable.provider, "zernio"),
          ),
        );

      if (zernioAcct) {
        // Meta-windowed channels enforce the 24h free-text rule regardless of
        // whether the account is Zernio-hosted or direct (same policy as the
        // direct-API branches below and the quick-contact route).
        if (
          (conv.channel === "whatsapp" || conv.channel === "messenger" || conv.channel === "instagram") &&
          !isWithin24hWindow(conv.lastInboundAt)
        ) {
          res.status(409).json({
            error: "outside_24h_window",
            message: "Free-form replies are only allowed within 24h of the last inbound message. Use a template.",
          });
          return;
        }

        // Single source of truth for Zernio outbound — shared with quick-contact
        // (routes/messages.ts) and, at the transport level, the AI bot.
        const result = await sendZernioConversationMessage({
          conv: {
            id,
            channel: conv.channel,
            externalThreadId: conv.externalThreadId,
            assignedToId: conv.assignedToId ?? null,
            unmatched: conv.unmatched,
          },
          externalAccountId: zernioAcct.externalAccountId!,
          senderId: req.user!.id,
          content: hasContent ? content : undefined,
          attachments: hasAttachments ? bodyAttachments : undefined,
        });

        if (result.precondition === "zernio_api_key_not_configured") {
          res.status(502).json({ error: "Zernio API key not configured" });
          return;
        }
        if (result.precondition === "zernio_no_external_thread") {
          res.status(400).json({ error: "Conversation has no external thread ID" });
          return;
        }

        // CRM-only reply context: store replyToId on the message row if provided.
        if (replyToId && result.message?.id) {
          await pool.query(`UPDATE messages SET reply_to_id = $1 WHERE id = $2`, [replyToId, result.message.id]);
        }
        res.status(result.ok ? 201 : 502).json({ message: result.message, error: result.error });
        return;
      }
    }

    if (conv.channel === "whatsapp") {
      if (!isWithin24hWindow(conv.lastInboundAt)) {
        res.status(409).json({
          error: "outside_24h_window",
          message: "Free-form replies are only allowed within 24h of the last inbound message. Use a template.",
        });
        return;
      }
      if (!conv.externalContactId) {
        res.status(400).json({ error: "Conversation has no external contact" });
        return;
      }
      const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
      if (!contact?.phoneE164) {
        res.status(400).json({ error: "Contact has no E.164 phone" });
        return;
      }
      const cfg: WhatsAppConfig = (await resolveOutboundConfig<WhatsAppConfig>("whatsapp", conv.channelAccountId)) || {};

      // Persist a 'pending' row first so the client can observe lifecycle.
      const [pending] = await db
        .insert(messagesTable)
        .values({
          conversationId: id,
          senderId: req.user!.id,
          content,
          channel: "whatsapp",
          direction: "outbound",
          status: "pending",
          metadata: {},
          ...(replyToId ? { replyToId } : {}),
        })
        .returning();

      const result = await sendWhatsAppText({ config: cfg, toPhoneE164: contact.phoneE164, text: content });

      const [msg] = await db
        .update(messagesTable)
        .set({
          status: result.ok ? "sent" : "failed",
          externalMessageId: result.externalMessageId || null,
          failedReason: result.ok ? null : result.error || "send_failed",
          sentAt: result.ok ? new Date() : null,
          metadata: { simulated: result.simulated, ...(result.ok ? {} : { error: result.error }) },
        })
        .where(eq(messagesTable.id, pending.id))
        .returning();

      if (result.ok) {
        await db
          .update(conversationsTable)
          .set({ lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 200) })
          .where(eq(conversationsTable.id, id));
        inboxBus.publish({
          type: "message",
          conversationId: id,
          channel: "whatsapp",
          assignedToId: conv.assignedToId ?? null,
          unmatched: conv.unmatched,
          direction: "outbound",
        });
      } else {
        // Notify staff of send failure (in_app + email per default rule).
        try {
          await dispatchNotification({
            event: "inbox.send_failed",
            title: `WhatsApp send failed for conversation #${id}`,
            body: result.error || "Send failed",
            actionUrl: `/staff/messages?conversation=${id}`,
            icon: "alert",
            data: { conversationId: id, channel: "whatsapp", error: result.error },
          });
        } catch (err) {
          console.error("[INBOX] send_failed dispatch error:", err);
        }
      }
      res.status(result.ok ? 201 : 502).json({ message: msg, simulated: result.simulated, error: result.error });
      return;
    }

    if (conv.channel === "messenger" || conv.channel === "instagram") {
      if (!isWithin24hWindow(conv.lastInboundAt)) {
        res.status(409).json({
          error: "outside_24h_window",
          message: "Free-form replies are only allowed within 24h of the last inbound message.",
        });
        return;
      }
      if (!conv.externalContactId) {
        res.status(400).json({ error: "Conversation has no external contact" });
        return;
      }
      const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
      // The recipient is the user's page-/IG-scoped id, stored as externalId.
      const recipientId = contact?.externalId || conv.externalThreadId || "";
      if (!recipientId) {
        res.status(400).json({ error: "Conversation has no recipient id" });
        return;
      }
      const metaCfg = (await resolveOutboundConfig<MessengerConfig & InstagramConfig>(conv.channel, conv.channelAccountId)) || {};

      // Persist a 'pending' row first so the client can observe lifecycle.
      const [pending] = await db
        .insert(messagesTable)
        .values({
          conversationId: id,
          senderId: req.user!.id,
          content,
          channel: conv.channel,
          direction: "outbound",
          status: "pending",
          metadata: {},
          ...(replyToId ? { replyToId } : {}),
        })
        .returning();

      const result =
        conv.channel === "messenger"
          ? await sendMessengerText({
              config: metaCfg as MessengerConfig,
              recipientId,
              text: content,
            })
          : await sendInstagramText({
              config: metaCfg as InstagramConfig,
              recipientId,
              text: content,
            });

      const [msg] = await db
        .update(messagesTable)
        .set({
          status: result.ok ? "sent" : "failed",
          externalMessageId: result.externalMessageId || null,
          failedReason: result.ok ? null : result.error || "send_failed",
          sentAt: result.ok ? new Date() : null,
          metadata: { simulated: result.simulated, ...(result.ok ? {} : { error: result.error }) },
        })
        .where(eq(messagesTable.id, pending.id))
        .returning();

      if (result.ok) {
        await db
          .update(conversationsTable)
          .set({ lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 200) })
          .where(eq(conversationsTable.id, id));
        inboxBus.publish({
          type: "message",
          conversationId: id,
          channel: conv.channel,
          assignedToId: conv.assignedToId ?? null,
          unmatched: conv.unmatched,
          direction: "outbound",
        });
      } else {
        try {
          await dispatchNotification({
            event: "inbox.send_failed",
            title: `${conv.channel} send failed for conversation #${id}`,
            body: result.error || "Send failed",
            actionUrl: `/staff/messages?conversation=${id}`,
            icon: "alert",
            data: { conversationId: id, channel: conv.channel, error: result.error },
          });
        } catch (err) {
          console.error("[INBOX] send_failed dispatch error:", err);
        }
      }
      res.status(result.ok ? 201 : 502).json({ message: msg, simulated: result.simulated, error: result.error });
      return;
    }

    if (conv.channel === "web_form") {
      const [msg] = await db
        .insert(messagesTable)
        .values({
          conversationId: id,
          senderId: req.user!.id,
          content,
          channel: "web_form",
          direction: "outbound",
          status: "sent",
          sentAt: new Date(),
          ...(replyToId ? { replyToId } : {}),
        })
        .returning();
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 200) })
        .where(eq(conversationsTable.id, id));
      inboxBus.publish({
        type: "message",
        conversationId: id,
        channel: "web_form",
        assignedToId: conv.assignedToId ?? null,
        unmatched: conv.unmatched,
        direction: "outbound",
      });

      // Auto-email the original submitter when an email is on file.
      let emailSent = false;
      let emailError: string | undefined;
      try {
        const [contact] = conv.externalContactId
          ? await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId))
          : [null];
        if (contact?.email) {
          const subject = "Reply from our team";
          const text = content;
          const html = `<p>${content.replace(/\n/g, "<br/>")}</p>`;
          await sendEmail(contact.email, { subject, html, text });
          emailSent = true;
          await db
            .update(messagesTable)
            .set({ metadata: { emailedTo: contact.email } })
            .where(eq(messagesTable.id, msg.id));
        }
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
        console.error("[INBOX] web_form email auto-reply failed:", err);
        try {
          await dispatchNotification({
            event: "inbox.send_failed",
            title: `Web form reply email failed for conversation #${id}`,
            body: emailError,
            actionUrl: `/staff/messages?conversation=${id}`,
            icon: "alert",
            data: { conversationId: id, channel: "web_form", error: emailError },
          });
        } catch {}
      }
      res.status(201).json({
        message: msg,
        emailSent,
        ...(emailError ? { emailError } : {}),
        note: emailSent
          ? "Reply emailed to submitter."
          : "Recorded; submitter has no email on file.",
      });
      return;
    }

    res.status(400).json({ error: `Channel '${conv.channel}' is not supported by this endpoint` });
  },
);

// Toggle an emoji reaction on a message. POST with { emoji } adds if absent,
// removes if the same user already reacted with that emoji (toggle semantics).
router.post(
  "/inbox/conversations/:id/messages/:msgId/react",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const msgId = parseInt(String(req.params.msgId), 10);
    const { emoji } = req.body as { emoji?: string };
    if (!msgId || !emoji || typeof emoji !== "string" || emoji.length > 12) {
      res.status(400).json({ error: "invalid params" });
      return;
    }
    const userId = req.user!.id;
    const existing = await pool.query<{ id: number }>(
      `SELECT id FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [msgId, userId, emoji],
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
        [msgId, userId, emoji],
      );
      res.json({ toggled: false, emoji });
    } else {
      await pool.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [msgId, userId, emoji],
      );
      res.json({ toggled: true, emoji });
    }
  },
);

// Retry a failed outbound message through the same send paths as the manual
// composer (Zernio-hosted → Zernio API; otherwise direct channel senders).
router.post(
  "/inbox/messages/:id/retry",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const msgId = parseInt(String(req.params.id), 10);
    if (!msgId) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, msgId));
    if (!msg) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (msg.direction !== "outbound" || msg.status !== "failed") {
      res.status(409).json({ error: "only_failed_outbound_retryable" });
      return;
    }
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, msg.conversationId));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const meta = (msg.metadata ?? {}) as Record<string, any>;
    const attachments = Array.isArray(meta.attachments) ? meta.attachments : undefined;
    const text = msg.content && msg.content !== "[attachment]" ? msg.content : undefined;

    let ok = false;
    let error: string | undefined;
    let externalMessageId: string | undefined;
    let handled = false;

    const zernioAcct = await resolveZernioAccount(conv.channelAccountId);
    if (zernioAcct && conv.externalThreadId) {
      handled = true;
      const outcome = await sendViaZernio({
        externalThreadId: conv.externalThreadId,
        externalAccountId: zernioAcct.externalAccountId,
        text,
        attachments,
      });
      ok = outcome.ok;
      error = outcome.error;
      externalMessageId = outcome.externalMessageId;
    } else if (conv.channel === "whatsapp") {
      handled = true;
      if (!isWithin24hWindow(conv.lastInboundAt)) {
        res.status(409).json({ error: "outside_24h_window" });
        return;
      }
      const [contact] = conv.externalContactId
        ? await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId))
        : [null];
      if (!contact?.phoneE164) {
        res.status(400).json({ error: "Contact has no E.164 phone" });
        return;
      }
      const cfg: WhatsAppConfig =
        (await resolveOutboundConfig<WhatsAppConfig>("whatsapp", conv.channelAccountId)) || {};
      const result = await sendWhatsAppText({ config: cfg, toPhoneE164: contact.phoneE164, text: text || "" });
      ok = result.ok;
      error = result.error;
      externalMessageId = result.externalMessageId;
    } else if (conv.channel === "messenger" || conv.channel === "instagram") {
      handled = true;
      if (!isWithin24hWindow(conv.lastInboundAt)) {
        res.status(409).json({ error: "outside_24h_window" });
        return;
      }
      const [contact] = conv.externalContactId
        ? await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId))
        : [null];
      const recipientId = contact?.externalId || conv.externalThreadId || "";
      if (!recipientId) {
        res.status(400).json({ error: "Conversation has no recipient id" });
        return;
      }
      const metaCfg =
        (await resolveOutboundConfig<MessengerConfig & InstagramConfig>(conv.channel, conv.channelAccountId)) || {};
      const result =
        conv.channel === "messenger"
          ? await sendMessengerText({ config: metaCfg as MessengerConfig, recipientId, text: text || "" })
          : await sendInstagramText({ config: metaCfg as InstagramConfig, recipientId, text: text || "" });
      ok = result.ok;
      error = result.error;
      externalMessageId = result.externalMessageId;
    }

    if (!handled) {
      res.status(400).json({ error: `Channel '${conv.channel}' does not support retry` });
      return;
    }

    const [updated] = await db
      .update(messagesTable)
      .set({
        status: ok ? "sent" : "failed",
        externalMessageId: externalMessageId || msg.externalMessageId,
        failedReason: ok ? null : error || "send_failed",
        sentAt: ok ? new Date() : null,
        metadata: { ...meta, retriedAt: new Date().toISOString(), ...(ok ? {} : { error }) },
      })
      .where(eq(messagesTable.id, msgId))
      .returning();

    if (ok) {
      inboxBus.publish({
        type: "message",
        conversationId: conv.id,
        channel: conv.channel,
        assignedToId: conv.assignedToId ?? null,
        unmatched: conv.unmatched,
        direction: "outbound",
      });
    }
    res.status(ok ? 200 : 502).json({ message: updated, error });
  },
);

// ─── Bulk conversation management (archive / restore / permanent delete) ────
const bulkIdsSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });

/** Internal (user-DM) conversations require participant membership for non-admins. */
async function filterBulkAccessibleIds(userId: number, isAdmin: boolean, ids: number[]): Promise<number[]> {
  const rows = await db
    .select({ id: conversationsTable.id, channel: conversationsTable.channel })
    .from(conversationsTable)
    .where(inArray(conversationsTable.id, ids));
  const internalIds = rows.filter((r) => r.channel === "internal").map((r) => r.id);
  let allowedInternal = new Set<number>(internalIds);
  if (!isAdmin && internalIds.length > 0) {
    const parts = await db
      .select({ conversationId: conversationParticipantsTable.conversationId })
      .from(conversationParticipantsTable)
      .where(
        and(
          inArray(conversationParticipantsTable.conversationId, internalIds),
          eq(conversationParticipantsTable.userId, userId),
        ),
      );
    allowedInternal = new Set(parts.map((p) => p.conversationId));
  }
  return rows
    .filter((r) => r.channel !== "internal" || allowedInternal.has(r.id))
    .map((r) => r.id);
}

router.post(
  "/inbox/conversations/bulk-archive",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "ids array required" });
      return;
    }
    const isAdmin = (ADMIN_ROLES as readonly string[]).includes(req.user!.role);
    const ids = await filterBulkAccessibleIds(req.user!.id, isAdmin, parsed.data.ids);
    if (ids.length === 0) {
      res.json({ archived: 0 });
      return;
    }
    const updated = await db
      .update(conversationsTable)
      .set({ isArchived: true })
      .where(inArray(conversationsTable.id, ids))
      .returning({ id: conversationsTable.id });
    res.json({ archived: updated.length });
  },
);

router.post(
  "/inbox/conversations/bulk-unarchive",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "ids array required" });
      return;
    }
    const isAdmin = (ADMIN_ROLES as readonly string[]).includes(req.user!.role);
    const ids = await filterBulkAccessibleIds(req.user!.id, isAdmin, parsed.data.ids);
    if (ids.length === 0) {
      res.json({ restored: 0 });
      return;
    }
    const updated = await db
      .update(conversationsTable)
      .set({ isArchived: false })
      .where(inArray(conversationsTable.id, ids))
      .returning({ id: conversationsTable.id });
    res.json({ restored: updated.length });
  },
);

// Permanent delete — irreversible; the client shows a double confirmation.
router.post(
  "/inbox/conversations/bulk-delete",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "ids array required" });
      return;
    }
    const isAdmin = (ADMIN_ROLES as readonly string[]).includes(req.user!.role);
    const ids = await filterBulkAccessibleIds(req.user!.id, isAdmin, parsed.data.ids);
    if (ids.length === 0) {
      res.json({ deleted: 0 });
      return;
    }
    const deleted = await db.transaction(async (tx) => {
      await tx.delete(messagesTable).where(inArray(messagesTable.conversationId, ids));
      await tx
        .delete(conversationParticipantsTable)
        .where(inArray(conversationParticipantsTable.conversationId, ids));
      const rows = await tx
        .delete(conversationsTable)
        .where(inArray(conversationsTable.id, ids))
        .returning({ id: conversationsTable.id });
      return rows.length;
    });
    await logAudit(req.user!.id, "inbox_bulk_delete", "conversation", undefined, { ids, deleted }, req.ip);
    res.json({ deleted });
  },
);

router.post(
  "/inbox/conversations/:id/templates",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { templateId, parameters } = req.body as { templateId: number; parameters?: string[] };
    if (!id || !templateId) {
      res.status(400).json({ error: "templateId is required" });
      return;
    }
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || conv.channel !== "whatsapp") {
      res.status(400).json({ error: "Templates are only supported on WhatsApp conversations" });
      return;
    }
    if (!conv.externalContactId) {
      res.status(400).json({ error: "Conversation has no external contact" });
      return;
    }
    const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
    if (!contact?.phoneE164) {
      res.status(400).json({ error: "Contact has no E.164 phone" });
      return;
    }
    const [tpl] = await db.select().from(messageTemplatesTable).where(eq(messageTemplatesTable.id, templateId));
    if (!tpl || !tpl.externalTemplateName) {
      res.status(400).json({ error: "Template missing externalTemplateName" });
      return;
    }

    // Pre-send guard: the number of provided parameters MUST exactly match
    // the template body's placeholder count ({{1}}, {{2}}, …) — otherwise
    // Meta rejects the send with the opaque error 132000. Fail early with a
    // human-readable message instead.
    const placeholderMatches = (tpl.content || "").match(/\{\{\s*\d+\s*\}\}/g);
    const placeholderCount = placeholderMatches ? new Set(placeholderMatches.map((m) => m.replace(/\D/g, ""))).size : 0;
    const providedParams = parameters || [];
    if (providedParams.length !== placeholderCount) {
      res.status(400).json({
        error: `Template gönderilemedi: şablonda ${placeholderCount} değişken var, ${providedParams.length} değer girildi. Lütfen tüm değişkenleri doldurun.`,
      });
      return;
    }

    // Route through Zernio for Zernio-hosted numbers; fall back to Meta Cloud
    // only when the account is not Zernio (which currently never applies — we
    // have no direct Meta Cloud credentials).
    const zernioAcctForTpl = await resolveZernioAccount(conv.channelAccountId);
    let result: { ok: boolean; externalMessageId?: string; error?: string; simulated: boolean; broadcastId?: string };
    if (zernioAcctForTpl) {
      // Zernio has no per-conversation template endpoint — templates go out
      // through the 3-step broadcast flow keyed by the recipient's phone.
      const phoneE164 = toE164(contact.phoneE164) || (contact.phoneE164.startsWith("+") ? contact.phoneE164 : null);
      if (!phoneE164) {
        res.status(400).json({ error: "Template gönderilemedi: alıcının telefon numarası E.164 formatına çevrilemedi." });
        return;
      }
      const zr = await sendZernioTemplate({
        externalAccountId: zernioAcctForTpl.externalAccountId,
        templateName: tpl.externalTemplateName,
        language: tpl.language || "en",
        toPhoneE164: phoneE164,
        parameters: providedParams,
        recipientLabel: contact.displayName || phoneE164,
      });
      result = { ok: zr.ok, externalMessageId: zr.externalMessageId, error: zr.error, broadcastId: zr.broadcastId, simulated: false };
    } else {
      const cfg: WhatsAppConfig = (await resolveOutboundConfig<WhatsAppConfig>("whatsapp", conv.channelAccountId)) || {};
      result = await sendWhatsAppTemplate({
        config: cfg,
        toPhoneE164: contact.phoneE164,
        templateName: tpl.externalTemplateName,
        language: tpl.language || "en",
        parameters: parameters || [],
      });
    }

    const renderedContent = (parameters || []).reduce<string>(
      (acc, val, idx) => acc.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, "g"), val),
      tpl.content,
    );

    const [msg] = await db
      .insert(messagesTable)
      .values({
        conversationId: id,
        senderId: req.user!.id,
        content: renderedContent,
        channel: "whatsapp",
        direction: "outbound",
        status: result.ok ? "sent" : "failed",
        externalMessageId: result.externalMessageId || null,
        failedReason: result.ok ? null : result.error || "send_failed",
        sentAt: result.ok ? new Date() : null,
        metadata: {
          simulated: result.simulated,
          template: tpl.externalTemplateName,
          // Broadcast is asynchronous — the delivery/read webhook is matched
          // back to this message via the Zernio broadcast id.
          ...(result.broadcastId ? { broadcastId: result.broadcastId } : {}),
        },
      })
      .returning();
    if (result.ok) {
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: new Date(), lastMessagePreview: renderedContent.slice(0, 200) })
        .where(eq(conversationsTable.id, id));
      inboxBus.publish({
        type: "message",
        conversationId: id,
        channel: "whatsapp",
        assignedToId: conv.assignedToId ?? null,
        unmatched: conv.unmatched,
        direction: "outbound",
      });
    }
    res.status(result.ok ? 201 : 502).json({ message: msg, simulated: result.simulated, error: result.error });
  },
);

/**
 * Layer A — WhatsApp Cloud API template management, proxied through Zernio
 * (the account is hosted on Zernio, same reasoning as zernioSend.ts). Listing
 * also syncs the results into `message_templates` (matched by
 * externalTemplateName+language) so the existing send flow
 * (POST /inbox/conversations/:id/templates) keeps working unchanged and the
 * Templates management page can show both "our" canned responses and the
 * Meta-approved templates in one place.
 */
router.get(
  "/inbox/whatsapp-templates",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const channelAccountId = req.query.channelAccountId ? parseInt(String(req.query.channelAccountId), 10) : undefined;
    const account = await resolveZernioWhatsAppAccount(channelAccountId);
    if (!account) {
      res.status(400).json({ error: "No Zernio-hosted WhatsApp channel account configured" });
      return;
    }
    const outcome = await listZernioWhatsAppTemplates(account.externalAccountId);
    if (!outcome.ok) {
      res.status(502).json({ error: outcome.error || "Failed to load WhatsApp templates from Zernio" });
      return;
    }

    // Upsert each approved/pending template into message_templates so it's
    // immediately selectable in the existing "send template" flow.
    for (const tpl of outcome.templates) {
      if (!tpl.name) continue;
      const [existing] = await db
        .select()
        .from(messageTemplatesTable)
        .where(and(eq(messageTemplatesTable.externalTemplateName, tpl.name), eq(messageTemplatesTable.language, tpl.language)));
      if (existing) {
        await db
          .update(messageTemplatesTable)
          .set({
            content: tpl.bodyText || existing.content,
            category: tpl.category || existing.category,
            approvalStatus: tpl.status,
            variables: Array.from({ length: tpl.variableCount }, (_, i) => `{{${i + 1}}}`),
          })
          .where(eq(messageTemplatesTable.id, existing.id));
      } else {
        await db.insert(messageTemplatesTable).values({
          name: tpl.name,
          category: tpl.category || "utility",
          content: tpl.bodyText || "",
          channel: "whatsapp",
          language: tpl.language,
          externalTemplateName: tpl.name,
          approvalStatus: tpl.status,
          variables: Array.from({ length: tpl.variableCount }, (_, i) => `{{${i + 1}}}`),
          createdById: req.user!.id,
        });
      }
    }

    const templates = await db
      .select()
      .from(messageTemplatesTable)
      .where(isNotNull(messageTemplatesTable.externalTemplateName))
      .orderBy(messageTemplatesTable.name);
    res.json({ data: templates });
  },
);

router.post(
  "/inbox/whatsapp-templates",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const { mode, name, language, category, bodyText, footerText, libraryTemplateName, channelAccountId } = req.body as {
      mode: "custom" | "library";
      name: string;
      language: string;
      category?: string;
      bodyText?: string;
      footerText?: string;
      libraryTemplateName?: string;
      channelAccountId?: number;
    };
    if (!mode || !name || !language) {
      res.status(400).json({ error: "mode, name and language are required" });
      return;
    }
    if (mode === "custom" && !bodyText?.trim()) {
      res.status(400).json({ error: "bodyText is required for custom templates" });
      return;
    }
    if (mode === "library" && !libraryTemplateName?.trim()) {
      res.status(400).json({ error: "libraryTemplateName is required for library templates" });
      return;
    }
    const account = await resolveZernioWhatsAppAccount(channelAccountId);
    if (!account) {
      res.status(400).json({ error: "No Zernio-hosted WhatsApp channel account configured" });
      return;
    }

    const outcome = await createZernioWhatsAppTemplate({
      externalAccountId: account.externalAccountId,
      mode,
      name,
      language,
      category,
      bodyText,
      footerText,
      libraryTemplateName,
    });
    if (!outcome.ok) {
      res.status(502).json({ error: outcome.error || "Failed to create WhatsApp template" });
      return;
    }

    const [template] = await db
      .insert(messageTemplatesTable)
      .values({
        name,
        category: category || "utility",
        content: mode === "custom" ? (bodyText || "") : `[library: ${libraryTemplateName}]`,
        channel: "whatsapp",
        language,
        externalTemplateName: name,
        approvalStatus: outcome.status || "pending",
        variables: mode === "custom" ? Array.from({ length: countVariablesForCreate(bodyText || "") }, (_, i) => `{{${i + 1}}}`) : [],
        createdById: req.user!.id,
      })
      .returning();

    await logAudit(req.user!.id, "create_whatsapp_template", "message_template", template.id, { name, mode, language }, req.ip);
    res.status(201).json({ data: template });
  },
);

function countVariablesForCreate(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  return matches ? new Set(matches).size : 0;
}

router.delete(
  "/inbox/whatsapp-templates/:templateName",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const templateName = String(req.params.templateName || "").trim();
    const channelAccountId = req.query.channelAccountId ? parseInt(String(req.query.channelAccountId), 10) : undefined;
    if (!templateName) {
      res.status(400).json({ error: "templateName is required" });
      return;
    }
    const account = await resolveZernioWhatsAppAccount(channelAccountId);
    if (!account) {
      res.status(400).json({ error: "No Zernio-hosted WhatsApp channel account configured" });
      return;
    }
    const outcome = await deleteZernioWhatsAppTemplate(account.externalAccountId, templateName);
    if (!outcome.ok) {
      res.status(502).json({ error: outcome.error || "Failed to delete WhatsApp template from Zernio" });
      return;
    }
    // Also remove the local message_templates record so it disappears from selectors.
    await db
      .delete(messageTemplatesTable)
      .where(eq(messageTemplatesTable.externalTemplateName, templateName));
    logAudit(req.user!.id, "delete_whatsapp_template", "message_template", undefined, { name: templateName }, req.ip);
    res.json({ ok: true });
  },
);

router.get(
  "/inbox/external-history",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const type = String(req.query.type || ""); // lead | student | agent
    const id = parseInt(String(req.query.id || ""), 10);
    if (!type || !id) {
      res.status(400).json({ error: "type and id required" });
      return;
    }
    if (type !== "lead" && type !== "student" && type !== "agent") {
      res.status(400).json({ error: "Invalid type" });
      return;
    }

    // 1) External conversations linked via external_contacts (WA + web_form).
    const extWhere =
      type === "lead"
        ? eq(externalContactsTable.leadId, id)
        : type === "student"
        ? eq(externalContactsTable.studentId, id)
        : eq(externalContactsTable.agentId, id);
    const contacts = await db.select().from(externalContactsTable).where(extWhere);
    const contactIds = contacts.map((c) => c.id);

    // 2) Internal conversations linked to the entity's user account, if any.
    //    Students and agents have a userId on their row; leads do not (they are
    //    pre-account prospects), so the internal union is a no-op for leads.
    let entityUserId: number | null = null;
    if (type === "student") {
      const [s] = await db
        .select({ userId: studentsTable.userId })
        .from(studentsTable)
        .where(eq(studentsTable.id, id))
        .limit(1);
      entityUserId = s?.userId ?? null;
    } else if (type === "agent") {
      const [a] = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, id))
        .limit(1);
      entityUserId = a?.userId ?? null;
    }

    let internalConvIds: number[] = [];
    if (entityUserId) {
      const parts = await db
        .select({ conversationId: conversationParticipantsTable.conversationId })
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.userId, entityUserId));
      internalConvIds = parts.map((p) => p.conversationId);
    }

    if (contactIds.length === 0 && internalConvIds.length === 0) {
      res.json({ conversations: [], messages: [], externalContacts: contacts });
      return;
    }

    // Union: external_contact-linked OR internal-participant-linked.
    const whereClauses = [];
    if (contactIds.length > 0) whereClauses.push(inArray(conversationsTable.externalContactId, contactIds));
    if (internalConvIds.length > 0) whereClauses.push(inArray(conversationsTable.id, internalConvIds));
    const conversations = await db
      .select()
      .from(conversationsTable)
      .where(whereClauses.length === 1 ? whereClauses[0] : or(...whereClauses))
      .orderBy(desc(conversationsTable.lastMessageAt));
    const convIds = conversations.map((c) => c.id);
    const messages = convIds.length
      ? await db
          .select()
          .from(messagesTable)
          .where(inArray(messagesTable.conversationId, convIds))
          .orderBy(desc(messagesTable.createdAt))
          .limit(500)
      : [];
    res.json({ conversations, messages, externalContacts: contacts });
  },
);

// ---------------------------------------------------------------------------
// Phase 2 — AI summarize + inline notes + inline follow-up tasks
// ---------------------------------------------------------------------------

router.post(
  "/inbox/conversations/:id/summarize",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: conversationIdParamSchema }),
  async (req, res): Promise<void> => {
    const { params } = getValidated<{ params: typeof conversationIdParamSchema }>(req);
    const conversationId = params.id;
    const userId = req.user!.id;

    // First, count messages — needed both to short-circuit empty conversations
    // and to key the cache. Then probe the cache *before* consuming any rate-
    // limit quota or acquiring a lock so repeated reads of a stable summary
    // stay cheap.
    const [conv] = await db
      .select({ id: conversationsTable.id, metadata: conversationsTable.metadata })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const [{ count: rawCount } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId));
    const messageCount = Number(rawCount) || 0;
    if (messageCount === 0) {
      res.status(400).json({ error: "No messages to summarize" });
      return;
    }

    const cached = readAiSummary(conv.metadata);
    if (cached && cached.messageCount === messageCount) {
      logAudit(userId, "conversation_summarize", "conversation", conversationId, {
        messageCount,
        fromCache: true,
      }, req.ip);
      res.json({ data: cached, fromCache: true });
      return;
    }

    // Cache miss — now charge a token against the per-user rate limit so the
    // expensive path is the only one that costs quota.
    try {
      await summarizeRateLimiter.consume(String(userId));
    } catch (rlErr) {
      const ms = (rlErr as { msBeforeNext?: number })?.msBeforeNext ?? 60000;
      res.setHeader("Retry-After", String(Math.ceil(ms / 1000)));
      res.status(429).json({ error: "Too many summarize requests. Please wait a moment." });
      return;
    }

    // Per-conversation advisory lock so two concurrent summarize requests for
    // the same conversation don't both call Anthropic. We use the
    // `pg_advisory_xact_lock` variant inside a transaction — it's released
    // automatically on COMMIT/ROLLBACK and survives if the request errors
    // out. After acquiring the lock we re-read metadata and re-check the
    // cache; the second caller will then hit the freshly-written summary.
    let summary: ConversationAiSummary;
    let fromCache = false;
    try {
      summary = await db.transaction(async (tx) => {
        // First key is a fixed namespace constant for "inbox.summarize"
        // (chosen arbitrarily — picked from task #216) so this lock cannot
        // collide with other advisory locks the app might add later.
        await tx.execute(sql`select pg_advisory_xact_lock(7216, ${conversationId})`);

        const [fresh] = await tx
          .select({ metadata: conversationsTable.metadata })
          .from(conversationsTable)
          .where(eq(conversationsTable.id, conversationId));
        const reCached = readAiSummary(fresh?.metadata);
        if (reCached && reCached.messageCount === messageCount) {
          fromCache = true;
          return reCached;
        }

        const transcript = await tx
          .select({
            direction: messagesTable.direction,
            content: messagesTable.content,
            createdAt: messagesTable.createdAt,
          })
          .from(messagesTable)
          .where(eq(messagesTable.conversationId, conversationId))
          .orderBy(asc(messagesTable.createdAt))
          .limit(50);

        const { content, model } = await generateConversationSummary({ messages: transcript });
        const next: ConversationAiSummary = {
          content,
          generatedAt: new Date().toISOString(),
          messageCount,
          model,
          generatedByUserId: userId,
        };

        // Atomic JSONB merge done in-database so a parallel writer that
        // updates a different metadata key (e.g. channel state) is preserved
        // instead of being clobbered by a stale read-modify-write.
        await tx
          .update(conversationsTable)
          .set({
            metadata: sql`coalesce(${conversationsTable.metadata}, '{}'::jsonb) || jsonb_build_object('aiSummary', ${JSON.stringify(next)}::jsonb)`,
          })
          .where(eq(conversationsTable.id, conversationId));

        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI service not configured";
      const isConfigError = /not configured|API key/i.test(message);
      res
        .status(502)
        .json({ error: isConfigError ? "AI service not configured" : `AI request failed: ${message}` });
      return;
    }

    logAudit(userId, "conversation_summarize", "conversation", conversationId, {
      messageCount,
      fromCache,
      model: summary.model,
    }, req.ip);

    res.json({ data: summary, fromCache });
  },
);

const conversationNoteBodySchema = z.object({
  content: z.string().min(1).max(2000),
});

router.post(
  "/inbox/conversations/:id/notes",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: conversationIdParamSchema, body: conversationNoteBodySchema }),
  async (req, res): Promise<void> => {
    const { params, body } = getValidated<{
      params: typeof conversationIdParamSchema;
      body: typeof conversationNoteBodySchema;
    }>(req);
    const conversationId = params.id;
    const userId = req.user!.id;

    const link = await loadConversationLink(conversationId);
    if (!link) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!link.leadId && !link.studentId) {
      res.status(400).json({ error: "This conversation is not linked to a lead or student" });
      return;
    }

    // Student takes priority: a converted lead has both leadId and studentId set;
    // notes should attach to the student (canonical post-conversion anchor).
    const primaryResourceType: "lead" | "student" = link.studentId ? "student" : "lead";
    const primaryResourceId = (link.studentId ?? link.leadId) as number;

    // Both inserts share a transaction so a failed cross-link does not leave
    // the primary note orphaned (or vice versa).
    const primaryNote = await db.transaction(async (tx) => {
      const [primary] = await tx
        .insert(notesTable)
        .values({
          content: body.content,
          authorId: userId,
          resourceType: primaryResourceType,
          resourceId: primaryResourceId,
          isInternal: true,
        })
        .returning();

      // Cross-link copy so a future inbox-side notes view can list notes by
      // conversation id without joining through external_contacts.
      await tx.insert(notesTable).values({
        content: body.content,
        authorId: userId,
        resourceType: "conversation",
        resourceId: conversationId,
        isInternal: true,
      });

      return primary;
    });

    logAudit(userId, "conversation_note_create", "conversation", conversationId, {
      noteId: primaryNote.id,
      resourceType: primaryResourceType,
      resourceId: primaryResourceId,
    }, req.ip);

    res.status(201).json({
      data: {
        id: primaryNote.id,
        content: primaryNote.content,
        createdAt: primaryNote.createdAt,
        resourceType: primaryResourceType,
        resourceId: primaryResourceId,
      },
    });
  },
);

const conversationTaskBodySchema = z.object({
  title: z.string().min(1).max(500),
  scheduledAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "scheduledAt must be a valid ISO datetime",
  }),
  assignedToId: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  "/inbox/conversations/:id/tasks",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: conversationIdParamSchema, body: conversationTaskBodySchema }),
  async (req, res): Promise<void> => {
    const { params, body } = getValidated<{
      params: typeof conversationIdParamSchema;
      body: typeof conversationTaskBodySchema;
    }>(req);
    const conversationId = params.id;
    const userId = req.user!.id;

    const link = await loadConversationLink(conversationId);
    if (!link) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!link.leadId && !link.studentId) {
      res.status(400).json({ error: "This conversation is not linked to a lead or student" });
      return;
    }

    // Student takes priority: a converted lead has both leadId and studentId set;
    // follow-ups should attach to the student (canonical post-conversion anchor).
    const resourceType: "lead" | "student" = link.studentId ? "student" : "lead";
    const [task] = await db
      .insert(followUpsTable)
      .values({
        leadId: link.leadId,
        studentId: link.studentId,
        resourceType,
        title: body.title,
        scheduledAt: new Date(body.scheduledAt),
        assignedToId: body.assignedToId ?? userId,
        notes: body.notes ?? null,
        createdById: userId,
      })
      .returning();

    logAudit(userId, "conversation_task_create", "conversation", conversationId, {
      taskId: task.id,
      resourceType,
      leadId: link.leadId,
      studentId: link.studentId,
    }, req.ip);

    res.status(201).json({ data: task });
  },
);

// ---------------------------------------------------------------------------
// AI Agent admin panel (FAZ 2) — manage the DB-managed ai_agent config and run
// the Test Console. Admin-only on every endpoint. The config is the same FAZ 1
// single source of truth read by the auto-reply engine.
// ---------------------------------------------------------------------------

// GET /inbox/ai-agent/config — read the live AI agent config (merged over
// safe defaults).
router.get(
  "/inbox/ai-agent/config",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const config = await getAiAgentConfig();
    res.json({ config });
  },
);

// PUT /inbox/ai-agent/config — validate and persist a (partial) config patch.
// Returns the merged, validated config.
router.put(
  "/inbox/ai-agent/config",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const parsed = aiAgentConfigPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid config", details: parsed.error.flatten() });
      return;
    }
    try {
      const config = await writeAiAgentConfig(parsed.data);
      logAudit(req.user!.id, "update_ai_agent_config", "integration", undefined, {
        enabled: config.enabled,
        model: config.model,
      }, req.ip);
      res.json({ config });
    } catch (err) {
      // writeAiAgentConfig re-validates the merged result; a merge that produces
      // an invalid config (e.g. an empty knowledge base) surfaces here.
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid config", details: err.flatten() });
        return;
      }
      throw err;
    }
  },
);

// POST /inbox/ai-agent/test — run the bot brain against a sample message and
// (optional) history, returning the would-be reply, detected language, and
// escalation result. Sends NOTHING.
const aiAgentTestSchema = z.object({
  message: z.string().min(1).max(4000),
  language: z.enum(["tr", "en", "ar", "ru", "fr"]).optional(),
  history: z
    .array(
      z.object({
        direction: z.enum(["inbound", "outbound"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(40)
    .optional(),
});

router.post(
  "/inbox/ai-agent/test",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const parsed = aiAgentTestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await runBotReplyTest({
        message: parsed.data.message,
        language: parsed.data.language,
        history: parsed.data.history,
      });
      res.json({ result });
    } catch (err) {
      console.error("[ai-agent-test]", err);
      res.status(502).json({ error: "Test run failed" });
    }
  },
);

// ---------------------------------------------------------------------------
// Knowledge Sources (FAZ 1 scaffold) — admin-only management of the
// program_scope source. This mirrors onto AiAgentConfig.programScope so the
// live searchPrograms tool and this admin surface can never drift apart (see
// writeProgramScopeSource in lib/inbox/knowledgeSources.ts).
// ---------------------------------------------------------------------------

const programScopeSchema = z.object({
  enabled: z.boolean(),
  countries: z.union([z.array(z.string()), z.literal("all")]),
  universityTypes: z.union([z.array(z.string()), z.literal("all")]),
});
const knowledgeSourceProgramScopeSchema = z.object({
  isActive: z.boolean(),
  scope: programScopeSchema,
});

// GET /inbox/knowledge-sources/program-scope — read the program_scope source
// (falls back to the AiAgentConfig default when the row hasn't been seeded
// yet, e.g. a brand-new environment before its first boot cycle).
router.get(
  "/inbox/knowledge-sources/program-scope",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const source = await getProgramScopeSource();
    if (source) {
      res.json({ source: { isActive: source.isActive, scope: source.scope, lastSyncedAt: source.lastSyncedAt } });
      return;
    }
    const config = await getAiAgentConfig();
    res.json({ source: { isActive: true, scope: config.programScope, lastSyncedAt: null } });
  },
);

// PUT /inbox/knowledge-sources/program-scope — validate and persist the
// program_scope source + mirror onto AiAgentConfig.programScope.
router.put(
  "/inbox/knowledge-sources/program-scope",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const parsed = knowledgeSourceProgramScopeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const source = await writeProgramScopeSource(parsed.data);
    logAudit(req.user!.id, "update_knowledge_source_program_scope", "integration", undefined, {
      isActive: source.isActive,
      enabled: source.scope.enabled,
    }, req.ip);
    res.json({ source: { isActive: source.isActive, scope: source.scope, lastSyncedAt: source.lastSyncedAt } });
  },
);

// ---------------------------------------------------------------------------
// AI Agent Faz 2 — external knowledge sources (file/url/text) RAG CRUD
// ---------------------------------------------------------------------------

const createRagSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    name: z.string().min(1).max(200),
    objectPath: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
  }),
  z.object({
    type: z.literal("url"),
    name: z.string().min(1).max(200),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal("text"),
    name: z.string().min(1).max(200),
    rawText: z.string().min(1).max(400_000),
  }),
]);
const updateRagSourceSchema = z.object({
  isActive: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
});

function ragSourceConfigFromInput(input: z.infer<typeof createRagSourceSchema>): Record<string, unknown> {
  if (input.type === "file") return { objectPath: input.objectPath, fileName: input.fileName, mimeType: input.mimeType };
  if (input.type === "url") return { url: input.url };
  return { rawText: input.rawText };
}

// GET /inbox/knowledge-sources/rag — list all admin-managed file/url/text
// knowledge sources with their processing status and chunk counts.
router.get(
  "/inbox/knowledge-sources/rag",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const sources = await listRagSources();
    res.json({ sources });
  },
);

// POST /inbox/knowledge-sources/rag — register a new file/url/text source and
// kick off (async) extraction + chunking + embedding.
router.post(
  "/inbox/knowledge-sources/rag",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const parsed = createRagSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const source = await createRagSource({
      type: parsed.data.type,
      name: parsed.data.name,
      config: ragSourceConfigFromInput(parsed.data),
    });
    logAudit(req.user!.id, "create_knowledge_source_rag", "integration", source.id, { type: source.type, name: source.name }, req.ip);
    res.status(201).json({ source });
  },
);

// PATCH /inbox/knowledge-sources/rag/:id — toggle active state or rename.
router.patch(
  "/inbox/knowledge-sources/rag/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const parsed = updateRagSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const source = await updateRagSource(id, parsed.data);
    if (!source) { res.status(404).json({ error: "Not found" }); return; }
    logAudit(req.user!.id, "update_knowledge_source_rag", "integration", id, parsed.data, req.ip);
    res.json({ source });
  },
);

// POST /inbox/knowledge-sources/rag/:id/reprocess — re-run extraction+embedding.
router.post(
  "/inbox/knowledge-sources/rag/:id/reprocess",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const ok = await reprocessRagSource(id);
    if (!ok) { res.status(404).json({ error: "Not found" }); return; }
    logAudit(req.user!.id, "reprocess_knowledge_source_rag", "integration", id, {}, req.ip);
    res.json({ success: true });
  },
);

// DELETE /inbox/knowledge-sources/rag/:id — remove a source and its chunks.
router.delete(
  "/inbox/knowledge-sources/rag/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const ok = await deleteRagSource(id);
    if (!ok) { res.status(404).json({ error: "Not found" }); return; }
    logAudit(req.user!.id, "delete_knowledge_source_rag", "integration", id, {}, req.ip);
    res.json({ success: true });
  },
);

// ── Per-conversation star toggle (per-user) ──────────────────────────────────
router.post(
  "/inbox/conversations/:id/star",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const userId = req.user!.id;
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const [existing] = await db
      .select()
      .from(conversationParticipantsTable)
      .where(and(eq(conversationParticipantsTable.conversationId, id), eq(conversationParticipantsTable.userId, userId)))
      .limit(1);

    if (existing) {
      await db
        .update(conversationParticipantsTable)
        .set({ isStarred: !existing.isStarred })
        .where(eq(conversationParticipantsTable.id, existing.id));
      res.json({ starred: !existing.isStarred });
    } else {
      await db.insert(conversationParticipantsTable).values({ conversationId: id, userId, isStarred: true });
      res.json({ starred: true });
    }
  },
);

// ── "Add as Document" — save an inbound attachment as a Lead/Student document ─
//
// Resolves the attachment from the stored message metadata (Zernio: url field;
// WhatsApp Cloud API: media ID in metadata.raw → fetches download URL via WA API).
// Validates file type (PDF/JPG/PNG), checks for duplicate (same attachment + owner)
// and type conflict (same doc type + owner), then uploads to object storage and
// creates the document row with source-tracking columns.
//
// Body: { ownerType: "lead"|"student", ownerId: number, documentType: "diploma_certificate"|"diploma_transcript"|"passport"|"photo"|"cv"|"other_certificates_documents" }

function mimeToExt(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "bin";
}


router.post(
  "/inbox/conversations/:id/messages/:msgId/attachments/:attachId/save-as-document",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const conversationId = parseInt(String(req.params.id), 10);
    const msgId = parseInt(String(req.params.msgId), 10);
    const attachIndex = parseInt(String(req.params.attachId), 10);

    if (!conversationId || !msgId || isNaN(attachIndex) || attachIndex < 0) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    const { ownerType, ownerId: ownerIdRaw, documentType, force, setAsPhoto = true } = req.body;
    const ownerId = Number(ownerIdRaw);

    const VALID_SAVE_AS_DOC_TYPES = [
      "diploma_certificate", "diploma_transcript", "passport", "photo", "cv", "other_certificates_documents",
      // Legacy aliases kept for backward compatibility
      "diploma", "transcript", "photograph",
    ] as const;
    if (!documentType || typeof documentType !== "string" || !documentType.trim()) {
      res.status(400).json({ error: "documentType is required" });
      return;
    }
    if (!(VALID_SAVE_AS_DOC_TYPES as readonly string[]).includes(documentType.trim())) {
      res.status(400).json({
        error: `documentType must be one of: ${VALID_SAVE_AS_DOC_TYPES.join(", ")}`,
      });
      return;
    }
    if (ownerType !== "lead" && ownerType !== "student") {
      res.status(400).json({ error: "ownerType must be 'lead' or 'student'" });
      return;
    }
    if (!ownerId || isNaN(ownerId)) {
      res.status(400).json({ error: "ownerId is required" });
      return;
    }

    // Load conversation
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    // Load message (must belong to this conversation)
    const [msg] = await db.select().from(messagesTable).where(
      and(eq(messagesTable.id, msgId), eq(messagesTable.conversationId, conversationId))
    );
    if (!msg) { res.status(404).json({ error: "Message not found" }); return; }

    // Extract attachment info from message metadata.
    // For Zernio: metadata.attachment or metadata.attachments[index].url
    // For WhatsApp: metadata.raw.{image|document|video|audio}.id
    const meta = (msg.metadata ?? {}) as Record<string, any>;
    const zernioAtts: Array<Record<string, any>> = [
      ...(meta.attachment && typeof meta.attachment === "object" ? [meta.attachment as Record<string, any>] : []),
      ...(Array.isArray(meta.attachments) ? (meta.attachments as Record<string, any>[]) : []),
    ];

    let attachUrl: string | null = null;
    let attachMimeType: string | null = null;
    let attachName: string | null = null;
    let waMediaId: string | null = null;

    if (attachIndex < zernioAtts.length) {
      const att = zernioAtts[attachIndex];
      attachUrl = String(att?.url ?? att?.fileUrl ?? "").trim() || null;
      attachMimeType = String(att?.mimeType ?? att?.mime_type ?? "").trim() || null;
      attachName = String(att?.name ?? att?.filename ?? "").trim() || null;
    }

    // WhatsApp: media object lives in metadata.raw under the message type key
    if (!attachUrl && meta.raw && typeof meta.raw === "object" && attachIndex === 0) {
      const raw = meta.raw as Record<string, any>;
      const mediaType = String(raw.type ?? "");
      const mediaObj = mediaType ? (raw[mediaType] as Record<string, any> | undefined) : undefined;
      if (mediaObj?.id) {
        waMediaId = String(mediaObj.id);
        attachMimeType = attachMimeType || String(mediaObj.mime_type ?? "").trim() || null;
        attachName = attachName || String(mediaObj.filename ?? mediaObj.file_name ?? "").trim() || null;
      }
    }

    if (!attachUrl && !waMediaId) {
      res.status(404).json({ error: "Attachment not found at this index" });
      return;
    }

    const sourceAttachmentId = `${msgId}:${attachIndex}`;

    // Duplicate guard: same source_attachment_id + same owner already saved
    const ownerCondition = ownerType === "student"
      ? eq(documentsTable.studentId, ownerId)
      : eq(documentsTable.leadId, ownerId);

    const [dupDoc] = await db.select({ id: documentsTable.id })
      .from(documentsTable)
      .where(and(
        eq(documentsTable.sourceAttachmentId, sourceAttachmentId),
        ownerCondition,
        isNull(documentsTable.deletedAt)
      ));
    if (dupDoc) {
      // Not an error from the caller's perspective — the attachment already
      // lives on this owner (e.g. it was saved to the lead and then adopted
      // onto the student by the match flow). Report it as already saved.
      res.status(409).json({
        error: "This attachment has already been saved as a document for this owner",
        alreadySaved: true,
        existingDocumentId: dupDoc.id,
      });
      return;
    }

    // Conflict check: same doc type + same owner already exists (profile-level).
    // Skipped when `force: true` is passed (user chose "Add as New Version").
    if (!force) {
      const [conflictDoc] = await db.select({ id: documentsTable.id })
        .from(documentsTable)
        .where(and(
          eq(documentsTable.type, documentType),
          ownerCondition,
          isNull(documentsTable.applicationId),
          isNull(documentsTable.deletedAt)
        ));
      if (conflictDoc) {
        // Return 200 with conflict flag so frontend can prompt the user to decide
        res.json({ conflict: true, existingDocumentId: conflictDoc.id });
        return;
      }
    }

    // ── Reuse already-stored bytes when available ───────────────────────────
    // If this exact attachment was previously saved as a document for ANY
    // owner (e.g. staged on the lead before the student existed), reuse its
    // stored fileKey instead of re-downloading — WhatsApp media URLs expire,
    // which used to make every re-save fail with a download error.
    const [storedTwin] = await db.select({
      fileKey: documentsTable.fileKey,
      mimeType: documentsTable.mimeType,
      sizeBytes: documentsTable.sizeBytes,
      name: documentsTable.name,
    })
      .from(documentsTable)
      .where(and(
        eq(documentsTable.sourceAttachmentId, sourceAttachmentId),
        eq(documentsTable.sourceMessageId, msgId),
        isNotNull(documentsTable.fileKey),
        isNull(documentsTable.deletedAt),
      ))
      .limit(1);

    // ── Download media bytes ────────────────────────────────────────────────
    let fileBuffer: Buffer | null = null;
    let resolvedMimeType: string;
    let resolvedFilename: string;
    let reusedFileKey: string | null = null;
    let reusedSizeBytes: number | null = null;

    if (storedTwin?.fileKey) {
      reusedFileKey = storedTwin.fileKey;
      reusedSizeBytes = storedTwin.sizeBytes ?? null;
      resolvedMimeType = storedTwin.mimeType || attachMimeType || "application/octet-stream";
      resolvedFilename = sanitizeFileName(attachName || `attachment.${mimeToExt(resolvedMimeType)}`);
    } else try {
      if (waMediaId) {
        // WhatsApp Cloud API: resolve download URL then download with Bearer token
        const waConfig = await resolveOutboundConfig<WhatsAppConfig>("whatsapp", conv.channelAccountId);
        const accessToken = (waConfig?.accessToken ?? process.env.WA_ACCESS_TOKEN ?? "").trim();
        if (!accessToken) {
          res.status(502).json({ error: "WhatsApp access token not configured" });
          return;
        }

        // Step 1: get media info (URL + mime_type) from Graph API
        const infoRes = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${waMediaId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!infoRes.ok) {
          console.error(`[INBOX save-as-doc] WA media info failed ${infoRes.status} for ${waMediaId}`);
          res.status(502).json({ error: "Failed to retrieve WhatsApp media info" });
          return;
        }
        const mediaInfo = await infoRes.json() as { url?: string; mime_type?: string; file_size?: number };
        if (!mediaInfo.url) {
          res.status(502).json({ error: "WhatsApp media URL not returned" });
          return;
        }
        resolvedMimeType = attachMimeType || mediaInfo.mime_type || "application/octet-stream";

        // Step 2: download the media bytes with the same Bearer token
        const mediaRes = await fetch(mediaInfo.url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!mediaRes.ok) {
          console.error(`[INBOX save-as-doc] WA media download failed ${mediaRes.status}`);
          res.status(502).json({ error: "Failed to download WhatsApp media" });
          return;
        }
        fileBuffer = Buffer.from(await mediaRes.arrayBuffer());
        resolvedFilename = sanitizeFileName(attachName || `attachment.${mimeToExt(resolvedMimeType)}`);
      } else {
        // Zernio or direct URL — add Bearer auth only for zernio.com hosts
        const fetchHeaders: Record<string, string> = {};
        try {
          const parsed = new URL(attachUrl!);
          if (parsed.hostname === "zernio.com") {
            const apiKey = await getZernioApiKey();
            if (apiKey) fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
          }
        } catch { /* non-parseable URL — will fail on fetch below */ }

        const mediaRes = await fetch(attachUrl!, { headers: fetchHeaders, redirect: "follow" });
        if (!mediaRes.ok) {
          console.error(`[INBOX save-as-doc] Attachment download failed ${mediaRes.status}: ${attachUrl}`);
          res.status(502).json({ error: "Failed to download attachment" });
          return;
        }
        const contentType = mediaRes.headers.get("content-type") || "application/octet-stream";
        fileBuffer = Buffer.from(await mediaRes.arrayBuffer());
        resolvedMimeType = attachMimeType || contentType.split(";")[0].trim();
        resolvedFilename = sanitizeFileName(attachName || `attachment.${mimeToExt(resolvedMimeType)}`);
      }
    } catch (err: any) {
      console.error("[INBOX save-as-doc] media fetch error:", err?.message ?? err);
      res.status(502).json({ error: "Failed to fetch attachment" });
      return;
    }

    // ── Validate file type and size (skipped for reused, already-validated bytes)
    let fileKey: string;
    let finalSizeBytes: number;
    if (reusedFileKey) {
      fileKey = reusedFileKey;
      finalSizeBytes = reusedSizeBytes ?? 0;
    } else {
      const buf = fileBuffer!;
      const validationError = validateUploadedFile(resolvedFilename, resolvedMimeType, buf.length);
      if (validationError) {
        res.status(validationError.type === "size_exceeded" ? 413 : 400).json({ error: validationError.message });
        return;
      }
      const bufferError = await validateUploadedFileBuffer(resolvedFilename, resolvedMimeType, buf.slice(0, 4100));
      if (bufferError) {
        res.status(bufferError.type === "size_exceeded" ? 413 : 400).json({ error: bufferError.message });
        return;
      }

      // ── Upload to object storage ──────────────────────────────────────────
      const storage = new ObjectStorageService();
      fileKey = await storage.uploadBuffer({
        subdir: "inbox-docs",
        filename: resolvedFilename,
        buffer: buf,
        contentType: resolvedMimeType,
      });
      finalSizeBytes = buf.length;
    }

    // ── Resolve owner name for descriptive document name ────────────────────
    let ownerFirstName: string | null = null;
    let ownerLastName: string | null = null;
    if (ownerType === "student") {
      const [s] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
        .from(studentsTable).where(eq(studentsTable.id, ownerId));
      ownerFirstName = s?.firstName ?? null;
      ownerLastName = s?.lastName ?? null;
    } else {
      const [l] = await db.select({ firstName: leadsTable.firstName, lastName: leadsTable.lastName })
        .from(leadsTable).where(eq(leadsTable.id, ownerId));
      ownerFirstName = l?.firstName ?? null;
      ownerLastName = l?.lastName ?? null;
    }
    const docName = buildDocNameFromParts(ownerFirstName, ownerLastName, documentType, resolvedMimeType);

    // ── Create document record ──────────────────────────────────────────────
    const [doc] = await db.insert(documentsTable).values({
      name: docName,
      type: documentType,
      status: "pending",
      studentId: ownerType === "student" ? ownerId : null,
      leadId: ownerType === "lead" ? ownerId : null,
      applicationId: null,
      fileKey,
      mimeType: resolvedMimeType,
      sizeBytes: finalSizeBytes,
      source: "inbox",
      sourceConversationId: conversationId,
      sourceMessageId: msgId,
      sourceAttachmentId,
    }).returning();

    // Sync has_photo flag when a photo document is saved for a student.
    // Skipped when setAsPhoto === false (user chose "Add as Document Only" without
    // setting it as the profile photo).
    if (ownerType === "student" && (documentType === "photo" || documentType === "photograph") && setAsPhoto !== false) {
      await recomputeStudentPhoto(ownerId);
    }

    // ── Audit log ───────────────────────────────────────────────────────────
    await writeAudit({
      userId: req.user!.id,
      action: "inbox_save_as_document",
      resource: "document",
      resourceId: doc.id,
      changes: {
        sourceConversationId: conversationId,
        sourceMessageId: msgId,
        sourceAttachmentId,
        documentType,
        ownerType,
        ownerId,
      },
      ipAddress: req.ip,
    });

    res.status(201).json(doc);
  }
);

// ── Server-side AI extraction for unmatched student creation ──────────────────
//
// Downloads the attachment server-side (so auth tokens for WA/Zernio are
// always available) and calls the AI extraction endpoint logic. Returns the
// same { extracted } shape as POST /api/ai/extract-document. When the media
// cannot be fetched, returns { extracted: {} } — never an error — so the
// CreateStudentAndAddDocumentModal still advances to the form step with the
// contact-name/phone prefill applied.
const EXTRACT_FOR_STUDENT_ALLOWED_TYPES = ["diploma", "transcript", "passport", "photograph"] as const;
const EXTRACT_FOR_STUDENT_PROMPT = `You are an expert document analysis system for an education consultancy.
Analyze the provided document image(s) and extract student information.

Extract ALL of the following fields if visible in the document. Return a JSON object with these exact keys:
{
  "firstName": "string or null - EXACTLY as printed on the document, preserving original spelling and capitalization",
  "lastName": "string or null - EXACTLY as printed on the document, preserving original spelling and capitalization",
  "dateOfBirth": "YYYY-MM-DD format or null",
  "nationality": "country name string (e.g. 'Afghanistan' not 'Afghan', 'Turkey' not 'Turkish', 'Iran' not 'Iranian', 'Pakistan' not 'Pakistani', 'Uzbekistan' not 'Uzbek', 'India' not 'Indian') or null",
  "passportNumber": "string or null",
  "passportExpiry": "YYYY-MM-DD format or null",
  "motherName": "string or null - EXACTLY as printed on the document",
  "fatherName": "string or null - EXACTLY as printed on the document",
  "email": "string or null",
  "phone": "string or null",
  "highSchool": "string or null",
  "graduationYear": "number or null",
  "gpa": "string or null",
  "documentType": "passport|diploma|transcript|photo|other",
  "confidence": "high|medium|low"
}
Rules:
- Extract names EXACTLY as they appear on the document. Do NOT modify, translate, or reformat names.
- Always normalize dates to YYYY-MM-DD format
- For nationality: always return the full country name (e.g. "Turkey" not "Turkish")
- Return ONLY the JSON object, no other text
- Set null for fields you cannot find`;

router.post(
  "/inbox/conversations/:id/messages/:msgId/attachments/:idx/extract-for-student",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const conversationId = parseInt(String(req.params.id), 10);
    const msgId = parseInt(String(req.params.msgId), 10);
    const attachIndex = parseInt(String(req.params.idx), 10);

    if (!conversationId || !msgId || isNaN(attachIndex) || attachIndex < 0) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    const { docType } = req.body as { docType?: string };

    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    const [msg] = await db.select().from(messagesTable).where(
      and(eq(messagesTable.id, msgId), eq(messagesTable.conversationId, conversationId))
    );
    if (!msg) { res.status(404).json({ error: "Message not found" }); return; }

    const meta = (msg.metadata ?? {}) as Record<string, any>;
    const zernioAtts: Array<Record<string, any>> = [
      ...(meta.attachment && typeof meta.attachment === "object" ? [meta.attachment as Record<string, any>] : []),
      ...(Array.isArray(meta.attachments) ? (meta.attachments as Record<string, any>[]) : []),
    ];

    let attachUrl: string | null = null;
    let attachMimeType: string | null = null;
    let waMediaId: string | null = null;

    if (attachIndex < zernioAtts.length) {
      const att = zernioAtts[attachIndex];
      attachUrl = String(att?.url ?? att?.fileUrl ?? "").trim() || null;
      attachMimeType = String(att?.mimeType ?? att?.mime_type ?? "").trim() || null;
    }

    if (!attachUrl && meta.raw && typeof meta.raw === "object" && attachIndex === 0) {
      const raw = meta.raw as Record<string, any>;
      const mediaType = String(raw.type ?? "");
      const mediaObj = mediaType ? (raw[mediaType] as Record<string, any> | undefined) : undefined;
      if (mediaObj?.id) {
        waMediaId = String(mediaObj.id);
        attachMimeType = attachMimeType || String(mediaObj.mime_type ?? "").trim() || null;
      }
    }

    if (!attachUrl && !waMediaId) {
      res.json({ extracted: {} });
      return;
    }

    // ── Download media bytes server-side ────────────────────────────────────
    let fileBuffer: Buffer;
    let resolvedMimeType: string;

    try {
      if (waMediaId) {
        const waConfig = await resolveOutboundConfig<WhatsAppConfig>("whatsapp", conv.channelAccountId);
        const accessToken = (waConfig?.accessToken ?? process.env.WA_ACCESS_TOKEN ?? "").trim();
        if (!accessToken) {
          res.json({ extracted: {} });
          return;
        }
        const infoRes = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${waMediaId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!infoRes.ok) {
          console.warn(`[INBOX extract-for-student] WA media info failed ${infoRes.status} for ${waMediaId}`);
          res.json({ extracted: {} });
          return;
        }
        const mediaInfo = await infoRes.json() as { url?: string; mime_type?: string };
        if (!mediaInfo.url) {
          res.json({ extracted: {} });
          return;
        }
        resolvedMimeType = attachMimeType || mediaInfo.mime_type || "application/octet-stream";
        const mediaRes = await fetch(mediaInfo.url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!mediaRes.ok) {
          console.warn(`[INBOX extract-for-student] WA media download failed ${mediaRes.status}`);
          res.json({ extracted: {} });
          return;
        }
        fileBuffer = Buffer.from(await mediaRes.arrayBuffer());
      } else {
        const fetchHeaders: Record<string, string> = {};
        try {
          const parsed = new URL(attachUrl!);
          if (parsed.hostname === "zernio.com") {
            const apiKey = await getZernioApiKey();
            if (apiKey) fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
          }
        } catch { /* non-parseable URL */ }

        const mediaRes = await fetch(attachUrl!, { headers: fetchHeaders, redirect: "follow" });
        if (!mediaRes.ok) {
          console.warn(`[INBOX extract-for-student] Attachment download failed ${mediaRes.status}: ${attachUrl}`);
          res.json({ extracted: {} });
          return;
        }
        const contentType = mediaRes.headers.get("content-type") || "application/octet-stream";
        fileBuffer = Buffer.from(await mediaRes.arrayBuffer());
        resolvedMimeType = attachMimeType || contentType.split(";")[0].trim();
      }
    } catch (err: any) {
      console.warn("[INBOX extract-for-student] media fetch error:", err?.message ?? err);
      res.json({ extracted: {} });
      return;
    }

    // ── Run AI extraction ───────────────────────────────────────────────────
    try {
      const anthropic = await getAnthropicClient();
      const isImage = resolvedMimeType.startsWith("image/");
      const base64 = fileBuffer.toString("base64");
      const label = docType && EXTRACT_FOR_STUDENT_ALLOWED_TYPES.includes(docType as any) ? docType : "document";

      const contentBlocks: any[] = [
        { type: "text", text: EXTRACT_FOR_STUDENT_PROMPT },
        { type: "text", text: `\n--- Document: ${label} ---` },
      ];

      if (isImage) {
        const validImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        const mediaType = validImageTypes.includes(resolvedMimeType) ? resolvedMimeType : "image/jpeg";
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
        });
      } else {
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        });
      }

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: contentBlocks }],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        res.json({ extracted: {} });
        return;
      }

      let extracted: Record<string, any> = {};
      try {
        const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
      } catch {
        res.json({ extracted: {} });
        return;
      }

      res.json({ extracted });
    } catch (err: any) {
      console.warn("[INBOX extract-for-student] AI extraction error:", err?.message ?? err);
      res.json({ extracted: {} });
    }
  }
);

// ── Document summary for a conversation's linked lead/student ─────────────────
//
// Returns the presence of each required document type for the conversation's
// linked entity (lead or student). Student takes priority over lead when both
// are linked (i.e. a converted lead).
//
// Response: { diploma: {exists, documentId}, transcript: {...}, passport: {...}, photograph: {...} }

router.get(
  "/inbox/conversations/:id/document-summary",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const conversationId = parseInt(String(req.params.id), 10);
    if (!conversationId) { res.status(400).json({ error: "Invalid id" }); return; }

    const link = await loadConversationLink(conversationId);
    if (!link) { res.status(404).json({ error: "Conversation not found" }); return; }

    const DOC_TYPES = ["diploma", "transcript", "passport", "photograph"] as const;
    type SummaryDocType = typeof DOC_TYPES[number];

    const summary: Record<SummaryDocType, { exists: boolean; documentId: number | null }> = {
      diploma: { exists: false, documentId: null },
      transcript: { exists: false, documentId: null },
      passport: { exists: false, documentId: null },
      photograph: { exists: false, documentId: null },
    };

    if (!link.leadId && !link.studentId) {
      res.json(summary);
      return;
    }

    const ownerConditions: ReturnType<typeof eq>[] = [];
    if (link.studentId) ownerConditions.push(eq(documentsTable.studentId, link.studentId));
    if (link.leadId) ownerConditions.push(eq(documentsTable.leadId, link.leadId));

    const docs = await db
      .select({ id: documentsTable.id, type: documentsTable.type })
      .from(documentsTable)
      .where(and(
        or(...ownerConditions),
        inArray(documentsTable.type, [...DOC_TYPES]),
        isNull(documentsTable.deletedAt)
      ))
      .orderBy(desc(documentsTable.createdAt));

    for (const doc of docs) {
      const t = doc.type as SummaryDocType;
      if (DOC_TYPES.includes(t) && !summary[t].exists) {
        summary[t] = { exists: true, documentId: doc.id };
      }
    }

    res.json(summary);
  }
);

// ── Per-conversation subscribe toggle (per-user) ─────────────────────────────
router.post(
  "/inbox/conversations/:id/subscribe",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const userId = req.user!.id;
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const [existing] = await db
      .select()
      .from(conversationParticipantsTable)
      .where(and(eq(conversationParticipantsTable.conversationId, id), eq(conversationParticipantsTable.userId, userId)))
      .limit(1);

    if (existing) {
      await db.delete(conversationParticipantsTable).where(eq(conversationParticipantsTable.id, existing.id));
      res.json({ subscribed: false });
    } else {
      await db.insert(conversationParticipantsTable).values({ conversationId: id, userId, isStarred: false });
      res.json({ subscribed: true });
    }
  },
);

export default router;
