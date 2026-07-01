import { Router, type IRouter } from "express";
import { execSync } from "child_process";
import fs from "fs";
import {
  db,
  userSessionsTable,
  userPageVisitsTable,
  userActivityEventsTable,
  userPresenceTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../lib/auth";
import { getValidated, validate } from "../middlewares/validate";
import { ADMIN_ROLES } from "../lib/roles";
import { withRenderLock } from "../lib/renderLock";
import {
  deriveModuleName,
  normalizeModuleBreakdown,
  clampSessionMetrics,
} from "../lib/activityNormalize";
import {
  loadBrandedPdfSettings,
  resolveBrandedAssets,
  buildBrandedHtml,
  buildBrandedFooterTemplate,
  buildDailyBarChartSvg,
} from "../lib/pdf/brandedBase";

const MAX_SESSION_SEC = 8 * 3600;

// Map the app's i18n language codes to BCP-47 tags so PDF dates format per the
// viewer's selected locale (no hardcoded date locale).
const LOCALE_MAP: Record<string, string> = {
  en: "en-GB", tr: "tr-TR", ar: "ar", fr: "fr-FR", ru: "ru-RU",
  fa: "fa-IR", zh: "zh-CN", hi: "hi-IN", es: "es-ES", id: "id-ID",
};
function resolveLocale(l?: string): string {
  return (l && LOCALE_MAP[l]) || "en-GB";
}

function capSessionWallClock<T extends {
  startedAt: Date | string | null;
  endedAt: Date | string | null;
  lastSeenAt: Date | string | null;
  totalDurationSeconds: number | null;
  activeDurationSeconds: number | null;
  idleDurationSeconds: number | null;
}>(s: T): T {
  const active = s.activeDurationSeconds || 0;
  const rawTotal = s.totalDurationSeconds || 0;
  const rawIdle = s.idleDurationSeconds || 0;

  const startMs = s.startedAt ? new Date(s.startedAt).getTime() : null;
  const endMs = s.endedAt
    ? new Date(s.endedAt).getTime()
    : s.lastSeenAt
      ? new Date(s.lastSeenAt).getTime()
      : null;
  const wallClockSec =
    startMs && endMs && endMs > startMs
      ? Math.round((endMs - startMs) / 1000)
      : rawTotal;

  const capSec = Math.min(MAX_SESSION_SEC, wallClockSec);
  const cappedTotal = Math.min(rawTotal, capSec);
  const cappedActive = Math.min(active, cappedTotal);
  const cappedIdle = Math.max(0, Math.min(rawIdle, cappedTotal - cappedActive));

  return { ...s, totalDurationSeconds: cappedTotal, activeDurationSeconds: cappedActive, idleDurationSeconds: cappedIdle };
}

const router: IRouter = Router();

const STALE_HEARTBEAT_SECONDS = 120;

async function closeStaleSession(sessionId: number, reason: string) {
  const [session] = await db.select().from(userSessionsTable).where(eq(userSessionsTable.id, sessionId));
  if (!session || !session.isActive) return;

  const endedAt = session.lastSeenAt;
  const totalSec = (session.activeDurationSeconds || 0) + (session.idleDurationSeconds || 0);
  await db.update(userSessionsTable).set({
    isActive: false,
    endedAt,
    endReason: reason,
    totalDurationSeconds: totalSec,
  }).where(eq(userSessionsTable.id, sessionId));

  await db.update(userPresenceTable).set({
    status: "offline",
    updatedAt: new Date(),
    sessionId: null,
  }).where(eq(userPresenceTable.userId, session.userId));
}

async function cleanupStaleSessions() {
  const threshold = new Date(Date.now() - STALE_HEARTBEAT_SECONDS * 1000);
  const stale = await db.select({ id: userSessionsTable.id })
    .from(userSessionsTable)
    .where(and(
      eq(userSessionsTable.isActive, true),
      lte(userSessionsTable.lastSeenAt, threshold)
    ));
  for (const s of stale) {
    await closeStaleSession(s.id, "stale_heartbeat");
  }
}

setInterval(cleanupStaleSessions, 60000);

router.post("/activity/session/start", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const userAgent = req.headers["user-agent"] || "";

  const existing = await db.select().from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, userId), eq(userSessionsTable.isActive, true)))
    .limit(1);

  if (existing.length > 0) {
    await db.update(userSessionsTable).set({ lastSeenAt: new Date() }).where(eq(userSessionsTable.id, existing[0].id));
    await db.insert(userPresenceTable).values({ userId, status: "active", lastActiveAt: new Date(), sessionId: existing[0].id })
      .onConflictDoUpdate({ target: userPresenceTable.userId, set: { status: "active", lastActiveAt: new Date(), sessionId: existing[0].id, updatedAt: new Date() } });
    res.json({ sessionId: existing[0].id, resumed: true });
    return;
  }

  const [session] = await db.insert(userSessionsTable).values({
    userId, userAgent, ipAddress: req.ip || null,
  }).returning();

  await db.insert(userPresenceTable).values({ userId, status: "active", lastActiveAt: new Date(), sessionId: session.id })
    .onConflictDoUpdate({ target: userPresenceTable.userId, set: { status: "active", lastActiveAt: new Date(), sessionId: session.id, updatedAt: new Date() } });

  await db.insert(userActivityEventsTable).values({ userId, sessionId: session.id, eventType: "session_started", metadata: { userAgent } });

  res.json({ sessionId: session.id });
});

