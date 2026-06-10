export const ROUTE_MODULE_MAP: Record<string, string> = {
  "/admin": "Dashboard", "/staff": "Dashboard", "/student": "Dashboard", "/agent": "Dashboard",
  "/staff/leads": "Leads", "/staff/students": "Students", "/staff/applications": "Applications",
  "/staff/documents": "Documents", "/staff/course-finder": "Course Finder", "/staff/agents": "Agents",
  "/staff/finance": "Finance", "/staff/messages": "Messages", "/staff/settings": "Settings",
  "/staff/tasks": "Tasks",
  "/admin/users": "Users", "/admin/catalog": "Catalog", "/admin/audit": "Audit Log",
  "/admin/settings": "Settings", "/admin/activity": "Activity",
  "/admin/staff-cards": "Staff Cards", "/admin/campaigns": "Campaigns",
  "/admin/commissions": "Commissions", "/admin/finance": "Finance",
  "/admin/reports": "Reports",
  "/student/applications": "Applications", "/student/account": "Account",
  "/student/documents": "Documents", "/student/messages": "Messages",
  "/agent/referrals": "Referrals", "/agent/commissions": "Commissions", "/agent/account": "Account",
  "/agent/leads": "Leads", "/agent/students": "Students", "/agent/finance": "Finance",
  "/agent/messages": "Messages", "/agent/documents": "Documents",
};

export const EXCLUDE_SEGMENT_RE = /^(en|tr|ar|fr|ru|fa|zh|hi|es|id|login|register|verify|reset|confirm|auth|callback|public|embed|apply|sign|contract|token|oauth|sso|invite|accept|decline|redirect|error|404|500)$/i;
export const DIRTY_LABEL_RE = /^(login|register|verify|reset|confirm|auth|callback|public|embed|apply|sign|contract|unknown|en|tr|ar|fr|ru|fa|zh|hi|es|id|404|500|error|redirect|null|undefined)$/i;
const UUID_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUM_TAIL_RE = /\/\d+$/;
const LONG_TOKEN_RE = /\/[A-Za-z0-9_-]{20,}$/;

const SORTED_ROUTE_ENTRIES = Object.entries(ROUTE_MODULE_MAP).sort((a, b) => b[0].length - a[0].length);

function tryRouteMatch(r: string): string | null {
  for (const [pattern, name] of SORTED_ROUTE_ENTRIES) {
    if (r === pattern) return name;
  }
  return null;
}

export function deriveModuleName(route: string): string {
  let hit = tryRouteMatch(route);
  if (hit) return hit;

  const cleaned = route.replace(UUID_RE, "").replace(NUM_TAIL_RE, "").replace(LONG_TOKEN_RE, "");

  if (cleaned && cleaned !== route) {
    hit = tryRouteMatch(cleaned);
    if (hit) return hit;
  }

  const base = cleaned || route;
  const parts = base.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (
    !last ||
    last.length <= 2 ||
    last.length > 30 ||
    /^\d+$/.test(last) ||
    EXCLUDE_SEGMENT_RE.test(last) ||
    (/^[a-z0-9_-]{6,}$/i.test(last) && /\d/.test(last) && /[a-zA-Z]/.test(last))
  ) return "Other";
  return "Other";
}

export function normalizeStoredModuleName(name: string | null): string {
  if (!name) return "Other";
  if (name.startsWith("/")) return deriveModuleName(name);
  const trimmed = name.trim();
  if (DIRTY_LABEL_RE.test(trimmed)) return "Other";
  if (trimmed.length <= 2) return "Other";
  if (/^[a-z0-9_-]{6,}$/i.test(trimmed) && /\d/.test(trimmed) && /[a-zA-Z]/.test(trimmed)) return "Other";
  return trimmed;
}

export function normalizeModuleBreakdown<T extends { moduleName: string | null; visitCount?: number | null; totalDuration?: number | null; activeDuration?: number | null; idleDuration?: number | null }>(rows: T[]): T[] {
  const acc = new Map<string, { row: T; visitCount: number; totalDuration: number; activeDuration: number; idleDuration: number }>();
  for (const r of rows) {
    const name = normalizeStoredModuleName(r.moduleName);
    const vn = Number(r.visitCount) || 0;
    const td = Number(r.totalDuration) || 0;
    const ad = Number(r.activeDuration) || 0;
    const id_ = Number(r.idleDuration) || 0;
    const existing = acc.get(name);
    if (existing) {
      existing.visitCount += vn;
      existing.totalDuration += td;
      existing.activeDuration += ad;
      existing.idleDuration += id_;
    } else {
      acc.set(name, { row: r, visitCount: vn, totalDuration: td, activeDuration: ad, idleDuration: id_ });
    }
  }
  return Array.from(acc.entries()).map(([name, v]) => ({
    ...v.row,
    moduleName: name,
    visitCount: v.visitCount,
    totalDuration: v.totalDuration,
    activeDuration: v.activeDuration,
    idleDuration: v.idleDuration,
  } as T)).sort((a, b) => (Number(b.visitCount) || 0) - (Number(a.visitCount) || 0));
}

export function clampSessionMetrics<T extends { activeDurationSeconds?: number | null; idleDurationSeconds?: number | null; totalDurationSeconds?: number | null }>(s: T): T {
  const active = s.activeDurationSeconds || 0;
  const idle = s.idleDurationSeconds || 0;
  const rawTotal = s.totalDurationSeconds || 0;
  const clampedTotal = Math.max(rawTotal, active + idle);
  const clampedIdle = Math.max(0, Math.min(idle, clampedTotal - active));
  return { ...s, totalDurationSeconds: clampedTotal, idleDurationSeconds: clampedIdle };
}
