import { Router, type IRouter } from "express";
import { execSync } from "child_process";
import {
  db,
  userSessionsTable,
  userPageVisitsTable,
  userActivityEventsTable,
  userPresenceTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, inArray, ne } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import { withRenderLock } from "../lib/renderLock";

const router: IRouter = Router();

const STALE_HEARTBEAT_SECONDS = 120;

async function closeStaleSession(sessionId: number, reason: string) {
  const [session] = await db.select().from(userSessionsTable).where(eq(userSessionsTable.id, sessionId));
  if (!session || !session.isActive) return;

  const endedAt = session.lastSeenAt;
  const totalSec = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000);
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
  await db.update(userSessionsTable).set({
    lastSeenAt: now,
    activeDurationSeconds: sql`${userSessionsTable.activeDurationSeconds} + ${Math.round(activeDelta)}`,
    idleDurationSeconds: sql`${userSessionsTable.idleDurationSeconds} + ${Math.round(idleDelta)}`,
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
      const totalSec = Math.floor((now.getTime() - session.startedAt.getTime()) / 1000);
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

router.get("/activity/presence", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
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
  .where(ne(userPresenceTable.status, "offline"))
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

  const data = sessions.map(s => ({
    ...s,
    totalDuration: Number(s.totalDuration) || 0,
    activeDuration: Number(s.activeDuration) || 0,
    idleDuration: Number(s.idleDuration) || 0,
    sessionCount: Number(s.sessionCount) || 0,
    status: presenceMap[s.userId] || "offline",
  }));

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

  res.json({
    user,
    presence: presence || { status: "offline" },
    sessions,
    pageVisits,
    moduleBreakdown: moduleBreakdown.map(m => ({ ...m, visitCount: Number(m.visitCount), totalDuration: Number(m.totalDuration), activeDuration: Number(m.activeDuration), idleDuration: Number(m.idleDuration) })),
    events,
    dailyBreakdown: dailyBreakdown.map(d => ({ ...d, totalDuration: Number(d.totalDuration), activeDuration: Number(d.activeDuration), sessionCount: Number(d.sessionCount) })),
  });
});

router.get("/activity/modules", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { from, to } = req.query as Record<string, string>;
  const dateFrom = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
  const dateTo = to ? new Date(to) : new Date();

  const modules = await db.select({
    moduleName: userPageVisitsTable.moduleName,
    visitCount: sql<number>`count(*)`,
    uniqueUsers: sql<number>`count(distinct ${userPageVisitsTable.userId})`,
    totalDuration: sql<number>`sum(${userPageVisitsTable.totalDurationSeconds})`,
    activeDuration: sql<number>`sum(${userPageVisitsTable.activeDurationSeconds})`,
    avgDuration: sql<number>`avg(${userPageVisitsTable.totalDurationSeconds})`,
  })
  .from(userPageVisitsTable)
  .where(and(gte(userPageVisitsTable.enteredAt, dateFrom), lte(userPageVisitsTable.enteredAt, dateTo)))
  .groupBy(userPageVisitsTable.moduleName)
  .orderBy(sql`count(*) desc`);

  res.json({ data: modules.map(m => ({ ...m, visitCount: Number(m.visitCount), uniqueUsers: Number(m.uniqueUsers), totalDuration: Number(m.totalDuration), activeDuration: Number(m.activeDuration), avgDuration: Number(m.avgDuration) })) });
});

