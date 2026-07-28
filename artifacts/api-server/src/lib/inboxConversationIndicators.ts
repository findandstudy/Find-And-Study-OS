import { sql } from "drizzle-orm";

// Drizzle can render a column interpolated inside a correlated raw SQL
// subquery as just "id". Inside `messages m` / `conversation_participants cp`
// that unqualified identifier binds to the inner table instead of the outer
// conversations row. Keep the correlation target explicitly qualified.
export const inboxOuterConversationIdSql = sql.raw(
  '"conversations"."id"',
);

export function inboxIsStarredSql(userId: number) {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = ${inboxOuterConversationIdSql}
    AND cp.user_id = ${userId} AND cp.is_starred = true
  )`.as("is_starred");
}

export function inboxIsSubscribedSql(userId: number) {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = ${inboxOuterConversationIdSql}
    AND cp.user_id = ${userId}
  )`.as("is_subscribed");
}

export function inboxUnreadCountSql(userId: number) {
  return sql<number>`(
    SELECT COUNT(*)::int FROM messages m
    WHERE m.conversation_id = ${inboxOuterConversationIdSql}
    AND m.direction = 'inbound'
    AND m.created_at > COALESCE((
      SELECT cp.last_read_at FROM conversation_participants cp
      WHERE cp.conversation_id = ${inboxOuterConversationIdSql}
      AND cp.user_id = ${userId}
    ), 'epoch'::timestamptz)
  )`.as("unread_count");
}

export function inboxAwaitingReplySql() {
  return sql<boolean>`(
    COALESCE((
      SELECT m.direction FROM messages m
      WHERE m.conversation_id = ${inboxOuterConversationIdSql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ), '') = 'inbound'
  )`.as("awaiting_reply");
}
