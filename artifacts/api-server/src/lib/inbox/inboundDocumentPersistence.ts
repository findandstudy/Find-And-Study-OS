import {
  conversationsTable,
  db,
  documentsTable,
  leadsTable,
  messagesTable,
  studentsTable,
} from "@workspace/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { buildDocNameFromParts } from "../docNaming";
import {
  sanitizeFileName,
  validateStudentDocumentBuffer,
  validateStudentDocumentFile,
} from "../fileUploadValidation";
import {
  ensureAttachmentFilenameExtension,
  readNestedZernioAttachmentMetadata,
} from "../inboxAttachmentMetadata";
import { ObjectStorageService } from "../objectStorage";
import { loadDocCatalogKeySet } from "../docCatalog";
import { resolveOutboundConfig } from "./channelAccountConfig";
import type { WhatsAppConfig } from "./channels/whatsapp";
import { META_API_VERSION } from "./channels/meta-shared";
import {
  configuredInboxMediaHosts,
  resolveLocalInboxStorageKey,
} from "./mediaSource";
import { getZernioApiKey } from "./zernioSend";
import { safeOutboundRequest } from "../safeOutboundRequest";

const DOCUMENT_PERSIST_LOCK_NS = 7313;

export type PersistInboundDocumentResult = {
  status: "saved" | "already_saved" | "already_present";
  documentId: number;
};

type AttachmentDescriptor = {
  url: string | null;
  whatsappMediaId: string | null;
  mimeType: string | null;
  fileName: string | null;
};

function mimeToExt(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  return "bin";
}

function attachmentAt(metadata: unknown, index: number): AttachmentDescriptor | null {
  const meta = metadata && typeof metadata === "object"
    ? metadata as Record<string, any>
    : {};
  const generic: Array<Record<string, any>> = [
    ...(meta.attachment && typeof meta.attachment === "object" ? [meta.attachment] : []),
    ...(Array.isArray(meta.attachments) ? meta.attachments : []),
  ];
  if (index < generic.length) {
    const attachment = generic[index];
    const nested = readNestedZernioAttachmentMetadata(meta, index);
    const url = String(attachment?.url ?? attachment?.fileUrl ?? "").trim() || null;
    if (!url) return null;
    return {
      url,
      whatsappMediaId: null,
      mimeType: String(attachment?.mimeType ?? attachment?.mime_type ?? "").trim()
        || nested.mimeType
        || null,
      fileName: String(attachment?.name ?? attachment?.filename ?? attachment?.fileName ?? "").trim()
        || nested.fileName
        || null,
    };
  }

  if (index === 0 && meta.raw && typeof meta.raw === "object") {
    const raw = meta.raw as Record<string, any>;
    const mediaType = String(raw.type ?? "");
    const media = mediaType && raw[mediaType] && typeof raw[mediaType] === "object"
      ? raw[mediaType] as Record<string, any>
      : null;
    if (media?.id) {
      return {
        url: null,
        whatsappMediaId: String(media.id),
        mimeType: String(media.mime_type ?? "").trim() || null,
        fileName: String(media.filename ?? media.file_name ?? "").trim() || null,
      };
    }
  }
  return null;
}

async function downloadAttachment(opts: {
  descriptor: AttachmentDescriptor;
  channelAccountId: number | null;
}): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const storage = new ObjectStorageService();
  const { descriptor } = opts;
  let buffer: Buffer;
  let mimeType = descriptor.mimeType || "application/octet-stream";

  if (descriptor.whatsappMediaId) {
    const config = await resolveOutboundConfig<WhatsAppConfig>(
      "whatsapp",
      opts.channelAccountId,
      null,
    );
    const accessToken = (config?.accessToken ?? process.env.WA_ACCESS_TOKEN ?? "").trim();
    if (!accessToken) throw new Error("WhatsApp access token is not configured");
    const infoResponse = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${descriptor.whatsappMediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!infoResponse.ok) throw new Error(`WhatsApp media lookup failed (${infoResponse.status})`);
    const info = await infoResponse.json() as { url?: string; mime_type?: string };
    if (!info.url) throw new Error("WhatsApp media URL was not returned");
    mimeType = descriptor.mimeType || info.mime_type || mimeType;
    const mediaResponse = await safeOutboundRequest(info.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      allowedProtocols: ["https:"],
      timeoutMs: 15_000,
      maxBytes: 25 * 1024 * 1024,
      maxRedirects: 2,
    });
    if (!mediaResponse.ok) throw new Error(`WhatsApp media download failed (${mediaResponse.status})`);
    buffer = mediaResponse.body;
  } else {
    const url = descriptor.url!;
    const localKey = resolveLocalInboxStorageKey(url, configuredInboxMediaHosts());
    if (localKey) {
      const file = await storage.getObjectEntityFile(`/objects/${localKey}`);
      const [metadata] = await file.getMetadata();
      [buffer] = await file.download();
      mimeType = descriptor.mimeType || metadata.contentType || mimeType;
    } else {
      const headers: Record<string, string> = {};
      try {
        const parsed = new URL(url);
        if (parsed.hostname === "zernio.com") {
          const apiKey = await getZernioApiKey();
          if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        }
      } catch {
        throw new Error("Attachment URL is invalid");
      }
      const response = await safeOutboundRequest(url, {
        headers,
        allowedProtocols: ["https:"],
        timeoutMs: 15_000,
        maxBytes: 25 * 1024 * 1024,
        maxRedirects: 2,
      });
      if (!response.ok) throw new Error(`Attachment download failed (${response.status})`);
      buffer = response.body;
      mimeType = descriptor.mimeType
        || response.headers["content-type"]?.split(";")[0]?.trim()
        || mimeType;
    }
  }

  const fileName = ensureAttachmentFilenameExtension(
    sanitizeFileName(descriptor.fileName || `attachment.${mimeToExt(mimeType)}`),
    mimeType,
  );
  return { buffer, mimeType, fileName };
}

