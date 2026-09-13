import fs from "node:fs";
import path from "node:path";

/**
 * Return the migration ledger length shipped by the exact source tree.
 *
 * Staging seed/fixture tools must not carry a stale hand-written ledger count.
 * The migration validator already requires a contiguous, zero-based ledger;
 * this helper applies the same shape check before a seed can touch a database.
 */
export function expectedStagingMigrationCount(root) {
  const directory = path.join(root, "lib", "db", "drizzle");
  let names;
  try {
    names = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    throw new Error(
      `staging migration ledger is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (names.length === 0) {
    throw new Error("staging migration ledger is empty");
  }

  const indexes = names.map((name) => Number(name.slice(0, 4)));
  const unique = new Set(indexes);
  const maximum = Math.max(...indexes);
  const contiguous = unique.size === maximum + 1
    && [...unique].every((index) => Number.isInteger(index) && index >= 0);
  if (!contiguous) {
    throw new Error("staging migration ledger must contain each prefix from 0000 without gaps or duplicates");
  }
  return unique.size;
}
