import {
  db,
  notificationRulesTable,
  DEFAULT_NOTIFICATION_RULES,
} from "@workspace/db";

/**
 * Idempotently materialise the built-in notification rules.
 *
 * This is intentionally invoked by the explicit worker-zero bootstrap. Keeping
 * it out of the notifications route prevents a database write merely because a
 * route module was imported by a test, migration tool, or secondary process.
 */
export async function seedNotificationRules(): Promise<void> {
  const existing = await db.select().from(notificationRulesTable);
  const existingEvents = new Set(existing.map((rule) => rule.event));

  let added = 0;
  for (const rule of DEFAULT_NOTIFICATION_RULES) {
    if (existingEvents.has(rule.event)) continue;
    await db.insert(notificationRulesTable).values({
      event: rule.event,
      name: rule.name,
      category: rule.category,
      channels: rule.channels,
      recipientType: rule.recipientType,
      recipientRoles: rule.recipientRoles,
      isActive: true,
    });
    added += 1;
  }

  if (added > 0) {
    console.log(`[notifications] Seeded ${added} new notification rules`);
  }
}
