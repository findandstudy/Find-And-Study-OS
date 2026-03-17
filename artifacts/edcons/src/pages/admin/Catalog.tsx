import { useState, useRef, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Building2, GraduationCap, BookOpen, Plus, Upload, Download, Search, Pencil, Trash2, ChevronLeft, ChevronRight, AlertTriangle, ImageIcon, Lock, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

/* ─── helpers ──────────────────────────────────────────────── */

async function api(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (r.status === 204) return undefined;
  return r.json();
}

async function apiDelete(url: string) {
  await fetch(url, { method: "DELETE", credentials: "include" });
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback((v: T) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedValue(v), delay);
  }, [delay]);
  if (value !== debouncedValue) update(value);
  return debouncedValue;
}

/* ─── types ─────────────────────────────────────────────────── */

type Country = { id: number; name: string; code: string; flagEmoji?: string | null; isActive: boolean };
type City = { id: number; name: string; countryId: number; isActive: boolean };
type University = {
  id: number; name: string; country: string; city?: string | null; website?: string | null;
  description?: string | null; ranking?: number | null; logoUrl?: string | null; isActive: boolean;
  universityType?: string | null; taxType?: string | null; taxPercent?: number | null;
  qsRanking?: number | null; timesRanking?: number | null; shanghaiRanking?: number | null;
  cwtsLeidenRanking?: number | null; address?: string | null; onlinePaymentUrl?: string | null;
  cricosLink?: string | null; documentsLink?: string | null; currentFeeListLink?: string | null;
  initialDepositOptions?: string | null; admissionProcess?: string | null;
  contactPersonName?: string | null; contactPersonPhone?: string | null; contactPersonEmail?: string | null;
  status: string;
};
type Program = { id: number; universityId: number; name: string; degree?: string | null; field?: string | null; language?: string | null; duration?: string | null; tuitionFee?: number | null; currency?: string | null; scholarship?: number | null; intakes?: string | null; requirements?: string | null; commissionRate?: number | null; applicationFee?: number | null; advancedFee?: number | null; depositFee?: number | null; serviceFeeAmount?: number | null; discountedFee?: number | null; languageFee?: number | null; isActive: boolean };

/* ─── BulkImportModal ─────────────────────────────────────── */

