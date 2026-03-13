import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListApplications } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Users, FileText, DollarSign, TrendingUp, Link2, Copy, Star, Clock, CheckCircle, ArrowRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

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
          <Link href="/agent/referrals">
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
                <Link href="/agent/referrals">
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

        {/* Recent Applications */}
        <Card className="border-none shadow-lg shadow-black/5">
          <div className="p-6 border-b border-border/50 flex items-center justify-between">
            <h3 className="font-display font-bold text-lg">Recent Referral Applications</h3>
            <Link href="/agent/referrals">
              <Button variant="ghost" size="sm" className="text-primary gap-1 text-xs">
                See All <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="divide-y divide-border/50">
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <div key={i} className="px-6 py-4">
                  <div className="h-10 bg-secondary animate-pulse rounded-xl" />
                </div>
              ))
            ) : applications.slice(0, 5).map((app: any) => {
              const stageCfg = STAGE_CONFIG[app.stage] || STAGE_CONFIG.inquiry;
              return (
                <div key={app.id} className="flex items-center justify-between px-6 py-4 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/20 to-accent/20 flex items-center justify-center font-bold text-sm text-primary">
                      {String(app.studentId)[0]}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground text-sm">Student #{app.studentId}</p>
                      <p className="text-xs text-muted-foreground">App #{app.id} · {new Date(app.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <Badge className={`text-xs border ${stageCfg.color}`}>{stageCfg.label}</Badge>
                </div>
              );
            })}
            {!isLoading && applications.length === 0 && (
              <div className="px-6 py-12 text-center text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                <p className="font-medium">No referral applications yet</p>
                <p className="text-sm mt-1">Share your referral link to get started</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
