export const DEFAULT_BULK_IMPORT_CHUNK_BYTES = 8 * 1024 * 1024;
export const DEFAULT_BULK_IMPORT_CHUNK_ROWS = 10_000;

export type BulkImportProgress = {
  completed: number;
  total: number;
};

export type ProgramIdentityCollisionReport = {
  groups: number;
  extraRows: number;
  sampleRows: Array<{ firstRow: number; duplicateRow: number }>;
};

type ChunkOptions = {
  maxBytes?: number;
  maxRows?: number;
};

const encoder = new TextEncoder();

function jsonByteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

/**
 * Split a JSON-array payload before it reaches the authenticated catalog
 * endpoint's 20 MiB body ceiling. The lower 8 MiB default leaves room for
 * encoding differences and reverse-proxy overhead while the row cap keeps
 * database work bounded even for unusually narrow files.
 */
export function chunkBulkImportRows<T>(
  rows: T[],
  options: ChunkOptions = {},
): T[][] {
  const maxBytes = options.maxBytes ?? DEFAULT_BULK_IMPORT_CHUNK_BYTES;
  const maxRows = options.maxRows ?? DEFAULT_BULK_IMPORT_CHUNK_ROWS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 3) {
    throw new Error("maxBytes must be an integer of at least 3");
  }
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new Error("maxRows must be a positive integer");
  }
  if (rows.length === 0) return [];

  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2; // opening + closing JSON array brackets

  for (const row of rows) {
    const rowBytes = jsonByteLength(row);
    if (rowBytes + 2 > maxBytes) {
      throw new Error("A single import row exceeds the safe request size");
    }

    const separatorBytes = current.length > 0 ? 1 : 0;
    if (
      current.length > 0 &&
      (current.length >= maxRows || currentBytes + separatorBytes + rowBytes > maxBytes)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }

    currentBytes += (current.length > 0 ? 1 : 0) + rowBytes;
    current.push(row);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function readHeader(
  row: Record<string, string>,
  aliases: readonly string[],
): string {
  const aliasSet = new Set(aliases.map((alias) => alias.toLowerCase()));
  for (const [rawKey, rawValue] of Object.entries(row)) {
    if (aliasSet.has(rawKey.trim().toLowerCase())) return String(rawValue ?? "").trim();
  }
  return "";
}

function programIdentityKey(row: Record<string, string>): string | null {
  const universityId = readHeader(row, ["universityId", "university id"]);
  const universityName = readHeader(row, ["universityName", "university name", "university"]);
  const programName = readHeader(row, ["name", "program", "program name"]);
  if ((!universityId && !universityName) || !programName) return null;

  const university = universityId
    ? `id:${universityId}`
    : `name:${universityName.toLowerCase()}`;
  const degree = readHeader(row, ["degree"]).toLowerCase();
  const language = readHeader(row, ["language"]).toLowerCase();
  return [university, programName.toLowerCase(), degree, language].join("\u0000");
}

/**
 * Mirror the server importer's program identity key. A collision would be
 * silently first-wins inside one request or last-batch-wins across requests,
 * so callers must stop and surface it before any mutating request begins.
 * Row numbers include the spreadsheet header row.
 */
export function findProgramIdentityCollisions(
  rows: Record<string, string>[],
  sampleLimit = 5,
): ProgramIdentityCollisionReport {
  const firstRowByKey = new Map<string, number>();
  const duplicateKeys = new Set<string>();
  const sampleRows: Array<{ firstRow: number; duplicateRow: number }> = [];
  let extraRows = 0;

  rows.forEach((row, index) => {
    const key = programIdentityKey(row);
    if (!key) return;
    const spreadsheetRow = index + 2;
    const firstRow = firstRowByKey.get(key);
    if (firstRow === undefined) {
      firstRowByKey.set(key, spreadsheetRow);
      return;
    }

    duplicateKeys.add(key);
    extraRows++;
    if (sampleRows.length < sampleLimit) {
      sampleRows.push({ firstRow, duplicateRow: spreadsheetRow });
    }
  });

  return { groups: duplicateKeys.size, extraRows, sampleRows };
}