router.post("/activity/heartbeat", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { sessionId, status, route, activeDelta = 0, idleDelta = 0 } = req.body;

  if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

  const now = new Date();
  const aDelta = Math.round(activeDelta);
  const iDelta = Math.round(idleDelta);
  await db.update(userSessionsTable).set({
    lastSeenAt: now,
    activeDurationSeconds: sql`${userSessionsTable.activeDurationSeconds} + ${aDelta}`,
    idleDurationSeconds: sql`${userSessionsTable.idleDurationSeconds} + ${iDelta}`,
    totalDurationSeconds: sql`${userSessionsTable.activeDurationSeconds} + ${userSessionsTable.idleDurationSeconds} + ${aDelta} + ${iDelta}`,
  }).where(and(eq(userSessionsTable.id, sessionId), eq(userSessionsTable.userId, userId)));

  const presenceStatus = status === "idle" ? "idle" : "active";
  await db.insert(userPresenceTable).values({
    userId, status: presenceStatus, lastActiveAt: presenceStatus === "active" ? now : undefined, currentRoute: route, sessionId, updatedAt: now,
  }).onConflictDoUpdate({
    target: userPresenceTable.userId,
    set: { status: presenceStatus, ...(presenceStatus === "active" ? { lastActiveAt: now } : {}), currentRoute: route, sessionId, updatedAt: now },
  });

  res.json({ ok: true });
});

router.post("/activity/page-visit", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { sessionId, route, moduleName } = req.body;
  if (!sessionId || !route) { res.status(400).json({ error: "sessionId and route required" }); return; }

  const [visit] = await db.insert(userPageVisitsTable).values({
    userId, sessionId, route, moduleName: moduleName || deriveModuleName(route),
  }).returning();

  res.json({ visitId: visit.id });
});

router.post("/activity/page-leave", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { visitId, activeDuration = 0, idleDuration = 0 } = req.body;
  if (!visitId) { res.status(400).json({ error: "visitId required" }); return; }

  const now = new Date();
  await db.update(userPageVisitsTable).set({
    leftAt: now,
    activeDurationSeconds: Math.round(activeDuration),
    idleDurationSeconds: Math.round(idleDuration),
    totalDurationSeconds: Math.round(activeDuration + idleDuration),
  }).where(and(eq(userPageVisitsTable.id, visitId), eq(userPageVisitsTable.userId, userId)));

  res.json({ ok: true });
});

router.post("/activity/event", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { sessionId, eventType, route, metadata } = req.body;
  if (!eventType) { res.status(400).json({ error: "eventType required" }); return; }

  await db.insert(userActivityEventsTable).values({
    userId, sessionId, eventType, route, metadata: metadata || {},
  });
  res.json({ ok: true });
});

