import { db, pool, conversationsTable, usersTable, settingsTable, staffWorkSchedulesTable, externalContactsTable, leadsTable } from "@workspace/db";
import { and, eq, isNull, lte, ne, inArray } from "drizzle-orm";
import { STAFF_ROLES } from "@workspace/roles";
import { logAudit } from "./auth";
import { dispatchNotification } from "./notificationDispatcher";
import { getStaffCountriesForUsers } from "./staffCountries";

// Faz 2 (staff auto-assign): periodically sweeps inbox conversations that
// are marked needsHuman=true but have sat unassigned too long, and assigns
// them to an eligible staff member. Priority: working-hours match → country
// match (Faz 1 staff_countries) → round-robin. Gated by
// settings.autoAssignStuckConversationsEnabled (default off).

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 45 * 1000;
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;
const ROUND_ROBIN_KV_KEY = "stuck_conversation_rr_last_user_id";

interface StuckConversation {
  id: number;
  channel: string;
  externalContactId: number | null;
  lastMessagePreview: string | null;
}

function tzOffsetMinutes(date: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(date);
    const m: Record<string, string> = {};
    for (const p of parts) m[p.type] = p.value;
    const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch { return 0; }
}

function tzWeekday(date: Date, tz: string): number {
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[wd] ?? 0;
  } catch { return date.getDay(); }
}

function tzMinutesOfDay(date: Date, tz: string): number {
  const offMin = tzOffsetMinutes(date, tz);
  const localMs = date.getTime() + offMin * 60000;
  const local = new Date(localMs);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

async function isAutoAssignEnabled(): Promise<boolean> {
  const [row] = await db.select({ v: settingsTable.autoAssignStuckConversationsEnabled }).from(settingsTable).limit(1);
  return row?.v ?? false;
}

export async function findStuckConversations(): Promise<StuckConversation[]> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const rows = await db.select({
    id: conversationsTable.id,
    channel: conversationsTable.channel,
    externalContactId: conversationsTable.externalContactId,
    lastMessagePreview: conversationsTable.lastMessagePreview,
  })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.needsHuman, true),
      isNull(conversationsTable.assignedToId),
      eq(conversationsTable.status, "open"),
      ne(conversationsTable.channel, "internal"),
      lte(conversationsTable.updatedAt, cutoff)
    ));
  return rows;
}

async function getEligibleStaffPool(): Promise<number[]> {
  const rows = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(inArray(usersTable.role, STAFF_ROLES), eq(usersTable.isActive, true)));
  return rows.map(r => r.id);
}

async function narrowByWorkingHours(userIds: number[]): Promise<number[]> {
  if (userIds.length === 0) return [];
  const users = await db.select({ id: usersTable.id, timezone: usersTable.timezone })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  const schedules = await db.select().from(staffWorkSchedulesTable)
    .where(inArray(staffWorkSchedulesTable.userId, userIds));
  const schedulesByUser = new Map<number, Array<{ weekday: number; startMinutes: number; endMinutes: number }>>();
  for (const s of schedules) {
    const list = schedulesByUser.get(s.userId) || [];
    list.push({ weekday: s.weekday, startMinutes: s.startMinutes, endMinutes: s.endMinutes });
    schedulesByUser.set(s.userId, list);
  }
  const now = new Date();
  const matches: number[] = [];
  for (const u of users) {
    const tz = u.timezone || "UTC";
    const schedule = schedulesByUser.get(u.id);
    if (!schedule || schedule.length === 0) continue;
    const wd = tzWeekday(now, tz);
    const minutes = tzMinutesOfDay(now, tz);
    const inWindow = schedule.some(s => s.weekday === wd && minutes >= s.startMinutes && minutes < s.endMinutes);
    if (inWindow) matches.push(u.id);
  }
  return matches;
}

async function resolveConversationCountry(conv: StuckConversation): Promise<string | null> {
  if (!conv.externalContactId) return null;
  const [contact] = await db.select({ leadId: externalContactsTable.leadId })
    .from(externalContactsTable)
    .where(eq(externalContactsTable.id, conv.externalContactId));
  if (!contact?.leadId) return null;
  const [lead] = await db.select({ country: leadsTable.country, interestedCountry: leadsTable.interestedCountry })
    .from(leadsTable)
    .where(eq(leadsTable.id, contact.leadId));
  if (!lead) return null;
  return lead.interestedCountry || lead.country || null;
}

