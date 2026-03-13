import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListLeads, useListStudents } from "@workspace/api-client-react";
import { Users, FileText, DollarSign, TrendingUp, UserPlus, Link2, Copy, Star, Clock, CheckCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

const commissionData = [
  { month: "Jan", amount: 1200 },
  { month: "Feb", amount: 1800 },
  { month: "Mar", amount: 2400 },
  { month: "Apr", amount: 1600 },
  { month: "May", amount: 3200 },
  { month: "Jun", amount: 2800 },
  { month: "Jul", amount: 4100 },
];

export default function AgentDashboard() {
  const { data: leadsResp } = useListLeads({ query: { queryKey: ['agent-leads'] } });
  const { data: studentsResp } = useListStudents({ query: { queryKey: ['agent-students'] } });
  const leads: any[] = (leadsResp as any)?.data || leadsResp || [];
  const students: any[] = (studentsResp as any)?.data || studentsResp || [];

  const referralLink = `${window.location.origin}/apply?ref=AGENT001`;

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Agent Portal</h1>
            <p className="text-muted-foreground mt-1">Track your referrals, commissions, and student progress</p>
          </div>
          <Button className="rounded-xl gap-2">
            <UserPlus className="w-4 h-4" /> Add New Lead
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "My Leads", value: leads?.length || 0, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
            { label: "Active Students", value: students?.length || 0, icon: FileText, color: "text-green-500", bg: "bg-green-500/10" },
            { label: "This Month Earnings", value: "$4,100", icon: DollarSign, color: "text-amber-500", bg: "bg-amber-500/10" },
            { label: "Total Earned", value: "$17,100", icon: TrendingUp, color: "text-purple-500", bg: "bg-purple-500/10" },
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
            <h3 className="font-display font-bold text-lg mb-6">Commission History</h3>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={commissionData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '12px', border: '1px solid hsl(var(--border))' }}
                    formatter={(v: number) => [`$${v}`, 'Commission']} />
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

            {/* Performance */}
            <Card className="p-5 border-none shadow-md shadow-black/5">
              <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                <Star className="w-5 h-5 text-amber-500" /> Performance
              </h3>
              <div className="space-y-3">
                {[
                  { label: "Conversion Rate", value: "34%", good: true },
                  { label: "Avg. App to Offer", value: "22 days", good: true },
                  { label: "Student Satisfaction", value: "4.8/5", good: true },
                  { label: "Pending Approvals", value: "2", good: false },
                ].map((m, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{m.label}</span>
                    <span className={`text-sm font-bold ${m.good ? 'text-green-600' : 'text-amber-600'}`}>{m.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* My Students */}
        <Card className="border-none shadow-lg shadow-black/5">
          <div className="p-6 border-b border-border/50">
            <h3 className="font-display font-bold text-lg">My Referred Students</h3>
          </div>
          <div className="divide-y divide-border/50">
            {(students || []).slice(0, 5).map((student) => (
              <div key={student.id} className="flex items-center justify-between px-6 py-4 hover:bg-secondary/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/20 to-accent/20 flex items-center justify-center font-bold text-sm text-primary">
                    {student.userId?.toString()[0] || 'S'}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">Student #{student.id}</p>
                    <p className="text-xs text-muted-foreground">Enrolled {new Date(student.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-green-500/10 text-green-600 border-green-200 text-xs">
                    <CheckCircle className="w-3 h-3 mr-1" /> Active
                  </Badge>
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 text-xs">
                    <Clock className="w-3 h-3 mr-1" /> Commission Pending
                  </Badge>
                </div>
              </div>
            ))}
            {(!students || students.length === 0) && (
              <div className="px-6 py-12 text-center text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                <p>No students referred yet. Share your referral link!</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
