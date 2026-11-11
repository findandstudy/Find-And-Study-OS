type SourceEntry = {
  sourceName?: unknown;
  sourceUrl?: unknown;
};

export type DetailSourceTopic = {
  topicTitle: string;
  verifiedContent: string;
  sourceName: string;
  sourceUrl: string;
};

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_SOURCE_ROWS = 96;
const MAX_TOPIC_TITLE = 160;
const MAX_TOPIC_CONTENT = 6_000;
const MAX_TOTAL_CONTENT = 60_000;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const cache = new Map<string, { expiresAt: number; topics: DetailSourceTopic[] }>();

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const cleanText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

function googleSheetExportUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname.toLocaleLowerCase("en-US") !== "docs.google.com") return null;
  const match = parsed.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/u);
  if (!match) return null;
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`);
  exportUrl.searchParams.set("format", "csv");
  const gid = parsed.searchParams.get("gid") ?? parsed.hash.match(/(?:^#|&)gid=(\d+)/u)?.[1];
  if (gid && /^\d+$/u.test(gid)) exportUrl.searchParams.set("gid", gid);
  return exportUrl.toString();
}

function googleSheetId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.hostname.toLocaleLowerCase("en-US") !== "docs.google.com") return null;
    return parsed.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/u)?.[1] ?? null;
  } catch {
    return null;
  }
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  row.push(cell);
  if (row.some(value => value.length) || rows.length === 0) rows.push(row);
  return rows;
}

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/u, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function topicsFromCsv(csv: string, sourceName: string, sourceUrl: string): DetailSourceTopic[] {
  const rows = parseCsv(csv);
  const headers = rows.shift()?.map(normalizedHeader) ?? [];
  const topicIndex = headers.findIndex(value => value === "topic title");
  const contentIndex = headers.findIndex(value => value === "verified content");
  if (topicIndex < 0 || contentIndex < 0) {
    throw new Error('Country source sheet must contain "Topic title" and "Verified content" columns');
  }
  const topics: DetailSourceTopic[] = [];
  let total = 0;
  for (const row of rows.slice(0, MAX_SOURCE_ROWS)) {
    const topicTitle = cleanText(row[topicIndex], MAX_TOPIC_TITLE);
    const verifiedContent = cleanText(row[contentIndex], MAX_TOPIC_CONTENT);
    if (!topicTitle || !verifiedContent) continue;
    if (total + verifiedContent.length > MAX_TOTAL_CONTENT) break;
    total += verifiedContent.length;
    topics.push({ topicTitle, verifiedContent, sourceName, sourceUrl });
  }
  if (!topics.length) throw new Error("Country source sheet contains no usable topic rows");
  return topics;
}

async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) throw new Error("Country source sheet exceeds the size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error("Country source sheet exceeds the size limit"); }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

async function loadPrivateSheetTopics(entry: SourceEntry): Promise<DetailSourceTopic[]> {
  const sheetId = googleSheetId(entry.sourceUrl);
  if (!sheetId) return [];
  const [{ db, integrationsTable }, { eq }, { decryptConfig }, { GoogleAuth }] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("./encryption"),
    import("google-auth-library"),
  ]);
  const [integration] = await db.select({ isEnabled: integrationsTable.isEnabled, config: integrationsTable.config })
    .from(integrationsTable).where(eq(integrationsTable.key, "google_sheets")).limit(1);
  if (!integration?.isEnabled) return [];
  const config = decryptConfig((integration.config ?? {}) as Record<string, unknown>);
  const rawCredentials = config.serviceAccountJson;
  let credentials: Record<string, unknown>;
  try {
    credentials = typeof rawCredentials === "string" ? JSON.parse(rawCredentials) as Record<string, unknown> : record(rawCredentials) ?? {};
  } catch {
    throw new Error("Google Sheets service account JSON is invalid");
  }
  if (typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") return [];
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const client = await auth.getClient();
  const response = await client.request<{ values?: unknown[][] }>({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:B`,
    method: "GET",
    timeout: 8_000,
  });
  const rows = Array.isArray(response.data.values) ? response.data.values.slice(0, MAX_SOURCE_ROWS + 1) : [];
  const csv = rows.map(row => (Array.isArray(row) ? row : []).slice(0, 2).map(value => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }).join(",")).join("\n");
  return topicsFromCsv(
    csv,
    cleanText(entry.sourceName, 160) || "Verified country source sheet",
    String(entry.sourceUrl),
  );
}

async function loadSheetTopics(entry: SourceEntry): Promise<DetailSourceTopic[]> {
  const sourceUrl = typeof entry.sourceUrl === "string" ? entry.sourceUrl.trim() : "";
  const exportUrl = googleSheetExportUrl(sourceUrl);
  if (!exportUrl) return [];
  const sourceName = cleanText(entry.sourceName, 160) || "Verified country source sheet";
  const cached = cache.get(exportUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.topics;
  let topics: DetailSourceTopic[] = [];
  let publicFailure: unknown;
  try {
    const response = await fetch(exportUrl, {
      headers: { accept: "text/csv,text/plain;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
    if (contentType.includes("text/html")) throw new Error("login page returned");
    topics = topicsFromCsv(await boundedText(response), sourceName, sourceUrl);
  } catch (error) {
    publicFailure = error;
  }
  if (!topics.length) {
    try { topics = await loadPrivateSheetTopics(entry); }
    catch (error) {
      const detail = error instanceof Error ? error.message : "private read failed";
      throw new Error(`Country source sheet is unreadable (${detail}); allow link viewing or share it with the configured Google Sheets service account`);
    }
  }
  if (!topics.length) {
    const detail = publicFailure instanceof Error ? publicFailure.message : "public read failed";
    throw new Error(`Country source sheet is unreadable (${detail}); allow link viewing or share it with the configured Google Sheets service account`);
  }
  cache.set(exportUrl, { expiresAt: Date.now() + CACHE_TTL_MS, topics });
  return topics;
}

function sourceEntries(kind: string, payload: unknown): SourceEntry[] {
  const root = record(payload);
  const entity = record(kind === "destination" ? root?.destination : root?.data);
  const metadata = record(entity?.sourceMetadata);
  if (!metadata) return [];
  const unique = new Map<string, SourceEntry>();
  for (const raw of Object.values(metadata)) {
    const entry = record(raw);
    if (!entry || typeof entry.sourceUrl !== "string") continue;
    const exportUrl = googleSheetExportUrl(entry.sourceUrl);
    if (exportUrl && !unique.has(exportUrl)) unique.set(exportUrl, entry);
  }
  return [...unique.values()].slice(0, 4);
}

export async function hydrateDetailSourceDocuments(kind: string, payload: unknown): Promise<unknown> {
  const entries = sourceEntries(kind, payload);
  if (!entries.length) return payload;
  const topics = (await Promise.all(entries.map(loadSheetTopics))).flat().slice(0, MAX_SOURCE_ROWS);
  if (!topics.length) return payload;
  const root = record(payload);
  const entityKey = kind === "destination" ? "destination" : "data";
  const entity = record(root?.[entityKey]);
  if (!root || !entity) return payload;
  return { ...root, [entityKey]: { ...entity, sourceTopics: topics } };
}

export const __test = { googleSheetExportUrl, googleSheetId, parseCsv, topicsFromCsv };
