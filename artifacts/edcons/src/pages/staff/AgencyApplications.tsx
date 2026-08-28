import { useCallback, useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, ArrowLeft, CheckCircle2, ClipboardCheck, Download, Eye, FileSignature, Loader2, RefreshCw, Search, Send, XCircle } from "lucide-react";
import { useLocation } from "wouter";

type AgencyApplication = {
  id: number;
  referenceCode: string;
  status: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  entityType: string;
  preferredLanguage: string;
  companyName: string | null;
  businessName: string | null;
  taxNumber: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  estimatedStudents: number | null;
  operatingCountries: unknown;
  recruitmentMarkets: unknown;
  emailVerifiedAt: string | null;
  logoFileKey: string | null;
  representativeIdFileKey: string | null;
  businessRegistrationFileKey: string | null;
  contractTemplateId: number;
  contractTemplateSelection: string;
  contractPreparedAt: string | null;
  contractSentAt: string | null;
  reviewNotes: string | null;
  changeRequestMessage: string | null;
  assignedStaffId: number | null;
  branchId: number | null;
  signedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  template?: { id: number; name: string; title: string | null; version: number } | null;
};

type Staff = { id: number; email?: string | null; firstName: string | null; lastName: string | null; role: string; isActive?: boolean };
type Branch = { id: number; name: string };
type ContractOption = {
  id: number;
  name: string;
  title: string | null;
  language: string;
  entityType: string;
  version: number;
  signingPageConfig?: { requireEmailVerification?: boolean } | null;
};