/**
 * Download one inbox attachment, verify its real bytes and persist it as a
 * canonical Lead/Student document. The source-message key and an advisory lock
 * make webhook retries idempotent.
 */
export async function persistInboundAttachmentAsDocument(opts: {
  conversationId: number;
  messageId: number;
  attachmentIndex: number;
  ownerType: "lead" | "student";
  ownerId: number;
  documentType: string;
}): Promise<PersistInboundDocumentResult> {
  const sourceAttachmentId = `${opts.messageId}:${opts.attachmentIndex}`;
  const activeDocumentTypes = await loadDocCatalogKeySet();
  const legacyAliases = new Set(["diploma", "transcript", "photograph"]);
  if (!activeDocumentTypes.has(opts.documentType) && !legacyAliases.has(opts.documentType)) {
    throw new Error(`Inactive document type: ${opts.documentType}`);
  }

  const [conversation] = await db.select({
    id: conversationsTable.id,
    channelAccountId: conversationsTable.channelAccountId,
  }).from(conversationsTable).where(eq(conversationsTable.id, opts.conversationId));
  if (!conversation) throw new Error("Conversation not found");
  const [message] = await db.select({ metadata: messagesTable.metadata })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.id, opts.messageId),
      eq(messagesTable.conversationId, opts.conversationId),
    ));
  if (!message) throw new Error("Inbound message not found");
  const descriptor = attachmentAt(message.metadata, opts.attachmentIndex);
  if (!descriptor) throw new Error("Attachment not found");

  // Network reads and byte inspection must not hold a database transaction or
  // advisory lock. A second duplicate check below preserves idempotency after
  // this potentially slow work completes.
  const downloaded = await downloadAttachment({
    descriptor,
    channelAccountId: conversation.channelAccountId,
  });
  const policyError = validateStudentDocumentFile(
    opts.documentType,
    downloaded.fileName,
    downloaded.mimeType,
    downloaded.buffer.length,
  );
  if (policyError) throw new Error(policyError.message);
  const contentError = await validateStudentDocumentBuffer(
    opts.documentType,
    downloaded.fileName,
    downloaded.mimeType,
    downloaded.buffer,
  );
  if (contentError) throw new Error(contentError.message);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${DOCUMENT_PERSIST_LOCK_NS}, hashtext(${sourceAttachmentId}))`,
    );
    const ownerCondition = opts.ownerType === "student"
      ? eq(documentsTable.studentId, opts.ownerId)
      : eq(documentsTable.leadId, opts.ownerId);
    const [duplicate] = await tx.select({ id: documentsTable.id })
      .from(documentsTable)
      .where(and(
        eq(documentsTable.sourceAttachmentId, sourceAttachmentId),
        ownerCondition,
        isNull(documentsTable.deletedAt),
      ));
    if (duplicate) return { status: "already_saved", documentId: duplicate.id };

    const [alreadyPresent] = await tx.select({ id: documentsTable.id })
      .from(documentsTable)
      .where(and(
        eq(documentsTable.type, opts.documentType),
        ownerCondition,
        isNotNull(documentsTable.fileKey),
        isNull(documentsTable.applicationId),
        isNull(documentsTable.deletedAt),
      ))
      .limit(1);
    if (alreadyPresent) return { status: "already_present", documentId: alreadyPresent.id };

    const storage = new ObjectStorageService();
    const fileKey = await storage.uploadBuffer({
      subdir: "inbox-docs",
      filename: downloaded.fileName,
      buffer: downloaded.buffer,
      contentType: downloaded.mimeType,
    });
    const [owner] = opts.ownerType === "student"
      ? await tx.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
          .from(studentsTable)
          .where(and(eq(studentsTable.id, opts.ownerId), isNull(studentsTable.deletedAt)))
      : await tx.select({ firstName: leadsTable.firstName, lastName: leadsTable.lastName })
          .from(leadsTable)
          .where(and(eq(leadsTable.id, opts.ownerId), isNull(leadsTable.deletedAt)));
    if (!owner) throw new Error("Linked document owner not found");

    const [document] = await tx.insert(documentsTable).values({
      name: buildDocNameFromParts(owner.firstName, owner.lastName, opts.documentType, downloaded.mimeType),
      type: opts.documentType,
      status: "pending",
      studentId: opts.ownerType === "student" ? opts.ownerId : null,
      leadId: opts.ownerType === "lead" ? opts.ownerId : null,
      applicationId: null,
      fileKey,
      mimeType: downloaded.mimeType,
      sizeBytes: downloaded.buffer.length,
      source: "inbox_ai",
      sourceConversationId: opts.conversationId,
      sourceMessageId: opts.messageId,
      sourceAttachmentId,
    }).returning({ id: documentsTable.id });
    return { status: "saved", documentId: document.id };
  });
}
