import { useEffect, useMemo, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  GraduationCap, Plus, Edit, Trash2, Loader2, Save, Search,
  Upload, Download, FileText, AlertTriangle, AlertOctagon, CheckCircle2,
} from "lucide-react";

type Status = "active" | "expiring_soon" | "expired" | "no_dates";

type Contract = {
  id: number;
  universityId: number;
  destinationId: number | null;
  country: string;
  year: number | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  fileObjectKey: string | null;
  fileName: string | null;
  fileMime: string | null;
  fileSize: number | null;
  notes: string | null;
  uploadedByUserId: number | null;
  assignedUserIds?: number[] | null;
  createdAt: string;
  universityName?: string | null;
  universityLogoUrl?: string | null;
  destinationName?: string | null;
  destinationCountry?: string | null;
  destinationFlagEmoji?: string | null;
  status: Status;
};

type University = { id: number; name: string; country: string; city: string | null };
type Destination = { id: number; name: string; country: string; flagEmoji?: string | null };

type FormState = {
  universityId: string;
  destinationId: string;
  year: string;
  effectiveDate: string;
  expiryDate: string;
  notes: string;
  fileObjectKey: string;
  fileName: string;
  fileMime: string;
  fileSize: number | null;
  assignedUserIds: number[];
  universityAssignedStaffIds: number[];
};

const emptyForm: FormState = {
  universityId: "",
  destinationId: "",
  year: "",
  effectiveDate: "",
  expiryDate: "",
  notes: "",
  fileObjectKey: "",
  fileName: "",
  fileMime: "",
  fileSize: null,
  assignedUserIds: [],
  universityAssignedStaffIds: [],
};

type StaffUser = { id: number; firstName: string | null; lastName: string | null; email: string | null; role: string };

const STATUS_LABELS: Record<Status, { label: string; tone: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  active: { label: "Aktif", tone: "outline", icon: CheckCircle2 },
  expiring_soon: { label: "Yakında sona eriyor", tone: "secondary", icon: AlertTriangle },
  expired: { label: "Sona erdi", tone: "destructive", icon: AlertOctagon },
  no_dates: { label: "Tarih yok", tone: "outline", icon: FileText },
};

const ALLOWED_CONTRACT_EXTS = /\.(pdf|docx|doc)$/i;
const ALLOWED_CONTRACT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

