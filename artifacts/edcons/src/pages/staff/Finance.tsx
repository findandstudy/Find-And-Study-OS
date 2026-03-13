import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListInvoices, useListCommissions } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, FileText, TrendingUp, Clock, Plus, MoreHorizontal, Download, CheckCircle, AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

const revenueData = [
  { month: "Jan", invoiced: 45000, paid: 38000 },
  { month: "Feb", invoiced: 52000, paid: 49000 },
  { month: "Mar", invoiced: 61000, paid: 58000 },
  { month: "Apr", invoiced: 58000, paid: 55000 },
  { month: "May", invoiced: 73000, paid: 70000 },
  { month: "Jun", invoiced: 67000, paid: 62000 },
  { month: "Jul", invoiced: 84000, paid: 79000 },
];

const INVOICE_STATUS: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-700 border-slate-200", icon: FileText },
  sent: { label: "Sent", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Clock },
  paid: { label: "Paid", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle },
  overdue: { label: "Overdue", color: "bg-rose-100 text-rose-700 border-rose-200", icon: AlertCircle },
};

export default function FinancePage() {
  const { data: invoicesResp, isLoading: invoicesLoading } = useListInvoices({ query: { queryKey: ['finance-invoices'] } });
  const { data: commissionsResp, isLoading: commissionsLoading } = useListCommissions({ query: { queryKey: ['finance-commissions'] } });
  const invoices: any[] = (invoicesResp as any)?.data || invoicesResp || [];
  const commissions: any[] = (commissionsResp as any)?.data || commissionsResp || [];

  const totalInvoiced = invoices.reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
  const totalPaid = invoices.filter((i: any) => i.status === 'paid').reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
  const totalOverdue = invoices.filter((i: any) => i.status === 'overdue').reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
  const totalCommissions = commissions.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Finance</h1>
            <p className="text-muted-foreground text-sm mt-1">Invoices, commissions, and revenue tracking</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="rounded-xl gap-2">
              <Download className="w-4 h-4" /> Export
            </Button>
            <Button className="rounded-xl gap-2">
              <Plus className="w-4 h-4" /> New Invoice
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Invoiced", value: `$${totalInvoiced.toLocaleString()}`, icon: FileText, color: "text-blue-500 bg-blue-500/10" },
            { label: "Total Collected", value: `$${totalPaid.toLocaleString()}`, icon: CheckCircle, color: "text-green-500 bg-green-500/10" },
            { label: "Overdue", value: `$${totalOverdue.toLocaleString()}`, icon: AlertCircle, color: "text-rose-500 bg-rose-500/10" },
            { label: "Commissions Due", value: `$${totalCommissions.toLocaleString()}`, icon: DollarSign, color: "text-amber-500 bg-amber-500/10" },
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
        <Card className="p-6 border-none shadow-lg shadow-black/5">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display font-bold text-lg">Revenue Overview</h3>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-primary" /> Invoiced</span>
              <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500" /> Paid</span>
            </div>
          </div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '12px', border: '1px solid hsl(var(--border))' }}
                  formatter={(v: number) => [`$${v.toLocaleString()}`]} />
                <Bar dataKey="invoiced" name="Invoiced" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" opacity={0.6} />
                <Bar dataKey="paid" name="Paid" radius={[4, 4, 0, 0]} fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Tabs: Invoices + Commissions */}
        <Tabs defaultValue="invoices">
          <TabsList className="rounded-xl bg-secondary/50 p-1">
            <TabsTrigger value="invoices" className="rounded-lg font-medium">
              Invoices <Badge variant="secondary" className="ml-2">{invoices?.length || 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="commissions" className="rounded-lg font-medium">
              Commissions <Badge variant="secondary" className="ml-2">{commissions?.length || 0}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invoices">
            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden mt-4">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-secondary/50 text-left">
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Invoice #</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Student</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Due Date</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {invoicesLoading ? (
                      [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-6 py-4"><div className="h-4 bg-secondary animate-pulse rounded-full" /></td>)}</tr>)
                    ) : (invoices || []).length === 0 ? (
                      <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No invoices yet</td></tr>
                    ) : (invoices || []).map(inv => {
                      const statusCfg = INVOICE_STATUS[inv.status] || INVOICE_STATUS.draft;
                      return (
                        <tr key={inv.id} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-6 py-4 text-sm font-mono font-bold text-primary">
                            {inv.invoiceNumber || `INV-${inv.id}`}
                          </td>
                          <td className="px-6 py-4 text-sm text-foreground font-medium">Student #{inv.studentId}</td>
                          <td className="px-6 py-4 text-sm font-bold text-foreground">${(inv.amount || 0).toLocaleString()}</td>
                          <td className="px-6 py-4">
                            <Badge className={`text-xs border ${statusCfg.color}`}>{statusCfg.label}</Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">
                            {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "—"}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg hover:bg-primary/10 hover:text-primary">
                                <Download className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg">
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="commissions">
            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden mt-4">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-secondary/50 text-left">
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">ID</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Agent</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Application</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {commissionsLoading ? (
                      [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-6 py-4"><div className="h-4 bg-secondary animate-pulse rounded-full" /></td>)}</tr>)
                    ) : (commissions || []).length === 0 ? (
                      <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No commissions recorded</td></tr>
                    ) : (commissions || []).map(com => (
                      <tr key={com.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-6 py-4 text-sm font-mono font-bold text-primary">#{com.id}</td>
                        <td className="px-6 py-4 text-sm text-foreground font-medium">Agent #{com.agentId}</td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">App #{com.applicationId}</td>
                        <td className="px-6 py-4 text-sm font-bold text-foreground">${(com.amount || 0).toLocaleString()}</td>
                        <td className="px-6 py-4">
                          <Badge className={com.status === 'paid' ?
                            "bg-green-100 text-green-700 border-green-200" :
                            "bg-amber-100 text-amber-700 border-amber-200"}>
                            {com.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          {com.status !== 'paid' && (
                            <Button size="sm" variant="outline" className="rounded-lg text-xs gap-1 h-8">
                              <CheckCircle className="w-3.5 h-3.5" /> Mark Paid
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