function BulkImportModal({ open, onClose, title, template, headers, onImport }: {
  open: boolean; onClose: () => void; title: string;
  template: string; headers: string; onImport: (rows: Record<string, string>[]) => Promise<{ inserted: number; skipped: number }>;
}) {
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) { setError("CSV boş veya hatalı format"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await onImport(rows);
      setResult(res);
    } catch { setError("İçe aktarma başarısız oldu. Lütfen format şablonunu kontrol edin."); }
    finally { setLoading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const reset = () => { setResult(null); setError(""); onClose(); };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>CSV İle Toplu Ekle — {title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-medium mb-1">CSV Sütun Başlıkları:</p>
            <code className="text-xs text-muted-foreground break-all">{headers}</code>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadCsv(template, `${title.toLowerCase().replace(/\s/g, "_")}_template.csv`)}>
            <Download className="h-4 w-4 mr-2" /> Şablon İndir (.csv)
          </Button>
          <div>
            <Label htmlFor="csvfile">CSV Dosyası Seç</Label>
            <Input id="csvfile" ref={fileRef} type="file" accept=".csv,text/csv" className="mt-1" onChange={handleFile} disabled={loading} />
          </div>
          {loading && <p className="text-sm text-muted-foreground animate-pulse">İşleniyor…</p>}
          {error && <p className="text-sm text-destructive flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</p>}
          {result && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm space-y-1">
              <p className="font-medium text-green-700">İçe aktarma tamamlandı</p>
              <p className="text-green-600">Eklendi: <strong>{result.inserted}</strong> — Atlandı (mevcut): <strong>{result.skipped}</strong></p>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={reset}>Kapat</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Pagination ─────────────────────────────────────────── */
function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-end mt-4">
      <Button size="icon" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
      <Button size="icon" variant="ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   COUNTRIES TAB
══════════════════════════════════════════════════════════ */
function CountriesTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const dSearch = useDebounce(search);
  const [form, setForm] = useState<Partial<Country> | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [delId, setDelId] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["countries", page, dSearch],
    queryFn: () => api(`/api/countries?page=${page}&limit=50${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ""}`),
  });
  const countries: Country[] = data?.data ?? [];
  const totalPages = Math.ceil((data?.meta?.total ?? 0) / 50);

  const save = useMutation({
    mutationFn: async (f: Partial<Country>) => f.id
      ? api(`/api/countries/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) })
      : api("/api/countries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["countries"] }); setForm(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/countries/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["countries"] }); setDelId(null); },
  });

  const handleBulkImport = async (rows: Record<string, string>[]) => {
    const res = await api("/api/countries/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
    qc.invalidateQueries({ queryKey: ["countries"] });
    return res;
  };

  const template = "name,code,flagEmoji\nTürkiye,TR,🇹🇷\nUnited Kingdom,GB,🇬🇧\nGermany,DE,🇩🇪\nFrance,FR,🇫🇷";
  const headers = "name, code, flagEmoji (opsiyonel)";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Ülke ara…" className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Button variant="outline" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4 mr-2" />CSV İle Ekle</Button>
        <Button onClick={() => setForm({ isActive: true })}><Plus className="h-4 w-4 mr-2" />Ülke Ekle</Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Ülke</th>
              <th className="text-left px-4 py-2 font-medium">Kod</th>
              <th className="text-left px-4 py-2 font-medium">Durum</th>
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {countries.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">Ülke bulunamadı</td></tr>
            )}
            {countries.map(c => (
              <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 font-medium">{c.flagEmoji ? `${c.flagEmoji} ` : ""}{c.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground font-mono">{c.code}</td>
                <td className="px-4 py-2.5">
                  <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">{c.isActive ? "Aktif" : "Pasif"}</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setForm(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDelId(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      {/* Add/Edit Modal */}
      <Dialog open={form !== null} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{form?.id ? "Ülkeyi Düzenle" : "Yeni Ülke"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Ülke Adı *</Label><Input className="mt-1" value={form?.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>ISO Kodu (2 harf) *</Label><Input className="mt-1 uppercase" maxLength={2} value={form?.code ?? ""} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} /></div>
            <div><Label>Bayrak Emoji</Label><Input className="mt-1" placeholder="🇹🇷" value={form?.flagEmoji ?? ""} onChange={e => setForm(f => ({ ...f, flagEmoji: e.target.value }))} /></div>
            <div className="flex items-center justify-between">
              <Label>Aktif</Label>
              <Switch checked={form?.isActive ?? true} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>İptal</Button>
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending || !form?.name || !form?.code}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={delId !== null} onOpenChange={o => !o && setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Ülkeyi Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Bu ülkeyi silmek istediğinizden emin misiniz?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>Sil</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Ülkeler" template={template} headers={headers} onImport={handleBulkImport} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CITIES TAB
══════════════════════════════════════════════════════════ */
function CitiesTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterCountry, setFilterCountry] = useState("all");
  const dSearch = useDebounce(search);
  const [form, setForm] = useState<Partial<City> | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [delId, setDelId] = useState<number | null>(null);

  const { data: countriesData } = useQuery({
    queryKey: ["countries", 1, ""],
    queryFn: () => api("/api/countries?limit=500"),
  });
  const countries: Country[] = countriesData?.data ?? [];
  const countryMap: Record<number, Country> = Object.fromEntries(countries.map(c => [c.id, c]));

  const { data } = useQuery({
    queryKey: ["cities", page, dSearch, filterCountry],
    queryFn: () => api(`/api/cities?page=${page}&limit=50${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ""}${filterCountry !== "all" ? `&countryId=${filterCountry}` : ""}`),
  });
  const cities: City[] = data?.data ?? [];
  const totalPages = Math.ceil((data?.meta?.total ?? 0) / 50);

  const save = useMutation({
    mutationFn: async (f: Partial<City>) => f.id
      ? api(`/api/cities/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) })
      : api("/api/cities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); setForm(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/cities/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); setDelId(null); },
  });

  const handleBulkImport = async (rows: Record<string, string>[]) => {
    const res = await api("/api/cities/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
    qc.invalidateQueries({ queryKey: ["cities"] });
    return res;
  };

  const template = "name,countryCode\nİstanbul,TR\nAnkara,TR\nLondon,GB\nBerlin,DE";
  const headers = "name, countryCode (ISO 2 harfli ülke kodu)";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Şehir ara…" className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={filterCountry} onValueChange={v => { setFilterCountry(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Tüm ülkeler" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm ülkeler</SelectItem>
            {countries.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.flagEmoji ? `${c.flagEmoji} ` : ""}{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4 mr-2" />CSV İle Ekle</Button>
        <Button onClick={() => setForm({ isActive: true })}><Plus className="h-4 w-4 mr-2" />Şehir Ekle</Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Şehir</th>
              <th className="text-left px-4 py-2 font-medium">Ülke</th>
              <th className="text-left px-4 py-2 font-medium">Durum</th>
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {cities.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">Şehir bulunamadı</td></tr>
            )}
            {cities.map(c => (
              <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{countryMap[c.countryId]?.flagEmoji ?? ""} {countryMap[c.countryId]?.name ?? c.countryId}</td>
                <td className="px-4 py-2.5">
                  <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">{c.isActive ? "Aktif" : "Pasif"}</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setForm(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDelId(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      <Dialog open={form !== null} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{form?.id ? "Şehri Düzenle" : "Yeni Şehir"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Şehir Adı *</Label><Input className="mt-1" value={form?.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <Label>Ülke *</Label>
              <Select value={form?.countryId ? String(form.countryId) : ""} onValueChange={v => setForm(f => ({ ...f, countryId: Number(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Ülke seçin" /></SelectTrigger>
                <SelectContent>{countries.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.flagEmoji ? `${c.flagEmoji} ` : ""}{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Aktif</Label>
              <Switch checked={form?.isActive ?? true} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>İptal</Button>
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending || !form?.name || !form?.countryId}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delId !== null} onOpenChange={o => !o && setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Şehri Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Bu şehri silmek istediğinizden emin misiniz?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>Sil</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Şehirler" template={template} headers={headers} onImport={handleBulkImport} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   UNIVERSITIES TAB
══════════════════════════════════════════════════════════ */
function UniversitiesTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const dSearch = useDebounce(search);
  const [form, setForm] = useState<Partial<University> | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [delId, setDelId] = useState<number | null>(null);
  const [selCountryId, setSelCountryId] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["universities", page, dSearch],
    queryFn: () => api(`/api/universities?page=${page}&limit=30${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ""}`),
  });
  const universities: University[] = data?.data ?? [];
  const totalPages = data?.meta?.totalPages ?? 1;

  const { data: allCountriesResp } = useQuery({
    queryKey: ["all-countries-uni"],
    queryFn: () => api("/api/countries?limit=500"),
  });
  const allCountries: Country[] = allCountriesResp?.data ?? [];

  const { data: formCitiesResp } = useQuery({
    queryKey: ["form-cities-uni", selCountryId],
    queryFn: () => api(`/api/cities?countryId=${selCountryId}&limit=500`),
    enabled: selCountryId != null,
  });
  const formCities: City[] = formCitiesResp?.data ?? [];

  const save = useMutation({
    mutationFn: async (f: Partial<University>) => f.id
      ? api(`/api/universities/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) })
      : api("/api/universities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["universities"] }); setForm(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/universities/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["universities"] }); setDelId(null); },
  });

  const handleBulkImport = async (rows: Record<string, string>[]) => {
    const res = await api("/api/universities/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
    qc.invalidateQueries({ queryKey: ["universities"] });
    return res;
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setForm(f => ({ ...f, logoUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const setF = (updates: Partial<University>) => setForm(f => ({ ...f, ...updates } as Partial<University>));

  const template = `name,country,city,website,description,ranking\nIstanbul University,Turkey,Istanbul,https://www.istanbul.edu.tr,Leading state university,351\nMiddle East Technical University,Turkey,Ankara,https://www.metu.edu.tr,Top technical university,601\nKing's College London,United Kingdom,London,https://www.kcl.ac.uk,Russell Group university,35`;
  const headers = "name*, country*, city, website, description, ranking";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Üniversite ara…" className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Button variant="outline" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4 mr-2" />CSV İle Ekle</Button>
        <Button onClick={() => { setForm({ isActive: true, status: "open" }); setSelCountryId(null); }}><Plus className="h-4 w-4 mr-2" />Üniversite Ekle</Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Üniversite</th>
              <th className="text-left px-4 py-2 font-medium">Ülke / Şehir</th>
              <th className="text-left px-4 py-2 font-medium">Tür</th>
              <th className="text-left px-4 py-2 font-medium">QS</th>
              <th className="text-left px-4 py-2 font-medium">Durum</th>
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {universities.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Üniversite bulunamadı</td></tr>
            )}
            {universities.map(u => (
              <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {u.logoUrl
                      ? <img src={u.logoUrl} alt={u.name} className="w-7 h-7 rounded object-contain border bg-white" />
                      : <div className="w-7 h-7 rounded border bg-muted flex items-center justify-center"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /></div>
                    }
                    <div>
                      <div className="font-medium">{u.name}</div>
                      {u.website && <a href={u.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{u.website}</a>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.country}{u.city ? `, ${u.city}` : ""}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">
                  {u.universityType === "state" ? "Devlet" : u.universityType === "private" ? "Özel" : u.universityType === "foundation" ? "Vakıf" : u.universityType ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.qsRanking ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <Badge variant={u.status === "open" ? "default" : "secondary"} className="text-xs w-fit">
                      {u.status === "open" ? "Açık" : "Kapalı"}
                    </Badge>
                    {!u.isActive && <Badge variant="outline" className="text-xs w-fit text-muted-foreground">Pasif</Badge>}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setForm(u); setSelCountryId(allCountries.find(c => c.name === u.country)?.id ?? null); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDelId(u.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      <Dialog open={form !== null} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Üniversiteyi Düzenle" : "Yeni Üniversite"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">

            {/* ── Logo ──────────────────────────────── */}
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-lg border-2 border-dashed bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {form?.logoUrl
                  ? <img src={form.logoUrl} alt="logo" className="w-full h-full object-contain" />
                  : <ImageIcon className="h-8 w-8 text-muted-foreground" />
                }
              </div>
              <div className="flex-1">
                <Label className="text-sm font-medium">Üniversite Logosu</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">PNG, JPG veya SVG yükleyin</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5 mr-1.5" />Dosya Seç
                  </Button>
                  {form?.logoUrl && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setF({ logoUrl: undefined })}>
                      Kaldır
                    </Button>
                  )}
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                <div className="mt-2">
                  <Input placeholder="veya Logo URL yapıştırın…" className="text-xs h-8"
                    value={form?.logoUrl?.startsWith("data:") ? "" : form?.logoUrl ?? ""}
                    onChange={e => setF({ logoUrl: e.target.value || undefined })}
                  />
                </div>
              </div>
            </div>

            {/* ── Temel Bilgiler ─────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Temel Bilgiler</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Üniversite Adı *</Label>
                  <Input className="mt-1" value={form?.name ?? ""} onChange={e => setF({ name: e.target.value })} />
                </div>
                <div>
                  <Label>Ülke *</Label>
                  <Select
                    value={form?.country ?? ""}
                    onValueChange={v => {
                      const found = allCountries.find(c => c.name === v);
                      setF({ country: v, city: null });
                      setSelCountryId(found?.id ?? null);
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Ülke seçin…" />
                    </SelectTrigger>
                    <SelectContent>
                      {allCountries.map(c => (
                        <SelectItem key={c.id} value={c.name}>
                          {c.flagEmoji ? `${c.flagEmoji} ` : ""}{c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Şehir</Label>
                  <Select
                    value={form?.city ?? ""}
                    onValueChange={v => setF({ city: v || null })}
                    disabled={!selCountryId}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder={selCountryId ? "Şehir seçin…" : "Önce ülke seçin"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">— Şehir seçmeyin —</SelectItem>
                      {formCities.map(c => (
                        <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Üniversite Türü</Label>
                  <Select value={form?.universityType ?? ""} onValueChange={v => setF({ universityType: v || null })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Tür seçin…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="state">Devlet</SelectItem>
                      <SelectItem value="private">Özel</SelectItem>
                      <SelectItem value="foundation">Vakıf</SelectItem>
                      <SelectItem value="other">Diğer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Başvuru Durumu</Label>
                  <Select value={form?.status ?? "open"} onValueChange={v => setF({ status: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Açık</SelectItem>
                      <SelectItem value="closed">Kapalı</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Adres</Label>
                  <Input className="mt-1" placeholder="Tam adres…" value={form?.address ?? ""} onChange={e => setF({ address: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label>Açıklama</Label>
                  <Textarea className="mt-1" rows={2} value={form?.description ?? ""} onChange={e => setF({ description: e.target.value })} />
                </div>
                <div className="col-span-2 flex items-center justify-between">
                  <Label>Sistemde Aktif</Label>
                  <Switch checked={form?.isActive ?? true} onCheckedChange={v => setF({ isActive: v })} />
                </div>
              </div>
            </div>

            {/* ── Vergi ─────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Vergi Bilgileri</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Vergi Türü</Label>
                  <Input className="mt-1" placeholder="KDV, Stopaj…" value={form?.taxType ?? ""} onChange={e => setF({ taxType: e.target.value })} />
                </div>
                <div>
                  <Label>Vergi Oranı (%)</Label>
                  <Input className="mt-1" type="number" step="0.01" placeholder="18" value={form?.taxPercent ?? ""} onChange={e => setF({ taxPercent: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
              </div>
            </div>

            {/* ── Sıralamalar ───────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Dünya Sıralamaları</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>QS World Ranking</Label>
                  <Input className="mt-1" type="number" placeholder="—" value={form?.qsRanking ?? ""} onChange={e => setF({ qsRanking: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
                <div>
                  <Label>Times Higher Education</Label>
                  <Input className="mt-1" type="number" placeholder="—" value={form?.timesRanking ?? ""} onChange={e => setF({ timesRanking: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
                <div>
                  <Label>Shanghai (ARWU)</Label>
                  <Input className="mt-1" type="number" placeholder="—" value={form?.shanghaiRanking ?? ""} onChange={e => setF({ shanghaiRanking: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
                <div>
                  <Label>CWTS Leiden</Label>
                  <Input className="mt-1" type="number" placeholder="—" value={form?.cwtsLeidenRanking ?? ""} onChange={e => setF({ cwtsLeidenRanking: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
              </div>
            </div>

            {/* ── Bağlantılar ───────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Bağlantılar ve Belgeler</p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label>Website</Label>
                  <div className="flex gap-2 mt-1">
                    <Input placeholder="https://university.edu" value={form?.website ?? ""} onChange={e => setF({ website: e.target.value })} />
                    {form?.website && <a href={form.website} target="_blank" rel="noopener noreferrer"><Button type="button" variant="ghost" size="icon"><ExternalLink className="h-4 w-4" /></Button></a>}
                  </div>
                </div>
                <div>
                  <Label>Online Ödeme Linki</Label>
                  <Input className="mt-1" placeholder="https://…" value={form?.onlinePaymentUrl ?? ""} onChange={e => setF({ onlinePaymentUrl: e.target.value })} />
                </div>
                <div>
                  <Label>CRICOS Linki</Label>
                  <Input className="mt-1" placeholder="https://cricos.education.gov.au/…" value={form?.cricosLink ?? ""} onChange={e => setF({ cricosLink: e.target.value })} />
                </div>
                <div>
                  <Label>Belgeler Linki</Label>
                  <Input className="mt-1" placeholder="https://…" value={form?.documentsLink ?? ""} onChange={e => setF({ documentsLink: e.target.value })} />
                </div>
                <div>
                  <Label>Güncel Ücret Listesi</Label>
                  <Input className="mt-1" placeholder="https://…" value={form?.currentFeeListLink ?? ""} onChange={e => setF({ currentFeeListLink: e.target.value })} />
                </div>
              </div>
            </div>

            {/* ── Kabul Süreci ──────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Kabul Süreci</p>
              <div className="space-y-3">
                <div>
                  <Label>Başlangıç Depozito Seçenekleri</Label>
                  <Textarea className="mt-1" rows={2} placeholder="Depozito miktarları ve koşulları…" value={form?.initialDepositOptions ?? ""} onChange={e => setF({ initialDepositOptions: e.target.value })} />
                </div>
                <div>
                  <Label>Kabul Süreci Açıklaması</Label>
                  <Textarea className="mt-1" rows={3} placeholder="Adım adım başvuru ve kabul süreci…" value={form?.admissionProcess ?? ""} onChange={e => setF({ admissionProcess: e.target.value })} />
                </div>
              </div>
            </div>

            {/* ── İletişim (sadece Super Admin) ─────── */}
            {isSuperAdmin && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lock className="h-4 w-4 text-amber-600" />
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">İletişim Kişisi — Sadece Super Admin</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label>İsim Soyisim</Label>
                    <Input className="mt-1 bg-white" placeholder="John Doe" value={form?.contactPersonName ?? ""} onChange={e => setF({ contactPersonName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Telefon</Label>
                    <Input className="mt-1 bg-white" placeholder="+1 555 000 0000" value={form?.contactPersonPhone ?? ""} onChange={e => setF({ contactPersonPhone: e.target.value })} />
                  </div>
                  <div>
                    <Label>E-posta</Label>
                    <Input className="mt-1 bg-white" type="email" placeholder="contact@university.edu" value={form?.contactPersonEmail ?? ""} onChange={e => setF({ contactPersonEmail: e.target.value })} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setForm(null)}>İptal</Button>
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending || !form?.name || !form?.country}>
              {save.isPending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delId !== null} onOpenChange={o => !o && setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Üniversiteyi Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Bu üniversiteyi silmek istediğinizden emin misiniz? Bağlı programlar da etkilenebilir.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>Sil</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Üniversiteler" template={template} headers={headers} onImport={handleBulkImport} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PROGRAMS TAB
══════════════════════════════════════════════════════════ */
function ProgramsTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterUni, setFilterUni] = useState("all");
  const dSearch = useDebounce(search);
  const [form, setForm] = useState<Partial<Program> | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [delId, setDelId] = useState<number | null>(null);

  const { data: unisData } = useQuery({
    queryKey: ["universities", 1, ""],
    queryFn: () => api("/api/universities?limit=500"),
  });
  const universities: University[] = unisData?.data ?? [];
  const uniMap: Record<number, University> = Object.fromEntries(universities.map(u => [u.id, u]));

  const { data } = useQuery({
    queryKey: ["programs", page, dSearch, filterUni],
    queryFn: () => api(`/api/programs?page=${page}&limit=30${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ""}${filterUni !== "all" ? `&universityId=${filterUni}` : ""}`),
  });
  const programs: Program[] = data?.data ?? [];
  const totalPages = data?.meta?.totalPages ?? 1;

  const save = useMutation({
    mutationFn: async (f: Partial<Program>) => f.id
      ? api(`/api/programs/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) })
      : api("/api/programs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["programs"] }); setForm(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/programs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["programs"] }); setDelId(null); },
  });

  const handleBulkImport = async (rows: Record<string, string>[]) => {
    const res = await api("/api/programs/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
    qc.invalidateQueries({ queryKey: ["programs"] });
    return res;
  };

  const template = `universityName,name,degree,field,language,duration,tuitionFee,currency,scholarship,commissionRate,applicationFee,advancedFee,depositFee,serviceFeeAmount,discountedFee,languageFee\nIstanbul University,Computer Engineering,BSc,Engineering,English,4 years,5000,USD,0,10,200,0,500,300,4500,0\nIstanbul University,Business Administration,MBA,Business,English,2 years,8000,USD,2000,12,150,0,500,300,7000,0`;
  const headers = "universityName* (veya universityId*), name*, degree, field, language, duration, tuitionFee, currency, scholarship, commissionRate, applicationFee, advancedFee, depositFee, serviceFeeAmount, discountedFee, languageFee";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Program ara…" className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={filterUni} onValueChange={v => { setFilterUni(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tüm üniversiteler" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm üniversiteler</SelectItem>
            {universities.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4 mr-2" />CSV İle Ekle</Button>
        <Button onClick={() => setForm({ isActive: true, currency: "USD" })}><Plus className="h-4 w-4 mr-2" />Program Ekle</Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Program</th>
              <th className="text-left px-4 py-2 font-medium">Üniversite</th>
              <th className="text-left px-4 py-2 font-medium">Derece / Alan</th>
              <th className="text-left px-4 py-2 font-medium">Ücret</th>
              <th className="text-left px-4 py-2 font-medium">Komisyon</th>
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {programs.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Program bulunamadı</td></tr>
            )}
            {programs.map(p => (
              <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{p.name}</div>
                  {p.language && <span className="text-xs text-muted-foreground">{p.language} {p.duration ? `· ${p.duration}` : ""}</span>}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{uniMap[p.universityId]?.name ?? `#${p.universityId}`}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{[p.degree, p.field].filter(Boolean).join(" / ") || "—"}</td>
                <td className="px-4 py-2.5 text-xs">{p.tuitionFee ? `${p.tuitionFee.toLocaleString()} ${p.currency ?? "USD"}` : "—"}</td>
                <td className="px-4 py-2.5 text-xs">{p.commissionRate != null ? `%${p.commissionRate}` : "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setForm(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDelId(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      <Dialog open={form !== null} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form?.id ? "Programı Düzenle" : "Yeni Program"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Üniversite *</Label>
              <Select value={form?.universityId ? String(form.universityId) : ""} onValueChange={v => setForm(f => ({ ...f, universityId: Number(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Üniversite seçin" /></SelectTrigger>
                <SelectContent>{universities.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Program Adı *</Label><Input className="mt-1" value={form?.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Derece</Label>
                <Select value={form?.degree ?? ""} onValueChange={v => setForm(f => ({ ...f, degree: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seçin" /></SelectTrigger>
                  <SelectContent>
                    {["Certificate", "Associate", "BSc", "BA", "BEng", "MSc", "MA", "MEng", "MBA", "PhD", "Other"].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Alan</Label><Input className="mt-1" placeholder="Engineering" value={form?.field ?? ""} onChange={e => setForm(f => ({ ...f, field: e.target.value }))} /></div>
              <div>
                <Label>Dil</Label>
                <Select value={form?.language ?? ""} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seçin" /></SelectTrigger>
                  <SelectContent>
                    {["English", "Turkish", "Arabic", "French", "Russian", "German", "Other"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Süre</Label><Input className="mt-1" placeholder="4 years" value={form?.duration ?? ""} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} /></div>
              <div>
                <Label>Yıllık Ücret</Label>
                <Input className="mt-1" type="number" value={form?.tuitionFee ?? ""} onChange={e => setForm(f => ({ ...f, tuitionFee: e.target.value ? Number(e.target.value) : undefined }))} />
              </div>
              <div>
                <Label>Para Birimi</Label>
                <Select value={form?.currency ?? "USD"} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["USD", "EUR", "GBP", "TRY", "AED", "CAD", "AUD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Burs</Label><Input className="mt-1" type="number" value={form?.scholarship ?? ""} onChange={e => setForm(f => ({ ...f, scholarship: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Komisyon %</Label><Input className="mt-1" type="number" value={form?.commissionRate ?? ""} onChange={e => setForm(f => ({ ...f, commissionRate: e.target.value ? Number(e.target.value) : undefined }))} /></div>
            </div>

            {/* ── Ek Ücret Alanları ─────────────────────────── */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ek Ücretler ({form?.currency ?? "USD"})</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Application Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = Yok" value={form?.applicationFee ?? ""} onChange={e => setForm(f => ({ ...f, applicationFee: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
                <div>
                  <Label className="text-xs">Advanced Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = Yok" value={form?.advancedFee ?? ""} onChange={e => setForm(f => ({ ...f, advancedFee: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
                <div>
                  <Label className="text-xs">Deposit Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = Yok" value={form?.depositFee ?? ""} onChange={e => setForm(f => ({ ...f, depositFee: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
                <div>
                  <Label className="text-xs">Service Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = Yok" value={form?.serviceFeeAmount ?? ""} onChange={e => setForm(f => ({ ...f, serviceFeeAmount: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
                <div>
                  <Label className="text-xs">Discounted Fee</Label>
                  <Input className="mt-1" type="number" placeholder="İndirimli tutar" value={form?.discountedFee ?? ""} onChange={e => setForm(f => ({ ...f, discountedFee: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
                <div>
                  <Label className="text-xs">Language Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = Yok" value={form?.languageFee ?? ""} onChange={e => setForm(f => ({ ...f, languageFee: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
              </div>
            </div>

            <div><Label>Başvuru Dönemleri</Label><Input className="mt-1" placeholder="Sep, Feb" value={form?.intakes ?? ""} onChange={e => setForm(f => ({ ...f, intakes: e.target.value }))} /></div>
            <div><Label>Gereksinimler</Label><Textarea className="mt-1" rows={2} placeholder="IELTS 6.0, GPA 3.0…" value={form?.requirements ?? ""} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} /></div>
            <div className="flex items-center justify-between">
              <Label>Aktif</Label>
              <Switch checked={form?.isActive ?? true} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>İptal</Button>
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending || !form?.name || !form?.universityId}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delId !== null} onOpenChange={o => !o && setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Programı Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Bu programı silmek istediğinizden emin misiniz?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>Sil</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Programlar" template={template} headers={headers} onImport={handleBulkImport} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════ */
export default function AdminCatalog() {
  const tabs = [
    { value: "countries", label: "Ülkeler", icon: Globe },
    { value: "cities", label: "Şehirler", icon: Building2 },
    { value: "universities", label: "Üniversiteler", icon: GraduationCap },
    { value: "programs", label: "Programlar", icon: BookOpen },
  ];

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Katalog Yönetimi</h1>
        <p className="text-muted-foreground text-sm mt-1">Ülkeler, şehirler, üniversiteler ve programları yönetin</p>
      </div>
      <Tabs defaultValue="countries" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          {tabs.map(t => (
            <TabsTrigger key={t.value} value={t.value} className="flex items-center gap-1.5">
              <t.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="countries">
          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><Globe className="h-4 w-4 text-primary" />Ülkeler</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Sistemdeki tüm ülkeleri yönetin</p>
            </div>
            <CountriesTab />
          </Card>
        </TabsContent>

        <TabsContent value="cities">
          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />Şehirler</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Ülkelere bağlı şehirleri yönetin</p>
            </div>
            <CitiesTab />
          </Card>
        </TabsContent>

        <TabsContent value="universities">
          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><GraduationCap className="h-4 w-4 text-primary" />Üniversiteler</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Partner üniversiteleri ve kurumları yönetin</p>
            </div>
            <UniversitiesTab />
          </Card>
        </TabsContent>

        <TabsContent value="programs">
          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Programlar</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Üniversite programlarını, ücretlerini ve komisyon oranlarını yönetin</p>
            </div>
            <ProgramsTab />
          </Card>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
