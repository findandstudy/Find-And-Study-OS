import { useState, useEffect, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Plus, Search, Edit, Trash2, X, Loader2, Save,
  Building2, Mail, Phone, MapPin, Upload, Eye, EyeOff,
  ChevronLeft, ChevronRight, UserPlus, Network,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const MANAGER_ROLES = ["super_admin", "admin", "manager"];
const CATEGORIES = ["Big", "Medium", "Small"];

const PHONE_CODES = [
  { code: "+90", country: "TR", flag: "🇹🇷" },
  { code: "+1", country: "US", flag: "🇺🇸" },
  { code: "+44", country: "GB", flag: "🇬🇧" },
  { code: "+49", country: "DE", flag: "🇩🇪" },
  { code: "+33", country: "FR", flag: "🇫🇷" },
  { code: "+971", country: "AE", flag: "🇦🇪" },
  { code: "+966", country: "SA", flag: "🇸🇦" },
  { code: "+91", country: "IN", flag: "🇮🇳" },
  { code: "+86", country: "CN", flag: "🇨🇳" },
  { code: "+81", country: "JP", flag: "🇯🇵" },
  { code: "+82", country: "KR", flag: "🇰🇷" },
  { code: "+55", country: "BR", flag: "🇧🇷" },
  { code: "+234", country: "NG", flag: "🇳🇬" },
  { code: "+20", country: "EG", flag: "🇪🇬" },
  { code: "+254", country: "KE", flag: "🇰🇪" },
  { code: "+27", country: "ZA", flag: "🇿🇦" },
  { code: "+62", country: "ID", flag: "🇮🇩" },
  { code: "+60", country: "MY", flag: "🇲🇾" },
  { code: "+63", country: "PH", flag: "🇵🇭" },
  { code: "+92", country: "PK", flag: "🇵🇰" },
  { code: "+880", country: "BD", flag: "🇧🇩" },
  { code: "+7", country: "RU", flag: "🇷🇺" },
  { code: "+380", country: "UA", flag: "🇺🇦" },
  { code: "+48", country: "PL", flag: "🇵🇱" },
  { code: "+39", country: "IT", flag: "🇮🇹" },
  { code: "+34", country: "ES", flag: "🇪🇸" },
  { code: "+31", country: "NL", flag: "🇳🇱" },
  { code: "+46", country: "SE", flag: "🇸🇪" },
  { code: "+47", country: "NO", flag: "🇳🇴" },
  { code: "+358", country: "FI", flag: "🇫🇮" },
  { code: "+212", country: "MA", flag: "🇲🇦" },
  { code: "+216", country: "TN", flag: "🇹🇳" },
  { code: "+213", country: "DZ", flag: "🇩🇿" },
  { code: "+964", country: "IQ", flag: "🇮🇶" },
  { code: "+962", country: "JO", flag: "🇯🇴" },
  { code: "+961", country: "LB", flag: "🇱🇧" },
  { code: "+994", country: "AZ", flag: "🇦🇿" },
  { code: "+995", country: "GE", flag: "🇬🇪" },
  { code: "+998", country: "UZ", flag: "🇺🇿" },
  { code: "+993", country: "TM", flag: "🇹🇲" },
];

type Agent = {
  id: number;
  userId: number | null;
  parentAgentId: number | null;
  agencyCode: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  companyName: string | null;
  businessName: string | null;
  category: string | null;
  commissionRate: number | null;
  subAgentCommissionRate: number | null;
  hideServiceFees: boolean;
  status: string;
  logoUrl: string | null;
  agentIdProofUrl: string | null;
  businessCertUrl: string | null;
  branch: string | null;
  pointOfContact: string | null;
  notes: string | null;
  createdAt: string;
};

const emptyForm = {
  agencyCode: "", firstName: "", lastName: "", email: "", phone: "", phoneCode: "+90",
  country: "", state: "", city: "", address: "",
  businessName: "", category: "", commissionRate: "",
  logoUrl: "", agentIdProofUrl: "", businessCertUrl: "",
  branch: "", pointOfContact: "", notes: "",
  parentAgentId: "", subAgentCommissionRate: "", hideServiceFees: false,
};

function splitPhone(phone: string | null) {
  if (!phone) return { code: "+90", number: "" };
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const pc of sorted) {
    if (phone.startsWith(pc.code)) {
      return { code: pc.code, number: phone.slice(pc.code.length).trim() };
    }
  }
  return { code: "+90", number: phone };
}

