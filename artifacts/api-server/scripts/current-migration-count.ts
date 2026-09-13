import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const journalPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../lib/db/drizzle/meta/_journal.json",
);

export function readCurrentMigrationCount(): number {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries?: unknown[] };
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) throw new Error("migration_journal_entries_required");
  return journal.entries.length;
}