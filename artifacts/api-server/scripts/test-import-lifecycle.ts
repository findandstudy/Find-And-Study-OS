import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath: string): string {
  return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), "utf8");
}

const feedBus = source("lib/feedBus.ts");
const inboxBus = source("lib/inbox/eventBus.ts");
const notificationBus = source("lib/notificationBus.ts");
const notificationsRoute = source("routes/notifications.ts");
const docCatalog = source("lib/docCatalog.ts");
const docNaming = source("lib/docNaming.ts");
const bootstrap = source("index.ts");

for (const [name, bus] of [
  ["feed", feedBus],
  ["inbox", inboxBus],
  ["notification", notificationBus],
] as const) {
  const exportAt = bus.indexOf("export const");
  assert.ok(exportAt > 0, `${name} bus export exists`);
  assert.doesNotMatch(
    bus.slice(0, exportAt),
    /void\s+connectListenClient\s*\(/,
    `${name} bus does not connect while being imported`,
  );
  assert.match(bus, /async shutdown\(\): Promise<void>/, `${name} bus exposes shutdown`);
}

assert.doesNotMatch(notificationsRoute, /seedNotificationRules\s*\(/, "route import does not seed the database");
assert.doesNotMatch(docCatalog, /void\s+loadDocCatalog\s*\(\s*\)\s*;/, "catalog import does not query the database");

const namingBeforeFirstExport = docNaming.slice(0, docNaming.indexOf("export function"));
assert.doesNotMatch(namingBeforeFirstExport, /void\s+loadDbLabels\s*\(/, "document naming import does not query the database");

assert.match(bootstrap, /await seedNotificationRules\(\)/, "notification seed is owned by explicit bootstrap");
assert.match(bootstrap, /await inboxBus\.shutdown\(\)/, "inbox listener is closed during shutdown");
assert.match(bootstrap, /await notificationBus\.shutdown\(\)/, "notification listener is closed during shutdown");

console.log("[import-lifecycle] 12/12 PASS");
