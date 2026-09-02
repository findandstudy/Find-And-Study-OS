export interface DocumentContentReference {
  fileKey?: unknown;
  fileUrl?: unknown;
}

export function hasStoredDocumentContent(input: DocumentContentReference): boolean {
  return [input.fileKey, input.fileUrl].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}