router.post("/activity/session/end", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { sessionId, reason = "manual_logout" } = req.body;

  if (sessionId) {
    const [session] = await db.select().from(userSessionsTable)
      .where(and(eq(userSessionsTable.id, sessionId), eq(userSessionsTable.userId, userId)));
    if (session && session.isActive) {
      const now = new Date();
      const totalSec = (session.activeDurationSeconds || 0) + (session.idleDurationSeconds || 0);
      await db.update(userSessionsTable).set({
        isActive: false, endedAt: now, endReason: reason, totalDurationSeconds: totalSec,
      }).where(eq(userSessionsTable.id, sessionId));

      await db.insert(userActivityEventsTable).values({ userId, sessionId, eventType: "session_ended", metadata: { reason } });
    }
  }

  await db.update(userPresenceTable).set({ status: "offline", sessionId: null, updatedAt: new Date() })
    .where(eq(userPresenceTable.userId, userId));

  res.json({ ok: true });
});

const presenceQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
});
type PresenceSchemas = { query: typeof presenceQuerySchema };

router.get("/activity/presence", requireAuth, requireRole(...ADMIN_ROLES), validate({ query: presenceQuerySchema }), async (req, res): Promise<void> => {
  const { userId: targetUserId } = getValidated<PresenceSchemas>(req).query;
  const presenceConditions = [ne(userPresenceTable.status, "offline")];
  if (targetUserId) presenceConditions.push(eq(userPresenceTable.userId, targetUserId));
  const presences = await db.select({
    userId: userPresenceTable.userId,
    status: userPresenceTable.status,
    lastActiveAt: userPresenceTable.lastActiveAt,
    currentRoute: userPresenceTable.currentRoute,
    sessionId: userPresenceTable.sessionId,
    updatedAt: userPresenceTable.updatedAt,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    email: usersTable.email,
    role: usersTable.role,
    avatarUrl: usersTable.avatarUrl,
  })
  .from(userPresenceTable)
  .innerJoin(usersTable, eq(userPresenceTable.userId, usersTable.id))
  .where(and(...presenceConditions))
  .orderBy(desc(userPresenceTable.lastActiveAt));

  res.json({ data: presences });
});

router.get("/activity/analytics", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { from, to, userId: targetUserId } = req.query as Record<string, string>;

  const dateFrom = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
  const dateTo = to ? new Date(to) : new Date();

  const conditions: any[] = [
    gte(userSessionsTable.startedAt, dateFrom),
    lte(userSessionsTable.startedAt, dateTo),
  ];
  if (targetUserId) conditions.push(eq(userSessionsTable.userId, parseInt(targetUserId)));

  const sessions = await db.select({
    userId: userSessionsTable.userId,
    totalDuration: sql<number>`sum(${userSessionsTable.totalDurationSeconds})`,
    activeDuration: sql<number>`sum(${userSessionsTable.activeDurationSeconds})`,
    idleDuration: sql<number>`sum(${userSessionsTable.idleDurationSeconds})`,
    sessionCount: sql<number>`count(*)`,
    firstLogin: sql<string>`min(${userSessionsTable.startedAt})`,
    lastSeen: sql<string>`max(${userSessionsTable.lastSeenAt})`,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    email: usersTable.email,
    role: usersTable.role,
  })
  .from(userSessionsTable)
  .innerJoin(usersTable, eq(userSessionsTable.userId, usersTable.id))
  .where(and(...conditions))
  .groupBy(userSessionsTable.userId, usersTable.firstName, usersTable.lastName, usersTable.email, usersTable.role);

  const presences = await db.select().from(userPresenceTable);
  const presenceMap: Record<number, string> = {};
  for (const p of presences) presenceMap[p.userId] = p.status;

  const data = sessions.map(s => {
    const totalDuration = Number(s.totalDuration) || 0;
    const activeDuration = Number(s.activeDuration) || 0;
    const idleDuration = Math.max(0, Math.min(Number(s.idleDuration) || 0, totalDuration - activeDuration));
    return {
      ...s,
      totalDuration,
      activeDuration,
      idleDuration,
      sessionCount: Number(s.sessionCount) || 0,
      status: presenceMap[s.userId] || "offline",
    };
  });

  const totals = {
    totalDuration: data.reduce((sum, d) => sum + d.totalDuration, 0),
    activeDuration: data.reduce((sum, d) => sum + d.activeDuration, 0),
    idleDuration: data.reduce((sum, d) => sum + d.idleDuration, 0),
    totalSessions: data.reduce((sum, d) => sum + d.sessionCount, 0),
    uniqueUsers: data.length,
    onlineUsers: data.filter(d => d.status !== "offline").length,
    activeUsers: data.filter(d => d.status === "active").length,
    idleUsers: data.filter(d => d.status === "idle").length,
  };

  res.json({ data, totals });
});

