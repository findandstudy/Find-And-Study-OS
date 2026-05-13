export {
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  ACCEPT_ATTRIBUTE,
  PDF_MAX_SIZE,
  IMAGE_MAX_SIZE,
  PDF_MAX_SIZE_MB,
  IMAGE_MAX_SIZE_MB,
  FILE_UPLOAD_HELP_TEXT,
  getExtension,
  isAllowedMimeType,
  isAllowedExtension,
  isPdf,
  isImage,
  getMaxSizeForType,
  getMaxSizeLabelForType,
  sanitizeFileName,
  validateUploadedFile,
  validateUploadedFileBuffer,
  validateFile,
} from "@workspace/file-upload-validation";

export type {
  FileValidationError,
  BufferValidationError,
  FileValidationResult,
} from "@workspace/file-upload-validation";
