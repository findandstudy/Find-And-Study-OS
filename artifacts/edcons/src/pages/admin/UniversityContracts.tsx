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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  createdAt: string;
  universityName?: string | null;
  status: Status;
};

type University = { id: number; name: string; country: string; city: string | null };

type FormState = {
  universityId: string;
  year: string;
  effectiveDate: string;
  expiryDate: string;
  notes: string;
  fileObjectKey: string;
  fileName: string;
  fileMime: string;
  fileSize: number | null;
};

const emptyForm: FormState = {
  universityId: "",
  year: "",
  effectiveDate: "",
  expiryDate: "",
  notes: "",
  fileObjectKey: "",
  fileName: "",
  fileMime: "",
  fileSize: null,
};

const STATUS_LABELS: Record<Status, { label: string; tone: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  active: { label: "Aktif", tone: "outline", icon: CheckCircle2 },
  expiring_soon: { label: "Yakında sona eriyor", tone: "secondary", icon: AlertTriangle },
  expired: { label: "Sona erdi", tone: "destructive", icon: AlertOctagon },
  no_dates: { label: "Tarih yok", tone: "outline", icon: FileText },
};

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

export default function UniversityContractsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Contract[]>([]);
  const [universities, setUniversities] = useState<University[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>("");
  const [search, setSearch] = useState("");

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCountry !== "all") params.set("country", filterCountry);
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
      const [unis, cs]: any = await Promise.all([
        customFetch(`/api/universities?limit=500`),
        customFetch(`/api/universities/countries`),
      ]);
      setUniversities(unis.data || []);
      setCountries(cs || []);
    } catch {}
  }

  useEffect(() => { loadMeta(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterCountry, filterStatus, filterYear]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowDialog(true);
  }

  function openEdit(c: Contract) {
    setEditing(c);
    setForm({
      universityId: String(c.universityId),
      year: c.year != null ? String(c.year) : "",
      effectiveDate: c.effectiveDate ? c.effectiveDate.slice(0, 10) : "",
      expiryDate: c.expiryDate ? c.expiryDate.slice(0, 10) : "",
      notes: c.notes || "",
      fileObjectKey: c.fileObjectKey || "",
      fileName: c.fileName || "",
      fileMime: c.fileMime || "",
      fileSize: c.fileSize ?? null,
    });
    setShowDialog(true);
  }

  async function uploadFile(file: File) {
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
        year: form.year ? parseInt(form.year, 10) : null,
        effectiveDate: form.effectiveDate || null,
        expiryDate: form.expiryDate || null,
        notes: form.notes || null,
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
        if (form.fileObjectKey) {
          body.fileObjectKey = form.fileObjectKey;
          body.fileName = form.fileName;
          body.fileMime = form.fileMime;
          body.fileSize = form.fileSize;
        }
        await customFetch(`/api/university-contracts`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "Sözleşme oluşturuldu" });
      }
      setShowDialog(false);
      await load();
    } catch (err: any) {
      toast({ title: "Kayıt başarısız", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function remove(id: number) {
    if (!confirm("Bu sözleşmeyi silmek istediğinizden emin misiniz?")) return;
    try {
      await customFetch(`/api/university-contracts/${id}`, { method: "DELETE" });
      toast({ title: "Silindi" });
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
                  <th className="text-left px-4 py-3">Ülke</th>
                  <th className="text-left px-4 py-3">Yıl</th>
                  <th className="text-left px-4 py-3">Geçerlilik</th>
                  <th className="text-left px-4 py-3">Bitiş</th>
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
                  return (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{c.universityName || `#${c.universityId}`}</td>
                      <td className="px-4 py-3">{c.country}</td>
                      <td className="px-4 py-3">{c.year ?? "-"}</td>
                      <td className="px-4 py-3">{formatDate(c.effectiveDate)}</td>
                      <td className="px-4 py-3">
                        {formatDate(c.expiryDate)}
                        {dl !== null && c.status !== "expired" && (
                          <div className="text-xs text-muted-foreground">{dl > 0 ? `${dl} gün kaldı` : ""}</div>
                        )}
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
                        <Button variant="ghost" size="sm" onClick={() => remove(c.id)}><Trash2 className="w-4 h-4 text-red-600" /></Button>
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
              <Select value={form.universityId} onValueChange={v => setForm(f => ({ ...f, universityId: v }))}>
                <SelectTrigger><SelectValue placeholder="Seçin..." /></SelectTrigger>
                <SelectContent>
                  {universities.map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name} — {u.country}{u.city ? `, ${u.city}` : ""}</SelectItem>
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
              <Label>Dosya</Label>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                  {form.fileObjectKey ? "Dosyayı değiştir" : "Dosya yükle"}
                </Button>
                {form.fileName && <span className="text-sm text-muted-foreground">{form.fileName}</span>}
              </div>
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
    </div>
  );
}
