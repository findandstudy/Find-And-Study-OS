import { Router, type IRouter } from "express";
import { db, auditLogsTable, usersTable, studentsTable, leadsTable, applicationsTable, documentsTable, programsTable } from "@workspace/db";
import { sql, desc, ilike, or, eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

async function resolveResourceNames(logs: any[]): Promise<Map<string, Map<number, string>>> {
  const resourceGroups: Record<string, Set<number>> = {};
  for (const log of logs) {
    if (!log.resourceId) continue;
    const r = (log.resource || "").toLowerCase();
    if (!resourceGroups[r]) resourceGroups[r] = new Set();
    resourceGroups[r].add(log.resourceId);
  }

  const nameMap = new Map<string, Map<number, string>>();

  if (resourceGroups["user"] && resourceGroups["user"].size > 0) {
    const ids = [...resourceGroups["user"]];
    const rows = await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, ids));
    const m = new Map<number, string>();
    for (const r of rows) {
      const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || `User #${r.id}`;
      m.set(r.id, name);
    }
    nameMap.set("user", m);
  }

  if (resourceGroups["student"] && resourceGroups["student"].size > 0) {
    const ids = [...resourceGroups["student"]];
    const rows = await db.select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(inArray(studentsTable.id, ids));
    const m = new Map<number, string>();
    for (const r of rows) {
      const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || `Student #${r.id}`;
      m.set(r.id, name);
    }
    nameMap.set("student", m);
  }

  if (resourceGroups["lead"] && resourceGroups["lead"].size > 0) {
    const ids = [...resourceGroups["lead"]];
    const rows = await db.select({ id: leadsTable.id, firstName: leadsTable.firstName, lastName: leadsTable.lastName }).from(leadsTable).where(inArray(leadsTable.id, ids));
    const m = new Map<number, string>();
    for (const r of rows) {
      const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || `Lead #${r.id}`;
      m.set(r.id, name);
    }
    nameMap.set("lead", m);
  }

  if (resourceGroups["document"] && resourceGroups["document"].size > 0) {
    const ids = [...resourceGroups["document"]];
    const rows = await db.select({ id: documentsTable.id, name: documentsTable.name }).from(documentsTable).where(inArray(documentsTable.id, ids));
    const m = new Map<number, string>();
    for (const r of rows) {
      m.set(r.id, r.name || `Document #${r.id}`);
    }
    nameMap.set("document", m);
  }

  if (resourceGroups["program"] && resourceGroups["program"].size > 0) {
    const ids = [...resourceGroups["program"]];
    const rows = await db.select({ id: programsTable.id, name: programsTable.name }).from(programsTable).where(inArray(programsTable.id, ids));
    const m = new Map<number, string>();
    for (const r of rows) {
      m.set(r.id, r.name || `Program #${r.id}`);
    }
    nameMap.set("program", m);
  }

  if (resourceGroups["application"] && resourceGroups["application"].size > 0) {
    const ids = [...resourceGroups["application"]];
    const rows = await db
      .select({
        id: applicationsTable.id,
        programName: applicationsTable.programName,
        studentFirstName: studentsTable.firstName,
        studentLastName: studentsTable.lastName,
      })
      .from(applicationsTable)
      .leftJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
      .where(inArray(applicationsTable.id, ids));
    const m = new Map<number, string>();
    for (const r of rows) {
      const studentName = [r.studentFirstName, r.studentLastName].filter(Boolean).join(" ");
      const name = studentName ? `${studentName}${r.programName ? ` — ${r.programName}` : ""}` : r.programName || `Application #${r.id}`;
      m.set(r.id, name);
    }
    nameMap.set("application", m);
  }

  const detailIds: Set<number> = new Set();
  for (const log of logs) {
    if (!log.changes) continue;
    try {
      const changes = typeof log.changes === "string" ? JSON.parse(log.changes) : log.changes;
      for (const [key, val] of Object.entries(changes)) {
        if ((key === "assignedToId" || key === "userId" || key === "targetUserId") && typeof val === "number") {
          detailIds.add(val);
        }
      }
    } catch {}
  }
  if (detailIds.size > 0) {
    const ids = [...detailIds];
    const existing = nameMap.get("user") || new Map<number, string>();
    const missingIds = ids.filter(id => !existing.has(id));
    if (missingIds.length > 0) {
      const rows = await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, missingIds));
      for (const r of rows) {
        const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || `User #${r.id}`;
        existing.set(r.id, name);
      }
    }
    nameMap.set("user", existing);
  }

  return nameMap;
}

function humanizeChanges(changes: string | null, userNames: Map<number, string>): string | null {
  if (!changes) return null;
  try {
    const obj = typeof changes === "string" ? JSON.parse(changes) : changes;
    const parts: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      if ((key === "assignedToId" || key === "userId" || key === "targetUserId") && typeof val === "number") {
        const name = userNames.get(val);
        if (name) {
          const label = key === "assignedToId" ? "assignedTo" : key === "targetUserId" ? "targetUser" : "user";
          parts.push(`${label}: "${name}"`);
          continue;
        }
      }
      parts.push(`${key}: ${JSON.stringify(val)}`);
    }
    return parts.join(", ");
  } catch {
    return changes;
  }
}

router.get("/audit", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { search, resource, resourceId, page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  const isManager = (MANAGER_ROLES as readonly string[]).includes(user.role);
  if (resource && resourceId) {
    if (!isManager) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const ridNum = parseInt(resourceId, 10);
    if (isNaN(ridNum)) { res.status(400).json({ error: "Invalid resourceId" }); return; }
    conditions.push(eq(auditLogsTable.resource, resource));
    conditions.push(eq(auditLogsTable.resourceId, ridNum));
  } else if (!isManager) {
    conditions.push(eq(auditLogsTable.userId, user.id));
  }

  if (search) {
    conditions.push(
      or(
        ilike(auditLogsTable.action, `%${search}%`),
        ilike(auditLogsTable.resource, `%${search}%`),
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogsTable)
    .where(where);

  const data = await db
    .select({
      id: auditLogsTable.id,
      userId: auditLogsTable.userId,
      action: auditLogsTable.action,
      resource: auditLogsTable.resource,
      resourceId: auditLogsTable.resourceId,
      changes: auditLogsTable.changes,
      ipAddress: auditLogsTable.ipAddress,
      createdAt: auditLogsTable.createdAt,
      userName: sql<string>`COALESCE(NULLIF(CONCAT_WS(' ', ${usersTable.firstName}, ${usersTable.lastName}), ''), 'System')`,
    })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const nameMap = await resolveResourceNames(data);
  const userNames = nameMap.get("user") || new Map<number, string>();

  const enriched = data.map((log) => {
    const rKey = (log.resource || "").toLowerCase();
    const resMap = nameMap.get(rKey);
    const resourceDisplayName = log.resourceId && resMap ? resMap.get(log.resourceId) || null : null;
    const humanChanges = humanizeChanges(log.changes, userNames);
    return {
      ...log,
      resourceDisplayName,
      changes: humanChanges,
    };
  });

  res.json({
    data: enriched,
    meta: {
      total: Number(count),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(count) / limitNum),
    },
  });
});

export default router;
