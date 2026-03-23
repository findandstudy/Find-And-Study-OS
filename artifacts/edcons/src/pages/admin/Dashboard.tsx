import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useGetOverviewStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, FileText, GraduationCap, DollarSign, TrendingUp, AlertTriangle, Activity, Shield, CalendarClock, ExternalLink, Bell, UserPlus, FileCheck, CreditCard, MessageCircle, Megaphone, AlertCircle } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell } from "recharts";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
function isOverdue(d: string) { return new Date(d) < new Date(); }

const chartData = [
  { name: 'Jan', leads: 65, apps: 28, revenue: 45000 },
  { name: 'Feb', leads: 78, apps: 35, revenue: 52000 },
  { name: 'Mar', leads: 90, apps: 42, revenue: 61000 },
  { name: 'Apr', leads: 81, apps: 38, revenue: 58000 },
  { name: 'May', leads: 112, apps: 55, revenue: 73000 },
  { name: 'Jun', leads: 95, apps: 48, revenue: 67000 },
  { name: 'Jul', leads: 128, apps: 62, revenue: 84000 },
];

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#22c55e', '#f59e0b'];

const AVATAR_COLORS = [
  "bg-blue-500/15 text-blue-600",
  "bg-purple-500/15 text-purple-600",
  "bg-emerald-500/15 text-emerald-600",
  "bg-amber-500/15 text-amber-600",
  "bg-rose-500/15 text-rose-600",
  "bg-cyan-500/15 text-cyan-600",
];

