import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { DashboardSkeleton } from "@/components/ui/page-skeleton";
import { useGetOverviewStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, FileText, GraduationCap, ArrowUpRight, Clock, CalendarClock, ExternalLink, Activity, Bell, UserPlus, FileCheck, CreditCard, DollarSign, MessageCircle, Megaphone, AlertCircle, Shield, Link as LinkIcon } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

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

const mockChartData = [
  { name: 'Jan', leads: 400, students: 240 },
  { name: 'Feb', leads: 300, students: 139 },
  { name: 'Mar', leads: 200, students: 980 },
  { name: 'Apr', leads: 278, students: 390 },
  { name: 'May', leads: 189, students: 480 },
  { name: 'Jun', leads: 239, students: 380 },
  { name: 'Jul', leads: 349, students: 430 },
];

function isOverdue(d: string) { return new Date(d) < new Date(); }

export default function StaffDashboard() {
  const { data: stats, isLoading } = useGetOverviewStats();

  const { data: upcomingFollowUps = [] } = useQuery<any[]>({
    queryKey: ["/api/follow-ups/upcoming"],
    queryFn: () => fetch(`${BASE}/api/follow-ups/upcoming`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: latestStudentsData } = useQuery<any>({
    queryKey: ["/api/students", "staff-dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/students?limit=5&page=1`, { credentials: "include" }).then(r => r.json()),
  });
  const latestStudents: any[] = latestStudentsData?.data || [];

  const { data: latestAuditData } = useQuery<any>({
    queryKey: ["/api/audit", "staff-dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/audit?limit=5&page=1`, { credentials: "include" }).then(r => r.json()),
  });
  const latestUpdates: any[] = latestAuditData?.data || [];

  const { data: notificationsData } = useQuery<any>({
    queryKey: ["/api/notifications", "staff-dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/notifications?limit=5`, { credentials: "include" }).then(r => r.json()),
  });
  const latestNotifications: any[] = notificationsData?.data || [];

  const { data: quickLinksData } = useQuery<any>({
    queryKey: ["/api/quick-links"],
    queryFn: () => fetch(`${BASE}/api/quick-links`, { credentials: "include" }).then(r => r.json()),
  });
  const quickLinks: any[] = quickLinksData?.data || [];

  if (isLoading) {
    return (
      <DashboardLayout>
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Welcome Back</h1>
          <p className="text-muted-foreground mt-1">Here's what's happening with your consultancy today.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: "Total Leads", value: stats?.totalLeads || 0, icon: Users, trend: "+12%", color: "text-blue-500", bg: "bg-blue-500/10" },
            { label: "Active Applications", value: stats?.activeApplications || 0, icon: FileText, trend: "+5%", color: "text-purple-500", bg: "bg-purple-500/10" },
            { label: "Enrolled Students", value: stats?.totalStudents || 0, icon: GraduationCap, trend: "+18%", color: "text-green-500", bg: "bg-green-500/10" },
            { label: "Pending Documents", value: stats?.pendingDocuments || 0, icon: Clock, trend: "-2%", color: "text-amber-500", bg: "bg-amber-500/10", reverse: true },
          ].map((stat, i) => (
            <Card key={i} className="p-6 border-none shadow-lg shadow-black/5 hover:-translate-y-1 transition-transform duration-300">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">{stat.label}</p>
                  <h3 className="text-3xl font-display font-bold text-foreground">{isLoading ? "..." : stat.value}</h3>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.bg}`}>
                  <stat.icon className={`w-6 h-6 ${stat.color}`} />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className={`font-semibold flex items-center ${stat.reverse ? 'text-destructive' : 'text-emerald-500'}`}>
                  <ArrowUpRight className="w-4 h-4 mr-1" />
                  {stat.trend}
                </span>
                <span className="text-muted-foreground ml-2">vs last month</span>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-2 p-6 border-none shadow-lg shadow-black/5">
            <h3 className="font-display font-bold text-lg mb-6">Growth Overview</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mockChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: 'hsl(var(--muted-foreground))', fontSize: 12}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: 'hsl(var(--muted-foreground))', fontSize: 12}} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Area type="monotone" dataKey="leads" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorLeads)" />
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
                (upcomingFollowUps as any[]).slice(0, 6).map((fu: any) => (
                  <Link key={fu.id} href={fu.leadId ? `/staff/leads/${fu.leadId}` : fu.studentId ? `/staff/students/${fu.studentId}` : "#"}>
                    <div className={`p-3 rounded-xl border cursor-pointer hover:scale-[1.02] transition-transform ${
                      isOverdue(fu.scheduledAt) ? "bg-red-50 border-red-200" : "bg-secondary/30 border-border"
                    }`}>
                      <div className="flex items-start justify-between">
                        <p className="text-sm font-medium text-foreground line-clamp-1">{fu.title}</p>
                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                      </div>
                      {fu.leadName && (
                        <p className="text-xs text-primary mt-0.5">{fu.leadName}</p>
                      )}
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

        {quickLinks.length > 0 && (
          <Card className="p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <LinkIcon className="w-4 h-4 text-violet-500" />
              </div>
              <h3 className="font-display font-bold text-base">Quick Links</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {quickLinks.map((link: any) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl border border-border/60 hover:bg-primary/5 hover:border-primary/30 transition-all group"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white text-sm font-bold overflow-hidden"
                    style={{ backgroundColor: link.logoUrl ? "transparent" : (link.color || "#6366f1") }}
                  >
                    {link.logoUrl ? (
                      <img src={link.logoUrl} alt={link.title} className="w-full h-full object-contain" />
                    ) : (
                      link.icon || link.title.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">{link.title}</span>
                </a>
              ))}
            </div>
          </Card>
        )}

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
      </div>
    </DashboardLayout>
  );
}
