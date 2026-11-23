import { pool } from "@workspace/db";
import { normalizeDetailSectionTitle } from "../src/lib/websiteDetailContentContract";

type BlockRow = { id: number; page_id: number; block_type: string; content: unknown };
type JsonRecord = Record<string, unknown>;

const apply = process.argv.includes("--apply");
const expectedDatabase = process.env.DETAIL_TITLE_BACKFILL_EXPECTED_DATABASE?.trim();
const expectedHost = process.env.DETAIL_TITLE_BACKFILL_EXPECTED_HOST?.trim();
const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function normalizeContentBlock(value: unknown): unknown {
  if (!isRecord(value) || typeof value.locale !== "string") return value;
  const locale = value.locale;
  const sections = Array.isArray(value.sections) ? value.sections.map((section) => {
    if (!isRecord(section) || section.key === "hero" || typeof section.title !== "string") return section;
    return { ...section, title: normalizeDetailSectionTitle(section.title, locale) };
  }) : value.sections;
  const templateSections = Array.isArray(value.templateSections) ? value.templateSections.map((section) => {
    if (!isRecord(section) || section.key === "hero" || typeof section.title !== "string") return section;
    return { ...section, title: normalizeDetailSectionTitle(section.title, locale) };
  }) : value.templateSections;
  return { ...value, ...(sections !== undefined ? { sections } : {}), ...(templateSections !== undefined ? { templateSections } : {}) };
}

function normalizeLayoutBlock(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.copy)) return value;
  const copy = Object.fromEntries(Object.entries(value.copy).map(([locale, localized]) => {
    if (!isRecord(localized)) return [locale, localized];
    return [locale, Object.fromEntries(Object.entries(localized).map(([key, section]) => {
      if (key === "hero" || !isRecord(section) || typeof section.title !== "string") return [key, section];
      return [key, { ...section, title: normalizeDetailSectionTitle(section.title, locale) }];
    }))];
  }));
  return { ...value, copy };
}

try {
  const identity = (await pool.query("SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port")).rows[0] as { name: string; host: string | null; port: number };
  if (apply && (!expectedDatabase || !expectedHost)) throw new Error("Apply requires DETAIL_TITLE_BACKFILL_EXPECTED_DATABASE and DETAIL_TITLE_BACKFILL_EXPECTED_HOST");
  if (apply && (identity.name !== expectedDatabase || identity.host !== expectedHost)) throw new Error("Database identity does not match the explicit target");
  const rows = (await pool.query<BlockRow>(`
    SELECT block.id, block.page_id, block.block_type, block.content
      FROM website_page_blocks block
      JOIN website_pages page ON page.id = block.page_id
     WHERE block.block_type IN ('detail_content', 'detail_layout')
       AND (page.template LIKE 'detail-content:%' OR page.template LIKE 'detail:%')
     ORDER BY block.id
     LIMIT 50001
  `)).rows;
  if (rows.length > 50_000) throw new Error("Refusing to scan more than 50,000 detail blocks");
  const changes = rows.flatMap((row) => {
    const normalized = row.block_type === "detail_content" ? normalizeContentBlock(row.content) : normalizeLayoutBlock(row.content);
    return JSON.stringify(normalized) === JSON.stringify(row.content) ? [] : [{ ...row, normalized }];
  });
  const pageIds = [...new Set(changes.map((row) => row.page_id))];
  if (apply && changes.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '20s'");
      for (const row of changes) {
        const result = await client.query("UPDATE website_page_blocks SET content = $1::jsonb, updated_at = NOW() WHERE id = $2 AND content = $3::jsonb", [JSON.stringify(row.normalized), row.id, JSON.stringify(row.content)]);
        if (result.rowCount !== 1) throw new Error(`Concurrent change detected for detail block ${row.id}`);
      }
      await client.query("UPDATE website_pages SET updated_at = NOW() WHERE id = ANY($1::int[])", [pageIds]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", database: identity.name, host: identity.host, port: identity.port, scannedBlocks: rows.length, changedBlocks: changes.length, changedPages: pageIds.length }));
} finally {
  await pool.end();
}