export default function AgentsPage() {
  const { user } = useAuth(true);
  const { toast } = useToast();
  const isManager = MANAGER_ROLES.includes(user?.role || "");

  const [activeTab, setActiveTab] = useState("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [subAgents, setSubAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [subSearch, setSubSearch] = useState("");
  const [page, setPage] = useState(1);
  const [subPage, setSubPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [subTotalPages, setSubTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [subTotal, setSubTotal] = useState(0);

  const [showDialog, setShowDialog] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isSubAgent, setIsSubAgent] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [idProofUploading, setIdProofUploading] = useState(false);
  const [certUploading, setCertUploading] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const idProofRef = useRef<HTMLInputElement>(null);
  const certRef = useRef<HTMLInputElement>(null);

  const [parentAgents, setParentAgents] = useState<Agent[]>([]);

  async function fetchAgents() {
    setLoading(true);
    try {
      const res = await customFetch(`/api/agents?type=agent&page=${page}&limit=20&search=${encodeURIComponent(search)}`);
      setAgents(res.data);
      setTotal(res.meta.total);
      setTotalPages(res.meta.totalPages);
    } catch {}
    setLoading(false);
  }

  async function fetchSubAgents() {
    try {
      const res = await customFetch(`/api/agents?type=sub_agent&page=${subPage}&limit=20&search=${encodeURIComponent(subSearch)}`);
      setSubAgents(res.data);
      setSubTotal(res.meta.total);
      setSubTotalPages(res.meta.totalPages);
    } catch {}
  }

  async function fetchParentAgents() {
    try {
      const res = await customFetch(`/api/agents?type=agent&limit=100`);
      setParentAgents(res.data);
    } catch {}
  }

  useEffect(() => { fetchAgents(); }, [page, search]);
  useEffect(() => { fetchSubAgents(); }, [subPage, subSearch]);
  useEffect(() => { fetchParentAgents(); }, []);

  function openCreate(isSub: boolean) {
    setEditingAgent(null);
    setIsSubAgent(isSub);
    setForm({ ...emptyForm });
    setShowDialog(true);
  }

  function openEdit(agent: Agent) {
    setEditingAgent(agent);
    setIsSubAgent(!!agent.parentAgentId);
    const { code, number } = splitPhone(agent.phone);
    setForm({
      agencyCode: agent.agencyCode || "",
      firstName: agent.firstName,
      lastName: agent.lastName,
      email: agent.email || "",
      phone: number,
      phoneCode: code,
      country: agent.country || "",
      state: agent.state || "",
      city: agent.city || "",
      address: agent.address || "",
      businessName: agent.businessName || "",
      category: agent.category || "",
      commissionRate: agent.commissionRate?.toString() || "",
      logoUrl: agent.logoUrl || "",
      agentIdProofUrl: agent.agentIdProofUrl || "",
      businessCertUrl: agent.businessCertUrl || "",
      branch: agent.branch || "",
      pointOfContact: agent.pointOfContact || "",
      notes: agent.notes || "",
      parentAgentId: agent.parentAgentId?.toString() || "",
      subAgentCommissionRate: agent.subAgentCommissionRate?.toString() || "",
      hideServiceFees: agent.hideServiceFees,
    });
    setShowDialog(true);
  }

  async function uploadFile(file: File, field: string, setUploading: (v: boolean) => void) {
    setUploading(true);
    try {
      const urlRes = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.uploadURL) throw new Error("No upload URL");
      const putRes = await fetch(urlRes.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Upload failed");
      const publicUrl = `${BASE_URL}/api/storage/objects${urlRes.objectPath}`;
      setForm(f => ({ ...f, [field]: publicUrl }));
      toast({ title: "File uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "Error", description: "First Name and Last Name are required.", variant: "destructive" });
      return;
    }
    if (!form.email.trim()) {
      toast({ title: "Error", description: "Email is required.", variant: "destructive" });
      return;
    }
    if (isSubAgent && !form.parentAgentId) {
      toast({ title: "Error", description: "Parent Agent is required for sub-agents.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const phone = form.phone.trim() ? `${form.phoneCode}${form.phone.trim()}` : "";
    const body: Record<string, any> = {
      agencyCode: form.agencyCode.trim() || null,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: phone || null,
      country: form.country.trim() || null,
      state: form.state.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      businessName: form.businessName.trim() || null,
      category: form.category || null,
      commissionRate: form.commissionRate ? parseFloat(form.commissionRate) : null,
      logoUrl: form.logoUrl || null,
      agentIdProofUrl: form.agentIdProofUrl || null,
      businessCertUrl: form.businessCertUrl || null,
      branch: form.branch.trim() || null,
      pointOfContact: form.pointOfContact.trim() || null,
      notes: form.notes.trim() || null,
      parentAgentId: isSubAgent && form.parentAgentId ? parseInt(form.parentAgentId) : null,
      subAgentCommissionRate: form.subAgentCommissionRate ? parseFloat(form.subAgentCommissionRate) : null,
      hideServiceFees: form.hideServiceFees,
    };

    try {
      if (editingAgent) {
        await customFetch(`/api/agents/${editingAgent.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        toast({ title: "Agent updated" });
      } else {
        await customFetch(`/api/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        toast({ title: isSubAgent ? "Sub-agent created" : "Agent created" });
      }
      setShowDialog(false);
      fetchAgents();
      fetchSubAgents();
      fetchParentAgents();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Are you sure you want to delete this agent?")) return;
    try {
      await customFetch(`/api/agents/${id}`, { method: "DELETE" });
      toast({ title: "Agent deleted" });
      fetchAgents();
      fetchSubAgents();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  function getParentName(parentId: number | null) {
    if (!parentId) return "-";
    const p = parentAgents.find(a => a.id === parentId);
    return p ? `${p.firstName} ${p.lastName}` : `#${parentId}`;
  }

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      active: "bg-green-500/10 text-green-600 border-green-200",
      inactive: "bg-gray-500/10 text-gray-600 border-gray-200",
      suspended: "bg-red-500/10 text-red-600 border-red-200",
    };
    return colors[s] || "bg-gray-500/10 text-gray-600 border-gray-200";
  };

  function AgentTable({ data, showParent }: { data: Agent[]; showParent?: boolean }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 text-left">
              <th className="py-3 px-3 font-semibold text-muted-foreground">Agent</th>
              <th className="py-3 px-3 font-semibold text-muted-foreground">Contact</th>
              {showParent && <th className="py-3 px-3 font-semibold text-muted-foreground">Parent Agent</th>}
              <th className="py-3 px-3 font-semibold text-muted-foreground">Category</th>
              <th className="py-3 px-3 font-semibold text-muted-foreground">Commission %</th>
              <th className="py-3 px-3 font-semibold text-muted-foreground">Status</th>
              {isManager && <th className="py-3 px-3 font-semibold text-muted-foreground text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={showParent ? 7 : 6} className="py-12 text-center text-muted-foreground">No agents found</td></tr>
            ) : data.map(a => (
              <tr key={a.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                <td className="py-3 px-3">
                  <div className="flex items-center gap-3">
                    {a.logoUrl ? (
                      <img src={a.logoUrl} alt="" className="w-9 h-9 rounded-lg object-cover border border-border" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-primary/20 to-accent/20 flex items-center justify-center font-bold text-xs text-primary">
                        {a.firstName[0]}{a.lastName[0]}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-foreground">{a.firstName} {a.lastName}</p>
                      <p className="text-xs text-muted-foreground">{a.agencyCode || a.businessName || "-"}</p>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <p className="text-foreground text-xs">{a.email || "-"}</p>
                  <p className="text-muted-foreground text-xs">{a.phone || "-"}</p>
                </td>
                {showParent && <td className="py-3 px-3 text-xs text-foreground">{getParentName(a.parentAgentId)}</td>}
                <td className="py-3 px-3">
                  {a.category ? <Badge variant="outline" className="text-xs">{a.category}</Badge> : <span className="text-muted-foreground text-xs">-</span>}
                </td>
                <td className="py-3 px-3 font-mono text-foreground">{a.commissionRate != null ? `${a.commissionRate}%` : "-"}</td>
                <td className="py-3 px-3">
                  <Badge className={`text-xs ${statusBadge(a.status)}`}>{a.status}</Badge>
                </td>
                {isManager && (
                  <td className="py-3 px-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => openEdit(a)}>
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive" onClick={() => handleDelete(a.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function Pagination({ currentPage, total: tp, setPageFn }: { currentPage: number; total: number; setPageFn: (p: number) => void }) {
    if (tp <= 1) return null;
    return (
      <div className="flex items-center justify-center gap-2 mt-4">
        <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPageFn(currentPage - 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm text-muted-foreground">{currentPage} / {tp}</span>
        <Button size="sm" variant="outline" disabled={currentPage >= tp} onClick={() => setPageFn(currentPage + 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Agents</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage agents and sub-agents</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="rounded-xl bg-secondary/50 p-1">
            <TabsTrigger value="agents" className="rounded-lg gap-2"><Users className="w-4 h-4" /> Agent List ({total})</TabsTrigger>
            <TabsTrigger value="sub-agents" className="rounded-lg gap-2"><Network className="w-4 h-4" /> Sub Agents ({subTotal})</TabsTrigger>
          </TabsList>

          {/* ── Agent List ── */}
          <TabsContent value="agents" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search agents..." value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    className="pl-9 rounded-xl" />
                </div>
                {isManager && (
                  <Button onClick={() => openCreate(false)} className="rounded-xl gap-2">
                    <Plus className="w-4 h-4" /> New Agent
                  </Button>
                )}
              </div>
              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : (
                <AgentTable data={agents} />
              )}
              <Pagination currentPage={page} total={totalPages} setPageFn={setPage} />
            </Card>
          </TabsContent>

          {/* ── Sub Agents ── */}
          <TabsContent value="sub-agents" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search sub-agents..." value={subSearch}
                    onChange={e => { setSubSearch(e.target.value); setSubPage(1); }}
                    className="pl-9 rounded-xl" />
                </div>
                {isManager && (
                  <Button onClick={() => openCreate(true)} className="rounded-xl gap-2">
                    <UserPlus className="w-4 h-4" /> New Sub Agent
                  </Button>
                )}
              </div>

              <div className="mb-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-400">
                <p className="font-semibold mb-1">How Sub-Agents work:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Sub-agents are linked to a parent agent and operate under them.</li>
                  <li>Students & applications submitted by sub-agents flow to the parent agent first, then to you.</li>
                  <li>Sub-agents earn commission based on the rate set by their parent agent.</li>
                  <li>Parent agents can choose to hide service fee visibility from their sub-agents.</li>
                </ul>
              </div>

              <AgentTable data={subAgents} showParent />
              <Pagination currentPage={subPage} total={subTotalPages} setPageFn={setSubPage} />
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Create / Edit Dialog ── */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border/50 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
              <h2 className="font-display font-bold text-lg text-foreground">
                {editingAgent ? (isSubAgent ? "Edit Sub Agent" : "Edit Agent") : (isSubAgent ? "New Sub Agent" : "New Agent")}
              </h2>
              <Button size="icon" variant="ghost" onClick={() => setShowDialog(false)} className="w-8 h-8 rounded-lg">
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-6 space-y-6">
              {/* Sub-Agent Parent */}
              {isSubAgent && (
                <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <Label className="text-sm font-semibold mb-2 block">Parent Agent <span className="text-red-500">*</span></Label>
                  <Select value={form.parentAgentId} onValueChange={v => setForm(f => ({ ...f, parentAgentId: v }))}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Select parent agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {parentAgents.map(pa => (
                        <SelectItem key={pa.id} value={pa.id.toString()}>{pa.firstName} {pa.lastName} {pa.businessName ? `(${pa.businessName})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Agency Code */}
              <div className="space-y-1.5">
                <Label>Agency Code</Label>
                <Input value={form.agencyCode} onChange={e => setForm(f => ({ ...f, agencyCode: e.target.value }))} className="rounded-xl" placeholder="e.g. AG-001" />
              </div>

              {/* Name */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>First Name <span className="text-red-500">*</span></Label>
                  <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name <span className="text-red-500">*</span></Label>
                  <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="rounded-xl" />
                </div>
              </div>

              {/* Contact */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email <span className="text-red-500">*</span></Label>
                  <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Mobile No. <span className="text-red-500">*</span></Label>
                  <div className="flex gap-2">
                    <Select value={form.phoneCode} onValueChange={v => setForm(f => ({ ...f, phoneCode: v }))}>
                      <SelectTrigger className="w-28 rounded-xl shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {PHONE_CODES.map(pc => (
                          <SelectItem key={pc.code + pc.country} value={pc.code}>{pc.flag} {pc.code}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Mobile No." className="rounded-xl" />
                  </div>
                </div>
              </div>

              {/* Location */}
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Country</Label>
                  <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>City / Location</Label>
                  <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className="rounded-xl" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="rounded-xl" />
              </div>

              {/* Business */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> Business Name</Label>
                  <Input value={form.businessName} onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Commission */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Commission Percent <span className="text-red-500">*</span></Label>
                  <Input type="number" min="0" max="100" step="0.5" value={form.commissionRate}
                    onChange={e => setForm(f => ({ ...f, commissionRate: e.target.value }))}
                    className="rounded-xl" placeholder="e.g. 15" />
                </div>
                {!isSubAgent && (
                  <div className="space-y-1.5">
                    <Label>Sub-Agent Commission Rate (%)</Label>
                    <Input type="number" min="0" max="100" step="0.5" value={form.subAgentCommissionRate}
                      onChange={e => setForm(f => ({ ...f, subAgentCommissionRate: e.target.value }))}
                      className="rounded-xl" placeholder="Commission for sub-agents" />
                  </div>
                )}
              </div>

              {/* Sub-agent settings for parent agents */}
              {!isSubAgent && (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-border/50">
                  <button
                    onClick={() => setForm(f => ({ ...f, hideServiceFees: !f.hideServiceFees }))}
                    className={`relative w-12 h-6 rounded-full transition-all ${form.hideServiceFees ? "bg-primary" : "bg-secondary border-2 border-border"}`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${form.hideServiceFees ? "translate-x-6" : ""}`} />
                  </button>
                  <div>
                    <p className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                      {form.hideServiceFees ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      Hide Service Fees from Sub-Agents
                    </p>
                    <p className="text-xs text-muted-foreground">When enabled, sub-agents under this agent won't see service fee details.</p>
                  </div>
                </div>
              )}

              {/* File Uploads */}
              <div className="space-y-4">
                <h3 className="font-display font-semibold text-foreground">Documents</h3>
                <div className="grid sm:grid-cols-3 gap-4">
                  {/* Logo */}
                  <div className="space-y-2">
                    <Label className="text-xs">Logo for Agent Panel</Label>
                    <div className="relative h-24 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden bg-secondary/20">
                      {form.logoUrl ? (
                        <>
                          <img src={form.logoUrl} alt="Logo" className="max-h-20 max-w-full object-contain" />
                          <button onClick={() => setForm(f => ({ ...f, logoUrl: "" }))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive/90 text-white flex items-center justify-center"><X className="w-3 h-3" /></button>
                        </>
                      ) : (
                        <button onClick={() => logoRef.current?.click()} className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary text-xs" disabled={logoUploading}>
                          {logoUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                          <span>{logoUploading ? "Uploading..." : "Upload"}</span>
                        </button>
                      )}
                    </div>
                    <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f, "logoUrl", setLogoUploading); e.target.value = ""; }} />
                  </div>

                  {/* ID Proof */}
                  <div className="space-y-2">
                    <Label className="text-xs">Agent ID Proof</Label>
                    <div className="relative h-24 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden bg-secondary/20">
                      {form.agentIdProofUrl ? (
                        <>
                          <p className="text-xs text-green-600 font-medium px-2 text-center">Uploaded</p>
                          <button onClick={() => setForm(f => ({ ...f, agentIdProofUrl: "" }))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive/90 text-white flex items-center justify-center"><X className="w-3 h-3" /></button>
                        </>
                      ) : (
                        <button onClick={() => idProofRef.current?.click()} className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary text-xs" disabled={idProofUploading}>
                          {idProofUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                          <span>{idProofUploading ? "Uploading..." : "Upload"}</span>
                        </button>
                      )}
                    </div>
                    <input ref={idProofRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f, "agentIdProofUrl", setIdProofUploading); e.target.value = ""; }} />
                  </div>

                  {/* Business Cert */}
                  <div className="space-y-2">
                    <Label className="text-xs">Business Certificate</Label>
                    <div className="relative h-24 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden bg-secondary/20">
                      {form.businessCertUrl ? (
                        <>
                          <p className="text-xs text-green-600 font-medium px-2 text-center">Uploaded</p>
                          <button onClick={() => setForm(f => ({ ...f, businessCertUrl: "" }))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive/90 text-white flex items-center justify-center"><X className="w-3 h-3" /></button>
                        </>
                      ) : (
                        <button onClick={() => certRef.current?.click()} className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary text-xs" disabled={certUploading}>
                          {certUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                          <span>{certUploading ? "Uploading..." : "Upload"}</span>
                        </button>
                      )}
                    </div>
                    <input ref={certRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f, "businessCertUrl", setCertUploading); e.target.value = ""; }} />
                  </div>
                </div>
              </div>

              {/* Branch & Point of Contact */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Branch</Label>
                  <Input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>Point of Contact</Label>
                  <Input value={form.pointOfContact} onChange={e => setForm(f => ({ ...f, pointOfContact: e.target.value }))} className="rounded-xl" />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
                  className="flex w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-card border-t border-border/50 px-6 py-4 rounded-b-2xl flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDialog(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="rounded-xl gap-2 px-6">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingAgent ? "Update" : "Create Agent"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