router.get("/activity/user/:userId", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const targetUserId = parseInt(String(req.params.userId), 10);
  const { from, to } = req.query as Record<string, string>;

  const dateFrom = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
  const dateTo = to ? new Date(to) : new Date();

  const sessions = await db.select().from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, targetUserId), gte(userSessionsTable.startedAt, dateFrom), lte(userSessionsTable.startedAt, dateTo)))
    .orderBy(desc(userSessionsTable.startedAt))
    .limit(100);

  const pageVisits = await db.select().from(userPageVisitsTable)
    .where(and(eq(userPageVisitsTable.userId, targetUserId), gte(userPageVisitsTable.enteredAt, dateFrom), lte(userPageVisitsTable.enteredAt, dateTo)))
    .orderBy(desc(userPageVisitsTable.enteredAt))
    .limit(200);

  const moduleBreakdown = await db.select({
    moduleName: userPageVisitsTable.moduleName,
    visitCount: sql<number>`count(*)`,
    totalDuration: sql<number>`sum(${userPageVisitsTable.totalDurationSeconds})`,
    activeDuration: sql<number>`sum(${userPageVisitsTable.activeDurationSeconds})`,
    idleDuration: sql<number>`sum(${userPageVisitsTable.idleDurationSeconds})`,
  })
  .from(userPageVisitsTable)
  .where(and(eq(userPageVisitsTable.userId, targetUserId), gte(userPageVisitsTable.enteredAt, dateFrom), lte(userPageVisitsTable.enteredAt, dateTo)))
  .groupBy(userPageVisitsTable.moduleName)
  .orderBy(sql`sum(${userPageVisitsTable.activeDurationSeconds}) desc`);

  const events = await db.select().from(userActivityEventsTable)
    .where(and(eq(userActivityEventsTable.userId, targetUserId), gte(userActivityEventsTable.createdAt, dateFrom), lte(userActivityEventsTable.createdAt, dateTo)))
    .orderBy(desc(userActivityEventsTable.createdAt))
    .limit(200);

  const dailyBreakdown = await db.select({
    day: sql<string>`date(${userSessionsTable.startedAt})`,
    totalDuration: sql<number>`sum(${userSessionsTable.totalDurationSeconds})`,
    activeDuration: sql<number>`sum(${userSessionsTable.activeDurationSeconds})`,
    sessionCount: sql<number>`count(*)`,
  })
  .from(userSessionsTable)
  .where(and(eq(userSessionsTable.userId, targetUserId), gte(userSessionsTable.startedAt, dateFrom), lte(userSessionsTable.startedAt, dateTo)))
  .groupBy(sql`date(${userSessionsTable.startedAt})`)
  .orderBy(sql`date(${userSessionsTable.startedAt})`);

  const [presence] = await db.select().from(userPresenceTable).where(eq(userPresenceTable.userId, targetUserId));
  const [user] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, targetUserId));

  const normalizedSessions = sessions.map(s => capSessionWallClock(s));

  res.json({
    user,
    presence: presence || { status: "offline" },
    sessions: normalizedSessions,
    pageVisits,
    moduleBreakdown: normalizeModuleBreakdown(moduleBreakdown.map(m => ({ ...m, visitCount: Number(m.visitCount), totalDuration: Number(m.totalDuration), activeDuration: Number(m.activeDuration), idleDuration: Number(m.idleDuration) }))),
    events,
    dailyBreakdown: dailyBreakdown.map(d => ({ ...d, totalDuration: Number(d.totalDuration), activeDuration: Number(d.activeDuration), sessionCount: Number(d.sessionCount) })),
  });
});

const modulesQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.coerce.number().int().positive().optional(),
});
type ModulesSchemas = { query: typeof modulesQuerySchema };