async function narrowByCountry(userIds: number[], country: string | null): Promise<number[]> {
  if (!country || userIds.length === 0) return [];
  const countriesByUser = await getStaffCountriesForUsers(userIds);
  const normalized = country.trim().toLowerCase();
  const matches: number[] = [];
  for (const [userId, countries] of countriesByUser.entries()) {
    if (countries.some(c => c.trim().toLowerCase() === normalized)) matches.push(userId);
  }
  return matches;
}

async function getLastRoundRobinUserId(): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ value: string }>(`SELECT value FROM system_kv WHERE key = $1`, [ROUND_ROBIN_KV_KEY]);
    if (rows.length > 0) return parseInt(rows[0].value, 10) || null;
  } catch { /* first run — no key yet */ }
  return null;
}

async function saveLastRoundRobinUserId(userId: number): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO system_kv (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [ROUND_ROBIN_KV_KEY, String(userId)]
    );
  } catch (err: any) {
    console.error("[stuckConversationAssigner] failed to save round-robin pointer:", err?.message || err);
  }
}

async function pickRoundRobin(userIds: number[]): Promise<number> {
  const sorted = [...userIds].sort((a, b) => a - b);
  const lastId = await getLastRoundRobinUserId();
  if (lastId === null) return sorted[0];
  const idx = sorted.findIndex(id => id > lastId);
  return idx === -1 ? sorted[0] : sorted[idx];
}

async function pickAssignee(conv: StuckConversation, pool0: number[]): Promise<number> {
  const workingHoursPool = await narrowByWorkingHours(pool0);
  const tierPool = workingHoursPool.length > 0 ? workingHoursPool : pool0;

  const country = await resolveConversationCountry(conv);
  const countryPool = await narrowByCountry(tierPool, country);
  const finalPool = countryPool.length > 0 ? countryPool : tierPool;

  return pickRoundRobin(finalPool);
}

export async function assignStuckConversation(conv: StuckConversation, staffPool: number[]): Promise<number | null> {
  if (staffPool.length === 0) return null;
  const assigneeId = await pickAssignee(conv, staffPool);

  await db.update(conversationsTable)
    .set({ assignedToId: assigneeId })
    .where(and(eq(conversationsTable.id, conv.id), isNull(conversationsTable.assignedToId)));

  await saveLastRoundRobinUserId(assigneeId);

  logAudit(null, "conversation.stuck_assigned", "conversation", conv.id, {
    assignedToId: assigneeId,
    channel: conv.channel,
  });

  await dispatchNotification({
    event: "conversation.stuck_assigned",
    title: "Konuşma Otomatik Atandı",
    body: `Uzun süredir yanıt bekleyen bir konuşma size atandı: ${conv.lastMessagePreview || "(mesaj yok)"}`,
    actionUrl: `/inbox?conversation=${conv.id}`,
    icon: "🤝",
    recipientUserIds: [assigneeId],
    data: { conversationId: conv.id, channel: conv.channel },
  });

  return assigneeId;
}

export async function runStuckConversationSweep(): Promise<void> {
  try {
    if (!(await isAutoAssignEnabled())) return;

    const stuck = await findStuckConversations();
    if (stuck.length === 0) return;

    const staffPool = await getEligibleStaffPool();
    if (staffPool.length === 0) {
      console.warn("[stuckConversationAssigner] No eligible staff found; skipping sweep.");
      return;
    }

    for (const conv of stuck) {
      try {
        const assigneeId = await assignStuckConversation(conv, staffPool);
        if (assigneeId) {
          console.log(`[stuckConversationAssigner] Assigned conversation #${conv.id} to user #${assigneeId}`);
        }
      } catch (err: any) {
        console.error(`[stuckConversationAssigner] Failed to assign conversation #${conv.id}:`, err?.message || err);
      }
    }
  } catch (err: any) {
    console.error("[stuckConversationAssigner] sweep error:", err?.message || err);
  }
}

export function startStuckConversationSweep(): void {
  setTimeout(async () => {
    await runStuckConversationSweep();
    setInterval(runStuckConversationSweep, SWEEP_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
}
