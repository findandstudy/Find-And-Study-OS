#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.join(root, "drizzle");
const defaultJournalPath = path.join(defaultMigrationsDir, "meta", "_journal.json");

export function validateMigrationLedger({
  migrationsDir = defaultMigrationsDir,
  journalPath = defaultJournalPath,
} = {}) {
  const files = fs.readdirSync(migrationsDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const byId = new Map();
  for (const file of files) {
    const id = file.slice(0, 4);
    byId.set(id, [...(byId.get(id) ?? []), file]);
  }
  const duplicates = [...byId.entries()].filter(([, names]) => names.length > 1);
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const tags = new Set(journal.entries.map((entry) => entry.tag));
  const missingFromJournal = files.map((file) => file.replace(/\.sql$/, "")).filter((tag) => !tags.has(tag));
  const missingFiles = journal.entries.map((entry) => `${entry.tag}.sql`).filter((file) => !files.includes(file));
  const problems = [];
  if (duplicates.length) problems.push(`duplicate ids: ${duplicates.map(([id, names]) => `${id}=[${names.join(",")}]`).join("; ")}`);
  if (missingFromJournal.length) problems.push(`SQL files absent from journal: ${missingFromJournal.join(", ")}`);
  if (missingFiles.length) problems.push(`journal entries without SQL files: ${missingFiles.join(", ")}`);
  if (problems.length) throw new Error(`[migration-validation] ${problems.join(" | ")}`);
  return { files: files.length, journalEntries: journal.entries.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = validateMigrationLedger();
    console.log(`[migration-validation] OK: ${result.files} files, ${result.journalEntries} journal entries`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
