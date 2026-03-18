import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useGetOverviewStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, FileText, GraduationCap, ArrowUpRight, Clock, CalendarClock, ExternalLink } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

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
                  <Link key={fu.id} href={fu.leadId ? `/staff/leads/${fu.leadId}` : "#"}>
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
      </div>
    </DashboardLayout>
  );
}
