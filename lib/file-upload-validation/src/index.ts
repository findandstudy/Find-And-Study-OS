export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"] as const;

export const ACCEPT_ATTRIBUTE = ".pdf,.jpg,.jpeg,.png";

export const PDF_MAX_SIZE = 10 * 1024 * 1024;
export const IMAGE_MAX_SIZE = 5 * 1024 * 1024;

export const PDF_MAX_SIZE_MB = 10;
export const IMAGE_MAX_SIZE_MB = 5;

export const FILE_UPLOAD_HELP_TEXT = "PDF (maks. 10 MB), JPG/PNG (maks. 5 MB)";

export function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0) return "";
  return fileName.slice(lastDot).toLowerCase();
}

export function isAllowedMimeType(mimeType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isAllowedExtension(fileName: string): boolean {
  const ext = getExtension(fileName);
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

export function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

export function isImage(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}

export function getMaxSizeForType(mimeType: string): number {
  if (isPdf(mimeType)) return PDF_MAX_SIZE;
  return IMAGE_MAX_SIZE;
}

export function getMaxSizeLabelForType(mimeType: string): string {
  if (isPdf(mimeType)) return `${PDF_MAX_SIZE_MB} MB`;
  return `${IMAGE_MAX_SIZE_MB} MB`;
}

export function sanitizeFileName(fileName: string): string {
  let name = fileName.normalize("NFC");

  name = name.replace(/\.\./g, "");
  name = name.replace(/[/\\]/g, "");

  const lastDot = name.lastIndexOf(".");
  let base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot) : "";

  base = base.replace(/[^a-zA-Z0-9._\-\s\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g, "_");
  base = base.replace(/_+/g, "_").replace(/^_|_$/g, "");

  if (!base) base = "document";

  if (base.length > 200) base = base.slice(0, 200);

  return base + ext.toLowerCase();
}

export type FileValidationError = {
  type: "invalid_type" | "invalid_extension" | "size_exceeded" | "mime_extension_mismatch";
  message: string;
};

export function validateUploadedFile(
  fileName: string,
  mimeType: string,
  sizeBytes: number
): FileValidationError | null {
  if (!isAllowedMimeType(mimeType)) {
    return {
      type: "invalid_type",
      message: "Sadece PDF, JPG, JPEG ve PNG dosyalar\u0131 y\u00fckleyebilirsiniz.",
    };
  }

  if (!isAllowedExtension(fileName)) {
    return {
      type: "invalid_extension",
      message: "Sadece PDF, JPG, JPEG ve PNG dosyalar\u0131 y\u00fckleyebilirsiniz.",
    };
  }

  const ext = getExtension(fileName);
  if (isPdf(mimeType) && ext !== ".pdf") {
    return {
      type: "mime_extension_mismatch",
      message: "Dosya tipi ile uzant\u0131s\u0131 uyu\u015fmuyor.",
    };
  }
  if (isImage(mimeType) && ![".jpg", ".jpeg", ".png"].includes(ext)) {
    return {
      type: "mime_extension_mismatch",
      message: "Dosya tipi ile uzant\u0131s\u0131 uyu\u015fmuyor.",
    };
  }

  const maxSize = getMaxSizeForType(mimeType);
  if (sizeBytes > maxSize) {
    if (isPdf(mimeType)) {
      return {
        type: "size_exceeded",
        message: `PDF dosyalar\u0131 en fazla ${PDF_MAX_SIZE_MB} MB olabilir.`,
      };
    }
    return {
      type: "size_exceeded",
      message: `JPG, JPEG ve PNG dosyalar\u0131 en fazla ${IMAGE_MAX_SIZE_MB} MB olabilir.`,
    };
  }

  return null;
}

export type FileValidationResult = {
  valid: false;
  message: string;
} | {
  valid: true;
};

export type BufferValidationError = FileValidationError | {
  type: "magic_byte_mismatch" | "magic_byte_unknown";
  message: string;
};

export async function validateUploadedFileBuffer(
  fileName: string,
  declaredMimeType: string,
  buffer: Buffer | Uint8Array,
): Promise<BufferValidationError | null> {
  const baseError = validateUploadedFile(fileName, declaredMimeType, buffer.byteLength);
  if (baseError) return baseError;

  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    return {
      type: "magic_byte_unknown",
      message: "Dosya i\u00e7eri\u011fi tan\u0131namad\u0131. L\u00fctfen ge\u00e7erli bir PDF, JPG veya PNG dosyas\u0131 y\u00fckleyin.",
    };
  }

  const allowedDetectedMimes = new Set<string>(["application/pdf", "image/jpeg", "image/png"]);
  if (!allowedDetectedMimes.has(detected.mime)) {
    return {
      type: "magic_byte_mismatch",
      message: `Dosya i\u00e7eri\u011fi izin verilen bir t\u00fcr de\u011fil (alg\u0131lanan: ${detected.mime}).`,
    };
  }

  if (detected.mime !== declaredMimeType) {
    return {
      type: "magic_byte_mismatch",
      message: `Dosya i\u00e7eri\u011fi belirtilen tip ile uyu\u015fmuyor (belirtilen: ${declaredMimeType}, alg\u0131lanan: ${detected.mime}).`,
    };
  }

  return null;
}

export function validateFile(fileName: string, mimeType: string, sizeBytes: number): FileValidationResult {
  if (!isAllowedMimeType(mimeType) || !isAllowedExtension(fileName)) {
    return {
      valid: false,
      message: "Sadece PDF, JPG, JPEG ve PNG dosyalar\u0131 y\u00fckleyebilirsiniz.",
    };
  }

  const maxSize = getMaxSizeForType(mimeType);
  if (sizeBytes > maxSize) {
    if (isPdf(mimeType)) {
      return {
        valid: false,
        message: `PDF dosyalar\u0131 en fazla ${PDF_MAX_SIZE_MB} MB olabilir.`,
      };
    }
    return {
      valid: false,
      message: `JPG, JPEG ve PNG dosyalar\u0131 en fazla ${IMAGE_MAX_SIZE_MB} MB olabilir.`,
    };
  }

  return { valid: true };
}
