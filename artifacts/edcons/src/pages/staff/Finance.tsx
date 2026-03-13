import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListInvoices, useListCommissions, customFetch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, FileText, Clock, Plus, Download, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

const INVOICE_STATUS: Record<string, { label: string; color: string }> = {
  draft:   { label: "Draft",   color: "bg-slate-100 text-slate-700 border-slate-200" },
  sent:    { label: "Sent",    color: "bg-blue-100 text-blue-700 border-blue-200" },
  paid:    { label: "Paid",    color: "bg-green-100 text-green-700 border-green-200" },
  overdue: { label: "Overdue", color: "bg-rose-100 text-rose-700 border-rose-200" },
};

export default function FinancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: invoicesResp, isLoading: invoicesLoading } = useListInvoices({ query: { queryKey: ["finance-invoices"] } });
  const { data: commissionsResp, isLoading: commissionsLoading } = useListCommissions({ query: { queryKey: ["finance-commissions"] } });
  const invoices: any[] = (invoicesResp as any)?.data || invoicesResp || [];
  const commissions: any[] = (commissionsResp as any)?.data || commissionsResp || [];

  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ studentId: "", amount: "", currency: "USD", status: "draft", dueDate: "", notes: "" });
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<number | null>(null);

  const totalInvoiced = invoices.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
  const totalPaid = invoices.filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
  const totalOverdue = invoices.filter((i: any) => i.status === "overdue").reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
  const totalCommissions = commissions.filter((c: any) => c.status === "pending").reduce((s: number, c: any) => s + Number(c.amount || 0), 0);

  const monthlyMap: Record<string, { invoiced: number; paid: number }> = {};
  invoices.forEach((inv: any) => {
    const m = new Date(inv.createdAt).toLocaleDateString("en-US", { month: "short" });
    if (!monthlyMap[m]) monthlyMap[m] = { invoiced: 0, paid: 0 };
    monthlyMap[m].invoiced += Number(inv.amount || 0);
    if (inv.status === "paid") monthlyMap[m].paid += Number(inv.amount || 0);
  });
  const revenueData = Object.entries(monthlyMap).slice(-7).map(([month, v]) => ({ month, ...v }));

  async function handleCreateInvoice() {
    if (!invoiceForm.studentId || !invoiceForm.amount) {
      toast({ title: "Required fields missing", description: "Student ID and amount are required.", variant: "destructive" });
      return;
    }
    setSavingInvoice(true);
    try {
      const res = await customFetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: parseInt(invoiceForm.studentId, 10),
          amount: parseFloat(invoiceForm.amount),
          currency: invoiceForm.currency,
          status: invoiceForm.status,
          dueDate: invoiceForm.dueDate || undefined,
          notes: invoiceForm.notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create invoice");
      }
      await qc.invalidateQueries({ queryKey: ["finance-invoices"] });
      toast({ title: "Invoice created", description: "The invoice has been created successfully." });
      setShowInvoiceModal(false);
      setInvoiceForm({ studentId: "", amount: "", currency: "USD", status: "draft", dueDate: "", notes: "" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingInvoice(false);
    }
  }

  async function handleMarkCommissionPaid(id: number) {
    setMarkingPaid(id);
    try {
      const res = await customFetch(`/api/commissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid", paidAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error("Failed to update commission");
      await qc.invalidateQueries({ queryKey: ["finance-commissions"] });
      toast({ title: "Commission marked as paid", description: `Commission #${id} has been marked as paid.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setMarkingPaid(null);
    }
  }

  async function handleMarkInvoicePaid(id: number) {
    try {
      const res = await customFetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid", paidAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error("Failed");
      await qc.invalidateQueries({ queryKey: ["finance-invoices"] });
      toast({ title: "Invoice marked as paid" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Finance</h1>
            <p className="text-muted-foreground text-sm mt-1">Invoices, commissions, and revenue tracking</p>
          </div>
          <div className="flex gap-3">
            <Button className="rounded-xl gap-2" onClick={() => setShowInvoiceModal(true)}>
              <Plus className="w-4 h-4" /> New Invoice
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Invoiced",    value: `$${totalInvoiced.toLocaleString()}`,   icon: FileText,    color: "text-blue-500 bg-blue-500/10" },
            { label: "Total Collected",   value: `$${totalPaid.toLocaleString()}`,        icon: CheckCircle, color: "text-green-500 bg-green-500/10" },
            { label: "Overdue",           value: `$${totalOverdue.toLocaleString()}`,     icon: AlertCircle, color: "text-rose-500 bg-rose-500/10" },
            { label: "Commissions Due",   value: `$${totalCommissions.toLocaleString()}`, icon: DollarSign,  color: "text-amber-500 bg-amber-500/10" },
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
        {revenueData.length > 0 && (
          <Card className="p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display font-bold text-lg">Revenue Overview</h3>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-primary opacity-60" /> Invoiced</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500" /> Paid</span>
              </div>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "12px", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number) => [`$${v.toLocaleString()}`]} />
                  <Bar dataKey="invoiced" name="Invoiced" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" opacity={0.6} />
                  <Bar dataKey="paid" name="Paid" radius={[4, 4, 0, 0]} fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="invoices">
          <TabsList className="rounded-xl bg-secondary/50 p-1">
            <TabsTrigger value="invoices" className="rounded-lg font-medium">
              Invoices <Badge variant="secondary" className="ml-2">{invoices.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="commissions" className="rounded-lg font-medium">
              Commissions <Badge variant="secondary" className="ml-2">{commissions.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* ── INVOICES ── */}
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
                      [...Array(4)].map((_, i) => (
                        <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-6 py-4"><div className="h-4 bg-secondary animate-pulse rounded-full" /></td>)}</tr>
                      ))
                    ) : invoices.length === 0 ? (
                      <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                        <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground/20" />
                        No invoices yet. Create your first invoice.
                      </td></tr>
                    ) : invoices.map((inv: any) => {
                      const statusCfg = INVOICE_STATUS[inv.status] || INVOICE_STATUS.draft;
                      return (
                        <tr key={inv.id} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-6 py-4 text-sm font-mono font-bold text-primary">{inv.invoiceNumber || `INV-${inv.id}`}</td>
                          <td className="px-6 py-4 text-sm text-foreground font-medium">Student #{inv.studentId}</td>
                          <td className="px-6 py-4 text-sm font-bold text-foreground">
                            {inv.currency || "USD"} {Number(inv.amount || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <Badge className={`text-xs border ${statusCfg.color}`}>{statusCfg.label}</Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">
                            {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                          </td>
                          <td className="px-6 py-4">
                            {inv.status !== "paid" && (
                              <Button size="sm" variant="outline" className="rounded-lg text-xs gap-1 h-8"
                                onClick={() => handleMarkInvoicePaid(inv.id)}>
                                <CheckCircle className="w-3.5 h-3.5" /> Mark Paid
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ── COMMISSIONS ── */}
          <TabsContent value="commissions">
            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden mt-4">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-secondary/50 text-left">
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">ID</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Agent</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Notes</th>
                      <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {commissionsLoading ? (
                      [...Array(3)].map((_, i) => (
                        <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-6 py-4"><div className="h-4 bg-secondary animate-pulse rounded-full" /></td>)}</tr>
                      ))
                    ) : commissions.length === 0 ? (
                      <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No commissions recorded</td></tr>
                    ) : commissions.map((com: any) => (
                      <tr key={com.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-6 py-4 text-sm font-mono font-bold text-primary">#{com.id}</td>
                        <td className="px-6 py-4 text-sm text-foreground font-medium">Agent #{com.agentId}</td>
                        <td className="px-6 py-4 text-sm font-bold text-foreground">
                          {com.currency || "USD"} {Number(com.amount || 0).toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          <Badge className={com.status === "paid"
                            ? "bg-green-100 text-green-700 border-green-200"
                            : "bg-amber-100 text-amber-700 border-amber-200"}>
                            {com.status === "paid" ? <><CheckCircle className="w-3 h-3 mr-1" />Paid</> : <><Clock className="w-3 h-3 mr-1" />Pending</>}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">{com.notes || "—"}</td>
                        <td className="px-6 py-4">
                          {com.status !== "paid" && (
                            <Button
                              size="sm" variant="outline" className="rounded-lg text-xs gap-1 h-8"
                              disabled={markingPaid === com.id}
                              onClick={() => handleMarkCommissionPaid(com.id)}
                            >
                              {markingPaid === com.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <CheckCircle className="w-3.5 h-3.5" />}
                              Mark Paid
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

      {/* ── New Invoice Modal ── */}
      <Dialog open={showInvoiceModal} onOpenChange={setShowInvoiceModal}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Student ID <span className="text-rose-500">*</span></Label>
                <Input
                  type="number" placeholder="e.g. 42"
                  className="rounded-xl"
                  value={invoiceForm.studentId}
                  onChange={e => setInvoiceForm(f => ({ ...f, studentId: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Amount <span className="text-rose-500">*</span></Label>
                <Input
                  type="number" placeholder="5000"
                  className="rounded-xl"
                  value={invoiceForm.amount}
                  onChange={e => setInvoiceForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={invoiceForm.currency} onValueChange={v => setInvoiceForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["USD","EUR","GBP","TRY","AED","SAR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={invoiceForm.status} onValueChange={v => setInvoiceForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input
                type="date" className="rounded-xl"
                value={invoiceForm.dueDate}
                onChange={e => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                placeholder="Optional notes..."
                className="rounded-xl"
                value={invoiceForm.notes}
                onChange={e => setInvoiceForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowInvoiceModal(false)}>Cancel</Button>
            <Button className="rounded-xl gap-2" onClick={handleCreateInvoice} disabled={savingInvoice}>
              {savingInvoice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
