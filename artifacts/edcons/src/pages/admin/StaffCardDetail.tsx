import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { ArrowLeft, Trash2, Plus, Upload, Download, Loader2, FileText, BadgeCheck, AlertTriangle } from "lucide-react";

const WEEKDAYS_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

type CardData = {
  user: any;
  schedules: Array<{ id: number; weekday: number; startMinutes: number; endMinutes: number }>;
  languages: Array<{ id: number; language: string; proficiency: string | null }>;
  documents: Array<{ id: number; docType: string; filename: string; sizeBytes: number; mimeType: string; uploadedAt: string }>;
  assignedAgents: Array<{ id: number; firstName: string | null; lastName: string | null; companyName: string | null; businessName: string | null; email: string | null; isPrimary: boolean }>;
  assignedStudents: Array<{ id: number; firstName: string | null; lastName: string | null; email: string | null; status: string | null; season: string | null }>;
  salaryPayments: Array<any>;
  commissions: Array<any>;
  salaryTotals: { paid: number; pending: number };
  commissionTotals: { paid: number; pending: number };
  presence: { status: string; lastActiveAt: string | null };
};

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function StaffCardDetailPage({ userId }: { userId: number }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("general");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetched = await customFetch<CardData>(`/api/staff-cards/${userId}`);
      setData(fetched);
    } catch (err: any) {
      const msg = String(err?.message || err);
      setError(msg);
      toast({ title: t("staffCards.loadFailed"), description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [userId, toast, t]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return <div className="p-12 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (error || !data) {
    return (
      <div className="p-12 max-w-md mx-auto text-center space-y-3">
        <p className="text-sm text-destructive">{error || t("staffCards.loadFailed")}</p>
        <Button size="sm" variant="outline" onClick={refresh}>{t("common.retry") || "Retry"}</Button>
      </div>
    );
  }

  const fullName = [data.user.firstName, data.user.lastName].filter(Boolean).join(" ") || data.user.email || `#${data.user.id}`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/staff-cards"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />{t("common.back")}</Button></Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">{fullName} <Badge variant="secondary">{data.user.role}</Badge></h1>
            <p className="text-sm text-muted-foreground">{data.user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Badge variant={data.presence.status === "online" ? "default" : "outline"}>{data.presence.status}</Badge>
          {data.presence.lastActiveAt && <span>{t("staffCards.lastActive")}: {new Date(data.presence.lastActiveAt).toLocaleString()}</span>}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="general">{t("staffCards.tab.general")}</TabsTrigger>
          <TabsTrigger value="schedule">{t("staffCards.tab.schedule")}</TabsTrigger>
          <TabsTrigger value="languages">{t("staffCards.tab.languages")}</TabsTrigger>
          <TabsTrigger value="documents">{t("staffCards.tab.documents")}</TabsTrigger>
          <TabsTrigger value="agents">{t("staffCards.tab.agents")}</TabsTrigger>
          <TabsTrigger value="students">{t("staffCards.tab.students")}</TabsTrigger>
          <TabsTrigger value="activity">{t("staffCards.tab.activity")}</TabsTrigger>
          <TabsTrigger value="salary">{t("staffCards.tab.salary")}</TabsTrigger>
          <TabsTrigger value="commissions">{t("staffCards.tab.commissions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4"><GeneralTab user={data.user} onSaved={refresh} userId={userId} /></TabsContent>
        <TabsContent value="schedule" className="mt-4"><ScheduleTab schedules={data.schedules} userId={userId} onSaved={refresh} /></TabsContent>
        <TabsContent value="languages" className="mt-4"><LanguagesTab languages={data.languages} userId={userId} onSaved={refresh} /></TabsContent>
        <TabsContent value="documents" className="mt-4"><DocumentsTab documents={data.documents} userId={userId} onSaved={refresh} /></TabsContent>
        <TabsContent value="agents" className="mt-4"><AgentsTab assignedAgents={data.assignedAgents} userId={userId} onSaved={refresh} /></TabsContent>
        <TabsContent value="students" className="mt-4"><StudentsTab assignedStudents={data.assignedStudents} userId={userId} onSaved={refresh} /></TabsContent>
        <TabsContent value="activity" className="mt-4"><ActivityTab userId={userId} /></TabsContent>
        <TabsContent value="salary" className="mt-4"><SalaryTab payments={data.salaryPayments} totals={data.salaryTotals} userId={userId} onSaved={refresh} /></TabsContent>
        <TabsContent value="commissions" className="mt-4"><CommissionsTab commissions={data.commissions} totals={data.commissionTotals} userId={userId} onSaved={refresh} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── General ────────────────────────────────────────────────────────────────
function GeneralTab({ user, userId, onSaved }: { user: any; userId: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [form, setForm] = useState({
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    phone: user.phone || "",
    homeAddress: user.homeAddress || "",
    locationCountry: user.locationCountry || "",
    locationCity: user.locationCity || "",
    timezone: user.timezone || "",
    emergencyContactName: user.emergencyContactName || "",
    emergencyContactPhone: user.emergencyContactPhone || "",
    isActive: !!user.isActive,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await customFetch(`/api/staff-cards/${userId}/profile`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      toast({ title: t("staffCards.saved") });
      onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><Label>{t("staffCards.field.firstName")}</Label><Input value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))} /></div>
        <div><Label>{t("staffCards.field.lastName")}</Label><Input value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))} /></div>
        <div><Label>{t("staffCards.field.phone")}</Label><Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
        <div><Label>{t("staffCards.field.timezone")}</Label><Input placeholder="Europe/Istanbul" value={form.timezone} onChange={(e) => setForm(f => ({ ...f, timezone: e.target.value }))} /></div>
        <div><Label>{t("staffCards.field.locationCountry")}</Label><Input value={form.locationCountry} onChange={(e) => setForm(f => ({ ...f, locationCountry: e.target.value }))} /></div>
        <div><Label>{t("staffCards.field.locationCity")}</Label><Input value={form.locationCity} onChange={(e) => setForm(f => ({ ...f, locationCity: e.target.value }))} /></div>
        <div className="md:col-span-2"><Label>{t("staffCards.field.homeAddress")}</Label><Textarea rows={2} value={form.homeAddress} onChange={(e) => setForm(f => ({ ...f, homeAddress: e.target.value }))} /></div>
        <div><Label>{t("staffCards.field.emergencyName")}</Label><Input value={form.emergencyContactName} onChange={(e) => setForm(f => ({ ...f, emergencyContactName: e.target.value }))} /></div>
        <div><Label>{t("staffCards.field.emergencyPhone")}</Label><Input value={form.emergencyContactPhone} onChange={(e) => setForm(f => ({ ...f, emergencyContactPhone: e.target.value }))} /></div>
      </div>
      <div className="flex justify-end"><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}{t("common.save")}</Button></div>
    </Card>
  );
}

// ─── Schedule ───────────────────────────────────────────────────────────────
function ScheduleTab({ schedules, userId, onSaved }: { schedules: any[]; userId: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [entries, setEntries] = useState(schedules.map(s => ({ ...s })));
  const [saving, setSaving] = useState(false);

  const addRow = () => setEntries(e => [...e, { weekday: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }]);
  const removeRow = (i: number) => setEntries(e => e.filter((_, idx) => idx !== i));
  const update = (i: number, key: string, val: any) => setEntries(e => e.map((row, idx) => idx === i ? { ...row, [key]: val } : row));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { entries: entries.map(e => ({ weekday: Number(e.weekday), startMinutes: Number(e.startMinutes), endMinutes: Number(e.endMinutes) })) };
      await customFetch(`/api/staff-cards/${userId}/schedule`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      toast({ title: t("staffCards.saved") }); onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="space-y-2">
        {entries.length === 0 && <p className="text-sm text-muted-foreground">{t("staffCards.schedule.empty")}</p>}
        {entries.map((row, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4">
              <Label>{t("staffCards.schedule.weekday")}</Label>
              <Select value={String(row.weekday)} onValueChange={(v) => update(i, "weekday", Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{WEEKDAYS_KEYS.map((k, idx) => <SelectItem key={idx} value={String(idx)}>{t(`staffCards.weekday.${k}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-3"><Label>{t("staffCards.schedule.start")}</Label><Input type="time" value={minutesToHHMM(row.startMinutes)} onChange={(e) => update(i, "startMinutes", hhmmToMinutes(e.target.value))} /></div>
            <div className="col-span-3"><Label>{t("staffCards.schedule.end")}</Label><Input type="time" value={minutesToHHMM(row.endMinutes)} onChange={(e) => update(i, "endMinutes", hhmmToMinutes(e.target.value))} /></div>
            <div className="col-span-2"><Button variant="ghost" size="icon" onClick={() => removeRow(i)}><Trash2 className="h-4 w-4" /></Button></div>
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />{t("staffCards.schedule.add")}</Button>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}{t("common.save")}</Button>
      </div>
    </Card>
  );
}

// ─── Languages ──────────────────────────────────────────────────────────────
function LanguagesTab({ languages, userId, onSaved }: { languages: any[]; userId: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = useState(languages.map(l => ({ ...l })));
  const [saving, setSaving] = useState(false);

  const addRow = () => setItems(e => [...e, { language: "", proficiency: "" }]);
  const removeRow = (i: number) => setItems(e => e.filter((_, idx) => idx !== i));
  const update = (i: number, key: string, val: any) => setItems(e => e.map((row, idx) => idx === i ? { ...row, [key]: val } : row));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { languages: items.filter(i => (i.language || "").trim()).map(i => ({ language: i.language.trim(), proficiency: (i.proficiency || "").trim() || null })) };
      await customFetch(`/api/staff-cards/${userId}/languages`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      toast({ title: t("staffCards.saved") }); onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-6 space-y-4">
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t("staffCards.languages.empty")}</p>}
      {items.map((row, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5"><Label>{t("staffCards.languages.language")}</Label><Input placeholder="Türkçe" value={row.language} onChange={(e) => update(i, "language", e.target.value)} /></div>
          <div className="col-span-5"><Label>{t("staffCards.languages.proficiency")}</Label>
            <Select value={row.proficiency || ""} onValueChange={(v) => update(i, "proficiency", v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A1">A1</SelectItem><SelectItem value="A2">A2</SelectItem>
                <SelectItem value="B1">B1</SelectItem><SelectItem value="B2">B2</SelectItem>
                <SelectItem value="C1">C1</SelectItem><SelectItem value="C2">C2</SelectItem>
                <SelectItem value="native">{t("staffCards.languages.native")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Button variant="ghost" size="icon" onClick={() => removeRow(i)}><Trash2 className="h-4 w-4" /></Button></div>
        </div>
      ))}
      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />{t("staffCards.languages.add")}</Button>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}{t("common.save")}</Button>
      </div>
    </Card>
  );
}

// ─── Documents (private upload via presigned URL) ───────────────────────────
function DocumentsTab({ documents, userId, onSaved }: { documents: any[]; userId: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [docType, setDocType] = useState<"contract" | "diploma" | "passport">("contract");
  const [uploading, setUploading] = useState(false);

  const accepts: Record<string, string> = {
    contract: ".pdf,.doc,.docx",
    diploma: ".pdf,.jpg,.jpeg,.png,.doc,.docx",
    passport: ".pdf,.jpg,.jpeg,.png",
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(`/api/storage/uploads/request-url`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
      });
      const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      await customFetch(`/api/staff-cards/${userId}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, filename: file.name, objectPath, sizeBytes: file.size, mimeType: file.type || "application/octet-stream" }),
      });
      toast({ title: t("staffCards.documents.uploaded") });
      onSaved();
    } catch (err: any) {
      toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" });
    } finally { setUploading(false); }
  };

  const download = async (docId: number, filename: string) => {
    try {
      const blob = await customFetch<Blob>(`/api/staff-cards/${userId}/documents/${docId}/download`, { responseType: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  const remove = async (docId: number) => {
    if (!confirm(t("staffCards.documents.confirmDelete"))) return;
    try {
      await customFetch(`/api/staff-cards/${userId}/documents/${docId}`, { method: "DELETE" });
      onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-xs">
          <Label>{t("staffCards.documents.type")}</Label>
          <Select value={docType} onValueChange={(v) => setDocType(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contract">{t("staffCards.documents.contract")}</SelectItem>
              <SelectItem value="diploma">{t("staffCards.documents.diploma")}</SelectItem>
              <SelectItem value="passport">{t("staffCards.documents.passport")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="cursor-pointer">
          <input type="file" className="hidden" accept={accepts[docType]} disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          <span className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 text-sm font-medium">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{t("staffCards.documents.upload")}
          </span>
        </label>
      </div>
      <div className="text-xs text-muted-foreground">{t("staffCards.documents.privacyNote")}</div>

      <div className="space-y-2">
        {documents.length === 0 && <p className="text-sm text-muted-foreground">{t("staffCards.documents.empty")}</p>}
        {documents.map((d) => (
          <div key={d.id} className="flex items-center justify-between border rounded-md p-3">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-medium">{d.filename}</div>
                <div className="text-xs text-muted-foreground">{t(`staffCards.documents.${d.docType}`)} · {(d.sizeBytes / 1024).toFixed(1)} KB · {new Date(d.uploadedAt).toLocaleString()}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => download(d.id, d.filename)}><Download className="h-4 w-4 mr-1" />{t("staffCards.documents.download")}</Button>
              <Button variant="ghost" size="icon" onClick={() => remove(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Agents ─────────────────────────────────────────────────────────────────
function AgentsTab({ assignedAgents, userId, onSaved }: { assignedAgents: any[]; userId: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [allAgents, setAllAgents] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => { customFetch<any>("/api/agents?limit=500").then((d) => setAllAgents(Array.isArray(d) ? d : (d?.data || d?.agents || []))); }, []);

  const add = async () => {
    const id = Number(selected); if (!id) return;
    try {
      await customFetch(`/api/staff-cards/${userId}/assigned-agents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: id }) });
      setSelected(""); onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  const remove = async (agentId: number) => {
    try {
      await customFetch(`/api/staff-cards/${userId}/assigned-agents/${agentId}`, { method: "DELETE" });
      onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  const assignedIds = new Set(assignedAgents.map(a => a.id));
  const available = allAgents.filter(a => !assignedIds.has(a.id));

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1 max-w-md">
          <Label>{t("staffCards.agents.add")}</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {available.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.companyName || a.businessName || `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.email}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={add} disabled={!selected}><Plus className="h-4 w-4 mr-1" />{t("staffCards.agents.assign")}</Button>
      </div>
      <div className="space-y-2">
        {assignedAgents.length === 0 && <p className="text-sm text-muted-foreground">{t("staffCards.agents.empty")}</p>}
        {assignedAgents.map(a => (
          <div key={a.id} className="flex items-center justify-between border rounded-md p-3">
            <div>
              <div className="font-medium">{a.companyName || a.businessName || `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.email}</div>
              <div className="text-xs text-muted-foreground">{a.email}</div>
            </div>
            <div className="flex items-center gap-2">
              {a.isPrimary && <Badge>{t("staffCards.agents.primary")}</Badge>}
              <Link href={`/admin/agents/${a.id}`}><Button size="sm" variant="outline">{t("common.open")}</Button></Link>
              <Button variant="ghost" size="icon" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Students ───────────────────────────────────────────────────────────────
function StudentsTab({ assignedStudents, userId, onSaved }: { assignedStudents: any[]; userId: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [studentId, setStudentId] = useState("");

  const add = async () => {
    const id = Number(studentId); if (!id) return;
    try {
      await customFetch(`/api/staff-cards/${userId}/assigned-students`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: id }) });
      setStudentId(""); onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  const remove = async (sid: number) => {
    try {
      await customFetch(`/api/staff-cards/${userId}/assigned-students/${sid}`, { method: "DELETE" });
      onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-end gap-2 max-w-md">
        <div className="flex-1"><Label>{t("staffCards.students.studentId")}</Label><Input type="number" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="123" /></div>
        <Button onClick={add} disabled={!studentId}><Plus className="h-4 w-4 mr-1" />{t("staffCards.students.assign")}</Button>
      </div>
      <div className="space-y-2">
        {assignedStudents.length === 0 && <p className="text-sm text-muted-foreground">{t("staffCards.students.empty")}</p>}
        {assignedStudents.map(s => (
          <div key={s.id} className="flex items-center justify-between border rounded-md p-3">
            <div>
              <div className="font-medium">{[s.firstName, s.lastName].filter(Boolean).join(" ") || s.email || `#${s.id}`}</div>
              <div className="text-xs text-muted-foreground">{s.email} {s.status ? `· ${s.status}` : ""} {s.season ? `· ${s.season}` : ""}</div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/staff/students/${s.id}`}><Button size="sm" variant="outline">{t("common.open")}</Button></Link>
              <Button variant="ghost" size="icon" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Activity ───────────────────────────────────────────────────────────────
function ActivityTab({ userId }: { userId: number }) {
  const { t } = useI18n();
  const [range, setRange] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    customFetch<any>(`/api/staff-cards/${userId}/activity?range=${range}`)
      .then(d => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, range]);

  if (loading || !data) return <Card className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></Card>;

  const fmt = (m: number) => `${Math.floor(m / 60)}s ${m % 60}d`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["daily", "weekly", "monthly"] as const).map(r => (
          <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)}>{t(`staffCards.activity.range.${r}`)}</Button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <StatCard label={t("staffCards.activity.planned")} value={fmt(data.totals.plannedMinutes)} />
        <StatCard label={t("staffCards.activity.actual")} value={fmt(data.totals.actualMinutes)} />
        <StatCard label={t("staffCards.activity.outside")} value={fmt(data.totals.outsideMinutes)} icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard label={t("staffCards.activity.missing")} value={fmt(data.totals.missingMinutes)} />
        <StatCard label={t("staffCards.activity.overtime")} value={fmt(data.totals.overtimeMinutes)} icon={<BadgeCheck className="h-4 w-4" />} />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase">
            <tr>
              <th className="p-3">{t("staffCards.activity.day")}</th>
              <th className="p-3">{t("staffCards.activity.planned")}</th>
              <th className="p-3">{t("staffCards.activity.actual")}</th>
              <th className="p-3">{t("staffCards.activity.outside")}</th>
              <th className="p-3">{t("staffCards.activity.missing")}</th>
              <th className="p-3">{t("staffCards.activity.overtime")}</th>
            </tr>
          </thead>
          <tbody>
            {data.breakdown.map((d: any) => (
              <tr key={d.day} className="border-t">
                <td className="p-3 font-medium">{d.day}</td>
                <td className="p-3">{fmt(d.plannedMinutes)}</td>
                <td className="p-3">{fmt(d.actualMinutes)}</td>
                <td className="p-3 text-amber-600">{fmt(d.outsideMinutes)}</td>
                <td className="p-3 text-rose-600">{fmt(d.missingMinutes)}</td>
                <td className="p-3 text-emerald-600">{fmt(d.overtimeMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </Card>
  );
}

// ─── Salary ─────────────────────────────────────────────────────────────────
function SalaryTab({ payments, totals, userId, onSaved }: { payments: any[]; totals: any; userId: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [form, setForm] = useState({ amount: "", currency: "USD", period: "monthly", payDate: "", status: "pending", notes: "" });

  const add = async () => {
    if (!form.amount) return;
    try {
      await customFetch(`/api/staff-cards/${userId}/salary-payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount), payDate: form.payDate || null, notes: form.notes || null }),
      });
      setForm({ amount: "", currency: "USD", period: "monthly", payDate: "", status: "pending", notes: "" });
      onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  const updateStatus = async (id: number, status: string) => {
    try {
      await customFetch(`/api/staff-cards/${userId}/salary-payments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  const remove = async (id: number) => {
    try { await customFetch(`/api/staff-cards/${userId}/salary-payments/${id}`, { method: "DELETE" }); onSaved(); }
    catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t("staffCards.salary.totalPaid")} value={`${totals.paid.toFixed(2)}`} />
        <StatCard label={t("staffCards.salary.totalPending")} value={`${totals.pending.toFixed(2)}`} />
      </div>
      <Card className="p-4 grid grid-cols-1 md:grid-cols-7 gap-2 items-end">
        <div><Label>{t("staffCards.salary.amount")}</Label><Input type="number" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
        <div><Label>{t("staffCards.salary.currency")}</Label><Input value={form.currency} onChange={(e) => setForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} /></div>
        <div>
          <Label>{t("staffCards.salary.period")}</Label>
          <Select value={form.period} onValueChange={(v) => setForm(f => ({ ...f, period: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">{t("staffCards.salary.monthly")}</SelectItem>
              <SelectItem value="weekly">{t("staffCards.salary.weekly")}</SelectItem>
              <SelectItem value="biweekly">{t("staffCards.salary.biweekly")}</SelectItem>
              <SelectItem value="hourly">{t("staffCards.salary.hourly")}</SelectItem>
              <SelectItem value="project">{t("staffCards.salary.project")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>{t("staffCards.salary.payDate")}</Label><Input type="date" value={form.payDate} onChange={(e) => setForm(f => ({ ...f, payDate: e.target.value }))} /></div>
        <div>
          <Label>{t("staffCards.salary.status")}</Label>
          <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">{t("staffCards.salary.pending")}</SelectItem>
              <SelectItem value="paid">{t("staffCards.salary.paid")}</SelectItem>
              <SelectItem value="cancelled">{t("staffCards.salary.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2 flex gap-2">
          <Input className="flex-1" placeholder={t("staffCards.salary.notes")} value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
          <Button onClick={add}><Plus className="h-4 w-4" /></Button>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase">
            <tr><th className="p-3">{t("staffCards.salary.payDate")}</th><th className="p-3">{t("staffCards.salary.amount")}</th><th className="p-3">{t("staffCards.salary.period")}</th><th className="p-3">{t("staffCards.salary.status")}</th><th className="p-3">{t("staffCards.salary.notes")}</th><th className="p-3 text-right">{t("staffCards.col.actions")}</th></tr>
          </thead>
          <tbody>
            {payments.length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={6}>{t("staffCards.salary.empty")}</td></tr>}
            {payments.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-3">{p.payDate ? new Date(p.payDate).toLocaleDateString() : "—"}</td>
                <td className="p-3 font-medium">{Number(p.amount).toFixed(2)} {p.currency}</td>
                <td className="p-3">{t(`staffCards.salary.${p.period}`)}</td>
                <td className="p-3">
                  <Select value={p.status} onValueChange={(v) => updateStatus(p.id, v)}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">{t("staffCards.salary.pending")}</SelectItem>
                      <SelectItem value="paid">{t("staffCards.salary.paid")}</SelectItem>
                      <SelectItem value="cancelled">{t("staffCards.salary.cancelled")}</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-3 text-muted-foreground">{p.notes || "—"}</td>
                <td className="p-3 text-right"><Button variant="ghost" size="icon" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Commissions ────────────────────────────────────────────────────────────
function CommissionsTab({ commissions, totals, userId, onSaved }: { commissions: any[]; totals: any; userId: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [form, setForm] = useState({ amount: "", currency: "USD", studentId: "", agentId: "", applicationId: "", payDate: "", status: "pending", notes: "" });

  const add = async () => {
    if (!form.amount) return;
    try {
      const body: any = {
        amount: Number(form.amount), currency: form.currency,
        studentId: form.studentId ? Number(form.studentId) : null,
        agentId: form.agentId ? Number(form.agentId) : null,
        applicationId: form.applicationId ? Number(form.applicationId) : null,
        status: form.status, payDate: form.payDate || null, notes: form.notes || null,
      };
      await customFetch(`/api/staff-cards/${userId}/commissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setForm({ amount: "", currency: "USD", studentId: "", agentId: "", applicationId: "", payDate: "", status: "pending", notes: "" });
      onSaved();
    } catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  const updateStatus = async (id: number, status: string) => {
    try { await customFetch(`/api/staff-cards/${userId}/commissions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); onSaved(); }
    catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  const remove = async (id: number) => {
    try { await customFetch(`/api/staff-cards/${userId}/commissions/${id}`, { method: "DELETE" }); onSaved(); }
    catch (err: any) { toast({ title: t("common.error"), description: String(err.message || err), variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t("staffCards.commissions.totalPaid")} value={`${totals.paid.toFixed(2)}`} />
        <StatCard label={t("staffCards.commissions.totalPending")} value={`${totals.pending.toFixed(2)}`} />
      </div>
      <Card className="p-4 grid grid-cols-2 md:grid-cols-8 gap-2 items-end">
        <div><Label>{t("staffCards.salary.amount")}</Label><Input type="number" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
        <div><Label>{t("staffCards.salary.currency")}</Label><Input value={form.currency} onChange={(e) => setForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} /></div>
        <div><Label>{t("staffCards.commissions.studentId")}</Label><Input type="number" value={form.studentId} onChange={(e) => setForm(f => ({ ...f, studentId: e.target.value }))} /></div>
        <div><Label>{t("staffCards.commissions.agentId")}</Label><Input type="number" value={form.agentId} onChange={(e) => setForm(f => ({ ...f, agentId: e.target.value }))} /></div>
        <div><Label>{t("staffCards.commissions.applicationId")}</Label><Input type="number" value={form.applicationId} onChange={(e) => setForm(f => ({ ...f, applicationId: e.target.value }))} /></div>
        <div><Label>{t("staffCards.salary.payDate")}</Label><Input type="date" value={form.payDate} onChange={(e) => setForm(f => ({ ...f, payDate: e.target.value }))} /></div>
        <div>
          <Label>{t("staffCards.salary.status")}</Label>
          <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">{t("staffCards.salary.pending")}</SelectItem>
              <SelectItem value="approved">{t("staffCards.commissions.approved")}</SelectItem>
              <SelectItem value="paid">{t("staffCards.salary.paid")}</SelectItem>
              <SelectItem value="cancelled">{t("staffCards.salary.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2"><Input className="flex-1" placeholder={t("staffCards.salary.notes")} value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} /><Button onClick={add}><Plus className="h-4 w-4" /></Button></div>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase">
            <tr><th className="p-3">{t("staffCards.salary.payDate")}</th><th className="p-3">{t("staffCards.salary.amount")}</th><th className="p-3">{t("staffCards.commissions.refs")}</th><th className="p-3">{t("staffCards.salary.status")}</th><th className="p-3">{t("staffCards.salary.notes")}</th><th className="p-3 text-right">{t("staffCards.col.actions")}</th></tr>
          </thead>
          <tbody>
            {commissions.length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={6}>{t("staffCards.commissions.empty")}</td></tr>}
            {commissions.map(c => (
              <tr key={c.id} className="border-t">
                <td className="p-3">{c.payDate ? new Date(c.payDate).toLocaleDateString() : "—"}</td>
                <td className="p-3 font-medium">{Number(c.amount).toFixed(2)} {c.currency}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {c.studentId ? `S#${c.studentId}` : ""} {c.agentId ? `· A#${c.agentId}` : ""} {c.applicationId ? `· App#${c.applicationId}` : ""}
                </td>
                <td className="p-3">
                  <Select value={c.status} onValueChange={(v) => updateStatus(c.id, v)}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">{t("staffCards.salary.pending")}</SelectItem>
                      <SelectItem value="approved">{t("staffCards.commissions.approved")}</SelectItem>
                      <SelectItem value="paid">{t("staffCards.salary.paid")}</SelectItem>
                      <SelectItem value="cancelled">{t("staffCards.salary.cancelled")}</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-3 text-muted-foreground">{c.notes || "—"}</td>
                <td className="p-3 text-right"><Button variant="ghost" size="icon" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