router.get("/activity/modules", requireAuth, requireRole(...ADMIN_ROLES), validate({ query: modulesQuerySchema }), async (req, res): Promise<void> => {
  const { from, to, userId: targetUserId } = getValidated<ModulesSchemas>(req).query;
  const dateFrom = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
  const dateTo = to ? new Date(to) : new Date();

  const moduleConditions = [gte(userPageVisitsTable.enteredAt, dateFrom), lte(userPageVisitsTable.enteredAt, dateTo)];
  if (targetUserId) moduleConditions.push(eq(userPageVisitsTable.userId, targetUserId));

  const modules = await db.select({
    moduleName: userPageVisitsTable.moduleName,
    visitCount: sql<number>`count(*)`,
    uniqueUsers: sql<number>`count(distinct ${userPageVisitsTable.userId})`,
    totalDuration: sql<number>`sum(${userPageVisitsTable.totalDurationSeconds})`,
    activeDuration: sql<number>`sum(${userPageVisitsTable.activeDurationSeconds})`,
    avgDuration: sql<number>`avg(${userPageVisitsTable.totalDurationSeconds})`,
  })
  .from(userPageVisitsTable)
  .where(and(...moduleConditions))
  .groupBy(userPageVisitsTable.moduleName)
  .orderBy(sql`count(*) desc`);

  const rawModules = modules.map(m => ({
    moduleName: m.moduleName,
    visitCount: Number(m.visitCount),
    uniqueUsers: Number(m.uniqueUsers),
    totalDuration: Number(m.totalDuration),
    activeDuration: Number(m.activeDuration),
    avgDuration: Number(m.avgDuration),
    idleDuration: 0,
  }));
  res.json({ data: normalizeModuleBreakdown(rawModules).map(m => ({ ...m, avgDuration: m.avgDuration ?? 0 })) });
});

const pdfReportQuerySchema = z.object({
  userId: z.coerce.number().int().positive(),
  from: z.string().optional(),
  to: z.string().optional(),
  locale: z.string().max(10).optional(),
});
type PdfReportSchemas = { query: typeof pdfReportQuerySchema };

