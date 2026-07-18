import { Router, type IRouter } from "express";
import { db, leadsTable, studentsTable, applicationsTable, agentsTable, documentsTable, commissionsTable, pipelineStagesTable, messagesTable, conversationsTable, channelAccountsTable } from "@workspace/db";
import { sql, eq, and, isNull, inArray, or, gte, ne, notInArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES, AGENT_ROLES } from "../lib/roles";
import { isAgentRole, isAdminRole } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { z } from "zod";
import { validate, getValidated } from "../middlewares/validate";

const router: IRouter = Router();

router.get("/stats/overview", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const user = req.user!;
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const isAgent = isAgentRole(user.role);

  const seasonParam = typeof req.query.season === "string" && req.query.season ? req.query.season : null;
  const seasonLead = seasonParam ? eq(leadsTable.season, seasonParam) : undefined;
  const seasonStudent = seasonParam ? eq(studentsTable.season, seasonParam) : undefined;
  const seasonApp = seasonParam ? eq(applicationsTable.season, seasonParam) : undefined;

  const wonStages = await db
    .select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.variant, "won")));
  const wonKeys = wonStages.map(s => s.key);

  const lostStages = await db
    .select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.variant, "lost")));
  const lostKeys = lostStages.map(s => s.key);
  const terminalKeys = [...wonKeys, ...lostKeys];

  let leadFilter = and(isNull(leadsTable.deletedAt), seasonLead)!;
  let studentFilter = and(isNull(studentsTable.deletedAt), seasonStudent)!;
  let appFilter = and(isNull(applicationsTable.deletedAt), seasonApp)!;

  if (isAgent) {
    const agentIds = await getAgentVisibleIds(user.id, user.role);
    if (agentIds.length === 0) {
      res.json({ totalLeads: 0, totalStudents: 0, totalApplications: 0, activeApplications: 0, enrolledStudents: 0, monthlyRevenue: 0 });
      return;
    }
    leadFilter = and(isNull(leadsTable.deletedAt), inArray(leadsTable.agentId, agentIds), seasonLead)!;
    studentFilter = and(isNull(studentsTable.deletedAt), inArray(studentsTable.agentId, agentIds), seasonStudent)!;
    appFilter = and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.agentId, agentIds), seasonApp)!;
  } else if (!isAdmin) {
    leadFilter = and(isNull(leadsTable.deletedAt), or(eq(leadsTable.assignedToId, user.id), isNull(leadsTable.assignedToId)), seasonLead)!;
    studentFilter = and(isNull(studentsTable.deletedAt), or(eq(studentsTable.assignedToId, user.id), isNull(studentsTable.assignedToId)), seasonStudent)!;
    appFilter = and(isNull(applicationsTable.deletedAt), or(eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.assignedToId)), seasonApp)!;
  }

  const [[{ leads }], [{ students }], [{ applications }]] = await Promise.all([
    db.select({ leads: sql<number>`count(*)` }).from(leadsTable).where(leadFilter),
    db.select({ students: sql<number>`count(*)` }).from(studentsTable).where(studentFilter),
    db.select({ applications: sql<number>`count(*)` }).from(applicationsTable).where(appFilter),
  ]);

  let activeApps = Number(applications);
  if (terminalKeys.length > 0) {
    const terminalSql = sql`stage NOT IN (${sql.join(terminalKeys.map(k => sql`${k}`), sql`, `)})`;
    if (isAgent) {
      const agentIds = await getAgentVisibleIds(user.id, user.role);
      const [{ active }] = await db
        .select({ active: sql<number>`count(*)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.agentId, agentIds), terminalSql, seasonApp));
      activeApps = Number(active);
    } else if (!isAdmin) {
      const [{ active }] = await db
        .select({ active: sql<number>`count(*)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), or(eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.assignedToId)), terminalSql, seasonApp));
      activeApps = Number(active);
    } else {
      const [{ active }] = await db
        .select({ active: sql<number>`count(*)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), terminalSql, seasonApp));
      activeApps = Number(active);
    }
  }

  let enrolledStudents = 0;
  if (wonKeys.length > 0) {
    if (isAgent) {
      const agentIds = await getAgentVisibleIds(user.id, user.role);
      const [{ enrolled }] = await db
        .select({ enrolled: sql<number>`count(DISTINCT student_id)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.stage, wonKeys), inArray(applicationsTable.agentId, agentIds), seasonApp));
      enrolledStudents = Number(enrolled);
    } else if (!isAdmin) {
      const [{ enrolled }] = await db
        .select({ enrolled: sql<number>`count(DISTINCT student_id)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.stage, wonKeys), or(eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.assignedToId)), seasonApp));
      enrolledStudents = Number(enrolled);
    } else {
      const [{ enrolled }] = await db
        .select({ enrolled: sql<number>`count(DISTINCT student_id)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.stage, wonKeys), seasonApp));
      enrolledStudents = Number(enrolled);
    }
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  let isSubAgentUser = false;
  if (isAgent) {
    const agentRec = await getAgentRecord(user.id, user.role);
    isSubAgentUser = user.role === "sub_agent" || !!agentRec?.parentAgentId;
  }

  const revenuePeriodSql = seasonParam
    ? sql`season = ${seasonParam}`
    : sql`confirmed_at >= ${monthStart} AND confirmed_at < ${monthEnd}`;
  let revenueFilter = sql`status IN ('confirmed','collected_partial','collected_full','settled') AND ${revenuePeriodSql}`;
  if (isAgent) {
    const agentIds = await getAgentVisibleIds(user.id, user.role);
    const idCol = isSubAgentUser ? sql`sub_agent_id` : sql`agent_id`;
    revenueFilter = sql`status IN ('confirmed','collected_partial','collected_full','settled') AND ${revenuePeriodSql} AND ${idCol} IN (${sql.join(agentIds.map(id => sql`${id}`), sql`, `)})`;
  }

  const revenueRows = await db
    .select({
      currency: sql<string>`coalesce(currency, 'USD')`,
      universityCommissionAmount: commissionsTable.universityCommissionAmount,
      agentCommissionAmount: commissionsTable.agentCommissionAmount,
      subAgentCommissionAmount: commissionsTable.subAgentCommissionAmount,
    })
    .from(commissionsTable)
    .where(revenueFilter);

  const SUPPORTED = ["USD", "EUR", "GBP", "TRY", "AED"] as const;
  const monthlyRevenueByCurrency: Record<string, number> = {};
  const toN = (v: any) => parseFloat(String(v ?? 0)) || 0;
  for (const r of revenueRows) {
    const raw = String(r.currency || "USD").toUpperCase();
    const cur = (SUPPORTED as readonly string[]).includes(raw) ? raw : "USD";
    const uAmt = toN(r.universityCommissionAmount);
    const aAmt = toN(r.agentCommissionAmount);
    const saAmt = toN(r.subAgentCommissionAmount);
    const val = isAgent
      ? (isSubAgentUser ? saAmt : (aAmt - saAmt))
      : (uAmt - aAmt);
    monthlyRevenueByCurrency[cur] = (monthlyRevenueByCurrency[cur] || 0) + val;
  }
  const monthlyRevenue = Object.values(monthlyRevenueByCurrency).reduce((s, v) => s + v, 0);

  res.json({
    totalLeads: Number(leads),
    totalStudents: Number(students),
    totalApplications: Number(applications),
    activeApplications: activeApps,
    enrolledStudents: enrolledStudents,
    monthlyRevenue,
    monthlyRevenueByCurrency,
  });
});

