import test from "node:test";
import assert from "node:assert/strict";
import { db, conversationsTable } from "@workspace/db";
import {
  inboxAwaitingReplySql,
  inboxIsStarredSql,
  inboxIsSubscribedSql,
  inboxUnreadCountSql,
  manualUnreadLastReadAt,
} from "../src/lib/inboxConversationIndicators";

test("inbox indicators correlate to the qualified outer conversation id", () => {
  const compiled = db
    .select({
      id: conversationsTable.id,
      isStarred: inboxIsStarredSql(8),
      isSubscribed: inboxIsSubscribedSql(8),
      unreadCount: inboxUnreadCountSql(8),
      awaitingReply: inboxAwaitingReplySql(),
    })
    .from(conversationsTable)
    .toSQL();

  const qualifiedMatches =
    compiled.sql.match(/conversation_id = "conversations"\."id"/g) ?? [];

  assert.equal(qualifiedMatches.length, 5);
  assert.doesNotMatch(compiled.sql, /conversation_id = "id"/);
  assert.deepEqual(compiled.params, [8, 8, 8]);
});

test("manual unread cursor sits immediately before the latest inbound message", () => {
  const latest = new Date("2026-07-30T00:36:12.500Z");
  const cursor = manualUnreadLastReadAt(latest);

  assert.equal(cursor.toISOString(), "2026-07-30T00:36:12.499Z");
  assert.equal(manualUnreadLastReadAt(latest.toISOString()).getTime(), cursor.getTime());
  assert.throws(() => manualUnreadLastReadAt("not-a-date"), /Invalid latest inbound timestamp/);
});
