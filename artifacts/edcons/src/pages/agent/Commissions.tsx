import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, Clock, CheckCircle, AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

export default function AgentCommissions() {
  const { user } = useAuth(true);

  const { data, isLoading } = useQuery({
    queryKey: ["agent-commissions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const res = await customFetch(`/api/commissions`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const commissions: any[] = (data as any)?.data || data || [];

  const totalEarned = commissions.filter(c => c.status === "paid").reduce((s, c) => s + (c.amount || 0), 0);
  const totalPending = commissions.filter(c => c.status === "pending").reduce((s, c) => s + (c.amount || 0), 0);
  const paidCount = commissions.filter(c => c.status === "paid").length;
  const pendingCount = commissions.filter(c => c.status === "pending").length;

  const monthlyMap: Record<string, number> = {};
  commissions
    .filter(c => c.status === "paid")
    .forEach(c => {
      const month = new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthlyMap[month] = (monthlyMap[month] || 0) + (c.amount || 0);
    });
  const chartData = Object.entries(monthlyMap).slice(-7).map(([month, amount]) => ({ month, amount }));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-primary" /> My Commissions
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Track your earnings and pending payments</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Earned", value: `$${totalEarned.toLocaleString()}`, icon: CheckCircle, color: "text-green-500 bg-green-500/10" },
            { label: "Pending", value: `$${totalPending.toLocaleString()}`, icon: Clock, color: "text-amber-500 bg-amber-500/10" },
            { label: "Paid Records", value: paidCount, icon: TrendingUp, color: "text-blue-500 bg-blue-500/10" },
            { label: "Awaiting", value: pendingCount, icon: AlertCircle, color: "text-purple-500 bg-purple-500/10" },
          ].map((s, i) => (
            <Card key={i} className="p-5 border-none shadow-md shadow-black/5 hover:-translate-y-1 transition-transform">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
                <s.icon className="w-5 h-5" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
              <p className="text-2xl font-display font-bold text-foreground mt-1">{s.value}</p>
            </Card>
          ))}
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <Card className="p-6 border-none shadow-lg shadow-black/5">
            <h3 className="font-display font-bold text-lg mb-6">Monthly Earnings</h3>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickFormatter={v => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "12px", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number) => [`$${v.toLocaleString()}`, "Earned"]}
                  />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* Commission Records */}
        <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
          <div className="p-5 border-b border-border/50">
            <h3 className="font-display font-bold text-lg">Commission History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-secondary/50 text-left">
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">ID</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Amount</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Notes</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(5)].map((_, j) => (
                        <td key={j} className="px-5 py-4"><div className="h-4 bg-secondary animate-pulse rounded-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : commissions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center">
                      <DollarSign className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">No commissions recorded yet</p>
                    </td>
                  </tr>
                ) : commissions.map((c: any) => (
                  <tr key={c.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-5 py-4 text-sm font-mono font-bold text-primary">#{c.id}</td>
                    <td className="px-5 py-4 text-sm font-bold text-foreground">
                      {c.currency || "USD"} {Number(c.amount || 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-4">
                      <Badge className={
                        c.status === "paid"
                          ? "bg-green-100 text-green-700 border-green-200"
                          : "bg-amber-100 text-amber-700 border-amber-200"
                      }>
                        {c.status === "paid"
                          ? <><CheckCircle className="w-3 h-3 mr-1" />Paid</>
                          : <><Clock className="w-3 h-3 mr-1" />Pending</>}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{c.notes || "—"}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