router.get("/activity/report/pdf", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { userId: userIdStr, from, to } = req.query as Record<string, string>;
  const targetUserId = parseInt(String(userIdStr), 10);
  if (!targetUserId || isNaN(targetUserId)) {
    res.status(400).json({ error: "userId required" });
    return;
  }

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

  const totalActive = sessions.reduce((s, x) => s + (x.activeDurationSeconds || 0), 0);
  const totalIdle = sessions.reduce((s, x) => s + (x.idleDurationSeconds || 0), 0);
  const totalTotal = sessions.reduce((s, x) => s + (x.totalDurationSeconds || 0), 0);

  function fmtDur(s: number): string {
    if (!s || s < 0) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }
  function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const fromLabel = dateFrom.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const toLabel = dateTo.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const generatedAt = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const moduleRows = moduleBreakdown.map(m => {
    const vis = Number(m.visitCount) || 0;
    const dur = Number(m.totalDuration) || Number(m.activeDuration) || 0;
    return `<tr><td>${esc(m.moduleName || "")}</td><td>${vis}</td><td>${fmtDur(dur)}</td></tr>`;
  }).join("");

  const dailyRows = dailyBreakdown.map(d => {
    const active = Number(d.activeDuration) || 0;
    const sc = Number(d.sessionCount) || 0;
    return `<tr><td>${esc(String(d.day || ""))}</td><td>${sc}</td><td>${fmtDur(active)}</td></tr>`;
  }).join("");

  const sessionRows = sessions.slice(0, 50).map(s => {
    const start = s.startedAt ? new Date(s.startedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    const end = s.endedAt ? new Date(s.endedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    const reason = s.endReason ? esc(s.endReason.replace(/_/g, " ")) : "—";
    return `<tr><td>${start}</td><td>${end}</td><td>${fmtDur(s.totalDurationSeconds || 0)}</td><td>${fmtDur(s.activeDurationSeconds || 0)}</td><td>${reason}</td></tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
@page{size:A4;margin:16mm 14mm}
*,*::before,*::after{box-sizing:border-box}
body{font-family:'DejaVu Sans','Noto Sans',Arial,sans-serif;color:#0f172a;font-size:10px;line-height:1.5;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:18px;font-weight:700;margin:0 0 2px}
h2{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:16px 0 5px;border-bottom:1px solid #e2e8f0;padding-bottom:3px}
.meta{color:#64748b;font-size:9px;margin-bottom:14px}
.kpi-row{display:flex;gap:10px;margin-bottom:14px}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;flex:1}
.kpi-label{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.kpi-value{font-size:15px;font-weight:700;color:#0f172a;margin-top:1px}
table{width:100%;border-collapse:collapse;margin-bottom:6px}
thead th{background:#f1f5f9;text-align:left;padding:4px 6px;font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #e2e8f0}
tbody td{padding:3px 6px;border-bottom:1px solid #f8fafc}
footer{position:fixed;bottom:6mm;left:14mm;right:14mm;font-size:8px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:3px;display:flex;justify-content:space-between}
</style></head><body>
<h1>${esc(`${user.firstName || ""} ${user.lastName || ""}`.trim())}</h1>
<div class="meta">${esc(user.email || "")} &middot; ${esc(user.role || "")} &middot; ${fromLabel} &ndash; ${toLabel}</div>
<div class="kpi-row">
  <div class="kpi"><div class="kpi-label">Sessions</div><div class="kpi-value">${sessions.length}</div></div>
  <div class="kpi"><div class="kpi-label">Total Time</div><div class="kpi-value">${fmtDur(totalTotal)}</div></div>
  <div class="kpi"><div class="kpi-label">Active Time</div><div class="kpi-value">${fmtDur(totalActive)}</div></div>
  <div class="kpi"><div class="kpi-label">Idle Time</div><div class="kpi-value">${fmtDur(totalIdle)}</div></div>
</div>
${moduleBreakdown.length > 0 ? `<h2>Module Breakdown</h2><table><thead><tr><th>Module</th><th>Visits</th><th>Duration</th></tr></thead><tbody>${moduleRows}</tbody></table>` : ""}
${dailyBreakdown.length > 0 ? `<h2>Daily Activity</h2><table><thead><tr><th>Date</th><th>Sessions</th><th>Active Time</th></tr></thead><tbody>${dailyRows}</tbody></table>` : ""}
${sessions.length > 0 ? `<h2>Session History (last ${Math.min(sessions.length, 50)})</h2><table><thead><tr><th>Started</th><th>Ended</th><th>Total</th><th>Active</th><th>End Reason</th></tr></thead><tbody>${sessionRows}</tbody></table>` : ""}
<footer><span>EduConsult OS &mdash; Activity Report</span><span>Generated: ${generatedAt}</span></footer>
</body></html>`;

  function resolveChromium(): string | undefined {
    const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    if (fromEnv) return fromEnv;
    try {
      const found = execSync("which chromium", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (found) return found;
    } catch { /* fall through */ }
    return undefined;
  }

  const LAUNCH_ARGS = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote",
    "--disable-gpu", "--single-process",
  ];

  const pdfBuffer = await withRenderLock(async () => {
    const { chromium } = await import("playwright-core");
    const executablePath = resolveChromium();
    const browser = await chromium.launch({ executablePath, args: LAUNCH_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      return await page.pdf({ format: "A4", printBackground: true });
    } finally {
      await browser.close();
    }
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="activity-${targetUserId}.pdf"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.send(pdfBuffer);
});

function deriveModuleName(route: string): string {
  const map: Record<string, string> = {
    "/admin": "Dashboard", "/staff": "Dashboard", "/student": "Dashboard", "/agent": "Dashboard",
    "/staff/leads": "Leads", "/staff/students": "Students", "/staff/applications": "Applications",
    "/staff/documents": "Documents", "/staff/course-finder": "Course Finder", "/staff/agents": "Agents",
    "/staff/finance": "Finance", "/staff/messages": "Messages", "/staff/settings": "Settings",
    "/admin/users": "Users", "/admin/catalog": "Catalog", "/admin/audit": "Audit Log",
    "/admin/settings": "Settings", "/admin/activity": "Activity",
    "/student/applications": "Applications", "/student/account": "Account",
    "/agent/referrals": "Referrals", "/agent/commissions": "Commissions", "/agent/account": "Account",
  };
  for (const [pattern, name] of Object.entries(map)) {
    if (route === pattern || route.startsWith(pattern + "/")) return name;
  }
  const parts = route.split("/").filter(Boolean);
  return parts[parts.length - 1]?.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Unknown";
}

export default router;