router.get("/activity/report/pdf", requireAuth, requireRole(...ADMIN_ROLES), validate({ query: pdfReportQuerySchema }), async (req, res): Promise<void> => {
  const { userId: targetUserId, from, to, locale: localeParam } = getValidated<PdfReportSchemas>(req).query;
  const locale = resolveLocale(localeParam);

  const dateFrom = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
  const dateTo = to ? new Date(to) : new Date();
  if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
    res.status(400).json({ error: "Invalid from/to date" });
    return;
  }

  const [user] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const sessions = await db.select().from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, targetUserId), gte(userSessionsTable.startedAt, dateFrom), lte(userSessionsTable.startedAt, dateTo)))
    .orderBy(desc(userSessionsTable.startedAt))
    .limit(100);

  const moduleBreakdown = await db.select({
    moduleName: userPageVisitsTable.moduleName,
    visitCount: sql<number>`count(*)`,
    totalDuration: sql<number>`sum(${userPageVisitsTable.totalDurationSeconds})`,
    activeDuration: sql<number>`sum(${userPageVisitsTable.activeDurationSeconds})`,
  })
  .from(userPageVisitsTable)
  .where(and(eq(userPageVisitsTable.userId, targetUserId), gte(userPageVisitsTable.enteredAt, dateFrom), lte(userPageVisitsTable.enteredAt, dateTo)))
  .groupBy(userPageVisitsTable.moduleName)
  .orderBy(sql`count(*) desc`);

  const dailyBreakdown = await db.select({
    day: sql<string>`date(${userSessionsTable.startedAt})`,
    activeDuration: sql<number>`sum(${userSessionsTable.activeDurationSeconds})`,
    sessionCount: sql<number>`count(*)`,
  })
  .from(userSessionsTable)
  .where(and(eq(userSessionsTable.userId, targetUserId), gte(userSessionsTable.startedAt, dateFrom), lte(userSessionsTable.startedAt, dateTo)))
  .groupBy(sql`date(${userSessionsTable.startedAt})`)
  .orderBy(sql`date(${userSessionsTable.startedAt})`);

  const cappedPdfSessions = sessions.map(s => capSessionWallClock(s));
  const totalActive = cappedPdfSessions.reduce((s, x) => s + (x.activeDurationSeconds || 0), 0);
  const totalIdle = cappedPdfSessions.reduce((s, x) => s + (x.idleDurationSeconds || 0), 0);
  const totalTotal = cappedPdfSessions.reduce((s, x) => s + (x.totalDurationSeconds || 0), 0);

  const fromLabel = dateFrom.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  const toLabel = dateTo.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });

  function fmtDur(s: number): string {
    if (!s || s < 0) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }
  function pesc(v: string): string {
    return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const clampedIdle = Math.max(0, Math.min(totalIdle, totalTotal - totalActive));

  const brandSettings = await loadBrandedPdfSettings();
  const { logoUri, sealUri } = await resolveBrandedAssets(brandSettings);
  const primary = brandSettings.pdfPrimaryColor || "#2563eb";
  const accent = brandSettings.pdfAccentColor || "#0ea5e9";

  const dailyChartData = dailyBreakdown.map(d => ({
    day: String(d.day || ""),
    activeDuration: Number(d.activeDuration) || 0,
  }));

  const barChart = dailyChartData.length > 1
    ? buildDailyBarChartSvg(dailyChartData, primary, accent)
    : "";

  const normalizedMods = normalizeModuleBreakdown(moduleBreakdown.map(m => ({ ...m, visitCount: Number(m.visitCount), totalDuration: Number(m.totalDuration), activeDuration: Number(m.activeDuration), idleDuration: Number((m as any).idleDuration) || 0 })));
  const maxModVisits = Math.max(...normalizedMods.map(m => Number(m.visitCount) || 0), 1);
  const moduleRows = normalizedMods.map((m, idx) => {
    const vis = Number(m.visitCount) || 0;
    const dur = Number(m.totalDuration) || Number(m.activeDuration) || 0;
    const pct = Math.round((vis / maxModVisits) * 100);
    const bg = idx % 2 === 0 ? "#fff" : "#f8fafc";
    return `<tr style="background:${bg}">
      <td style="padding:5px 8px;font-size:9.5px;width:40%">${pesc(m.moduleName || "")}</td>
      <td style="padding:5px 8px;font-size:9.5px;text-align:center;width:10%">${vis}</td>
      <td style="padding:5px 8px;font-size:9.5px;width:15%">${fmtDur(dur)}</td>
      <td style="padding:5px 8px;width:35%">
        <div style="height:6px;background:${pesc(accent)}33;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${pesc(primary)};border-radius:3px"></div>
        </div>
      </td>
    </tr>`;
  }).join("");

  const sessionRows = sessions.slice(0, 50).map((s, idx) => {
    const start = s.startedAt ? new Date(s.startedAt).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    const end = s.endedAt ? new Date(s.endedAt).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    const reason = s.endReason ? pesc(s.endReason.replace(/_/g, " ")) : "—";
    const bg = idx % 2 === 0 ? "#fff" : "#f8fafc";
    return `<tr style="background:${bg}">
      <td style="padding:4px 8px;font-size:9px">${start}</td>
      <td style="padding:4px 8px;font-size:9px">${end}</td>
      <td style="padding:4px 8px;font-size:9px;font-family:monospace">${fmtDur(s.totalDurationSeconds || 0)}</td>
      <td style="padding:4px 8px;font-size:9px;font-family:monospace;color:#16a34a">${fmtDur(s.activeDurationSeconds || 0)}</td>
      <td style="padding:4px 8px;font-size:9px;color:#64748b">${reason}</td>
    </tr>`;
  }).join("");

  const body = `
<p style="font-size:9px;color:#64748b;margin:-10px 0 16px">${pesc(user.email || "")} &middot; ${pesc(user.role || "")} &middot; ${fromLabel} &ndash; ${toLabel}</p>

<div style="display:flex;gap:10px;margin-bottom:16px">
  <div style="border:1px solid #e2e8f0;border-radius:7px;padding:9px 13px;flex:1;border-top:3px solid ${pesc(primary)};background:#f8fafc">
    <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Sessions</div>
    <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:1px">${sessions.length}</div>
  </div>
  <div style="border:1px solid #e2e8f0;border-radius:7px;padding:9px 13px;flex:1;border-top:3px solid ${pesc(primary)};background:#f8fafc">
    <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Total Time</div>
    <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:1px">${fmtDur(totalTotal)}</div>
  </div>
  <div style="border:1px solid #e2e8f0;border-radius:7px;padding:9px 13px;flex:1;border-top:3px solid #16a34a;background:#f8fafc">
    <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Active Time</div>
    <div style="font-size:16px;font-weight:700;color:#16a34a;margin-top:1px">${fmtDur(totalActive)}</div>
  </div>
  <div style="border:1px solid #e2e8f0;border-radius:7px;padding:9px 13px;flex:1;border-top:3px solid #d97706;background:#f8fafc">
    <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Idle Time</div>
    <div style="font-size:16px;font-weight:700;color:#d97706;margin-top:1px">${fmtDur(clampedIdle)}</div>
  </div>
</div>

${barChart ? `
<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748b;margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid ${pesc(primary)}22">Daily Active Time</div>
<div style="margin-bottom:16px">${barChart}</div>` : ""}

${moduleBreakdown.length > 0 ? `
<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748b;margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid ${pesc(primary)}22">Module Breakdown</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
  <thead><tr style="background:${pesc(primary)}">
    <th style="color:#fff;text-align:left;padding:5px 8px;font-size:8.5px;text-transform:uppercase">Module</th>
    <th style="color:#fff;text-align:center;padding:5px 8px;font-size:8.5px;text-transform:uppercase">Visits</th>
    <th style="color:#fff;text-align:left;padding:5px 8px;font-size:8.5px;text-transform:uppercase">Duration</th>
    <th style="color:#fff;text-align:left;padding:5px 8px;font-size:8.5px;text-transform:uppercase">Share</th>
  </tr></thead>
  <tbody>${moduleRows}</tbody>
</table>` : ""}

${sessions.length > 0 ? `
<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748b;margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid ${pesc(primary)}22">Session History (last ${Math.min(sessions.length, 50)})</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:8px">
  <thead><tr style="background:${pesc(primary)}">
    <th style="color:#fff;text-align:left;padding:5px 8px;font-size:8.5px;text-transform:uppercase">Started</th>
    <th style="color:#fff;text-align:left;padding:5px 8px;font-size:8.5px;text-transform:uppercase">Ended</th>
    <th style="color:#fff;text-align:left;padding:5px 8px;font-size:8.5px;text-transform:uppercase">Total</th>
    <th style="color:#fff;text-align:left;padding:5px 8px;font-size:8.5px;text-transform:uppercase">Active</th>
    <th style="color:#fff;text-align:left;padding:5px 8px;font-size:8.5px;text-transform:uppercase">End Reason</th>
  </tr></thead>
  <tbody>${sessionRows}</tbody>
</table>` : ""}
`;

  const html = buildBrandedHtml({
    title: `${(user.firstName || "")} ${(user.lastName || "")}`.trim() || "Activity Report",
    subtitle: `Activity Report — ${fromLabel} – ${toLabel}`,
    body,
    settings: brandSettings,
    logoBuri: logoUri,
    sealUri,
    locale,
  });
  const footerTemplate = buildBrandedFooterTemplate(brandSettings, locale);

  function resolveChromium(): string | undefined {
    const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    if (fromEnv) return fromEnv;
    // Nix store chromium (Replit / NixOS environment)
    try {
      const nixDir = "/nix/store";
      if (fs.existsSync(nixDir)) {
        const entries = fs.readdirSync(nixDir);
        for (const entry of entries) {
          if (!entry.includes("chromium")) continue;
          const candidate = `${nixDir}/${entry}/bin/chromium`;
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch { /* fall through */ }
    try {
      const found = execSync("which chromium 2>/dev/null", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (found) return found;
    } catch { /* fall through */ }
    return undefined;
  }

  const LAUNCH_ARGS = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote",
    "--disable-gpu", "--single-process",
  ];

  try {
    const pdfBuffer = await withRenderLock(async () => {
      const { chromium } = await import("playwright-core");
      const executablePath = resolveChromium();
      const browser = await chromium.launch({ executablePath, args: LAUNCH_ARGS });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        return await page.pdf({
          format: "A4",
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate,
          margin: { top: "18mm", right: "16mm", bottom: "22mm", left: "16mm" },
        });
      } finally {
        await browser.close();
      }
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="activity-${targetUserId}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("[ActivityPDF] Failed to generate PDF:", err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF", detail: String(err?.message || err) });
    }
  }
});

export default router;
