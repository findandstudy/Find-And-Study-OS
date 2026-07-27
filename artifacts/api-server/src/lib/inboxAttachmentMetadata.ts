import {
  isAllowedExtension,
  sanitizeFileName,
} from "./fileUploadValidation";

type JsonRecord = Record<string, any>;

export interface NestedAttachmentMetadata {
  mimeType: string | null;
  fileName: string | null;
}

/**
 * Zernio webhook messages keep the authoritative MIME/filename in
 * metadata.raw.message.attachments[index].payload while the normalized
 * metadata.attachments entry may contain only { type: "image", name: "image" }.
 */
export function readNestedZernioAttachmentMetadata(
  metadata: JsonRecord,
  attachmentIndex: number,
): NestedAttachmentMetadata {
  const nested = Array.isArray(metadata?.raw?.message?.attachments)
    ? metadata.raw.message.attachments[attachmentIndex]
    : null;
  const payload = nested?.payload && typeof nested.payload === "object"
    ? nested.payload
    : null;

  const mimeType = [
    nested?.mimeType,
    nested?.mime_type,
    payload?.mimeType,
    payload?.mime_type,
  ].find((value) => typeof value === "string" && value.trim());

  const fileName = [
    nested?.name,
    nested?.fileName,
    nested?.filename,
    payload?.name,
    payload?.fileName,
    payload?.filename,
  ].find((value) => typeof value === "string" && value.trim());

  return {
    mimeType: typeof mimeType === "string"
      ? mimeType.split(";")[0].trim().toLowerCase()
      : null,
    fileName: typeof fileName === "string" ? fileName.trim() : null,
  };
}

function extensionForMime(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case "application/pdf": return "pdf";
    case "image/jpeg":
    case "image/jpg": return "jpg";
    case "image/png": return "png";
    case "application/msword": return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
    case "application/vnd.ms-excel": return "xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "xlsx";
    case "application/vnd.ms-powerpoint": return "ppt";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return "pptx";
    default: return null;
  }
}

/**
 * WhatsApp/Zernio often calls an image simply "image" or a PDF "document".
 * Once the MIME is known, give those transport placeholders a valid extension
 * before the shared upload validator checks extension/MIME consistency.
 */
export function ensureAttachmentFilenameExtension(
  rawFileName: string | null | undefined,
  mimeType: string,
): string {
  const safeName = sanitizeFileName(rawFileName?.trim() || "attachment");
  if (isAllowedExtension(safeName)) return safeName;

  const extension = extensionForMime(mimeType);
  if (!extension) return safeName;

  const lastDot = safeName.lastIndexOf(".");
  const base = lastDot > 0 ? safeName.slice(0, lastDot) : safeName;
  return sanitizeFileName(`${base || "attachment"}.${extension}`);
}
