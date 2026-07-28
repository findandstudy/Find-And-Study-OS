import test from "node:test";
import assert from "node:assert/strict";
import { db, conversationsTable } from "@workspace/db";
import {
  inboxAwaitingReplySql,
  inboxIsStarredSql,
  inboxIsSubscribedSql,
  inboxUnreadCountSql,
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
