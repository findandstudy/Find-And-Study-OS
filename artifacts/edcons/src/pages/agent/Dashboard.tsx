import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListApplications } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, FileText, DollarSign, TrendingUp, Link2, Copy, Star, Clock, CheckCircle, ArrowRight, GraduationCap, Activity, Bell, UserPlus, FileCheck, CreditCard, CalendarClock, MessageCircle, Megaphone, AlertCircle, Shield } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

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

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  inquiry:             { label: "Inquiry",        color: "bg-slate-100 text-slate-700 border-slate-200" },
  documents_collected: { label: "Docs Collected", color: "bg-blue-100 text-blue-700 border-blue-200" },
  submitted:           { label: "Submitted",      color: "bg-violet-100 text-violet-700 border-violet-200" },
  offer_received:      { label: "Offer Received", color: "bg-amber-100 text-amber-700 border-amber-200" },
  visa_applied:        { label: "Visa Applied",   color: "bg-orange-100 text-orange-700 border-orange-200" },
  visa_approved:       { label: "Visa Approved",  color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  enrolled:            { label: "Enrolled",       color: "bg-green-100 text-green-700 border-green-200" },
  rejected:            { label: "Rejected",       color: "bg-rose-100 text-rose-700 border-rose-200" },
};

export default function AgentDashboard() {
  const { user } = useAuth(true);
  const { data: appsResp, isLoading } = useListApplications({ query: { queryKey: ["agent-dash-apps"] } });
  const applications: any[] = (appsResp as any)?.data || appsResp || [];

  const { data: latestStudentsData } = useQuery<any>({
    queryKey: ["/api/students", "agent-dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/students?limit=5&page=1`, { credentials: "include" }).then(r => r.json()),
  });
  const latestStudents: any[] = latestStudentsData?.data || [];

  const { data: latestAuditData } = useQuery<any>({
    queryKey: ["/api/audit", "agent-dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/audit?limit=5&page=1`, { credentials: "include" }).then(r => r.json()),
  });
  const latestUpdates: any[] = latestAuditData?.data || [];

  const { data: notificationsData } = useQuery<any>({
    queryKey: ["/api/notifications", "agent-dashboard-latest"],
    queryFn: () => fetch(`${BASE}/api/notifications?limit=5`, { credentials: "include" }).then(r => r.json()),
  });
  const latestNotifications: any[] = notificationsData?.data || [];

  const enrolled = applications.filter(a => a.stage === "enrolled").length;
  const inProgress = applications.filter(a => !["enrolled", "rejected"].includes(a.stage)).length;
  const referralLink = `${window.location.origin}/apply?ref=${user?.id || "AGENT"}`;

  const copyLink = () => navigator.clipboard.writeText(referralLink);

  const commissionData = [
    { month: "Jan", amount: 0 },
    { month: "Feb", amount: 0 },
    { month: "Mar", amount: 0 },
    { month: "Apr", amount: 0 },
    { month: "May", amount: 0 },
    { month: "Jun", amount: 0 },
    { month: "Jul", amount: 0 },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Agent Portal</h1>
            <p className="text-muted-foreground mt-1">Track your referrals, commissions, and student progress</p>
          </div>
          <Link href="/agent/applications">
            <Button className="rounded-xl gap-2">
              <FileText className="w-4 h-4" /> View All Referrals
            </Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Referrals", value: applications.length, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
            { label: "In Progress", value: inProgress, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
            { label: "Enrolled", value: enrolled, icon: CheckCircle, color: "text-green-500", bg: "bg-green-500/10" },
            { label: "Conversion Rate", value: applications.length > 0 ? `${Math.round((enrolled / applications.length) * 100)}%` : "—", icon: TrendingUp, color: "text-purple-500", bg: "bg-purple-500/10" },
          ].map((s, i) => (
            <Card key={i} className="p-5 border-none shadow-md shadow-black/5 hover:-translate-y-1 transition-transform">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
              <p className="text-2xl font-display font-bold text-foreground mt-1">{s.value}</p>
            </Card>
          ))}
        </div>

        {/* Commission Chart + Referral */}
        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display font-bold text-lg">Commission History</h3>
              <Link href="/agent/commissions">
                <Button variant="ghost" size="sm" className="text-primary gap-1 text-xs">
                  View All <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={commissionData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "12px", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number) => [`$${v}`, "Commission"]} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="space-y-4">
            {/* Referral Link */}
            <Card className="p-5 border-none shadow-md shadow-black/5">
              <div className="flex items-center gap-2 mb-4">
                <Link2 className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-foreground">Your Referral Link</h3>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-secondary/50 border border-border/50 mb-4">
                <p className="text-xs text-muted-foreground flex-1 truncate font-mono">{referralLink}</p>
              </div>
              <Button onClick={copyLink} variant="outline" className="w-full rounded-xl gap-2">
                <Copy className="w-4 h-4" /> Copy Link
              </Button>
            </Card>

            {/* Quick Links */}
            <Card className="p-5 border-none shadow-md shadow-black/5">
              <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                <Star className="w-5 h-5 text-amber-500" /> Quick Access
              </h3>
              <div className="space-y-2">
                <Link href="/agent/applications">
                  <div className="flex items-center justify-between p-3 rounded-xl hover:bg-secondary/50 transition-colors cursor-pointer">
                    <span className="text-sm font-medium text-foreground">My Referrals</span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
                <Link href="/agent/commissions">
                  <div className="flex items-center justify-between p-3 rounded-xl hover:bg-secondary/50 transition-colors cursor-pointer">
                    <span className="text-sm font-medium text-foreground">Commission Tracker</span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              </div>
            </Card>
          </div>
        </div>

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
                  <Link key={s.id} href="/agent/students">
                    <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-secondary/50 transition-colors cursor-pointer">
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
