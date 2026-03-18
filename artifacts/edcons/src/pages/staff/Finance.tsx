import { useState, useMemo, useCallback, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSeason } from "@/contexts/SeasonContext";
import {
  useListCommissions, useListServiceFees, useGetFinanceSummary,
  customFetch,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Upload, FileText, Download, BarChart3, AlertTriangle, Calendar,
  Landmark, CreditCard, PiggyBank, Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

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

function FinanceStatCard({ icon: Icon, label, rows, color = "text-indigo-600", borderColor = "border-t-blue-500" }: {
  icon: any; label: string; rows: { label: string; value: string }[]; color?: string; borderColor?: string;
}) {
  return (
    <Card className={`border-t-2 ${borderColor}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className={`p-1.5 rounded-md bg-slate-50 ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">{label}</p>
        </div>
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{row.label}</span>
              <span className="text-sm font-bold text-slate-800">{row.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressBar({ value, max, color = "bg-blue-500" }: { value: number; max: number; color?: string }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full bg-slate-100 rounded-full h-2 mt-1">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${p}%` }} />
    </div>
  );
}

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
        await customFetch(`${BASE}/api/commissions/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await customFetch(`${BASE}/api/commissions`, { method: "POST", body: JSON.stringify(body) });
      }
      qc.invalidateQueries({ queryKey: ["commissions"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      qc.invalidateQueries({ queryKey: ["university-breakdown"] });
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
                  <div className="text-xs text-emerald-600 font-medium">Net Income</div>
                  <div className="font-bold text-emerald-700">{fmt(netAgency, form.currency)}</div>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>University Collected</Label>
            <Input type="number" value={form.universityCollected} onChange={set("universityCollected")} placeholder="0" />
          </div>
          <div>
            <Label>Agent Paid Out</Label>
            <Input type="number" value={form.agentPaid} onChange={set("agentPaid")} placeholder="0" />
          </div>

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
        await customFetch(`${BASE}/api/service-fees/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await customFetch(`${BASE}/api/service-fees`, { method: "POST", body: JSON.stringify(body) });
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

function TransactionModal({
  open, onClose, type, commissionId, commissionLabel, universityName,
}: {
  open: boolean; onClose: () => void;
  type: "collection" | "agent_payment";
  commissionId?: number;
  commissionLabel?: string;
  universityName?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [reference, setReference] = useState("");
  const [agentName, setAgentName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFile(): Promise<{ url: string; name: string } | null> {
    if (!file) return null;
    setUploading(true);
    try {
      const data: any = await customFetch(`${BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      const putResp = await fetch(data.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putResp.ok) {
        console.error("Upload PUT failed:", putResp.status);
        return null;
      }
      return { url: `${BASE}/api/storage/objects/${data.objectPath.replace(/^\/objects\//, "")}`, name: file.name };
    } catch (e) {
      console.error("Upload error:", e);
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!amount || !date) {
      toast({ title: "Amount and date are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let fileUrl = null;
      let fileName = null;
      if (file) {
        const uploaded = await uploadFile();
        if (uploaded) {
          fileUrl = uploaded.url;
          fileName = uploaded.name;
        }
      }
      await customFetch(`${BASE}/api/financial-transactions`, {
        method: "POST",
        body: JSON.stringify({
          commissionId: commissionId || null,
          type,
          amount: toNum(amount),
          transactionDate: date,
          reference: reference || null,
          universityName: universityName || null,
          agentName: type === "agent_payment" ? agentName || null : null,
          fileUrl, fileName,
          notes: notes || null,
        }),
      });
      qc.invalidateQueries({ queryKey: ["commissions"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      qc.invalidateQueries({ queryKey: ["financial-transactions"] });
      qc.invalidateQueries({ queryKey: ["university-breakdown"] });
      toast({ title: type === "collection" ? "Collection recorded" : "Agent payment recorded" });
      onClose();
    } catch { toast({ title: "Error saving transaction", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  const isCollection = type === "collection";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isCollection ? "Record University Collection" : "Record Agent Payment"}
          </DialogTitle>
        </DialogHeader>
        {commissionLabel && (
          <p className="text-sm text-slate-500 -mt-2">For: <span className="font-medium text-slate-700">{commissionLabel}</span></p>
        )}
        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <Label>Amount</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Reference / Invoice #</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="INV-2025-001" />
          </div>
          {!isCollection && (
            <div className="col-span-2">
              <Label>Agent Name</Label>
              <Input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Agent name" />
            </div>
          )}
          <div className="col-span-2">
            <Label>Attach Document (Invoice / Receipt)</Label>
            <div
              className="mt-1 border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span className="font-medium text-slate-700">{file.name}</span>
                  <span className="text-slate-400">({(file.size / 1024).toFixed(0)} KB)</span>
                </div>
              ) : (
                <div className="text-slate-400 text-sm">
                  <Upload className="w-5 h-5 mx-auto mb-1" />
                  Click to upload PDF, image, or document
                </div>
              )}
            </div>
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || uploading}>
            {(saving || uploading) ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {uploading ? "Uploading..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransactionHistory({ commissionId }: { commissionId: number }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["financial-transactions", commissionId],
    queryFn: () => customFetch<any>(`${BASE}/api/financial-transactions?commissionId=${commissionId}`),
    enabled: open,
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const transactions: any[] = data?.data || [];

  async function deleteTx(id: number) {
    try {
      await customFetch(`${BASE}/api/financial-transactions/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["financial-transactions", commissionId] });
      qc.invalidateQueries({ queryKey: ["commissions"] });
      qc.invalidateQueries({ queryKey: ["university-breakdown"] });
      toast({ title: "Transaction deleted" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
  }

  return (
    <>
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setOpen(true)} title="View transactions">
        <Eye className="w-3.5 h-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transaction History</DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No transactions recorded yet</p>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx: any) => (
                <div key={tx.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50">
                  <div className={`p-1.5 rounded ${tx.type === "collection" ? "bg-blue-100 text-blue-600" : "bg-amber-100 text-amber-600"}`}>
                    {tx.type === "collection" ? <Landmark className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-slate-800">{fmt(tx.amount, tx.currency)}</span>
                      <span className="text-xs text-slate-400">{tx.transactionDate}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {tx.type === "collection" ? "University Collection" : `Agent Payment${tx.agentName ? ` — ${tx.agentName}` : ""}`}
                    </p>
                    {tx.reference && <p className="text-xs text-slate-400">Ref: {tx.reference}</p>}
                    {tx.fileName && (
                      <a
                        href={tx.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-0.5"
                      >
                        <FileText className="w-3 h-3" /> {tx.fileName}
                      </a>
                    )}
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-rose-400 hover:text-rose-600" onClick={() => deleteTx(tx.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function FinancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { season } = useSeason();
  const [tab, setTab] = useState("commissions");
  const [commSearch, setCommSearch] = useState("");
  const [commStatus, setCommStatus] = useState("all");

  const [commModal, setCommModal] = useState<{ open: boolean; id?: number; initial?: CommissionForm }>({ open: false });
  const [feeModal, setFeeModal] = useState<{ open: boolean; id?: number; initial?: ServiceFeeForm }>({ open: false });
  const [txModal, setTxModal] = useState<{
    open: boolean; type: "collection" | "agent_payment";
    commissionId?: number; commissionLabel?: string; universityName?: string;
  }>({ open: false, type: "collection" });
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

  const { data: uniBreakdownData } = useQuery({
    queryKey: ["university-breakdown", season],
    queryFn: () => customFetch<any>(`${BASE}/api/finance/university-breakdown?season=${season}`),
  });

  const commissions: any[] = (commResp as any)?.data || [];
  const commSummary: any = (commResp as any)?.summary || {};
  const fees: any[] = (feeResp as any)?.data || [];
  const feeSummary: any = (feeResp as any)?.summary || {};
  const summary: any = summaryData || {};
  const uniBreakdown: any[] = uniBreakdownData?.breakdown || [];
  const uniTotals: any = uniBreakdownData?.totals || {};

  async function deleteCommission(id: number) {
    setDeleting(id);
    try {
      await customFetch(`${BASE}/api/commissions/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["commissions"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      qc.invalidateQueries({ queryKey: ["university-breakdown"] });
      toast({ title: "Commission deleted" });
    } catch { toast({ title: "Error deleting", variant: "destructive" }); }
    finally { setDeleting(null); }
  }

  async function deleteServiceFee(id: number) {
    setDeleting(id);
    try {
      await customFetch(`${BASE}/api/service-fees/${id}`, { method: "DELETE" });
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
      await customFetch(`${BASE}/api/service-fees/${fee.id}`, { method: "PATCH", body: JSON.stringify(body) });
      qc.invalidateQueries({ queryKey: ["service-fees"] });
      toast({ title: `Installment ${installment} marked as paid` });
    } catch { toast({ title: "Error", variant: "destructive" }); }
  }

  const overdueCommissions = useMemo(() => {
    return commissions.filter(c => {
      if (c.status === "potential") return false;
      const uAmt = toNum(c.universityCommissionAmount);
      const uColl = toNum(c.universityCollected);
      if (uColl >= uAmt) return false;
      if (!c.confirmedAt) return false;
      const daysSince = (Date.now() - new Date(c.confirmedAt).getTime()) / (1000 * 60 * 60 * 24);
      return daysSince > 90;
    });
  }, [commissions]);

  const agingSummary = useMemo(() => {
    const bins = { current: 0, days30: 0, days60: 0, days90plus: 0 };
    commissions.forEach(c => {
      if (c.status === "potential") return;
      const remaining = toNum(c.universityCommissionAmount) - toNum(c.universityCollected);
      if (remaining <= 0) return;
      if (!c.confirmedAt) { bins.current += remaining; return; }
      const days = (Date.now() - new Date(c.confirmedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days <= 30) bins.current += remaining;
      else if (days <= 60) bins.days30 += remaining;
      else if (days <= 90) bins.days60 += remaining;
      else bins.days90plus += remaining;
    });
    return bins;
  }, [commissions]);

  const cs = summary?.commissions || {};
  const collectionRate = pct(
    toNum(cs?.totalUniversityCollected || 0),
    toNum(cs?.totalUniversityCommission || 0)
  );

  const offSummary = summary?.offset || {};

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Finance</h1>
            <p className="text-slate-500 text-sm mt-0.5">Commission tracking, collections, agent payments & analytics</p>
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

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <FinanceStatCard
            icon={Clock}
            label="Potential Commission"
            borderColor="border-t-amber-400"
            color="text-amber-600"
            rows={[
              { label: "Agency", value: fmt(cs?.potentialAgentCommission || 0) },
              { label: "Our Commission", value: fmt((toNum(cs?.potentialUniversityCommission) - toNum(cs?.potentialAgentCommission)) || 0) },
            ]}
          />
          <FinanceStatCard
            icon={CheckCircle}
            label="Confirmed Commission"
            borderColor="border-t-blue-500"
            color="text-blue-600"
            rows={[
              { label: "Agency", value: fmt(cs?.confirmedAgentCommission || 0) },
              { label: "Our Commission", value: fmt((toNum(cs?.confirmedUniversityCommission) - toNum(cs?.confirmedAgentCommission)) || 0) },
            ]}
          />
          <FinanceStatCard
            icon={CreditCard}
            label="Commission Paid"
            borderColor="border-t-emerald-500"
            color="text-emerald-600"
            rows={[
              { label: "Paid (To agents)", value: fmt(cs?.paidToAgents || 0) },
              { label: "Collected (From unis)", value: fmt(cs?.collectedFromUniversities || 0) },
            ]}
          />
          <FinanceStatCard
            icon={AlertCircle}
            label="Pending Commission"
            borderColor="border-t-rose-400"
            color="text-rose-600"
            rows={[
              { label: "Pending (To pay)", value: fmt(cs?.pendingToPay || 0) },
              { label: "Pending (To get)", value: fmt(cs?.pendingToCollect || 0) },
            ]}
          />
          <FinanceStatCard
            icon={DollarSign}
            label="Service Fees"
            borderColor="border-t-indigo-500"
            color="text-indigo-600"
            rows={[
              { label: "Confirmed", value: fmt(feeSummary.totalServiceFees || 0) },
              { label: "Collected", value: fmt(feeSummary.totalCollected || 0) },
            ]}
          />
        </div>

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

        {overdueCommissions.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-rose-800 text-sm">
                {overdueCommissions.length} Overdue Collection{overdueCommissions.length > 1 ? "s" : ""} (90+ days)
              </p>
              <p className="text-rose-600 text-sm mt-0.5">
                Total overdue: <strong>{fmt(overdueCommissions.reduce((s, c) => s + toNum(c.universityCommissionAmount) - toNum(c.universityCollected), 0))}</strong>
                {" "} — {overdueCommissions.map(c => c.universityName).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
              </p>
            </div>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="commissions">
              Commissions
              <Badge className="ml-2 bg-slate-200 text-slate-600 text-xs">{commissions.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="universities">
              University Breakdown
              <Badge className="ml-2 bg-slate-200 text-slate-600 text-xs">{uniBreakdown.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="fees">
              Service Fees
              <Badge className="ml-2 bg-slate-200 text-slate-600 text-xs">{fees.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="analytics">
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* COMMISSIONS TAB */}
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
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" onClick={() => setTxModal({ open: true, type: "collection" })}>
                  <Landmark className="w-4 h-4 mr-1" /> Record Collection
                </Button>
                <Button variant="outline" onClick={() => setTxModal({ open: true, type: "agent_payment" })}>
                  <CreditCard className="w-4 h-4 mr-1" /> Record Agent Payment
                </Button>
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
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Net Income</th>
                      <th className="text-center px-4 py-3 font-semibold text-slate-600">Collection</th>
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
                      const uRemaining = uAmt - uCollected;
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
                            <div className="text-xs text-slate-400">{c.universityCommissionRate || "—"}%</div>
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
                          <td className="px-4 py-3">
                            <div className="w-24 mx-auto">
                              <div className="flex justify-between text-xs text-slate-500 mb-0.5">
                                <span>{fmt(uCollected, c.currency)}</span>
                                <span>{pct(uCollected, uAmt)}%</span>
                              </div>
                              <ProgressBar value={uCollected} max={uAmt} color={uCollected >= uAmt ? "bg-green-500" : "bg-blue-500"} />
                              {uRemaining > 0 && (
                                <div className="text-xs text-slate-400 mt-0.5 text-center">{fmt(uRemaining, c.currency)} left</div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={`text-xs border ${status.color}`}>{status.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {c.status !== "potential" && uCollected < uAmt && (
                                <Button
                                  size="sm" variant="outline"
                                  className="text-xs h-7"
                                  onClick={() => setTxModal({
                                    open: true, type: "collection",
                                    commissionId: c.id,
                                    commissionLabel: `${c.studentName || "—"} — ${c.universityName || "—"}`,
                                    universityName: c.universityName,
                                  })}
                                >
                                  <Landmark className="w-3 h-3 mr-1" /> Collect
                                </Button>
                              )}
                              {c.status !== "potential" && aPaid < aAmt && (
                                <Button
                                  size="sm" variant="outline"
                                  className="text-xs h-7"
                                  onClick={() => setTxModal({
                                    open: true, type: "agent_payment",
                                    commissionId: c.id,
                                    commissionLabel: `${c.studentName || "—"} — ${c.universityName || "—"}`,
                                    universityName: c.universityName,
                                  })}
                                >
                                  <CreditCard className="w-3 h-3 mr-1" /> Pay Agent
                                </Button>
                              )}
                              <TransactionHistory commissionId={c.id} />
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
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </TabsContent>

          {/* UNIVERSITY BREAKDOWN TAB */}
          <TabsContent value="universities" className="mt-4 space-y-4">
            {uniBreakdown.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No university data for {season}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-blue-600 font-medium uppercase">Total Receivable</p>
                      <p className="text-xl font-bold text-blue-700">{fmt(uniTotals.totalCommission)}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-green-50 border-green-200">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-green-600 font-medium uppercase">Total Collected</p>
                      <p className="text-xl font-bold text-green-700">{fmt(uniTotals.totalCollected)}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-amber-50 border-amber-200">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-amber-600 font-medium uppercase">Agent Payouts</p>
                      <p className="text-xl font-bold text-amber-700">{fmt(uniTotals.totalAgentPaid)}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-emerald-50 border-emerald-200">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-emerald-600 font-medium uppercase">Net Income</p>
                      <p className="text-xl font-bold text-emerald-700">{fmt(uniTotals.totalNetIncome)}</p>
                    </CardContent>
                  </Card>
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">University</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600">Total Commission</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600">Collected</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600">Remaining</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600">Agent Payout</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600">Net Income</th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-600">Collection %</th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-600">Students</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {uniBreakdown.map((u: any) => {
                        const collPct = pct(u.totalCollected, u.totalCommission);
                        const isOverdue = u.oldestUnpaid && ((Date.now() - new Date(u.oldestUnpaid).getTime()) / (1000 * 60 * 60 * 24) > 90);
                        return (
                          <tr key={u.universityName} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-800 flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-slate-400" />
                                {u.universityName}
                                {isOverdue && (
                                  <Badge className="text-xs bg-rose-100 text-rose-700 border-rose-200">Overdue</Badge>
                                )}
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">{u.commissionCount} commission{u.commissionCount !== 1 ? "s" : ""}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-blue-700 tabular-nums">
                              {fmt(u.totalCommission)}
                            </td>
                            <td className="px-4 py-3 text-right text-green-700 tabular-nums">
                              {fmt(u.totalCollected)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              <span className={u.totalRemaining > 0 ? "text-rose-600 font-medium" : "text-slate-400"}>
                                {fmt(u.totalRemaining)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-amber-700 tabular-nums">
                              <div>{fmt(u.totalAgentPaid)}</div>
                              {u.totalAgentRemaining > 0 && (
                                <div className="text-xs text-slate-400">{fmt(u.totalAgentRemaining)} unpaid</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-emerald-700 tabular-nums">
                              {fmt(u.netIncome)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="w-20 mx-auto">
                                <div className="text-xs text-center text-slate-500 mb-0.5">{collPct}%</div>
                                <ProgressBar
                                  value={u.totalCollected}
                                  max={u.totalCommission}
                                  color={collPct >= 100 ? "bg-green-500" : collPct >= 50 ? "bg-blue-500" : "bg-amber-500"}
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center text-slate-600">{u.studentCount}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                      <tr>
                        <td className="px-4 py-3 text-slate-600">{uniBreakdown.length} Universities</td>
                        <td className="px-4 py-3 text-right text-blue-700 tabular-nums">{fmt(uniTotals.totalCommission)}</td>
                        <td className="px-4 py-3 text-right text-green-700 tabular-nums">{fmt(uniTotals.totalCollected)}</td>
                        <td className="px-4 py-3 text-right text-rose-600 tabular-nums">{fmt(uniTotals.totalRemaining)}</td>
                        <td className="px-4 py-3 text-right text-amber-700 tabular-nums">{fmt(uniTotals.totalAgentPaid)}</td>
                        <td className="px-4 py-3 text-right text-emerald-700 tabular-nums">{fmt(uniTotals.totalNetIncome)}</td>
                        <td className="px-4 py-3 text-center text-slate-600">
                          {pct(uniTotals.totalCollected, uniTotals.totalCommission)}%
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </TabsContent>

          {/* SERVICE FEES TAB */}
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

          {/* ANALYTICS TAB */}
          <TabsContent value="analytics" className="mt-4 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-600" /> Receivables Aging
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { label: "Current (0-30 days)", value: agingSummary.current, color: "bg-green-500" },
                      { label: "31-60 days", value: agingSummary.days30, color: "bg-amber-500" },
                      { label: "61-90 days", value: agingSummary.days60, color: "bg-orange-500" },
                      { label: "90+ days (Overdue)", value: agingSummary.days90plus, color: "bg-rose-500" },
                    ].map(bin => {
                      const total = agingSummary.current + agingSummary.days30 + agingSummary.days60 + agingSummary.days90plus;
                      return (
                        <div key={bin.label}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-600">{bin.label}</span>
                            <span className="font-semibold text-slate-800">{fmt(bin.value)}</span>
                          </div>
                          <ProgressBar value={bin.value} max={total || 1} color={bin.color} />
                        </div>
                      );
                    })}
                    <div className="pt-2 border-t border-slate-100 flex justify-between text-sm font-semibold">
                      <span className="text-slate-600">Total Receivable</span>
                      <span className="text-slate-800">
                        {fmt(agingSummary.current + agingSummary.days30 + agingSummary.days60 + agingSummary.days90plus)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <PiggyBank className="w-4 h-4 text-emerald-600" /> Cash Flow Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                        <p className="text-xs text-blue-600 font-medium uppercase">Inflow (Collected)</p>
                        <p className="text-lg font-bold text-blue-700">
                          {fmt(summary?.commissions?.totalUniversityCollected || 0)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-center">
                        <p className="text-xs text-amber-600 font-medium uppercase">Outflow (Agent Paid)</p>
                        <p className="text-lg font-bold text-amber-700">
                          {fmt(summary?.commissions?.totalAgentPaid || 0)}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
                      <p className="text-xs text-emerald-600 font-medium uppercase">Net Cash Position</p>
                      <p className="text-2xl font-bold text-emerald-700">
                        {fmt((toNum(summary?.commissions?.totalUniversityCollected) + toNum(summary?.serviceFees?.collected)) - toNum(summary?.commissions?.totalAgentPaid))}
                      </p>
                      <p className="text-xs text-emerald-500 mt-1">Includes service fee collections</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Expected (Unconfirmed)</span>
                        <span className="text-slate-700">{fmt(summary?.commissions?.totalUniversityCommission ? (toNum(summary.commissions.totalUniversityCommission) - toNum(summary.commissions.totalUniversityCollected)) : 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Agent Payable</span>
                        <span className="text-slate-700">{fmt(summary?.commissions?.totalAgentPending || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Service Fee Pending</span>
                        <span className="text-slate-700">{fmt(toNum(summary?.serviceFees?.total) - toNum(summary?.serviceFees?.collected))}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-600" /> Top Universities by Commission
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {uniBreakdown.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">No data</p>
                  ) : (
                    <div className="space-y-3">
                      {uniBreakdown.slice(0, 5).map((u: any, i: number) => (
                        <div key={u.universityName}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-600 truncate mr-2">{i + 1}. {u.universityName}</span>
                            <span className="font-semibold text-slate-800 shrink-0">{fmt(u.totalCommission)}</span>
                          </div>
                          <ProgressBar value={u.totalCommission} max={uniBreakdown[0]?.totalCommission || 1} color="bg-indigo-500" />
                          <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                            <span>{u.commissionCount} students</span>
                            <span>Net: {fmt(u.netIncome)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-violet-600" /> Commission Status Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(COMM_STATUS).map(([key, { label, color }]) => {
                      const count = commissions.filter(c => c.status === key).length;
                      const amount = commissions.filter(c => c.status === key).reduce((s, c) => s + toNum(c.universityCommissionAmount), 0);
                      return (
                        <div key={key} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs border ${color}`}>{label}</Badge>
                            <span className="text-sm text-slate-500">{count}</span>
                          </div>
                          <span className="font-semibold text-sm text-slate-800 tabular-nums">{fmt(amount)}</span>
                        </div>
                      );
                    })}
                    <div className="pt-2 border-t border-slate-100 flex justify-between text-sm font-semibold">
                      <span className="text-slate-600">Total</span>
                      <span className="text-slate-800">{fmt(commissions.reduce((s: number, c: any) => s + toNum(c.universityCommissionAmount), 0))}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

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
      {txModal.open && (
        <TransactionModal
          open={txModal.open}
          onClose={() => setTxModal({ open: false, type: "collection" })}
          type={txModal.type}
          commissionId={txModal.commissionId}
          commissionLabel={txModal.commissionLabel}
          universityName={txModal.universityName}
        />
      )}
    </DashboardLayout>
  );
}
