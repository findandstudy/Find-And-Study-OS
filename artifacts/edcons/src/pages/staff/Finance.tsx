import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSeason } from "@/contexts/SeasonContext";
import {
  useListCommissions, useListServiceFees, useGetFinanceSummary,
  customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  DollarSign, TrendingUp, Building2, Users, Plus, Trash2, Pencil,
  CheckCircle, Clock, AlertCircle, Loader2, RefreshCw, ArrowUpRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/* ─── helpers ─────────────────────────────────────────────────── */

const toNum = (v: any) => parseFloat(String(v ?? 0)) || 0;
const fmt = (v: any, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(toNum(v));
const pct = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 100) : 0;

const currentYear = String(new Date().getFullYear());
const seasons = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));

const COMM_STATUS: Record<string, { label: string; color: string }> = {
  potential:       { label: "Potential",   color: "bg-amber-100 text-amber-700 border-amber-200" },
  confirmed:       { label: "Confirmed",   color: "bg-blue-100 text-blue-700 border-blue-200" },
  collected_partial: { label: "Part. Collected", color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  collected_full:  { label: "Collected",   color: "bg-green-100 text-green-700 border-green-200" },
  settled:         { label: "Settled",     color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

const FEE_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-rose-100 text-rose-700 border-rose-200" },
  partial: { label: "1st Paid", color: "bg-amber-100 text-amber-700 border-amber-200" },
  paid:    { label: "Paid",    color: "bg-green-100 text-green-700 border-green-200" },
};

/* ─── stat card ───────────────────────────────────────────────── */

function StatCard({ icon: Icon, label, value, sub, color = "text-indigo-600" }: {
  icon: any; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={`p-2 rounded-lg bg-slate-50 ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-lg font-bold text-slate-800">{value}</p>
          {sub && <p className="text-xs text-slate-400">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Commission Form Modal ───────────────────────────────────── */

interface CommissionForm {
  studentName: string;
  universityName: string;
  programName: string;
  season: string;
  currency: string;
  isStateUniversity: boolean;
  programFee: string;
  universityCommissionRate: string;
  agentCommissionRate: string;
  status: string;
  universityCollected: string;
  agentPaid: string;
  offsetAmount: string;
  notes: string;
}

const EMPTY_COMM: CommissionForm = {
  studentName: "", universityName: "", programName: "",
  season: currentYear, currency: "USD", isStateUniversity: false,
  programFee: "", universityCommissionRate: "20", agentCommissionRate: "70",
  status: "potential",
  universityCollected: "0", agentPaid: "0", offsetAmount: "0",
  notes: "",
};

function CommissionModal({
  open, onClose, initial, editId,
}: {
  open: boolean; onClose: () => void; initial?: CommissionForm; editId?: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<CommissionForm>(initial || EMPTY_COMM);
  const [saving, setSaving] = useState(false);

  const uRate = toNum(form.universityCommissionRate);
  const aRate = toNum(form.agentCommissionRate);
  const fee   = toNum(form.programFee);
  const uAmt  = fee > 0 && uRate > 0 ? (fee * uRate) / 100 : 0;
  const aAmt  = uAmt > 0 && aRate > 0 ? (uAmt * aRate) / 100 : 0;
  const netAgency = uAmt - aAmt;
  const maxOffset = form.status !== "potential" && uAmt > 0 ? uAmt * 0.7 : 0;

  const set = (k: keyof CommissionForm) => (e: any) =>
    setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));

  async function save() {
    setSaving(true);
    try {
      const body = {
        ...form,
        programFee: toNum(form.programFee) || null,
        universityCommissionRate: uRate || null,
        universityCommissionAmount: uAmt || null,
        agentCommissionRate: aRate || null,
        agentCommissionAmount: aAmt || null,
        universityCollected: toNum(form.universityCollected),
        agentPaid: toNum(form.agentPaid),
        offsetAmount: toNum(form.offsetAmount),
        isStateUniversity: form.isStateUniversity,
      };
      if (editId) {
        await customFetch(`/api/commissions/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await customFetch("/api/commissions", { method: "POST", body: JSON.stringify(body) });
      }
      qc.invalidateQueries({ queryKey: ["commissions"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      toast({ title: editId ? "Commission updated" : "Commission created" });
      onClose();
    } catch { toast({ title: "Error saving commission", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Edit Commission" : "New Commission"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <div>
              <Label>Student Name</Label>
              <Input value={form.studentName} onChange={set("studentName")} placeholder="Full name" />
            </div>
            <div>
              <Label>University Name</Label>
              <Input value={form.universityName} onChange={set("universityName")} placeholder="University" />
            </div>
          </div>
          <div>
            <Label>Program</Label>
            <Input value={form.programName} onChange={set("programName")} placeholder="Program name" />
          </div>
          <div>
            <Label>Season</Label>
            <Select value={form.season} onValueChange={set("season")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{seasons.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Currency</Label>
            <Select value={form.currency} onValueChange={set("currency")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["USD","EUR","GBP","TRY","AED"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={set("status")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(COMM_STATUS).map(([v, { label }]) =>
                  <SelectItem key={v} value={v}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Commission Calculation */}
          <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3 grid grid-cols-3 gap-3">
            <div>
              <Label>Program Fee ({form.currency})</Label>
              <Input type="number" value={form.programFee} onChange={set("programFee")} placeholder="0" />
            </div>
            <div>
              <Label>University Rate (%)</Label>
              <Input type="number" value={form.universityCommissionRate} onChange={set("universityCommissionRate")} placeholder="20" />
            </div>
            <div>
              <Label>Agent Rate (%)</Label>
              <Input type="number" value={form.agentCommissionRate} onChange={set("agentCommissionRate")} placeholder="70" />
            </div>
            {uAmt > 0 && (
              <div className="col-span-3 grid grid-cols-3 gap-2 pt-1 text-sm">
                <div className="rounded bg-blue-50 border border-blue-200 p-2 text-center">
                  <div className="text-xs text-blue-600 font-medium">University Pays Agency</div>
                  <div className="font-bold text-blue-700">{fmt(uAmt, form.currency)}</div>
                </div>
                <div className="rounded bg-amber-50 border border-amber-200 p-2 text-center">
                  <div className="text-xs text-amber-600 font-medium">Agency Pays Agent</div>
                  <div className="font-bold text-amber-700">{fmt(aAmt, form.currency)}</div>
                </div>
                <div className="rounded bg-emerald-50 border border-emerald-200 p-2 text-center">
                  <div className="text-xs text-emerald-600 font-medium">Net Agency Income</div>
                  <div className="font-bold text-emerald-700">{fmt(netAgency, form.currency)}</div>
                </div>
              </div>
            )}
          </div>

          {/* Tracking */}
          <div>
            <Label>University Collected</Label>
            <Input type="number" value={form.universityCollected} onChange={set("universityCollected")} placeholder="0" />
          </div>
          <div>
            <Label>Agent Paid Out</Label>
            <Input type="number" value={form.agentPaid} onChange={set("agentPaid")} placeholder="0" />
          </div>

          {/* Offset (Article 6) */}
          <div>
            <Label>State University</Label>
            <div className="flex items-center gap-2 mt-2">
              <Checkbox
                checked={form.isStateUniversity}
                onCheckedChange={(v) => setForm(f => ({ ...f, isStateUniversity: !!v }))}
              />
              <span className="text-sm text-slate-600">Is state university</span>
            </div>
          </div>
          {form.isStateUniversity && (
            <div>
              <Label>Offset Amount (Art. 6) — max {fmt(maxOffset, form.currency)}</Label>
              <Input
                type="number"
                value={form.offsetAmount}
                onChange={set("offsetAmount")}
                max={maxOffset}
                placeholder="0"
              />
            </div>
          )}

          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={set("notes")} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {editId ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Service Fee Form Modal ──────────────────────────────────── */

interface ServiceFeeForm {
  studentName: string;
  universityName: string;
  isStateUniversity: boolean;
  payerType: string;
  season: string;
  currency: string;
  totalAmount: string;
  firstInstallmentPaidAt: string;
  secondInstallmentPaidAt: string;
  notes: string;
}

const EMPTY_FEE: ServiceFeeForm = {
  studentName: "", universityName: "",
  isStateUniversity: false, payerType: "student",
  season: currentYear, currency: "USD", totalAmount: "",
  firstInstallmentPaidAt: "", secondInstallmentPaidAt: "",
  notes: "",
};

function ServiceFeeModal({
  open, onClose, initial, editId,
}: {
  open: boolean; onClose: () => void; initial?: ServiceFeeForm; editId?: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<ServiceFeeForm>(initial || EMPTY_FEE);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof ServiceFeeForm) => (e: any) =>
    setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, any> = {
        ...form,
        totalAmount: toNum(form.totalAmount),
        isStateUniversity: form.isStateUniversity,
        firstInstallmentPaidAt: form.firstInstallmentPaidAt || null,
        secondInstallmentPaidAt: form.secondInstallmentPaidAt || null,
      };
      if (editId) {
        await customFetch(`/api/service-fees/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await customFetch("/api/service-fees", { method: "POST", body: JSON.stringify(body) });
      }
      qc.invalidateQueries({ queryKey: ["service-fees"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      toast({ title: editId ? "Service fee updated" : "Service fee created" });
      onClose();
    } catch { toast({ title: "Error saving service fee", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  const total = toNum(form.totalAmount);
  const half = total / 2;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Edit Service Fee" : "New Service Fee"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <Label>Student Name</Label>
            <Input value={form.studentName} onChange={set("studentName")} />
          </div>
          <div>
            <Label>University Name</Label>
            <Input value={form.universityName} onChange={set("universityName")} />
          </div>
          <div>
            <Label>Payer</Label>
            <Select value={form.payerType} onValueChange={set("payerType")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Season</Label>
            <Select value={form.season} onValueChange={set("season")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{seasons.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Currency</Label>
            <Select value={form.currency} onValueChange={set("currency")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["USD","EUR","GBP","TRY","AED"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Total Amount</Label>
            <Input type="number" value={form.totalAmount} onChange={set("totalAmount")} placeholder="0" />
          </div>

          {total > 0 && (
            <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3 grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">1st Installment ({fmt(half, form.currency)})</Label>
                <Input
                  type="date"
                  value={form.firstInstallmentPaidAt}
                  onChange={set("firstInstallmentPaidAt")}
                  placeholder="Paid date"
                />
                <p className="text-xs text-slate-400 mt-1">Leave blank if unpaid</p>
              </div>
              <div>
                <Label className="text-xs">2nd Installment ({fmt(half, form.currency)})</Label>
                <Input
                  type="date"
                  value={form.secondInstallmentPaidAt}
                  onChange={set("secondInstallmentPaidAt")}
                  placeholder="Paid date"
                />
                <p className="text-xs text-slate-400 mt-1">Leave blank if unpaid</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.isStateUniversity}
              onCheckedChange={(v) => setForm(f => ({ ...f, isStateUniversity: !!v }))}
            />
            <Label>State University</Label>
          </div>

          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={set("notes")} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {editId ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main ────────────────────────────────────────────────────── */

export default function FinancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { season } = useSeason();
  const [tab, setTab] = useState("commissions");
  const [commSearch, setCommSearch] = useState("");
  const [commStatus, setCommStatus] = useState("all");

  const [commModal, setCommModal] = useState<{ open: boolean; id?: number; initial?: CommissionForm }>({ open: false });
  const [feeModal, setFeeModal] = useState<{ open: boolean; id?: number; initial?: ServiceFeeForm }>({ open: false });
  const [deleting, setDeleting] = useState<number | null>(null);

  const commParams = { season, ...(commSearch ? { search: commSearch } : {}), ...(commStatus !== "all" ? { status: commStatus } : {}), limit: 200 } as any;
  const feeParams  = { season, limit: 200 } as any;

  const { data: commResp, isLoading: commLoading, refetch: refetchComm } = useListCommissions(
    commParams,
    { query: { queryKey: ["commissions", season, commSearch, commStatus] } }
  );
  const { data: feeResp, isLoading: feeLoading, refetch: refetchFees } = useListServiceFees(
    feeParams,
    { query: { queryKey: ["service-fees", season] } }
  );
  const { data: summaryData } = useGetFinanceSummary(
    { season } as any,
    { query: { queryKey: ["finance-summary", season] } }
  );

  const commissions: any[] = (commResp as any)?.data || [];
  const commSummary: any = (commResp as any)?.summary || {};
  const fees: any[] = (feeResp as any)?.data || [];
  const feeSummary: any = (feeResp as any)?.summary || {};
  const summary: any = summaryData || {};

  async function deleteCommission(id: number) {
    setDeleting(id);
    try {
      await customFetch(`/api/commissions/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["commissions"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      toast({ title: "Commission deleted" });
    } catch { toast({ title: "Error deleting", variant: "destructive" }); }
    finally { setDeleting(null); }
  }

  async function deleteServiceFee(id: number) {
    setDeleting(id);
    try {
      await customFetch(`/api/service-fees/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["service-fees"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      toast({ title: "Service fee deleted" });
    } catch { toast({ title: "Error deleting", variant: "destructive" }); }
    finally { setDeleting(null); }
  }

  async function markInstallment(fee: any, installment: 1 | 2) {
    const today = new Date().toISOString().split("T")[0];
    const body = installment === 1
      ? { firstInstallmentPaidAt: today }
      : { secondInstallmentPaidAt: today };
    try {
      await customFetch(`/api/service-fees/${fee.id}`, { method: "PATCH", body: JSON.stringify(body) });
      qc.invalidateQueries({ queryKey: ["service-fees"] });
      toast({ title: `Installment ${installment} marked as paid` });
    } catch { toast({ title: "Error", variant: "destructive" }); }
  }

  async function collectCommission(c: any) {
    const newCollected = toNum(c.universityCollected) + (toNum(c.universityCommissionAmount) - toNum(c.universityCollected));
    try {
      await customFetch(`/api/commissions/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ universityCollected: newCollected, status: "collected_full" }),
      });
      qc.invalidateQueries({ queryKey: ["commissions"] });
      toast({ title: "Marked as fully collected" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
  }

  const offSummary = summary?.offset || {};

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Finance</h1>
            <p className="text-slate-500 text-sm mt-0.5">Commission tracking, service fees, and Article 6 offsets</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-muted-foreground font-medium bg-primary/8 border border-primary/20 px-3 py-1.5 rounded-lg">
              Season: <span className="font-bold text-primary">{season}</span>
            </div>
            <Button variant="outline" size="icon" onClick={() => { refetchComm(); refetchFees(); }}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Building2}
            label="University Commission"
            value={fmt(summary?.commissions?.totalUniversityCommission || commSummary.totalUniversityCommission || 0)}
            sub={`${fmt(summary?.commissions?.totalUniversityCollected || commSummary.totalUniversityCollected || 0)} collected`}
            color="text-blue-600"
          />
          <StatCard
            icon={Users}
            label="Agent Commission"
            value={fmt(summary?.commissions?.totalAgentCommission || commSummary.totalAgentCommission || 0)}
            sub={`${fmt(summary?.commissions?.totalAgentPaid || commSummary.totalAgentPaid || 0)} paid`}
            color="text-amber-600"
          />
          <StatCard
            icon={TrendingUp}
            label="Net Agency Income"
            value={fmt(summary?.commissions?.totalNetAgency || commSummary.totalNetAgency || 0)}
            sub="collected − paid to agents"
            color="text-emerald-600"
          />
          <StatCard
            icon={DollarSign}
            label="Service Fees"
            value={fmt(feeSummary.totalServiceFees || 0)}
            sub={`${fmt(feeSummary.totalCollected || 0)} collected`}
            color="text-indigo-600"
          />
        </div>

        {/* Offset Banner */}
        {offSummary.availableForOffset > 0 && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 flex items-start gap-3">
            <ArrowUpRight className="w-5 h-5 text-violet-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-violet-800 text-sm">Article 6 Commission Offset Available</p>
              <p className="text-violet-600 text-sm mt-0.5">
                Up to <strong>{fmt(offSummary.availableForOffset)}</strong> of confirmed commissions can offset service fees
                for state universities ({offSummary.maxOffsetRate}% max).
                Already used: {fmt(offSummary.totalOffsetUsed)}.
              </p>
            </div>
          </div>
        )}

        {/* Main Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="commissions">
              Commissions
              <Badge className="ml-2 bg-slate-200 text-slate-600 text-xs">{commissions.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="fees">
              Service Fees
              <Badge className="ml-2 bg-slate-200 text-slate-600 text-xs">{fees.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* ── COMMISSIONS TAB ── */}
          <TabsContent value="commissions" className="mt-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Search student or university..."
                className="w-64"
                value={commSearch}
                onChange={e => setCommSearch(e.target.value)}
              />
              <Select value={commStatus} onValueChange={setCommStatus}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {Object.entries(COMM_STATUS).map(([v, { label }]) =>
                    <SelectItem key={v} value={v}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="ml-auto">
                <Button onClick={() => setCommModal({ open: true })}>
                  <Plus className="w-4 h-4 mr-1" /> New Commission
                </Button>
              </div>
            </div>

            {commLoading ? (
              <div className="text-center py-12 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Loading...
              </div>
            ) : commissions.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No commission records for {season}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Student / University</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Prog. Fee</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Univ. Commission</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Agent Commission</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Net Agency</th>
                      <th className="text-center px-4 py-3 font-semibold text-slate-600">Status</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {commissions.map((c: any) => {
                      const uAmt = toNum(c.universityCommissionAmount);
                      const aAmt = toNum(c.agentCommissionAmount);
                      const net  = uAmt - aAmt;
                      const uCollected = toNum(c.universityCollected);
                      const aPaid = toNum(c.agentPaid);
                      const status = COMM_STATUS[c.status] || COMM_STATUS.potential;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-800">{c.studentName || "—"}</div>
                            <div className="text-xs text-slate-500">{c.universityName || "—"} · {c.programName || "—"}</div>
                            {c.isStateUniversity && (
                              <Badge className="text-xs mt-0.5 bg-violet-100 text-violet-700 border-violet-200">State</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                            {c.programFee ? fmt(c.programFee, c.currency) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <div className="font-medium text-blue-700">{fmt(uAmt, c.currency)}</div>
                            <div className="text-xs text-slate-400">{c.universityCommissionRate || "—"}% · {fmt(uCollected, c.currency)} coll.</div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <div className="font-medium text-amber-700">{fmt(aAmt, c.currency)}</div>
                            <div className="text-xs text-slate-400">{c.agentCommissionRate || "—"}% · {fmt(aPaid, c.currency)} paid</div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <div className="font-semibold text-emerald-700">{fmt(net, c.currency)}</div>
                            {c.offsetAmount && toNum(c.offsetAmount) > 0 && (
                              <div className="text-xs text-violet-600">Offset: {fmt(c.offsetAmount, c.currency)}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={`text-xs border ${status.color}`}>{status.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {c.status === "confirmed" && uCollected < uAmt && (
                                <Button
                                  size="sm" variant="outline"
                                  className="text-xs h-7"
                                  onClick={() => collectCommission(c)}
                                >
                                  <CheckCircle className="w-3 h-3 mr-1" /> Collect
                                </Button>
                              )}
                              <Button
                                size="icon" variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setCommModal({
                                  open: true, id: c.id,
                                  initial: {
                                    studentName: c.studentName || "",
                                    universityName: c.universityName || "",
                                    programName: c.programName || "",
                                    season: c.season,
                                    currency: c.currency,
                                    isStateUniversity: !!c.isStateUniversity,
                                    programFee: c.programFee || "",
                                    universityCommissionRate: c.universityCommissionRate || "20",
                                    agentCommissionRate: c.agentCommissionRate || "70",
                                    status: c.status,
                                    universityCollected: c.universityCollected || "0",
                                    agentPaid: c.agentPaid || "0",
                                    offsetAmount: c.offsetAmount || "0",
                                    notes: c.notes || "",
                                  },
                                })}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon" variant="ghost"
                                className="h-7 w-7 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                                onClick={() => deleteCommission(c.id)}
                                disabled={deleting === c.id}
                              >
                                {deleting === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                    <tr>
                      <td className="px-4 py-3 text-slate-600">Totals ({commissions.length})</td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {fmt(commissions.reduce((s: number, c: any) => s + toNum(c.programFee), 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-blue-700 tabular-nums">
                        {fmt(commSummary.totalUniversityCommission || 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-700 tabular-nums">
                        {fmt(commSummary.totalAgentCommission || 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-700 tabular-nums">
                        {fmt(commSummary.totalNetAgency || 0)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── SERVICE FEES TAB ── */}
          <TabsContent value="fees" className="mt-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="text-sm text-slate-500">
                {feeSummary.pendingCount ?? 0} pending · {feeSummary.partialCount ?? 0} partial · {feeSummary.paidCount ?? 0} paid
              </div>
              <div className="ml-auto">
                <Button onClick={() => setFeeModal({ open: true })}>
                  <Plus className="w-4 h-4 mr-1" /> New Service Fee
                </Button>
              </div>
            </div>

            {feeLoading ? (
              <div className="text-center py-12 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Loading...
              </div>
            ) : fees.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No service fees for {season}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Student / University</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Payer</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Total</th>
                      <th className="text-center px-4 py-3 font-semibold text-slate-600">1st Installment (50%)</th>
                      <th className="text-center px-4 py-3 font-semibold text-slate-600">2nd Installment (50%)</th>
                      <th className="text-center px-4 py-3 font-semibold text-slate-600">Status</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fees.map((f: any) => {
                      const status = FEE_STATUS[f.status] || FEE_STATUS.pending;
                      const half = toNum(f.totalAmount) / 2;
                      return (
                        <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-800">{f.studentName || "—"}</div>
                            <div className="text-xs text-slate-500">{f.universityName || "—"}</div>
                            {f.isStateUniversity && (
                              <Badge className="text-xs mt-0.5 bg-violet-100 text-violet-700 border-violet-200">State</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600 capitalize">{f.payerType}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">
                            {fmt(f.totalAmount, f.currency)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {f.firstInstallmentPaidAt ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <CheckCircle className="w-4 h-4 text-green-600" />
                                <span className="text-xs text-slate-400">{f.firstInstallmentPaidAt}</span>
                              </div>
                            ) : (
                              <Button
                                size="sm" variant="outline"
                                className="text-xs h-7 text-amber-700 border-amber-300 hover:bg-amber-50"
                                onClick={() => markInstallment(f, 1)}
                              >
                                {fmt(half, f.currency)} — Mark Paid
                              </Button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {f.secondInstallmentPaidAt ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <CheckCircle className="w-4 h-4 text-green-600" />
                                <span className="text-xs text-slate-400">{f.secondInstallmentPaidAt}</span>
                              </div>
                            ) : (
                              <Button
                                size="sm" variant="outline"
                                className="text-xs h-7 text-amber-700 border-amber-300 hover:bg-amber-50"
                                onClick={() => markInstallment(f, 2)}
                                disabled={!f.firstInstallmentPaidAt}
                              >
                                {fmt(half, f.currency)} — Mark Paid
                              </Button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={`text-xs border ${status.color}`}>{status.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon" variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setFeeModal({
                                  open: true, id: f.id,
                                  initial: {
                                    studentName: f.studentName || "",
                                    universityName: f.universityName || "",
                                    isStateUniversity: !!f.isStateUniversity,
                                    payerType: f.payerType,
                                    season: f.season,
                                    currency: f.currency,
                                    totalAmount: f.totalAmount || "",
                                    firstInstallmentPaidAt: f.firstInstallmentPaidAt || "",
                                    secondInstallmentPaidAt: f.secondInstallmentPaidAt || "",
                                    notes: f.notes || "",
                                  },
                                })}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon" variant="ghost"
                                className="h-7 w-7 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                                onClick={() => deleteServiceFee(f.id)}
                                disabled={deleting === f.id}
                              >
                                {deleting === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 text-slate-600">Totals ({fees.length})</td>
                      <td className="px-4 py-3 text-right text-slate-800 tabular-nums">
                        {fmt(feeSummary.totalServiceFees || 0)}
                      </td>
                      <td colSpan={4} className="px-4 py-3 text-right text-emerald-700 tabular-nums">
                        Collected: {fmt(feeSummary.totalCollected || 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Modals */}
      {commModal.open && (
        <CommissionModal
          open={commModal.open}
          onClose={() => setCommModal({ open: false })}
          initial={commModal.initial}
          editId={commModal.id}
        />
      )}
      {feeModal.open && (
        <ServiceFeeModal
          open={feeModal.open}
          onClose={() => setFeeModal({ open: false })}
          initial={feeModal.initial}
          editId={feeModal.id}
        />
      )}
    </DashboardLayout>
  );
}