const STATUS_OPTIONS = ["all", "submitted", "under_review", "changes_requested", "awaiting_signature", "signed", "approved", "rejected"];
const STATUS_STYLE: Record<string, string> = {
  awaiting_signature: "bg-amber-100 text-amber-800",
  signed: "bg-teal-100 text-teal-800",
  submitted: "bg-blue-100 text-blue-800",
  under_review: "bg-violet-100 text-violet-800",
  changes_requested: "bg-orange-100 text-orange-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

function formatStatus(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function list(value: unknown): string {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : "—";
}

export default function AgencyApplications() {
  const { lang } = useI18n();
  const tr = lang === "tr";
  const [, setLocation] = useLocation();
  const [rows, setRows] = useState<AgencyApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<AgencyApplication | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [contractOptions, setContractOptions] = useState<ContractOption[]>([]);
  const [directoryError, setDirectoryError] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [changeMessage, setChangeMessage] = useState("");
  const [assignedStaffId, setAssignedStaffId] = useState("none");
  const [branchId, setBranchId] = useState("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [portalPath, setPortalPath] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ status, search, limit: "100" });
      const response = await customFetch<{ data: AgencyApplication[]; pagination: { total: number } }>(`/api/agent-applications?${params}`);
      setRows(response.data || []); setTotal(response.pagination?.total || 0);
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Applications could not be loaded"); }
    finally { setLoading(false); }
  }, [search, status]);

  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    let cancelled = false;
    const failures: string[] = [];
    const recordFailure = (label: string, cause: unknown) => {
      console.error(`[agency-applications] ${label} could not be loaded`, cause);
      failures.push(label);
      if (!cancelled) setDirectoryError(tr
        ? `Bazı inceleme seçenekleri yüklenemedi: ${failures.join(", ")}. Sayfayı yenileyin.`
        : `Some review options could not be loaded: ${failures.join(", ")}. Refresh the page.`);
    };

    customFetch<{ data: Staff[] }>("/api/users?roles=super_admin,admin,manager,staff,consultant,editor,accountant&limit=200")
      .then((response) => {
        if (cancelled) return;
        setStaff((response.data || [])
          .filter((user) => user.isActive !== false)
          .sort((left, right) => `${left.firstName || ""} ${left.lastName || ""}`.localeCompare(`${right.firstName || ""} ${right.lastName || ""}`)));
      })
      .catch((cause) => recordFailure(tr ? "personel" : "staff", cause));

    customFetch<{ data: Branch[] }>("/api/branches?archived=0")
      .then((response) => { if (!cancelled) setBranches(response.data || []); })
      .catch((cause) => recordFailure(tr ? "şubeler" : "branches", cause));

    customFetch<{ data: ContractOption[] }>("/api/agent-applications/contract-options")
      .then((response) => { if (!cancelled) setContractOptions(response.data || []); })
      .catch((cause) => recordFailure(tr ? "sözleşmeler" : "contracts", cause));

    return () => { cancelled = true; };
  }, [tr]);

  const counts = useMemo(() => rows.reduce<Record<string, number>>((result, row) => ({ ...result, [row.status]: (result[row.status] || 0) + 1 }), {}), [rows]);
  const selectedContractOption = contractOptions.find(option => String(option.id) === selectedTemplateId) || null;

  async function openDetails(row: AgencyApplication) {
    setError(""); setTemporaryPassword(""); setPortalPath("");
    try {
      const response = await customFetch<{ data: AgencyApplication }>(`/api/agent-applications/${row.id}`);
      const detail = response.data;
      setSelected(detail); setReviewNotes(detail.reviewNotes || ""); setChangeMessage(detail.changeRequestMessage || "");
      setAssignedStaffId(detail.assignedStaffId ? String(detail.assignedStaffId) : "none");
      setBranchId(detail.branchId ? String(detail.branchId) : "none");
      setSelectedTemplateId(String(detail.contractTemplateId));
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Application could not be opened"); }
  }

  async function changeContractTemplate(templateId: string) {
    if (!selected || !templateId || templateId === String(selected.contractTemplateId)) return;
    setSaving(true); setError(""); setPortalPath("");
    try {
      await customFetch(`/api/agent-applications/${selected.id}/contract-template`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: Number(templateId) }),
      });
      const response = await customFetch<{ data: AgencyApplication }>(`/api/agent-applications/${selected.id}`);
      setSelected(response.data); setSelectedTemplateId(String(response.data.contractTemplateId)); await load();
    } catch (cause: any) { setSelectedTemplateId(String(selected.contractTemplateId)); setError(cause?.data?.error || cause?.message || "Contract template could not be changed"); }
    finally { setSaving(false); }
  }

  async function sendContract() {
    if (!selected) return;
    if (!window.confirm(tr ? "Seçili sözleşmeyi başvuru sahibinin imza portalına göndermek istiyor musunuz?" : "Send the selected contract to the applicant's signing portal?")) return;
    setSaving(true); setError(""); setPortalPath("");
    try {
      const response = await customFetch<{ data: { application: AgencyApplication; dispatched: boolean; portalPath: string } }>(`/api/agent-applications/${selected.id}/send-contract`, { method: "POST" });
      const detail = await customFetch<{ data: AgencyApplication }>(`/api/agent-applications/${selected.id}`);
      setSelected(detail.data); setPortalPath(response.data.portalPath); await load();
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Contract could not be sent"); }
    finally { setSaving(false); }
  }

  async function saveAssignment() {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const response = await customFetch<{ data: AgencyApplication }>(`/api/agent-applications/${selected.id}/assignment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedStaffId: assignedStaffId === "none" ? null : Number(assignedStaffId),
          branchId: branchId === "none" ? null : Number(branchId),
        }),
      });
      setSelected((current) => current ? { ...current, ...response.data } : current);
      await load();
    } catch (cause: any) {
      setError(cause?.data?.error || cause?.message || "Assignment could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function review(nextStatus: "under_review" | "changes_requested" | "rejected") {
    if (!selected) return;
    if (nextStatus === "changes_requested" && !changeMessage.trim()) { setError(tr ? "Düzeltme açıklaması zorunludur." : "A change request message is required."); return; }
    setSaving(true); setError("");
    try {
      const response = await customFetch<{ data: AgencyApplication }>(`/api/agent-applications/${selected.id}/review`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          status: nextStatus, reviewNotes, changeRequestMessage: nextStatus === "changes_requested" ? changeMessage : null,
          assignedStaffId: assignedStaffId === "none" ? null : Number(assignedStaffId), branchId: branchId === "none" ? null : Number(branchId),
        }),
      });
      setSelected(response.data); await load();
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Review could not be saved"); }
    finally { setSaving(false); }
  }

  async function approve() {
    if (!selected) return;
    if (!window.confirm(tr ? "İmzalı başvuruyu onaylayıp acente hesabını oluşturmak istiyor musunuz?" : "Approve the signed application and create the agent account?")) return;
    setSaving(true); setError("");
    try {
      const response = await customFetch<{ data: { application: AgencyApplication; temporaryPassword?: string; credentialsDispatched: boolean } }>(`/api/agent-applications/${selected.id}/approve`, { method: "POST" });
      setSelected(response.data.application); setTemporaryPassword(response.data.temporaryPassword || ""); await load();
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Application could not be approved"); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><Button variant="ghost" size="icon" onClick={() => setLocation("/staff/agents")}><ArrowLeft className="h-5 w-5" /></Button><div><h1 className="text-2xl font-bold">{tr ? "Acente Başvuruları" : "Agency Applications"}</h1><p className="text-sm text-muted-foreground mt-1">{tr ? "Başvuruları, sözleşme imzalarını ve onay sürecini yönetin." : "Review applications, verified contract signatures and account provisioning."}</p></div></div><Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{tr ? "Yenile" : "Refresh"}</Button></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Metric label={tr ? "Toplam" : "Total"} value={total} /><Metric label={tr ? "Gönderilmiş" : "Submitted"} value={counts.submitted || 0} /><Metric label={tr ? "İmzalı" : "Signed"} value={counts.signed || 0} /><Metric label={tr ? "Onaylı" : "Approved"} value={counts.approved || 0} /></div>
    <Card className="p-5"><div className="flex flex-col md:flex-row gap-3 mb-5"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr ? "Ad, e-posta, şirket veya referans ara…" : "Search name, email, company or reference…"} /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="md:w-56"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map((value) => <SelectItem key={value} value={value}>{value === "all" ? (tr ? "Tüm durumlar" : "All statuses") : formatStatus(value)}</SelectItem>)}</SelectContent></Select></div>
      {error && !selected ? <ErrorBox message={error} /> : null}
      {loading ? <div className="py-20 grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : rows.length === 0 ? <div className="py-16 text-center text-muted-foreground"><ClipboardCheck className="h-10 w-10 mx-auto mb-3" />{tr ? "Başvuru bulunamadı." : "No applications found."}</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">{tr ? "Başvuru" : "Applicant"}</th><th className="p-3">{tr ? "Kurum" : "Organization"}</th><th className="p-3">{tr ? "Sözleşme" : "Contract"}</th><th className="p-3">{tr ? "Durum" : "Status"}</th><th className="p-3">{tr ? "Tarih" : "Date"}</th><th className="p-3 text-right">{tr ? "İşlem" : "Action"}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30"><td className="p-3"><strong>{row.firstName} {row.lastName}</strong><span className="block text-xs text-muted-foreground">{row.email} · {row.referenceCode}</span></td><td className="p-3">{row.companyName || row.businessName || "—"}<span className="block text-xs text-muted-foreground capitalize">{row.entityType}</span></td><td className="p-3 capitalize">{row.preferredLanguage}</td><td className="p-3"><Badge className={STATUS_STYLE[row.status] || ""}>{formatStatus(row.status)}</Badge></td><td className="p-3 text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</td><td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => openDetails(row)}><Eye className="mr-2 h-4 w-4" />{tr ? "İncele" : "Review"}</Button></td></tr>)}</tbody></table></div>}
    </Card>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !saving) { setSelected(null); setError(""); setTemporaryPassword(""); setPortalPath(""); } }}><DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{selected?.firstName} {selected?.lastName} · {selected?.referenceCode}</DialogTitle><DialogDescription>{selected ? `${formatStatus(selected.status)} · ${selected.email}` : ""}</DialogDescription></DialogHeader>
      {selected ? <div className="space-y-5">
        {error ? <ErrorBox message={error} /> : null}{directoryError ? <ErrorBox message={directoryError} /> : null}{temporaryPassword ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><strong>{tr ? "Yerel geçici parola" : "Local temporary password"}</strong><code className="block mt-2 text-lg">{temporaryPassword}</code><p className="mt-2 text-xs text-muted-foreground">{tr ? "Bu yalnızca yerel ortamda gösterilir." : "This is displayed only in the local environment."}</p></div> : null}
        {portalPath ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><strong>{tr ? "Yerel imza bağlantısı hazır" : "Local signing link is ready"}</strong><a className="mt-2 block break-all text-sm text-primary underline" href={portalPath}>{portalPath}</a></div> : null}
        {selected.changeRequestMessage ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><strong>{tr ? "İstenen düzeltme" : "Requested changes"}</strong><p className="mt-1 text-sm">{selected.changeRequestMessage}</p></div> : null}
        <div className="grid md:grid-cols-3 gap-4 rounded-xl bg-muted/40 p-4"><Detail label={tr ? "Başvuru tipi" : "Entity type"} value={selected.entityType} /><Detail label={tr ? "Sözleşme dili" : "Contract language"} value={selected.preferredLanguage} /><Detail label={tr ? "Sözleşme" : "Contract"} value={selected.template ? `${selected.template.title || selected.template.name} · v${selected.template.version}` : "—"} /><Detail label={tr ? "Şirket" : "Company"} value={selected.companyName || "—"} /><Detail label={tr ? "Ticari ad" : "Trading name"} value={selected.businessName || "—"} /><Detail label={tr ? "Vergi/sicil" : "Tax/registration"} value={selected.taxNumber || "—"} /><Detail label={tr ? "Telefon" : "Phone"} value={selected.phone || "—"} /><Detail label={tr ? "Konum" : "Location"} value={[selected.city, selected.state, selected.country].filter(Boolean).join(", ") || "—"} /><Detail label={tr ? "Yıllık öğrenci" : "Students/year"} value={selected.estimatedStudents == null ? "—" : String(selected.estimatedStudents)} /><Detail label={tr ? "Faaliyet ülkeleri" : "Operating countries"} value={list(selected.operatingCountries)} /><Detail label={tr ? "Öğrenci pazarları" : "Recruitment markets"} value={list(selected.recruitmentMarkets)} /><Detail label={tr ? "İmza" : "Signature"} value={selected.signedAt ? new Date(selected.signedAt).toLocaleString() : (tr ? "Henüz imzalanmadı" : "Not signed yet")} /></div>
        <div className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center gap-2"><FileSignature className="h-5 w-5" /><strong>{tr ? "Sözleşme hazırlığı" : "Contract preparation"}</strong></div>
          <p className="text-sm text-muted-foreground">{tr ? "Dil ve başvuru tipine göre otomatik seçilen şablonu, imzaya göndermeden önce değiştirebilirsiniz." : "You can override the template selected from language and applicant type before sending it for signature."}</p>
          <Select value={selectedTemplateId} onValueChange={changeContractTemplate} disabled={saving || ["signed", "approved", "rejected"].includes(selected.status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{contractOptions.filter((option) => option.entityType.toLowerCase() === selected.entityType.toLowerCase()).map((option) => <SelectItem key={option.id} value={String(option.id)}>{option.title || option.name} · {option.language} · v{option.version}</SelectItem>)}</SelectContent>
          </Select>
          {selectedContractOption?.signingPageConfig?.requireEmailVerification === false && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{tr ? "Bu şablonda imzalayan kişinin e-posta doğrulaması kapalıdır. Göndermeden önce bu tercihi kontrol edin." : "Signer email verification is disabled for this template. Review this choice before sending."}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="outline">{selected.contractTemplateSelection === "manual" ? (tr ? "Personel seçimi" : "Staff override") : (tr ? "Otomatik seçim" : "Automatic selection")}</Badge>{selected.emailVerifiedAt ? <Badge variant="outline" className="text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />{tr ? "E-posta doğrulandı" : "Email verified"}</Badge> : null}{selected.contractSentAt ? <Badge variant="outline">{tr ? "İmzaya gönderildi" : "Sent for signature"}</Badge> : null}</div>
        </div>
        <div className="rounded-xl border p-4 space-y-3"><strong>{tr ? "Başvuru belgeleri" : "Application documents"}</strong><div className="flex flex-wrap gap-2">{selected.logoFileKey ? <DocumentButton id={selected.id} kind="logo" label={tr ? "Logo" : "Logo"} /> : null}{selected.representativeIdFileKey ? <DocumentButton id={selected.id} kind="representative-id" label={tr ? "Yetkili kimliği" : "Representative ID"} /> : null}{selected.businessRegistrationFileKey ? <DocumentButton id={selected.id} kind="business-registration" label={tr ? "Şirket kayıt belgesi" : "Business registration"} /> : null}</div></div>
        <div className="space-y-3"><div className="grid md:grid-cols-2 gap-4"><div className="space-y-2"><Label>{tr ? "Atanan personel" : "Assigned staff"}</Label><Select value={assignedStaffId} onValueChange={setAssignedStaffId} disabled={saving || staff.length === 0}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem>{staff.map((person) => <SelectItem key={person.id} value={String(person.id)}>{[person.firstName, person.lastName].filter(Boolean).join(" ") || person.email || `#${person.id}`}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>{tr ? "Şube" : "Branch"}</Label><Select value={branchId} onValueChange={setBranchId} disabled={saving || branches.length === 0}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>)}</SelectContent></Select></div></div><div className="flex justify-end"><Button type="button" variant="outline" onClick={saveAssignment} disabled={saving || !selected || selected.status === "approved"}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{tr ? "Atamayı kaydet" : "Save assignment"}</Button></div></div>
        <div className="space-y-2"><Label>{tr ? "İnceleme notu" : "Review notes"}</Label><Textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} rows={3} /></div>
        <div className="space-y-2"><Label>{tr ? "Başvuru sahibinden istenecek düzeltmeler" : "Changes requested from applicant"}</Label><Textarea value={changeMessage} onChange={(event) => setChangeMessage(event.target.value)} rows={3} /></div>
      </div> : null}
      <DialogFooter className="gap-2 flex-wrap sm:justify-between"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => review("under_review")} disabled={saving || !selected || !["submitted", "under_review", "changes_requested"].includes(selected.status)}>{tr ? "İncelemeye al" : "Start review"}</Button><Button variant="outline" onClick={() => review("changes_requested")} disabled={saving || !selected || !["submitted", "under_review", "changes_requested"].includes(selected.status)}><AlertCircle className="mr-2 h-4 w-4" />{tr ? "Düzeltme iste" : "Request changes"}</Button><Button variant="destructive" onClick={() => review("rejected")} disabled={saving || !selected || !["submitted", "under_review", "changes_requested"].includes(selected.status)}><XCircle className="mr-2 h-4 w-4" />{tr ? "Reddet" : "Reject"}</Button></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={sendContract} disabled={saving || !selected || !["submitted", "under_review", "awaiting_signature"].includes(selected.status)}><Send className="mr-2 h-4 w-4" />{selected?.status === "awaiting_signature" ? (tr ? "Sözleşmeyi yeniden gönder" : "Resend contract") : (tr ? "Sözleşmeyi gönder" : "Send contract")}</Button><Button onClick={approve} disabled={saving || !selected || selected.status !== "signed"}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{tr ? "Onayla ve acente oluştur" : "Approve & create agent"}</Button></div></DialogFooter>
    </DialogContent></Dialog></div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <Card className="p-4"><span className="text-xs text-muted-foreground">{label}</span><strong className="block text-2xl mt-1">{value}</strong></Card>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><span className="text-xs text-muted-foreground">{label}</span><strong className="block mt-1 break-words capitalize">{value}</strong></div>; }
function ErrorBox({ message }: { message: string }) { return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>; }
function DocumentButton({ id, kind, label }: { id: number; kind: string; label: string }) { return <Button asChild type="button" variant="outline" size="sm"><a href={`/api/agent-applications/${id}/documents/${kind}`} target="_blank" rel="noreferrer"><Download className="mr-2 h-4 w-4" />{label}</a></Button>; }