router.get("/stats/growth", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const user = req.user!;
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const isAgent = isAgentRole(user.role);

  const seasonParam = typeof req.query.season === "string" && /^\d{4}$/.test(req.query.season) ? req.query.season : null;
  const seasonYear = seasonParam ? parseInt(seasonParam, 10) : NaN;

  const now = new Date();
  const months: { name: string; start: string; end: string }[] = [];
  if (Number.isFinite(seasonYear)) {
    for (let m = 0; m < 12; m++) {
      const d = new Date(seasonYear, m, 1);
      const start = d.toISOString();
      const end = new Date(seasonYear, m + 1, 1).toISOString();
      const name = d.toLocaleString("en-US", { month: "short" });
      months.push({ name, start, end });
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = d.toISOString();
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
      const name = d.toLocaleString("en-US", { month: "short" });
      months.push({ name, start, end });
    }
  }

  let agentIds: number[] = [];
  if (isAgent) {
    agentIds = await getAgentVisibleIds(user.id, user.role);
    if (agentIds.length === 0) {
      res.json(months.map(m => ({ name: m.name, leads: 0, students: 0, applications: 0 })));
      return;
    }
  }

  const result = await Promise.all(months.map(async (m) => {
    const dateFilter = sql`created_at >= ${m.start} AND created_at < ${m.end}`;

    let leadQ, studentQ, appQ;

    if (isAgent) {
      const agentFilter = sql`agent_id IN (${sql.join(agentIds.map(id => sql`${id}`), sql`, `)})`;
      leadQ = db.select({ c: sql<number>`count(*)` }).from(leadsTable).where(and(isNull(leadsTable.deletedAt), sql`${dateFilter} AND ${agentFilter}`));
      studentQ = db.select({ c: sql<number>`count(*)` }).from(studentsTable).where(and(isNull(studentsTable.deletedAt), sql`${dateFilter} AND ${agentFilter}`));
      appQ = db.select({ c: sql<number>`count(*)` }).from(applicationsTable).where(and(isNull(applicationsTable.deletedAt), sql`${dateFilter} AND ${agentFilter}`));
    } else if (!isAdmin) {
      const staffFilter = or(eq(leadsTable.assignedToId, user.id), isNull(leadsTable.assignedToId));
      const studentStaffFilter = or(eq(studentsTable.assignedToId, user.id), isNull(studentsTable.assignedToId));
      const appStaffFilter = or(eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.assignedToId));
      leadQ = db.select({ c: sql<number>`count(*)` }).from(leadsTable).where(and(isNull(leadsTable.deletedAt), sql`${dateFilter}`, staffFilter));
      studentQ = db.select({ c: sql<number>`count(*)` }).from(studentsTable).where(and(isNull(studentsTable.deletedAt), sql`${dateFilter}`, studentStaffFilter));
      appQ = db.select({ c: sql<number>`count(*)` }).from(applicationsTable).where(and(isNull(applicationsTable.deletedAt), sql`${dateFilter}`, appStaffFilter));
    } else {
      leadQ = db.select({ c: sql<number>`count(*)` }).from(leadsTable).where(and(isNull(leadsTable.deletedAt), sql`${dateFilter}`));
      studentQ = db.select({ c: sql<number>`count(*)` }).from(studentsTable).where(and(isNull(studentsTable.deletedAt), sql`${dateFilter}`));
      appQ = db.select({ c: sql<number>`count(*)` }).from(applicationsTable).where(and(isNull(applicationsTable.deletedAt), sql`${dateFilter}`));
    }

    const [[{ c: leadCount }], [{ c: studentCount }], [{ c: appCount }]] = await Promise.all([leadQ, studentQ, appQ]);
    return { name: m.name, leads: Number(leadCount), students: Number(studentCount), applications: Number(appCount) };
  }));

  res.json(result);
});

const kommoQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  staffId: z.coerce.number().int().positive().optional(),
});

router.get("/stats/kommo-summary", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), validate({ query: kommoQuerySchema }), async (req, res): Promise<void> => {
  const user = req.user!;
  const { from: fromStr, to: toStr, staffId: rawStaffId } = getValidated<{ query: typeof kommoQuerySchema }>(req).query;

  const to = toStr ? new Date(toStr) : new Date();
  const from = fromStr ? new Date(fromStr) : new Date(new Date().setHours(0, 0, 0, 0));
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    res.status(400).json({ error: "Invalid from/to date" });
    return;
  }

  const isAdmin = isAdminRole(user.role);
  const isAgent = isAgentRole(user.role);

  let staffFilter: number | null = null;
  let agentIds: number[] = [];

  if (isAdmin) {
    staffFilter = rawStaffId ?? null;
  } else if (isAgent) {
    agentIds = await getAgentVisibleIds(user.id, user.role);
    if (agentIds.length === 0) {
      res.json({ avgReplyTime: 0, medianReplyTime: 0, activeLeads: 0, wonLeads: 0, lostLeads: 0, incomingMessages: 0, outgoingMessages: 0, channels: [] });
      return;
    }
  } else {
    staffFilter = rawStaffId && isAdmin ? rawStaffId : user.id;
  }

  const dateFrom = from.toISOString();
  const dateTo = to.toISOString();

  const wonLeadStatus = "won";
  const lostLeadStatus = "lost";

  let leadWhere = isNull(leadsTable.deletedAt);
  let leadWhereWon = and(isNull(leadsTable.deletedAt), eq(leadsTable.status, wonLeadStatus));
  let leadWhereLost = and(isNull(leadsTable.deletedAt), eq(leadsTable.status, lostLeadStatus));
  let leadWhereActive = and(isNull(leadsTable.deletedAt), ne(leadsTable.status, wonLeadStatus), ne(leadsTable.status, lostLeadStatus));

  if (isAgent) {
    const agentFilter = inArray(leadsTable.agentId, agentIds);
    leadWhere = and(isNull(leadsTable.deletedAt), agentFilter)!;
    leadWhereWon = and(isNull(leadsTable.deletedAt), agentFilter, eq(leadsTable.status, wonLeadStatus))!;
    leadWhereLost = and(isNull(leadsTable.deletedAt), agentFilter, eq(leadsTable.status, lostLeadStatus))!;
    leadWhereActive = and(isNull(leadsTable.deletedAt), agentFilter, ne(leadsTable.status, wonLeadStatus), ne(leadsTable.status, lostLeadStatus))!;
  } else if (staffFilter !== null) {
    leadWhere = and(isNull(leadsTable.deletedAt), eq(leadsTable.assignedToId, staffFilter))!;
    leadWhereWon = and(isNull(leadsTable.deletedAt), eq(leadsTable.assignedToId, staffFilter), eq(leadsTable.status, wonLeadStatus))!;
    leadWhereLost = and(isNull(leadsTable.deletedAt), eq(leadsTable.assignedToId, staffFilter), eq(leadsTable.status, lostLeadStatus))!;
    leadWhereActive = and(isNull(leadsTable.deletedAt), eq(leadsTable.assignedToId, staffFilter), ne(leadsTable.status, wonLeadStatus), ne(leadsTable.status, lostLeadStatus))!;
  }

  const [[{ active }], [{ won }], [{ lost }]] = await Promise.all([
    db.select({ active: sql<number>`count(*)` }).from(leadsTable).where(leadWhereActive),
    db.select({ won: sql<number>`count(*)` }).from(leadsTable).where(leadWhereWon),
    db.select({ lost: sql<number>`count(*)` }).from(leadsTable).where(leadWhereLost),
  ]);

  let msgConvWhere: any = sql`created_at >= ${dateFrom} AND created_at <= ${dateTo}`;
  if (staffFilter !== null) {
    msgConvWhere = and(sql`created_at >= ${dateFrom} AND created_at <= ${dateTo}`, eq(messagesTable.senderId, staffFilter));
  }

  const convDateFilter = sql`last_message_at >= ${dateFrom} AND last_message_at <= ${dateTo}`;
  let convWhere: any = convDateFilter;
  if (staffFilter !== null) {
    convWhere = and(convDateFilter, eq(conversationsTable.assignedToId, staffFilter));
  } else if (isAgent && agentIds.length > 0) {
    convWhere = and(convDateFilter, inArray(conversationsTable.createdById, agentIds));
  }

  const [msgCounts] = await db.select({
    incoming: sql<number>`coalesce(sum(case when direction='inbound' then 1 else 0 end),0)`,
    outgoing: sql<number>`coalesce(sum(case when direction='outbound' then 1 else 0 end),0)`,
  }).from(messagesTable).where(sql`created_at >= ${dateFrom} AND created_at <= ${dateTo}`);

  // Per-channel breakdown over the SAME filter as the totals above so the
  // section 4b cards always sum to the top MESSAGES card.
  const channelRows = await db.select({
    channel: messagesTable.channel,
    incoming: sql<number>`coalesce(sum(case when direction='inbound' then 1 else 0 end),0)`,
    outgoing: sql<number>`coalesce(sum(case when direction='outbound' then 1 else 0 end),0)`,
  }).from(messagesTable)
    .where(sql`created_at >= ${dateFrom} AND created_at <= ${dateTo}`)
    .groupBy(messagesTable.channel);

  // "Connected" = an active channel_accounts row exists for that channel.
  const connectedRows = await db.select({ channel: channelAccountsTable.channel })
    .from(channelAccountsTable)
    .where(eq(channelAccountsTable.isActive, true))
    .groupBy(channelAccountsTable.channel);
  const connectedSet = new Set(connectedRows.map((r) => String(r.channel)));

  const channels = channelRows.map((r) => ({
    channel: String(r.channel ?? "other"),
    incoming: Number(r.incoming ?? 0),
    outgoing: Number(r.outgoing ?? 0),
    connected: connectedSet.has(String(r.channel)),
  }));
  // Include connected-but-silent channels so the UI can show them as 0/0 connected.
  for (const ch of connectedSet) {
    if (!channels.some((c) => c.channel === ch)) {
      channels.push({ channel: ch, incoming: 0, outgoing: 0, connected: true });
    }
  }

  const replyRows = await db.execute<{ reply_seconds: string | null }>(sql`
    WITH reply_pairs AS (
      SELECT
        m_in.id AS inbound_id,
        EXTRACT(EPOCH FROM (MIN(m_out.created_at) - m_in.created_at)) AS reply_seconds
      FROM messages m_in
      JOIN messages m_out
        ON m_out.conversation_id = m_in.conversation_id
        AND m_out.created_at > m_in.created_at
        AND m_out.direction = 'outbound'
      WHERE m_in.direction = 'inbound'
        AND m_in.created_at >= ${from}
        AND m_in.created_at <= ${to}
      GROUP BY m_in.id, m_in.created_at
    )
    SELECT
      AVG(reply_seconds) AS avg_reply_seconds,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY reply_seconds) AS median_reply_seconds
    FROM reply_pairs
  `);

  const replyRow = ((replyRows as any).rows ?? (replyRows as any))?.[0] ?? {};
  const avgReplyTime = replyRow.avg_reply_seconds != null ? Math.round(Number(replyRow.avg_reply_seconds)) : 0;
  const medianReplyTime = replyRow.median_reply_seconds != null ? Math.round(Number(replyRow.median_reply_seconds)) : 0;

  res.json({
    avgReplyTime,
    medianReplyTime,
    activeLeads: Number(active),
    wonLeads: Number(won),
    lostLeads: Number(lost),
    incomingMessages: Number(msgCounts?.incoming ?? 0),
    outgoingMessages: Number(msgCounts?.outgoing ?? 0),
    channels,
  });
});

export default router;
