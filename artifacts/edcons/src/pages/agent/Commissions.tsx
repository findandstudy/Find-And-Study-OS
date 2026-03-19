import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, CheckCircle, Clock, TrendingUp, AlertCircle, Banknote, Receipt } from "lucide-react";
import { TablePagination, useTablePagination } from "@/components/TablePagination";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function formatUSD(v: number) {
  return `USD ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AgentCommissions() {
  const { user } = useAuth(true);
  const pgComm = useTablePagination(25);
  const pgFee = useTablePagination(25);

  const { data: summary } = useQuery<{ commissions: { potential: number; confirmed: number; paid: number; pending: number }; serviceFees: { potential: number; confirmed: number; paid: number; pending: number } }>({
    queryKey: ["agent-finance-summary", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const r = await fetch(`${BASE_URL}/api/agent/finance-summary`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const { data: commData, isLoading: commLoading } = useQuery({
    queryKey: ["agent-commissions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const r = await fetch(`${BASE_URL}/api/agent/commissions?limit=200`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const { data: feeData, isLoading: feeLoading } = useQuery({
    queryKey: ["agent-service-fees", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const r = await fetch(`${BASE_URL}/api/agent/service-fees?limit=200`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const commissions: any[] = commData?.data || [];
  const serviceFees: any[] = feeData?.data || [];
  const { paged: pagedComm, total: totalComm } = pgComm.paginate(commissions);
  const { paged: pagedFees, total: totalFees } = pgFee.paginate(serviceFees);

  const cs = summary?.commissions || { potential: 0, confirmed: 0, paid: 0, pending: 0 };
  const fs = summary?.serviceFees || { potential: 0, confirmed: 0, paid: 0, pending: 0 };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-primary" /> My Commissions
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Track your earnings and pending payments</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "POTENTIAL COMMISSION", value: formatUSD(cs.potential), icon: DollarSign, color: "text-green-500 bg-green-500/10" },
            { label: "CONFIRMED COMMISSION", value: formatUSD(cs.confirmed), icon: DollarSign, color: "text-amber-500 bg-amber-500/10" },
            { label: "COMMISSION PAID", value: formatUSD(cs.paid), icon: DollarSign, color: "text-blue-500 bg-blue-500/10" },
            { label: "PENDING COMMISSION", value: formatUSD(cs.pending), icon: DollarSign, color: "text-purple-500 bg-purple-500/10" },
          ].map((s, i) => (
            <Card key={i} className="p-5 border-none shadow-md shadow-black/5 hover:-translate-y-1 transition-transform">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
                <s.icon className="w-5 h-5" />
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{s.label}</p>
              <p className="text-xl font-display font-bold text-foreground mt-1">{s.value}</p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "POTENTIAL SERVICE FEE", value: formatUSD(fs.potential), icon: DollarSign, color: "text-green-500 bg-green-500/10" },
            { label: "CONFIRMED SERVICE FEE", value: formatUSD(fs.confirmed), icon: DollarSign, color: "text-amber-500 bg-amber-500/10" },
            { label: "PAID SERVICE FEE", value: formatUSD(fs.paid), icon: DollarSign, color: "text-blue-500 bg-blue-500/10" },
            { label: "PENDING SERVICE FEE", value: formatUSD(fs.pending), icon: DollarSign, color: "text-purple-500 bg-purple-500/10" },
          ].map((s, i) => (
            <Card key={i} className="p-5 border-none shadow-md shadow-black/5 hover:-translate-y-1 transition-transform">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
                <s.icon className="w-5 h-5" />
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{s.label}</p>
              <p className="text-xl font-display font-bold text-foreground mt-1">{s.value}</p>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="commissions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="commissions" className="gap-1.5"><Banknote className="w-4 h-4" /> Commission History</TabsTrigger>
            <TabsTrigger value="service-fees" className="gap-1.5"><Receipt className="w-4 h-4" /> Service Fee History</TabsTrigger>
          </TabsList>

          <TabsContent value="commissions">
            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
              <div className="p-5 border-b border-border/50">
                <h3 className="font-display font-bold text-lg">Commission History</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-secondary/50 text-left">
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Student</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">University</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Program Fee</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Commission</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Paid</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {commLoading ? (
                      [...Array(4)].map((_, i) => (
                        <tr key={i}>
                          {[...Array(7)].map((_, j) => (
                            <td key={j} className="px-5 py-4"><div className="h-4 bg-secondary animate-pulse rounded-full" /></td>
                          ))}
                        </tr>
                      ))
                    ) : pagedComm.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-16 text-center">
                          <DollarSign className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                          <p className="text-muted-foreground font-medium">No commissions recorded yet</p>
                        </td>
                      </tr>
                    ) : pagedComm.map((c: any) => (
                      <tr key={c.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-5 py-4 text-sm font-medium">{c.studentName || "—"}</td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">{c.universityName || "—"}</td>
                        <td className="px-5 py-4 text-sm font-medium">{c.programFee ? `${c.currency || "USD"} ${Number(c.programFee).toLocaleString()}` : "—"}</td>
                        <td className="px-5 py-4 text-sm font-bold text-primary">{c.agentCommissionAmount ? `${c.currency || "USD"} ${Number(c.agentCommissionAmount).toLocaleString()}` : "—"}</td>
                        <td className="px-5 py-4 text-sm font-medium text-green-600">{c.agentPaid && Number(c.agentPaid) > 0 ? `${c.currency || "USD"} ${Number(c.agentPaid).toLocaleString()}` : "—"}</td>
                        <td className="px-5 py-4">
                          <Badge className={
                            c.status === "potential" ? "bg-gray-100 text-gray-600 border-gray-200" :
                            c.status === "confirmed" ? "bg-blue-100 text-blue-700 border-blue-200" :
                            c.status === "collected_partial" ? "bg-amber-100 text-amber-700 border-amber-200" :
                            c.status === "collected_full" ? "bg-green-100 text-green-700 border-green-200" :
                            "bg-gray-100 text-gray-700 border-gray-200"
                          }>
                            {c.status?.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">
                          {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={pgComm.page}
                totalItems={totalComm}
                pageSize={pgComm.pageSize}
                onPageChange={pgComm.setPage}
                onPageSizeChange={pgComm.setPageSize}
              />
            </Card>
          </TabsContent>

          <TabsContent value="service-fees">
            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
              <div className="p-5 border-b border-border/50">
                <h3 className="font-display font-bold text-lg">Service Fee History</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-secondary/50 text-left">
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Student</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">University</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Total</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">1st Installment</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">2nd Installment</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {feeLoading ? (
                      [...Array(4)].map((_, i) => (
                        <tr key={i}>
                          {[...Array(7)].map((_, j) => (
                            <td key={j} className="px-5 py-4"><div className="h-4 bg-secondary animate-pulse rounded-full" /></td>
                          ))}
                        </tr>
                      ))
                    ) : pagedFees.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-16 text-center">
                          <Receipt className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                          <p className="text-muted-foreground font-medium">No service fees recorded yet</p>
                        </td>
                      </tr>
                    ) : pagedFees.map((f: any) => (
                      <tr key={f.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-5 py-4 text-sm font-medium">{f.studentName || "—"}</td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">{f.universityName || "—"}</td>
                        <td className="px-5 py-4 text-sm font-bold text-primary">{f.currency || "USD"} {Number(f.totalAmount || 0).toLocaleString()}</td>
                        <td className="px-5 py-4 text-sm">
                          {f.firstInstallmentAmount ? (
                            <span className={f.firstInstallmentPaidAt ? "text-green-600 font-medium" : "text-muted-foreground"}>
                              {f.currency || "USD"} {Number(f.firstInstallmentAmount).toLocaleString()}
                              {f.firstInstallmentPaidAt && <CheckCircle className="w-3 h-3 inline ml-1" />}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-5 py-4 text-sm">
                          {f.secondInstallmentAmount ? (
                            <span className={f.secondInstallmentPaidAt ? "text-green-600 font-medium" : "text-muted-foreground"}>
                              {f.currency || "USD"} {Number(f.secondInstallmentAmount).toLocaleString()}
                              {f.secondInstallmentPaidAt && <CheckCircle className="w-3 h-3 inline ml-1" />}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-5 py-4">
                          <Badge className={
                            f.status === "paid" ? "bg-green-100 text-green-700 border-green-200" :
                            f.status === "partial" ? "bg-amber-100 text-amber-700 border-amber-200" :
                            "bg-gray-100 text-gray-600 border-gray-200"
                          }>
                            {f.status}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">
                          {new Date(f.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={pgFee.page}
                totalItems={totalFees}
                pageSize={pgFee.pageSize}
                onPageChange={pgFee.setPage}
                onPageSizeChange={pgFee.setPageSize}
              />
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