function formatDate(d: string | null): string {
  if (!d) return "-";
  try { return new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" }); }
  catch { return "-"; }
}

function daysLeft(expiry: string | null): number | null {
  if (!expiry) return null;
  const e = new Date(expiry);
  if (isNaN(e.getTime())) return null;
  return Math.ceil((e.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

interface Props { openId?: number }

export default function UniversityContractsPage({ openId }: Props = {}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Contract[]>([]);
  const [universities, setUniversities] = useState<University[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [filterUniversity, setFilterUniversity] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>("");
  const [search, setSearch] = useState("");

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [originalUniStaffIds, setOriginalUniStaffIds] = useState<number[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Contract | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handledOpenIdRef = useRef<number | null>(null);

  const destByCountry = useMemo(() => {
    const m: Record<string, Destination> = {};
    for (const d of destinations) m[d.country] = d;
    return m;
  }, [destinations]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCountry !== "all") params.set("country", filterCountry);
      if (filterUniversity !== "all") params.set("universityId", filterUniversity);
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterYear.trim()) params.set("year", filterYear.trim());
      if (search.trim()) params.set("search", search.trim());
      params.set("pageSize", "100");
      const res: any = await customFetch(`/api/university-contracts?${params.toString()}`);
      setRows(res.data || []);
    } catch (err: any) {
      toast({ title: "Yükleme hatası", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }

  async function loadMeta() {
    try {
      const [unis, cs, dests, users]: any = await Promise.all([
        customFetch(`/api/universities?limit=500`),
        customFetch(`/api/universities/countries`),
        customFetch(`/api/public/destinations`),
        customFetch(`/api/users?limit=500`).catch(() => ({ data: [] })),
      ]);
      setUniversities(unis.data || []);
      setCountries(cs || []);
      setDestinations(Array.isArray(dests) ? dests : (dests?.data || []));
      const list: any[] = users?.data || [];
      setStaffUsers(list
        .filter(u => u.isActive !== false && ["super_admin", "admin", "manager", "staff", "consultant", "agent_staff"].includes(u.role))
        .map(u => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role })));
    } catch {}
  }

  useEffect(() => { loadMeta(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterCountry, filterUniversity, filterStatus, filterYear]);

  // Deep-link: open dialog for /admin/university-contracts/:id
  useEffect(() => {
    if (!openId || handledOpenIdRef.current === openId) return;
    if (rows.length === 0) return;
    const c = rows.find(r => r.id === openId);
    if (c) {
      handledOpenIdRef.current = openId;
      openEdit(c);
    }
    // eslint-disable-next-line
  }, [openId, rows]);

  async function fetchUniStaffIds(uniId: number): Promise<number[]> {
    try {
      const u: any = await customFetch(`/api/universities/${uniId}`);
      return Array.isArray(u?.assignedStaffIds) ? u.assignedStaffIds : [];
    } catch { return []; }
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm });
    setOriginalUniStaffIds([]);
    setShowDialog(true);
  }

  function openEdit(c: Contract) {
    setEditing(c);
    setForm({
      universityId: String(c.universityId),
      destinationId: c.destinationId != null ? String(c.destinationId) : "",
      year: c.year != null ? String(c.year) : "",
      effectiveDate: c.effectiveDate ? c.effectiveDate.slice(0, 10) : "",
      expiryDate: c.expiryDate ? c.expiryDate.slice(0, 10) : "",
      notes: c.notes || "",
      fileObjectKey: c.fileObjectKey || "",
      fileName: c.fileName || "",
      fileMime: c.fileMime || "",
      fileSize: c.fileSize ?? null,
      assignedUserIds: Array.isArray(c.assignedUserIds) ? c.assignedUserIds : [],
      universityAssignedStaffIds: [],
    });
    setShowDialog(true);
    fetchUniStaffIds(c.universityId).then(ids => {
      setOriginalUniStaffIds(ids);
      setForm(f => ({ ...f, universityAssignedStaffIds: ids }));
    });
  }

  // Auto-default destination from selected university's country and
  // load that university's assigned-staff list (per-university source
  // of truth for contract expiry recipients).
  function onUniversityChange(uniId: string) {
    setForm(f => {
      const next = { ...f, universityId: uniId, universityAssignedStaffIds: [] };
      const uni = universities.find(u => String(u.id) === uniId);
      if (uni && !next.destinationId) {
        const dest = destByCountry[uni.country];
        if (dest) next.destinationId = String(dest.id);
      }
      return next;
    });
    setOriginalUniStaffIds([]);
    const idNum = parseInt(uniId, 10);
    if (!Number.isNaN(idNum)) {
      fetchUniStaffIds(idNum).then(ids => {
        setOriginalUniStaffIds(ids);
        setForm(f => (f.universityId === uniId ? { ...f, universityAssignedStaffIds: ids } : f));
      });
    }
  }

  async function uploadFile(file: File) {
    if (!ALLOWED_CONTRACT_MIMES.has(file.type) && !ALLOWED_CONTRACT_EXTS.test(file.name)) {
      toast({ title: "Dosya türü desteklenmiyor", description: "Yalnızca PDF veya DOCX dosyaları yüklenebilir.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const urlRes: any = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.uploadURL) throw new Error("Yükleme bağlantısı alınamadı");
      const putRes = await fetch(urlRes.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Yükleme başarısız");
      setForm(f => ({
        ...f,
        fileObjectKey: urlRes.objectPath,
        fileName: file.name,
        fileMime: file.type || "application/octet-stream",
        fileSize: file.size,
      }));
      toast({ title: "Dosya yüklendi" });
    } catch (err: any) {
      toast({ title: "Yükleme başarısız", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form.universityId) { toast({ title: "Üniversite seçin", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body: any = {
        universityId: parseInt(form.universityId, 10),
        destinationId: form.destinationId ? parseInt(form.destinationId, 10) : null,
        year: form.year ? parseInt(form.year, 10) : null,
        effectiveDate: form.effectiveDate || null,
        expiryDate: form.expiryDate || null,
        notes: form.notes || null,
        assignedUserIds: form.assignedUserIds,
      };
      if (form.fileObjectKey && (!editing || form.fileObjectKey !== editing.fileObjectKey)) {
        body.fileObjectKey = form.fileObjectKey;
        body.fileName = form.fileName;
        body.fileMime = form.fileMime;
        body.fileSize = form.fileSize;
      }
      if (editing) {
        await customFetch(`/api/university-contracts/${editing.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "Sözleşme güncellendi" });
      } else {
        await customFetch(`/api/university-contracts`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "Sözleşme oluşturuldu" });
      }

      // Persist per-university assigned staff if changed.
      const a = [...form.universityAssignedStaffIds].sort((x, y) => x - y);
      const b = [...originalUniStaffIds].sort((x, y) => x - y);
      const changed = a.length !== b.length || a.some((v, i) => v !== b[i]);
      if (changed && body.universityId) {
        try {
          await customFetch(`/api/universities/${body.universityId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignedStaffIds: a }),
          });
        } catch (err: any) {
          toast({ title: "Üniversite personel listesi güncellenemedi", description: err.message, variant: "destructive" });
        }
      }
      setShowDialog(false);
      await load();
    } catch (err: any) {
      toast({ title: "Kayıt başarısız", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function performDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    try {
      await customFetch(`/api/university-contracts/${id}`, { method: "DELETE" });
      toast({ title: "Çöpe taşındı", description: "Sözleşme çöpe taşındı ve listeden kaldırıldı." });
      setConfirmDelete(null);
      await load();
    } catch (err: any) {
      toast({ title: "Silme hatası", description: err.message, variant: "destructive" });
    }
  }

  async function download(c: Contract) {
    try {
      const res = await fetch(`/api/university-contracts/${c.id}/file`, { credentials: "include" });
      if (!res.ok) throw new Error("İndirme başarısız");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = c.fileName || `contract-${c.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "İndirilemedi", description: err.message, variant: "destructive" });
    }
  }

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.trim().toLowerCase();
    return rows.filter(r =>
      (r.universityName || "").toLowerCase().includes(term) ||
      (r.country || "").toLowerCase().includes(term) ||
      (r.fileName || "").toLowerCase().includes(term),
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    const s = { total: rows.length, active: 0, expiring: 0, expired: 0, no_dates: 0 };
    for (const r of rows) {
      if (r.status === "active") s.active++;
      else if (r.status === "expiring_soon") s.expiring++;
      else if (r.status === "expired") s.expired++;
      else s.no_dates++;
    }
    return s;
  }, [rows]);

  return (
    <TooltipProvider>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GraduationCap className="w-6 h-6" /> Üniversite Sözleşmeleri
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Üniversitelerle yapılan sözleşmeleri yönetin. Sona erme tarihinden 30, 14, 7 ve 1 gün önce ve bittiği gün otomatik bildirim gönderilir.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Yeni sözleşme</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Toplam</div><div className="text-2xl font-bold mt-1">{stats.total}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Aktif</div><div className="text-2xl font-bold mt-1 text-green-600">{stats.active}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Yakında sona eriyor</div><div className="text-2xl font-bold mt-1 text-amber-600">{stats.expiring}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Sona erdi</div><div className="text-2xl font-bold mt-1 text-red-600">{stats.expired}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Tarih yok</div><div className="text-2xl font-bold mt-1 text-muted-foreground">{stats.no_dates}</div></Card>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Ara</Label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Üniversite, ülke, dosya..." className="pl-8" />
          </div>
        </div>
        <div className="min-w-[220px]">
          <Label className="text-xs">Üniversite</Label>
          <Select value={filterUniversity} onValueChange={setFilterUniversity}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-[320px]">
              <SelectItem value="all">Tümü</SelectItem>
              {universities.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs">Ülke</Label>
          <Select value={filterCountry} onValueChange={setFilterCountry}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs">Durum</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="expiring_soon">Yakında sona eriyor</SelectItem>
              <SelectItem value="expired">Sona erdi</SelectItem>
              <SelectItem value="no_dates">Tarih yok</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[120px]">
          <Label className="text-xs">Yıl</Label>
          <Input type="number" value={filterYear} onChange={e => setFilterYear(e.target.value)} placeholder="2025" />
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">Sözleşme bulunamadı.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-4 py-3">Üniversite</th>
                  <th className="text-left px-4 py-3">Destinasyon</th>
                  <th className="text-left px-4 py-3">Yıl</th>
                  <th className="text-left px-4 py-3">Geçerlilik</th>
                  <th className="text-left px-4 py-3">Bitiş</th>
                  <th className="text-left px-4 py-3">Kalan gün</th>
                  <th className="text-left px-4 py-3">Durum</th>
                  <th className="text-left px-4 py-3">Dosya</th>
                  <th className="text-right px-4 py-3">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(c => {
                  const meta = STATUS_LABELS[c.status];
                  const Icon = meta.icon;
                  const dl = daysLeft(c.expiryDate);
                  // Prefer destination joined from API by destinationId; fall
                  // back to country-based lookup only when destinationId is
                  // not set on the contract.
                  const dest = c.destinationName
                    ? { name: c.destinationName, flagEmoji: c.destinationFlagEmoji || null }
                    : destByCountry[c.country];
                  const tooltipText = dl === null ? "No expiry date set" :
                    dl < 0 ? `Expired ${Math.abs(dl)} day${Math.abs(dl) === 1 ? "" : "s"} ago` :
                    `Expires on ${formatDate(c.expiryDate)}`;
                  const daysCellText = dl === null ? "-" :
                    dl < 0 ? `−${Math.abs(dl)} g` :
                    dl === 0 ? "Bugün" :
                    `${dl} g`;
                  const daysCellTone = dl === null ? "text-muted-foreground" :
                    dl < 0 ? "text-red-600 font-semibold" :
                    dl <= 7 ? "text-red-600 font-semibold" :
                    dl <= 30 ? "text-amber-600 font-medium" :
                    "text-foreground";
                  return (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">
                        <span className="inline-flex items-center gap-2">
                          {c.universityLogoUrl ? (
                            <img src={c.universityLogoUrl} alt="" className="w-6 h-6 rounded object-cover bg-muted" />
                          ) : (
                            <span className="w-6 h-6 rounded bg-muted inline-flex items-center justify-center text-[10px] text-muted-foreground">
                              {(c.universityName || "?").slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span>{c.universityName || `#${c.universityId}`}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-base leading-none">{dest?.flagEmoji || "🌍"}</span>
                          <span>{dest?.name || c.country}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">{c.year ?? "-"}</td>
                      <td className="px-4 py-3">{formatDate(c.effectiveDate)}</td>
                      <td className="px-4 py-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-2">{formatDate(c.expiryDate)}</span>
                          </TooltipTrigger>
                          <TooltipContent>{tooltipText}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`cursor-help ${daysCellTone}`}>{daysCellText}</span>
                          </TooltipTrigger>
                          <TooltipContent>{tooltipText}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={meta.tone}><Icon className="w-3 h-3 mr-1" />{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {c.fileObjectKey ? (
                          <Button variant="ghost" size="sm" onClick={() => download(c)}>
                            <Download className="w-4 h-4 mr-1" /> {c.fileName ? (c.fileName.length > 24 ? c.fileName.slice(0, 24) + "…" : c.fileName) : "İndir"}
                          </Button>
                        ) : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Edit className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(c)}><Trash2 className="w-4 h-4 text-red-600" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Sözleşmeyi düzenle" : "Yeni sözleşme"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label>Üniversite *</Label>
              <Select value={form.universityId} onValueChange={onUniversityChange}>
                <SelectTrigger><SelectValue placeholder="Seçin..." /></SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  {universities.map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name} — {u.country}{u.city ? `, ${u.city}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Destinasyon (otomatik doldurulur)</Label>
              <Select value={form.destinationId} onValueChange={v => setForm(f => ({ ...f, destinationId: v }))}>
                <SelectTrigger><SelectValue placeholder="Üniversite seçildiğinde otomatik atanır" /></SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  {destinations.map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      <span className="inline-flex items-center gap-2">
                        <span>{d.flagEmoji || "🌍"}</span>
                        <span>{d.name} — {d.country}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Yıl</Label>
              <Input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} placeholder="2025" />
            </div>
            <div></div>
            <div>
              <Label>Geçerlilik tarihi</Label>
              <Input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} />
            </div>
            <div>
              <Label>Bitiş tarihi</Label>
              <Input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Notlar</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
            </div>
            <div className="col-span-2">
              <Label>Üniversiteden sorumlu personel</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Bu üniversiteyle ilgili tüm sözleşme uyarıları aşağıdaki personele de gider. Liste, üniversite kaydında saklanır.
              </p>
              <div className="border rounded-md max-h-40 overflow-y-auto p-2 space-y-1 bg-muted/20">
                {!form.universityId ? (
                  <div className="text-xs text-muted-foreground">Önce üniversite seçin.</div>
                ) : staffUsers.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Personel bulunamadı.</div>
                ) : staffUsers.map(u => {
                  const checked = form.universityAssignedStaffIds.includes(u.id);
                  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || `#${u.id}`;
                  return (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer text-sm hover:bg-background/60 rounded px-2 py-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setForm(f => ({
                          ...f,
                          universityAssignedStaffIds: checked
                            ? f.universityAssignedStaffIds.filter(id => id !== u.id)
                            : [...f.universityAssignedStaffIds, u.id],
                        }))}
                      />
                      <span>{name}</span>
                      <span className="text-xs text-muted-foreground">({u.role})</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="col-span-2">
              <Label>Bu sözleşmeye özel ek personel (opsiyonel)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Aktif yöneticiler ve üniversiteden sorumlu personel her durumda bildirim alır. Burada yalnızca bu sözleşme için ek kişi ekleyebilirsiniz.
              </p>
              <div className="border rounded-md max-h-40 overflow-y-auto p-2 space-y-1 bg-muted/20">
                {staffUsers.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Personel bulunamadı.</div>
                ) : staffUsers.map(u => {
                  const checked = form.assignedUserIds.includes(u.id);
                  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || `#${u.id}`;
                  return (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer text-sm hover:bg-background/60 rounded px-2 py-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setForm(f => ({
                          ...f,
                          assignedUserIds: checked
                            ? f.assignedUserIds.filter(id => id !== u.id)
                            : [...f.assignedUserIds, u.id],
                        }))}
                      />
                      <span>{name}</span>
                      <span className="text-xs text-muted-foreground">({u.role})</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="col-span-2">
              <Label>Dosya (PDF veya DOCX)</Label>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                  {form.fileObjectKey ? "Dosyayı değiştir" : "Dosya yükle"}
                </Button>
                {form.fileName && <span className="text-sm text-muted-foreground">{form.fileName}</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Yalnızca PDF veya DOCX dosyaları kabul edilir.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>İptal</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sözleşmeyi çöpe taşı?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? `${confirmDelete.universityName || "Sözleşme"} kaydı çöpe taşınacak ve listeden kaldırılacak. Bu işlem geri alınabilir.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className="bg-red-600 hover:bg-red-700">Çöpe taşı</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  );
}
