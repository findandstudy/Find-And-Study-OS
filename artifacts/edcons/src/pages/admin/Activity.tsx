import { useState, useEffect, useMemo } from "react";
import { customFetch } from "@workspace/api-client-react";
import { TablePagination, useTablePagination } from "@/components/TablePagination";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users, Clock, Activity, Monitor, ArrowLeft, Search,
  ArrowUpDown, ArrowUp, ArrowDown, Eye, Wifi,
  Timer, BarChart3, TrendingUp, Pause, Download, Loader2,
} from "lucide-react";
import { useLocation } from "wouter";
import { useI18n } from "@/hooks/use-i18n";
import { formatDuration } from "@/lib/formatDuration";
import { useToast } from "@/hooks/use-toast";

function fmtTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-500",
    idle: "bg-amber-400",
    offline: "bg-gray-300",
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status] || colors.offline}`} />;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-500/10 text-green-600 border-green-200",
    idle: "bg-amber-500/10 text-amber-600 border-amber-200",
    offline: "bg-gray-500/10 text-gray-500 border-gray-200",
  };
  return <Badge className={`text-xs capitalize ${styles[status] || styles.offline}`}>{status}</Badge>;
}

type DatePreset = "today" | "yesterday" | "7days" | "30days" | "custom";

function getDateRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "today":
      return { from: todayStart.toISOString(), to: now.toISOString() };
    case "yesterday": {
      const ys = new Date(todayStart); ys.setDate(ys.getDate() - 1);
      return { from: ys.toISOString(), to: todayStart.toISOString() };
    }
    case "7days": {
      const d7 = new Date(todayStart); d7.setDate(d7.getDate() - 7);
      return { from: d7.toISOString(), to: now.toISOString() };
    }
    case "30days": {
      const d30 = new Date(todayStart); d30.setDate(d30.getDate() - 30);
      return { from: d30.toISOString(), to: now.toISOString() };
    }
    default:
      return { from: todayStart.toISOString(), to: now.toISOString() };
  }
}

function OverviewPage() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const [preset, setPreset] = useState<DatePreset>("today");
  const [analytics, setAnalytics] = useState<any>(null);
  const [presence, setPresence] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "activeDuration", dir: "desc" });
  const pg = useTablePagination(25);

  useEffect(() => {
    const range = getDateRange(preset);
    setLoading(true);
    Promise.all([
      customFetch(`/api/activity/analytics?from=${range.from}&to=${range.to}`),
      customFetch(`/api/activity/presence`),
      customFetch(`/api/activity/modules?from=${range.from}&to=${range.to}`),
    ]).then(([a, p, m]) => {
      setAnalytics(a);
      setPresence((p as any).data || []);
      setModules((m as any).data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [preset]);

  const totals = analytics?.totals || {};
  const userData = (analytics?.data || []) as any[];

  const filteredUsers = useMemo(() => {
    let list = userData.filter((u: any) =>
      !search || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(search.toLowerCase())
    );
    list.sort((a: any, b: any) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      switch (sort.key) {
        case "user": return dir * (`${a.firstName} ${a.lastName}`).localeCompare(`${b.firstName} ${b.lastName}`);
        case "role": return dir * (a.role || "").localeCompare(b.role || "");
        case "status": return dir * (a.status || "offline").localeCompare(b.status || "offline");
        case "sessions": return dir * ((a.sessionCount || 0) - (b.sessionCount || 0));
        case "totalDuration": return dir * ((a.totalDuration || 0) - (b.totalDuration || 0));
        case "activeDuration": return dir * ((a.activeDuration || 0) - (b.activeDuration || 0));
        case "idleDuration": return dir * ((a.idleDuration || 0) - (b.idleDuration || 0));
        case "firstLogin": return dir * (new Date(a.firstLogin || 0).getTime() - new Date(b.firstLogin || 0).getTime());
        case "lastSeen": return dir * (new Date(a.lastSeen || 0).getTime() - new Date(b.lastSeen || 0).getTime());
        default: return 0;
      }
    });
    return list;
  }, [userData, search, sort]);
  const { paged: pagedActivityUsers, total: totalActivityUsers } = pg.paginate(filteredUsers);

  function handleSort(key: string) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  }

  function SortTh({ label, sortKey, className }: { label: string; sortKey: string; className?: string }) {
    const active = sort.key === sortKey;
    return (
      <th
        className={`px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:bg-muted/50 transition-colors ${className || ""}`}
        onClick={() => handleSort(sortKey)}
      >
        <div className="flex items-center gap-1">
          {label}
          {active
            ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
            : <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />}
        </div>
      </th>
    );
  }

  const statCards = [
    {
      label: t("adminActivity.onlineUsers"),
      value: totals.onlineUsers || 0,
      sub: `${totals.activeUsers || 0} ${t("adminActivity.active")}, ${totals.idleUsers || 0} idle`,
      icon: Users, color: "text-green-500 bg-green-50 dark:bg-green-500/10",
    },
    {
      label: t("adminActivity.totalSessions"),
      value: totals.totalSessions || 0,
      sub: `${totals.uniqueUsers || 0} ${t("adminActivity.unique")}`,
      icon: Monitor, color: "text-blue-500 bg-blue-50 dark:bg-blue-500/10",
    },
    {
      label: t("adminActivity.totalActiveTime"),
      value: formatDuration(totals.activeDuration || 0),
      sub: `of ${formatDuration(totals.totalDuration || 0)} total`,
      icon: Activity, color: "text-purple-500 bg-purple-50 dark:bg-purple-500/10",
    },
    {
      label: t("adminActivity.avgActivePerUser"),
      value: totals.uniqueUsers ? formatDuration(Math.round((totals.activeDuration || 0) / totals.uniqueUsers)) : "—",
      sub: `across ${totals.uniqueUsers || 0} users`,
      icon: TrendingUp, color: "text-amber-500 bg-amber-50 dark:bg-amber-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">{t("adminActivity.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("adminActivity.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {(["today", "yesterday", "7days", "30days"] as DatePreset[]).map(p => (
            <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} className="rounded-xl text-xs"
              onClick={() => setPreset(p)}>
              {t(`adminActivity.preset.${p}` as any)}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s, i) => (
          <Card key={i} className="p-4 border-none shadow-md shadow-black/5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center shrink-0`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{s.label}</p>
                <p className="text-xl font-display font-bold">{loading ? "..." : s.value}</p>
                <p className="text-[11px] text-muted-foreground truncate">{loading ? "" : s.sub}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 p-5 border-none shadow-md shadow-black/5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-green-500" /> {t("adminActivity.currentlyOnline")}
          </h3>
          {presence.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{t("adminActivity.noUsersOnline")}</p>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {presence.map((p: any) => (
                <div key={p.userId} className="flex items-center gap-3 cursor-pointer hover:bg-secondary/50 rounded-lg p-2 -mx-2 transition-colors"
                  onClick={() => setLocation(`/admin/activity/${p.userId}`)}>
                  <div className="relative">
                    {p.avatarUrl ? (
                      <img src={p.avatarUrl} alt={`${p.firstName || ""} ${p.lastName || ""}`.trim() || "avatar"} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/30 to-accent/30 flex items-center justify-center text-xs font-bold">
                        {(p.firstName?.[0] || "")}{(p.lastName?.[0] || "")}
                      </div>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${p.status === "active" ? "bg-green-500" : "bg-amber-400"}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{p.firstName} {p.lastName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{p.currentRoute || "—"}</p>
                  </div>
                  <Badge className={`text-[10px] ${p.status === "active" ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"}`}>
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2 p-5 border-none shadow-md shadow-black/5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-500" /> {t("adminActivity.moduleUsage")}
          </h3>
          {modules.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{t("adminActivity.noModuleData")}</p>
          ) : (
            <div className="space-y-2.5 max-h-[300px] overflow-y-auto">
              {modules.map((m: any) => {
                const maxVisits = Math.max(...modules.map((x: any) => x.visitCount || 1));
                const pct = Math.round(((m.visitCount || 0) / maxVisits) * 100);
                return (
                  <div key={m.moduleName}>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="font-medium text-foreground">{m.moduleName}</span>
                      <span className="text-muted-foreground">
                        {m.visitCount} {t("adminActivity.visits")} · {m.uniqueUsers} {t("adminActivity.unique")} · {formatDuration(m.totalDuration || m.activeDuration || 0)}
                      </span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
        <div className="p-4 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{t("adminActivity.userActivitySummary")}</h3>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("adminActivity.searchUsers")} className="pl-9 h-9 rounded-xl text-sm" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-secondary/50 text-left">
                <SortTh label={t("adminActivity.colUser")} sortKey="user" />
                <SortTh label={t("adminActivity.colRole")} sortKey="role" />
                <SortTh label={t("adminActivity.colStatus")} sortKey="status" />
                <SortTh label={t("adminActivity.colSessions")} sortKey="sessions" />
                <SortTh label={t("adminActivity.colTotalTime")} sortKey="totalDuration" />
                <SortTh label={t("adminActivity.colActiveTime")} sortKey="activeDuration" />
                <SortTh label={t("adminActivity.colIdleTime")} sortKey="idleDuration" />
                <SortTh label={t("adminActivity.colFirstLogin")} sortKey="firstLogin" />
                <SortTh label={t("adminActivity.colLastSeen")} sortKey="lastSeen" />
                <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(10)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 w-16 bg-secondary animate-pulse rounded" /></td>)}</tr>
                ))
              ) : pagedActivityUsers.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">{t("adminActivity.noData")}</td></tr>
              ) : pagedActivityUsers.map((u: any) => (
                <tr key={u.userId} className="hover:bg-secondary/30 transition-colors cursor-pointer" onClick={() => setLocation(`/admin/activity/${u.userId}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <StatusDot status={u.status} />
                      <div>
                        <p className="text-sm font-semibold text-foreground">{u.firstName} {u.lastName}</p>
                        <p className="text-[11px] text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" className="text-xs capitalize">{u.role}</Badge></td>
                  <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-3 text-sm font-mono">{u.sessionCount}</td>
                  <td className="px-4 py-3 text-sm font-mono">{formatDuration(u.totalDuration)}</td>
                  <td className="px-4 py-3 text-sm font-mono font-semibold text-green-600">{formatDuration(u.activeDuration)}</td>
                  <td className="px-4 py-3 text-sm font-mono text-muted-foreground">{formatDuration(u.idleDuration)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtTime(u.firstLogin)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(u.lastSeen)}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg gap-1">
                      <Eye className="w-3.5 h-3.5" /> {t("adminActivity.details")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          currentPage={pg.page}
          totalItems={totalActivityUsers}
          pageSize={pg.pageSize}
          onPageChange={pg.setPage}
          onPageSizeChange={pg.setPageSize}
        />
      </Card>
    </div>
  );
}

function UserDetailPage({ userId }: { userId: number }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [preset, setPreset] = useState<DatePreset>("7days");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    const range = getDateRange(preset);
    setLoading(true);
    customFetch(`/api/activity/user/${userId}?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, preset]);

  const user = data?.user;
  const presence = data?.presence;
  const sessions = data?.sessions || [];
  const moduleBreakdown = data?.moduleBreakdown || [];
  const dailyBreakdown = data?.dailyBreakdown || [];
  const events = data?.events || [];

  const totalActive = sessions.reduce((s: number, x: any) => s + (x.activeDurationSeconds || 0), 0);
  const totalIdle = sessions.reduce((s: number, x: any) => s + (x.idleDurationSeconds || 0), 0);
  const totalDuration = sessions.reduce((s: number, x: any) => s + (x.totalDurationSeconds || 0), 0);

  async function handleDownloadPdf() {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const range = getDateRange(preset);
      const url = `/api/activity/report/pdf?userId=${userId}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("PDF generation failed");
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `activity-${userId}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast({ title: t("common.error"), description: t("adminActivity.pdfError"), variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="rounded-xl gap-1.5" onClick={() => setLocation("/admin/activity")}>
          <ArrowLeft className="w-4 h-4" /> {t("adminActivity.back")}
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-display font-bold text-foreground">
            {loading ? "..." : `${user?.firstName || ""} ${user?.lastName || ""}`}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            {user && <Badge variant="outline" className="text-xs capitalize">{user.role}</Badge>}
            {presence && <StatusBadge status={presence.status || "offline"} />}
            {presence?.currentRoute && <span className="text-xs text-muted-foreground">on {presence.currentRoute}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["today", "yesterday", "7days", "30days"] as DatePreset[]).map(p => (
            <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} className="rounded-xl text-xs"
              onClick={() => setPreset(p)}>
              {t(`adminActivity.preset.${p}` as any)}
            </Button>
          ))}
          <Button
            size="sm" variant="outline" className="rounded-xl text-xs gap-1.5"
            onClick={handleDownloadPdf} disabled={pdfLoading || loading}
          >
            {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {pdfLoading ? t("adminActivity.downloadingPdf") : t("adminActivity.downloadPdf")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t("adminActivity.colSessions"), value: sessions.length, icon: Monitor, color: "text-blue-500 bg-blue-50 dark:bg-blue-500/10" },
          { label: t("adminActivity.colTotalTime"), value: formatDuration(totalDuration), icon: Clock, color: "text-purple-500 bg-purple-50 dark:bg-purple-500/10" },
          { label: t("adminActivity.colActiveTime"), value: formatDuration(totalActive), icon: Activity, color: "text-green-500 bg-green-50 dark:bg-green-500/10" },
          { label: t("adminActivity.colIdleTime"), value: formatDuration(totalIdle), icon: Pause, color: "text-amber-500 bg-amber-50 dark:bg-amber-500/10" },
        ].map((s, i) => (
          <Card key={i} className="p-4 border-none shadow-md shadow-black/5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center shrink-0`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-display font-bold">{loading ? "..." : s.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5 border-none shadow-md shadow-black/5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-500" /> {t("adminActivity.moduleBreakdown")}
          </h3>
          {moduleBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{t("adminActivity.noPageVisits")}</p>
          ) : (
            <div className="space-y-3">
              {moduleBreakdown.map((m: any) => {
                const maxVisits = Math.max(...moduleBreakdown.map((x: any) => x.visitCount || 1));
                const pct = Math.round(((m.visitCount || 0) / maxVisits) * 100);
                return (
                  <div key={m.moduleName}>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="font-medium text-foreground">{m.moduleName}</span>
                      <span className="text-muted-foreground">
                        {m.visitCount} {t("adminActivity.visits")} · {formatDuration(m.totalDuration || m.activeDuration || 0)} {t("adminActivity.active")}
                      </span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-green-500/80 to-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5 border-none shadow-md shadow-black/5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" /> {t("adminActivity.dailyActivity")}
          </h3>
          {dailyBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{t("adminActivity.noDailyData")}</p>
          ) : (
            <div className="space-y-2">
              {dailyBreakdown.map((d: any) => {
                const maxDur = Math.max(...dailyBreakdown.map((x: any) => x.activeDuration || 1));
                const pct = Math.round(((d.activeDuration || 0) / maxDur) * 100);
                return (
                  <div key={d.day} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 shrink-0">{fmtDate(d.day)}</span>
                    <div className="flex-1 h-5 bg-secondary rounded-full overflow-hidden relative">
                      <div className="h-full bg-gradient-to-r from-blue-500/80 to-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-foreground w-16 text-right">{formatDuration(d.activeDuration || 0)}</span>
                    <span className="text-[10px] text-muted-foreground w-14 text-right">{d.sessionCount} {t("adminActivity.sess")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
        <div className="p-4 border-b border-border/50">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Timer className="w-4 h-4 text-blue-500" /> {t("adminActivity.sessionHistory")}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-secondary/50 text-left">
                <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colStarted")}</th>
                <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colEnded")}</th>
                <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colDuration")}</th>
                <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colActiveTime")}</th>
                <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colIdle")}</th>
                <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colEndReason")}</th>
                <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 w-16 bg-secondary animate-pulse rounded" /></td>)}</tr>
                ))
              ) : sessions.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t("adminActivity.noSessions")}</td></tr>
              ) : sessions.map((s: any) => (
                <tr key={s.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 text-sm">{fmtDateTime(s.startedAt)}</td>
                  <td className="px-4 py-3 text-sm">{s.endedAt ? fmtDateTime(s.endedAt) : "—"}</td>
                  <td className="px-4 py-3 text-sm font-mono">{formatDuration(s.totalDurationSeconds)}</td>
                  <td className="px-4 py-3 text-sm font-mono font-semibold text-green-600">{formatDuration(s.activeDurationSeconds)}</td>
                  <td className="px-4 py-3 text-sm font-mono text-muted-foreground">{formatDuration(s.idleDurationSeconds)}</td>
                  <td className="px-4 py-3">
                    {s.endReason ? (
                      <Badge variant="outline" className="text-[10px]">{s.endReason.replace(/_/g, " ")}</Badge>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {s.isActive ? (
                      <Badge className="text-[10px] bg-green-500/10 text-green-600">{t("adminActivity.active")}</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">Ended</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {events.length > 0 && (
        <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
          <div className="p-4 border-b border-border/50">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-500" /> {t("adminActivity.recentEvents")}
            </h3>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-background">
                <tr className="bg-secondary/50 text-left">
                  <th className="px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colTime")}</th>
                  <th className="px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colEvent")}</th>
                  <th className="px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("adminActivity.colRoute")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {events.slice(0, 50).map((e: any) => (
                  <tr key={e.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{e.eventType.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground font-mono">{e.route || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function AdminActivity({ userId }: { userId?: number }) {
  return (
    <>
      {userId ? <UserDetailPage userId={userId} /> : <OverviewPage />}
    </>
  );
}