function getInitials(firstName?: string, lastName?: string) {
  return `${(firstName || "?")[0]}${(lastName || "?")[0]}`.toUpperCase();
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const NOTIFICATION_ICONS: Record<string, typeof Bell> = {
  "lead.created": UserPlus,
  "lead.assigned": Users,
  "lead.stage_changed": Activity,
  "lead.follow_up_due": CalendarClock,
  "application.created": FileText,
  "application.stage_changed": FileCheck,
  "application.offer_received": GraduationCap,
  "application.visa_update": FileCheck,
  "student.created": GraduationCap,
  "student.document_uploaded": FileText,
  "student.status_changed": Activity,
  "finance.commission_confirmed": CreditCard,
  "finance.payment_received": DollarSign,
  "finance.payment_due": AlertCircle,
  "finance.agent_payout": CreditCard,
  "agent.new_registration": UserPlus,
  "agent.sub_agent_added": Users,
  "system.user_activated": Shield,
  "system.broadcast": Megaphone,
  "system.announcement": Megaphone,
  "message.new": MessageCircle,
  "message.mention": MessageCircle,
};

export default function AdminDashboard() {
  const { data: stats, isLoading } = useGetOverviewStats();
  const { data: upcomingFollowUps = [] } = useQuery<any[]>({
    queryKey: ["/api/follow-ups/upcoming"],
    queryFn: () => fetch(`${BASE}/api/follow-ups/upcoming`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: latestStudentsData } = useQuery<any>({
    queryKey: ["/api/students", "dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/students?limit=5&page=1`, { credentials: "include" }).then(r => r.json()),
  });
  const latestStudents: any[] = latestStudentsData?.data || [];

  const { data: latestAuditData } = useQuery<any>({
    queryKey: ["/api/audit", "dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/audit?limit=5&page=1`, { credentials: "include" }).then(r => r.json()),
  });
  const latestUpdates: any[] = latestAuditData?.data || [];

  const { data: notificationsData } = useQuery<any>({
    queryKey: ["/api/notifications", "dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/notifications?limit=5`, { credentials: "include" }).then(r => r.json()),
  });
  const latestNotifications: any[] = notificationsData?.data || [];

  const statCards = [
    { label: "Total Leads", value: stats?.totalLeads || 0, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10", trend: "+12%" },
    { label: "Active Applications", value: stats?.activeApplications || 0, icon: FileText, color: "text-purple-500", bg: "bg-purple-500/10", trend: "+8%" },
    { label: "Students Enrolled", value: stats?.totalStudents || 0, icon: GraduationCap, color: "text-green-500", bg: "bg-green-500/10", trend: "+22%" },
    { label: "Revenue (Month)", value: `$${(stats?.totalRevenue || 0).toLocaleString()}`, icon: DollarSign, color: "text-amber-500", bg: "bg-amber-500/10", trend: "+15%" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-muted-foreground mt-1">Full operational overview — Find And Study OS</p>
          </div>
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-2 text-sm font-semibold">
            <Shield className="w-4 h-4 mr-2" /> Admin Access
          </Badge>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((s, i) => (
            <Card key={i} className="p-6 border-none shadow-lg shadow-black/5 hover:-translate-y-1 transition-transform duration-300 group">
              <div className="flex items-start justify-between mb-4">
                <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                  <s.icon className={`w-6 h-6 ${s.color}`} />
                </div>
                <Badge variant="secondary" className="text-emerald-600 bg-emerald-50">
                  <TrendingUp className="w-3 h-3 mr-1" />{s.trend}
                </Badge>
              </div>
              <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
              <p className="text-3xl font-display font-bold text-foreground mt-1">
                {isLoading ? "..." : s.value}
              </p>
            </Card>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display font-bold text-lg">Lead & Application Trends</h3>
              <Badge variant="outline">Last 7 months</Badge>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="admLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="admApps" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '12px', border: '1px solid hsl(var(--border))' }} />
                  <Area type="monotone" dataKey="leads" name="Leads" stroke="hsl(var(--primary))" strokeWidth={2.5} fillOpacity={1} fill="url(#admLeads)" />
                  <Area type="monotone" dataKey="apps" name="Applications" stroke="hsl(var(--accent))" strokeWidth={2.5} fillOpacity={1} fill="url(#admApps)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-center gap-2 mb-6">
              <CalendarClock className="w-5 h-5 text-primary" />
              <h3 className="font-display font-bold text-lg">Upcoming Follow-ups</h3>
            </div>
            <div className="space-y-3">
              {(upcomingFollowUps as any[]).length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming follow-ups.</p>
              ) : (
                (upcomingFollowUps as any[]).slice(0, 5).map((fu: any) => (
                  <Link key={fu.id} href={fu.leadId ? `/staff/leads/${fu.leadId}` : "#"}>
                    <div className={`p-3 rounded-xl border cursor-pointer hover:scale-[1.02] transition-transform ${
                      isOverdue(fu.scheduledAt) ? "bg-red-50 border-red-200" : "bg-secondary/30 border-border"
                    }`}>
                      <div className="flex items-start justify-between">
                        <p className="text-sm font-medium text-foreground line-clamp-1">{fu.title}</p>
                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                      </div>
                      {fu.leadName && <p className="text-xs text-primary mt-0.5">{fu.leadName}</p>}
                      <p className={`text-xs mt-1 ${isOverdue(fu.scheduledAt) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                        {new Date(fu.scheduledAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        {" "}
                        {new Date(fu.scheduledAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                        {isOverdue(fu.scheduledAt) && " — Overdue"}
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>

        {/* Latest Students, Latest Updates, Notifications */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <GraduationCap className="w-4 h-4 text-green-500" />
              </div>
              <h3 className="font-display font-bold text-base">Latest Students</h3>
            </div>
            <div className="space-y-3 max-h-[320px] overflow-y-auto">
              {latestStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No students yet.</p>
              ) : (
                latestStudents.map((s: any, i: number) => (
                  <Link key={s.id} href={`/staff/students/${s.id}`}>
                    <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-secondary/50 transition-colors cursor-pointer group">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                        <img
                          src={`${BASE}/api/students/${s.id}/photo`}
                          alt={`${s.firstName} ${s.lastName}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const el = e.target as HTMLImageElement;
                            el.style.display = "none";
                            el.parentElement!.textContent = getInitials(s.firstName, s.lastName);
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate uppercase">
                          {s.firstName} {s.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(s.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}{", "}
                          {new Date(s.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] w-6 h-6 rounded-full p-0 flex items-center justify-center shrink-0 bg-primary/10 text-primary font-bold">
                        {i + 1}
                      </Badge>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Card>

          <Card className="p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-purple-500" />
              </div>
              <h3 className="font-display font-bold text-base">Latest Updates</h3>
            </div>
            <div className="space-y-3 max-h-[320px] overflow-y-auto">
              {latestUpdates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent updates.</p>
              ) : (
                latestUpdates.map((u: any, i: number) => (
                  <div key={u.id} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-secondary/50 transition-colors">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${AVATAR_COLORS[(i + 2) % AVATAR_COLORS.length]}`}>
                      {u.userName ? u.userName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() : "SY"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {u.userName || "System"}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {u.action}{u.resource ? ` — ${u.resource}` : ""}
                        {u.resourceId ? ` #${u.resourceId}` : ""}
                      </p>
                    </div>
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 mt-1">
                      {new Date(u.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                      <br />
                      {new Date(u.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Bell className="w-4 h-4 text-amber-500" />
              </div>
              <h3 className="font-display font-bold text-base">Notifications</h3>
            </div>
            <div className="space-y-3 max-h-[320px] overflow-y-auto">
              {latestNotifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notifications.</p>
              ) : (
                latestNotifications.map((n: any) => {
                  const NIcon = NOTIFICATION_ICONS[n.type] || Bell;
                  return (
                    <div key={n.id} className={`p-3 rounded-xl border transition-colors ${n.isRead ? "bg-secondary/20 border-border/50" : "bg-primary/5 border-primary/20"}`}>
                      <div className="flex items-start gap-2.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${n.isRead ? "bg-muted/50" : "bg-primary/10"}`}>
                          <NIcon className={`w-3.5 h-3.5 ${n.isRead ? "text-muted-foreground" : "text-primary"}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium line-clamp-1 ${n.isRead ? "text-muted-foreground" : "text-foreground"}`}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 mt-0.5">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* Revenue Chart */}
        <Card className="p-6 border-none shadow-lg shadow-black/5">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display font-bold text-lg">Monthly Revenue</h3>
            <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm bg-emerald-50 px-3 py-1.5 rounded-full">
              <Activity className="w-4 h-4" /> +24% YoY
            </div>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '12px', border: '1px solid hsl(var(--border))' }}
                  formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Quick Nav */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Users", icon: Users, href: "/admin/users", color: "text-blue-500 bg-blue-500/10" },
            { label: "Leads", icon: Users, href: "/staff/leads", color: "text-purple-500 bg-purple-500/10" },
            { label: "Applications", icon: FileText, href: "/staff/applications", color: "text-green-500 bg-green-500/10" },
            { label: "Finance", icon: DollarSign, href: "/staff/finance", color: "text-amber-500 bg-amber-500/10" },
            { label: "Settings", icon: Shield, href: "/admin/settings", color: "text-primary bg-primary/10" },
            { label: "Audit Log", icon: Activity, href: "/admin/audit", color: "text-rose-500 bg-rose-500/10" },
          ].map((item, i) => (
            <Link key={i} href={item.href}>
              <Card className="p-5 text-center border-none shadow-md shadow-black/5 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer group">
                <div className={`w-12 h-12 rounded-xl ${item.color} flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform`}>
                  <item.icon className="w-5 h-5" />
                </div>
                <p className="text-sm font-semibold text-foreground">{item.label}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
