import { useState, useRef, useCallback, useMemo } from "react";
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
import { Globe, Building2, GraduationCap, BookOpen, Plus, Upload, Download, Search, Pencil, Trash2, ChevronLeft, ChevronRight, AlertTriangle, ImageIcon, Lock, ExternalLink, ChevronsUpDown, ChevronUp, ChevronDown, Settings2, Loader2, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { CountryFlag } from "@/components/CountryFlag";

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

async function exportToExcel(rows: Record<string, any>[], sheetName: string, filename: string) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
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
type Program = { id: number; universityId: number; name: string; degree?: string | null; field?: string | null; language?: string | null; duration?: string | null; tuitionFee?: number | null; currency?: string | null; scholarship?: number | null; intakes?: string | null; requirements?: string | null; commissionRate?: number | null; applicationFee?: number | null; advancedFee?: number | null; depositFee?: number | null; serviceFeeAmount?: number | null; discountedFee?: number | null; languageFee?: number | null; feeType?: string | null; isActive: boolean };

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
    if (rows.length === 0) { setError("CSV is empty or has invalid format"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await onImport(rows);
      setResult(res);
    } catch { setError("Import failed. Please check the format template."); }
    finally { setLoading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const reset = () => { setResult(null); setError(""); onClose(); };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Bulk Import via CSV — {title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-medium mb-1">CSV Column Headers:</p>
            <code className="text-xs text-muted-foreground break-all">{headers}</code>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadCsv(template, `${title.toLowerCase().replace(/\s/g, "_")}_template.csv`)}>
            <Download className="h-4 w-4 mr-2" /> Download Template (.csv)
          </Button>
          <div>
            <Label htmlFor="csvfile">Select CSV File</Label>
            <Input id="csvfile" ref={fileRef} type="file" accept=".csv,text/csv" className="mt-1" onChange={handleFile} disabled={loading} />
          </div>
          {loading && <p className="text-sm text-muted-foreground animate-pulse">Processing…</p>}
          {error && <p className="text-sm text-destructive flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</p>}
          {result && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm space-y-1">
              <p className="font-medium text-green-700">Import completed</p>
              <p className="text-green-600">Added: <strong>{result.inserted}</strong> — Skipped (existing): <strong>{result.skipped}</strong></p>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={reset}>Close</Button></DialogFooter>
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

/* ─── Sort helpers ──────────────────────────────────────── */
type SortState = { col: string; dir: "asc" | "desc" };

function sortCompare<T>(a: T, b: T, key: keyof T, dir: "asc" | "desc"): number {
  const av = a[key] ?? "";
  const bv = b[key] ?? "";
  const cmp = String(av).localeCompare(String(bv), "tr", { numeric: true, sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

function SortTh({ label, col, sort, onSort, className }: { label: string; col: string; sort: SortState; onSort: (col: string) => void; className?: string }) {
  const active = sort.col === col;
  return (
    <th
      className={`text-left px-4 py-2 font-medium cursor-pointer select-none hover:bg-muted/80 transition-colors ${className ?? ""}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? sort.dir === "asc"
            ? <ChevronUp className="h-3.5 w-3.5 text-primary" />
            : <ChevronDown className="h-3.5 w-3.5 text-primary" />
          : <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50" />
        }
      </span>
    </th>
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
  const [sort, setSort] = useState<SortState>({ col: "name", dir: "asc" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { data } = useQuery({
    queryKey: ["countries", page, dSearch],
    queryFn: () => api(`/api/countries?page=${page}&limit=50${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ""}`),
  });
  const countries: Country[] = data?.data ?? [];
  const totalPages = Math.ceil((data?.meta?.total ?? 0) / 50);

  const sorted = useMemo(() => {
    const colMap: Record<string, keyof Country> = { name: "name", code: "code", status: "isActive" };
    const key = colMap[sort.col] ?? "name";
    return [...countries].sort((a, b) => sortCompare(a, b, key, sort.dir));
  }, [countries, sort]);

  function handleSort(col: string) {
    setSort(s => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" });
  }

  const allSelected = sorted.length > 0 && sorted.every(c => selected.has(c.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map(c => c.id)));
  }
  function toggleOne(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

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

  async function handleBulkDelete() {
    setBulkDeleting(true);
    await Promise.allSettled([...selected].map(id => apiDelete(`/api/countries/${id}`)));
    setSelected(new Set());
    setBulkDelOpen(false);
    setBulkDeleting(false);
    qc.invalidateQueries({ queryKey: ["countries"] });
  }

  const handleBulkImport = async (rows: Record<string, string>[]) => {
    const res = await api("/api/countries/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
    qc.invalidateQueries({ queryKey: ["countries"] });
    return res;
  };

  const template = "name,code,flagEmoji\nTürkiye,TR,🇹🇷\nUnited Kingdom,GB,🇬🇧\nGermany,DE,🇩🇪\nFrance,FR,🇫🇷";
  const headers = "name, code, flagEmoji (optional)";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search countries…" className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); setSelected(new Set()); }} />
        </div>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setBulkDelOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({selected.size})
          </Button>
        )}
        <Button variant="outline" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4 mr-2" />Import CSV</Button>
        <Button onClick={() => setForm({ isActive: true })}><Plus className="h-4 w-4 mr-2" />Add Country</Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded cursor-pointer" />
              </th>
              <SortTh label="Country" col="name" sort={sort} onSort={handleSort} />
              <SortTh label="Code" col="code" sort={sort} onSort={handleSort} />
              <SortTh label="Status" col="status" sort={sort} onSort={handleSort} />
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No countries found</td></tr>
            )}
            {sorted.map(c => (
              <tr key={c.id} className={`hover:bg-muted/20 transition-colors ${selected.has(c.id) ? "bg-primary/5" : ""}`}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="rounded cursor-pointer" />
                </td>
                <td className="px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1.5">{c.code ? <CountryFlag code={c.code} size="md" /> : null}{c.name}</span></td>
                <td className="px-4 py-2.5 text-muted-foreground font-mono">{c.code}</td>
                <td className="px-4 py-2.5">
                  <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">{c.isActive ? "Active" : "Inactive"}</Badge>
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
      <Pagination page={page} totalPages={totalPages} onPage={p => { setPage(p); setSelected(new Set()); }} />

      {/* Add/Edit Modal */}
      <Dialog open={form !== null} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{form?.id ? "Edit Country" : "New Country"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Country Name *</Label><Input className="mt-1" value={form?.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>ISO Code (2 letters) *</Label><Input className="mt-1 uppercase" maxLength={2} value={form?.code ?? ""} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} /></div>
            <div><Label>Flag Emoji</Label><Input className="mt-1" placeholder="🇹🇷" value={form?.flagEmoji ?? ""} onChange={e => setForm(f => ({ ...f, flagEmoji: e.target.value }))} /></div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={form?.isActive ?? true} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending || !form?.name || !form?.code}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single delete confirm */}
      <Dialog open={delId !== null} onOpenChange={o => !o && setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Country</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this country?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirm */}
      <Dialog open={bulkDelOpen} onOpenChange={o => !o && setBulkDelOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Bulk Delete</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{selected.size}</strong> selected countries? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDelOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting…" : `Delete ${selected.size} Countries`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Countries" template={template} headers={headers} onImport={handleBulkImport} />
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
  const [sort, setSort] = useState<SortState>({ col: "name", dir: "asc" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  const sorted = useMemo(() => {
    const key = sort.col === "country" ? "countryId" : sort.col === "status" ? "isActive" : "name";
    return [...cities].sort((a, b) => {
      if (sort.col === "country") {
        const an = countryMap[a.countryId]?.name ?? "";
        const bn = countryMap[b.countryId]?.name ?? "";
        const cmp = an.localeCompare(bn, "tr", { sensitivity: "base" });
        return sort.dir === "asc" ? cmp : -cmp;
      }
      return sortCompare(a, b, key as keyof City, sort.dir);
    });
  }, [cities, sort, countryMap]);

  function handleSort(col: string) {
    setSort(s => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" });
  }

  const allSelected = sorted.length > 0 && sorted.every(c => selected.has(c.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map(c => c.id)));
  }
  function toggleOne(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

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

  async function handleBulkDelete() {
    setBulkDeleting(true);
    await Promise.allSettled([...selected].map(id => apiDelete(`/api/cities/${id}`)));
    setSelected(new Set());
    setBulkDelOpen(false);
    setBulkDeleting(false);
    qc.invalidateQueries({ queryKey: ["cities"] });
  }

  const handleBulkImport = async (rows: Record<string, string>[]) => {
    const res = await api("/api/cities/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
    qc.invalidateQueries({ queryKey: ["cities"] });
    return res;
  };

  const template = "name,countryCode\nİstanbul,TR\nAnkara,TR\nLondon,GB\nBerlin,DE";
  const headers = "name, countryCode (ISO 2-letter country code)";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search cities…" className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); setSelected(new Set()); }} />
        </div>
        <Select value={filterCountry} onValueChange={v => { setFilterCountry(v); setPage(1); setSelected(new Set()); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All countries" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All countries</SelectItem>
            {countries.map(c => <SelectItem key={c.id} value={String(c.id)}><span className="inline-flex items-center gap-1.5">{c.code ? <CountryFlag code={c.code} size="sm" /> : null}{c.name}</span></SelectItem>)}
          </SelectContent>
        </Select>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setBulkDelOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({selected.size})
          </Button>
        )}
        <Button variant="outline" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4 mr-2" />Import CSV</Button>
        <Button onClick={() => setForm({ isActive: true })}><Plus className="h-4 w-4 mr-2" />Add City</Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded cursor-pointer" />
              </th>
              <SortTh label="City" col="name" sort={sort} onSort={handleSort} />
              <SortTh label="Country" col="country" sort={sort} onSort={handleSort} />
              <SortTh label="Status" col="status" sort={sort} onSort={handleSort} />
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No cities found</td></tr>
            )}
            {sorted.map(c => (
              <tr key={c.id} className={`hover:bg-muted/20 transition-colors ${selected.has(c.id) ? "bg-primary/5" : ""}`}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="rounded cursor-pointer" />
                </td>
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground"><span className="inline-flex items-center gap-1.5">{countryMap[c.countryId]?.code ? <CountryFlag code={countryMap[c.countryId].code} size="sm" /> : null}{countryMap[c.countryId]?.name ?? c.countryId}</span></td>
                <td className="px-4 py-2.5">
                  <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">{c.isActive ? "Active" : "Inactive"}</Badge>
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
      <Pagination page={page} totalPages={totalPages} onPage={p => { setPage(p); setSelected(new Set()); }} />

      <Dialog open={form !== null} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{form?.id ? "Edit City" : "New City"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>City Name *</Label><Input className="mt-1" value={form?.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <Label>Country *</Label>
              <Select value={form?.countryId ? String(form.countryId) : ""} onValueChange={v => setForm(f => ({ ...f, countryId: Number(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select country" /></SelectTrigger>
                <SelectContent>{countries.map(c => <SelectItem key={c.id} value={String(c.id)}><span className="inline-flex items-center gap-1.5">{c.code ? <CountryFlag code={c.code} size="sm" /> : null}{c.name}</span></SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={form?.isActive ?? true} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending || !form?.name || !form?.countryId}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delId !== null} onOpenChange={o => !o && setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete City</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this city?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDelOpen} onOpenChange={o => !o && setBulkDelOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Bulk Delete</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{selected.size}</strong> selected cities? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDelOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting…" : `Delete ${selected.size} Cities`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Cities" template={template} headers={headers} onImport={handleBulkImport} />
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
  const [sort, setSort] = useState<SortState>({ col: "name", dir: "asc" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { data } = useQuery({
    queryKey: ["universities", page, dSearch],
    queryFn: () => api(`/api/universities?page=${page}&limit=30${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ""}`),
  });
  const universities: University[] = data?.data ?? [];
  const totalPages = data?.meta?.totalPages ?? 1;

  const sorted = useMemo(() => {
    return [...universities].sort((a, b) => {
      if (sort.col === "country") {
        const cmp = (a.country ?? "").localeCompare(b.country ?? "", "tr", { sensitivity: "base" });
        return sort.dir === "asc" ? cmp : -cmp;
      }
      if (sort.col === "type") return sortCompare(a, b, "universityType" as keyof University, sort.dir);
      if (sort.col === "qs") return sortCompare(a, b, "qsRanking" as keyof University, sort.dir);
      if (sort.col === "status") return sortCompare(a, b, "status" as keyof University, sort.dir);
      return sortCompare(a, b, "name" as keyof University, sort.dir);
    });
  }, [universities, sort]);

  function handleSort(col: string) {
    setSort(s => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" });
  }

  const allSelected = sorted.length > 0 && sorted.every(u => selected.has(u.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map(u => u.id)));
  }
  function toggleOne(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    await Promise.allSettled([...selected].map(id => apiDelete(`/api/universities/${id}`)));
    setSelected(new Set());
    setBulkDelOpen(false);
    setBulkDeleting(false);
    qc.invalidateQueries({ queryKey: ["universities"] });
  }

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
          <Input placeholder="Search universities…" className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setBulkDelOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({selected.size})
          </Button>
        )}
        <Button variant="outline" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4 mr-2" />Import CSV</Button>
        <Button variant="outline" onClick={async () => {
          try {
            const all = await api("/api/universities?limit=5000");
            const rows = (all?.data ?? []).map((u: University) => ({
              Name: u.name, Country: u.country, City: u.city ?? "", Website: u.website ?? "",
              Type: u.universityType ?? "", Status: u.status,
              "QS Ranking": u.qsRanking ?? "", "Times Ranking": u.timesRanking ?? "",
              Address: u.address ?? "", "Contact Person": u.contactPersonName ?? "",
              "Contact Phone": u.contactPersonPhone ?? "", "Contact Email": u.contactPersonEmail ?? "",
              Description: u.description ?? "",
            }));
            await exportToExcel(rows, "Universities", `universities-${new Date().toISOString().slice(0, 10)}.xlsx`);
          } catch {}
        }}><Download className="h-4 w-4 mr-2" />Export Excel</Button>
        <Button onClick={() => { setForm({ isActive: true, status: "open" }); setSelCountryId(null); }}><Plus className="h-4 w-4 mr-2" />Add University</Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded cursor-pointer" />
              </th>
              <SortTh label="University" col="name" sort={sort} onSort={handleSort} />
              <SortTh label="Country / City" col="country" sort={sort} onSort={handleSort} />
              <SortTh label="Type" col="type" sort={sort} onSort={handleSort} />
              <SortTh label="QS" col="qs" sort={sort} onSort={handleSort} />
              <SortTh label="Status" col="status" sort={sort} onSort={handleSort} />
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No universities found</td></tr>
            )}
            {sorted.map(u => (
              <tr key={u.id} className={`hover:bg-muted/20 transition-colors ${selected.has(u.id) ? "bg-primary/5" : ""}`}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)} className="rounded cursor-pointer" />
                </td>
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
                  {u.universityType === "state" ? "State" : u.universityType === "private" ? "Private" : u.universityType === "foundation" ? "Foundation" : u.universityType ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.qsRanking ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <Badge variant={u.status === "open" ? "default" : "secondary"} className="text-xs w-fit">
                      {u.status === "open" ? "Open" : "Closed"}
                    </Badge>
                    {!u.isActive && <Badge variant="outline" className="text-xs w-fit text-muted-foreground">Inactive</Badge>}
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
      <Pagination page={page} totalPages={totalPages} onPage={p => { setPage(p); setSelected(new Set()); }} />

      <Dialog open={form !== null} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit University" : "New University"}</DialogTitle>
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
                <Label className="text-sm font-medium">University Logo</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">Upload PNG, JPG or SVG</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5 mr-1.5" />Choose File
                  </Button>
                  {form?.logoUrl && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setF({ logoUrl: undefined })}>
                      Remove
                    </Button>
                  )}
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                <div className="mt-2">
                  <Input placeholder="or paste Logo URL…" className="text-xs h-8"
                    value={form?.logoUrl?.startsWith("data:") ? "" : form?.logoUrl ?? ""}
                    onChange={e => setF({ logoUrl: e.target.value || undefined })}
                  />
                </div>
              </div>
            </div>

            {/* ── Basic Information ───────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Basic Information</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>University Name *</Label>
                  <Input className="mt-1" value={form?.name ?? ""} onChange={e => setF({ name: e.target.value })} />
                </div>
                <div>
                  <Label>Country *</Label>
                  <Select
                    value={form?.country ?? ""}
                    onValueChange={v => {
                      const found = allCountries.find(c => c.name === v);
                      setF({ country: v, city: null });
                      setSelCountryId(found?.id ?? null);
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select country…" />
                    </SelectTrigger>
                    <SelectContent>
                      {allCountries.map(c => (
                        <SelectItem key={c.id} value={c.name}>
                          <span className="inline-flex items-center gap-1.5">{c.code ? <CountryFlag code={c.code} size="sm" /> : null}{c.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>City</Label>
                  <Select
                    value={form?.city ?? ""}
                    onValueChange={v => setF({ city: v === "__none__" ? null : (v || null) })}
                    disabled={!selCountryId}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder={selCountryId ? "Select city…" : "Select country first"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— No city —</SelectItem>
                      {formCities.map(c => (
                        <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>University Type</Label>
                  <Select value={form?.universityType ?? ""} onValueChange={v => setF({ universityType: v || null })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select type…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="state">State</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="foundation">Foundation</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Application Status</Label>
                  <Select value={form?.status ?? "open"} onValueChange={v => setF({ status: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Address</Label>
                  <Input className="mt-1" placeholder="Full address…" value={form?.address ?? ""} onChange={e => setF({ address: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label>Description</Label>
                  <Textarea className="mt-1" rows={2} value={form?.description ?? ""} onChange={e => setF({ description: e.target.value })} />
                </div>
                <div className="col-span-2 flex items-center justify-between">
                  <Label>Active in System</Label>
                  <Switch checked={form?.isActive ?? true} onCheckedChange={v => setF({ isActive: v })} />
                </div>
              </div>
            </div>

            {/* ── Tax ───────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tax Information</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tax Type</Label>
                  <Input className="mt-1" placeholder="VAT, Withholding…" value={form?.taxType ?? ""} onChange={e => setF({ taxType: e.target.value })} />
                </div>
                <div>
                  <Label>Tax Rate (%)</Label>
                  <Input className="mt-1" type="number" step="0.01" placeholder="18" value={form?.taxPercent ?? ""} onChange={e => setF({ taxPercent: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
              </div>
            </div>

            {/* ── Rankings ──────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">World Rankings</p>
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

            {/* ── Links ─────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Links & Documents</p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label>Website</Label>
                  <div className="flex gap-2 mt-1">
                    <Input placeholder="https://university.edu" value={form?.website ?? ""} onChange={e => setF({ website: e.target.value })} />
                    {form?.website && <a href={form.website} target="_blank" rel="noopener noreferrer"><Button type="button" variant="ghost" size="icon"><ExternalLink className="h-4 w-4" /></Button></a>}
                  </div>
                </div>
                <div>
                  <Label>Online Payment Link</Label>
                  <Input className="mt-1" placeholder="https://…" value={form?.onlinePaymentUrl ?? ""} onChange={e => setF({ onlinePaymentUrl: e.target.value })} />
                </div>
                <div>
                  <Label>CRICOS Link</Label>
                  <Input className="mt-1" placeholder="https://cricos.education.gov.au/…" value={form?.cricosLink ?? ""} onChange={e => setF({ cricosLink: e.target.value })} />
                </div>
                <div>
                  <Label>Documents Link</Label>
                  <Input className="mt-1" placeholder="https://…" value={form?.documentsLink ?? ""} onChange={e => setF({ documentsLink: e.target.value })} />
                </div>
                <div>
                  <Label>Current Fee List</Label>
                  <Input className="mt-1" placeholder="https://…" value={form?.currentFeeListLink ?? ""} onChange={e => setF({ currentFeeListLink: e.target.value })} />
                </div>
              </div>
            </div>

            {/* ── Admission Process ─────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Admission Process</p>
              <div className="space-y-3">
                <div>
                  <Label>Initial Deposit Options</Label>
                  <Textarea className="mt-1" rows={2} placeholder="Deposit amounts and conditions…" value={form?.initialDepositOptions ?? ""} onChange={e => setF({ initialDepositOptions: e.target.value })} />
                </div>
                <div>
                  <Label>Admission Process Description</Label>
                  <Textarea className="mt-1" rows={3} placeholder="Step-by-step application and admission process…" value={form?.admissionProcess ?? ""} onChange={e => setF({ admissionProcess: e.target.value })} />
                </div>
              </div>
            </div>

            {/* ── Contact Person (Super Admin only) ─── */}
            {isSuperAdmin && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lock className="h-4 w-4 text-amber-600" />
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Contact Person — Super Admin Only</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label>Full Name</Label>
                    <Input className="mt-1 bg-white" placeholder="John Doe" value={form?.contactPersonName ?? ""} onChange={e => setF({ contactPersonName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input className="mt-1 bg-white" placeholder="+1 555 000 0000" value={form?.contactPersonPhone ?? ""} onChange={e => setF({ contactPersonPhone: e.target.value })} />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input className="mt-1 bg-white" type="email" placeholder="contact@university.edu" value={form?.contactPersonEmail ?? ""} onChange={e => setF({ contactPersonEmail: e.target.value })} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending || !form?.name || !form?.country}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delId !== null} onOpenChange={o => !o && setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete University</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this university? Linked programs may also be affected.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDelOpen} onOpenChange={o => !o && setBulkDelOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Bulk Delete</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{selected.size}</strong> selected universities? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDelOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting…" : `Delete ${selected.size} Universities`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Universities" template={template} headers={headers} onImport={handleBulkImport} />
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
  const [sort, setSort] = useState<SortState>({ col: "name", dir: "asc" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { data: unisData } = useQuery({
    queryKey: ["universities", 1, ""],
    queryFn: () => api("/api/universities?limit=500"),
  });
  const universities: University[] = unisData?.data ?? [];
  const uniMap: Record<number, University> = Object.fromEntries(universities.map(u => [u.id, u]));

  const { data: catOptsResp } = useQuery({ queryKey: ["catalog-options"], queryFn: () => api("/api/catalog-options") });
  const catOpts: Record<string, CatalogOption[]> = (catOptsResp as any)?.grouped || {};
  const activeOpts = (key: string) => (catOpts[key] || []).filter(o => o.isActive).map(o => o.value);

  const { data } = useQuery({
    queryKey: ["programs", page, dSearch, filterUni],
    queryFn: () => api(`/api/programs?page=${page}&limit=30${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ""}${filterUni !== "all" ? `&universityId=${filterUni}` : ""}`),
  });
  const programs: Program[] = data?.data ?? [];
  const totalPages = data?.meta?.totalPages ?? 1;

  const sorted = useMemo(() => {
    return [...programs].sort((a, b) => {
      if (sort.col === "university") {
        const an = uniMap[a.universityId]?.name ?? "";
        const bn = uniMap[b.universityId]?.name ?? "";
        const cmp = an.localeCompare(bn, "tr", { sensitivity: "base" });
        return sort.dir === "asc" ? cmp : -cmp;
      }
      if (sort.col === "degree") return sortCompare(a, b, "degree" as keyof Program, sort.dir);
      if (sort.col === "fee") return sortCompare(a, b, "tuitionFee" as keyof Program, sort.dir);
      if (sort.col === "commission") return sortCompare(a, b, "commissionRate" as keyof Program, sort.dir);
      return sortCompare(a, b, "name" as keyof Program, sort.dir);
    });
  }, [programs, sort, uniMap]);

  function handleSort(col: string) {
    setSort(s => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" });
  }

  const allSelected = sorted.length > 0 && sorted.every(p => selected.has(p.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map(p => p.id)));
  }
  function toggleOne(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    await Promise.allSettled([...selected].map(id => apiDelete(`/api/programs/${id}`)));
    setSelected(new Set());
    setBulkDelOpen(false);
    setBulkDeleting(false);
    qc.invalidateQueries({ queryKey: ["programs"] });
  }

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
  const headers = "universityName* (or universityId*), name*, degree, field, language, duration, tuitionFee, currency, scholarship, commissionRate, applicationFee, advancedFee, depositFee, serviceFeeAmount, discountedFee, languageFee";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search programs…" className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={filterUni} onValueChange={v => { setFilterUni(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All universities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All universities</SelectItem>
            {universities.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setBulkDelOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({selected.size})
          </Button>
        )}
        <Button variant="outline" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4 mr-2" />Import CSV</Button>
        <Button variant="outline" onClick={async () => {
          try {
            const all = await api(`/api/programs?limit=5000${filterUni !== "all" ? `&universityId=${filterUni}` : ""}`);
            const rows = (all?.data ?? []).map((p: Program) => ({
              Program: p.name, University: uniMap[p.universityId]?.name ?? "",
              Degree: p.degree ?? "", Field: p.field ?? "", Language: p.language ?? "",
              Duration: p.duration ?? "", "Tuition Fee": p.tuitionFee ?? "",
              Currency: p.currency ?? "", "Commission %": p.commissionRate ?? "",
              "Scholarship %": p.scholarship ?? "", Intakes: p.intakes ?? "",
              "Application Fee": p.applicationFee ?? "", "Advance Fee": p.advancedFee ?? "",
              "Deposit Fee": p.depositFee ?? "", "Service Fee": p.serviceFeeAmount ?? "",
              "Discounted Fee": p.discountedFee ?? "", "Language Fee": p.languageFee ?? "",
              Requirements: p.requirements ?? "",
            }));
            await exportToExcel(rows, "Programs", `programs-${new Date().toISOString().slice(0, 10)}.xlsx`);
          } catch {}
        }}><Download className="h-4 w-4 mr-2" />Export Excel</Button>
        <Button onClick={() => setForm({ isActive: true, currency: "USD" })}><Plus className="h-4 w-4 mr-2" />Add Program</Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded cursor-pointer" />
              </th>
              <SortTh label="Program" col="name" sort={sort} onSort={handleSort} />
              <SortTh label="University" col="university" sort={sort} onSort={handleSort} />
              <SortTh label="Degree / Field" col="degree" sort={sort} onSort={handleSort} />
              <SortTh label="Fee" col="fee" sort={sort} onSort={handleSort} />
              <SortTh label="Commission" col="commission" sort={sort} onSort={handleSort} />
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No programs found</td></tr>
            )}
            {sorted.map(p => (
              <tr key={p.id} className={`hover:bg-muted/20 transition-colors ${selected.has(p.id) ? "bg-primary/5" : ""}`}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} className="rounded cursor-pointer" />
                </td>
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
      <Pagination page={page} totalPages={totalPages} onPage={p => { setPage(p); setSelected(new Set()); }} />

      <Dialog open={form !== null} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form?.id ? "Edit Program" : "New Program"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>University *</Label>
              <Select value={form?.universityId ? String(form.universityId) : ""} onValueChange={v => setForm(f => ({ ...f, universityId: Number(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select university" /></SelectTrigger>
                <SelectContent>{universities.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Program Name *</Label><Input className="mt-1" value={form?.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Degree</Label>
                <Select value={form?.degree ?? ""} onValueChange={v => setForm(f => ({ ...f, degree: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {activeOpts("degree").map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Field</Label>
                <Select value={form?.field ?? ""} onValueChange={v => setForm(f => ({ ...f, field: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {activeOpts("field").map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Language</Label>
                <Select value={form?.language ?? ""} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {activeOpts("language").map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Duration</Label>
                <Select value={form?.duration ?? ""} onValueChange={v => setForm(f => ({ ...f, duration: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {activeOpts("duration").map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Annual Fee</Label>
                <Input className="mt-1" type="number" value={form?.tuitionFee ?? ""} onChange={e => setForm(f => ({ ...f, tuitionFee: e.target.value ? Number(e.target.value) : undefined }))} />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={form?.currency ?? "USD"} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["USD", "EUR", "GBP", "TRY", "AED", "CAD", "AUD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fee Type</Label>
                <Select value={form?.feeType ?? ""} onValueChange={v => setForm(f => ({ ...f, feeType: v || null }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {activeOpts("fee_type").map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Scholarship</Label><Input className="mt-1" type="number" value={form?.scholarship ?? ""} onChange={e => setForm(f => ({ ...f, scholarship: e.target.value ? Number(e.target.value) : null }))} /></div>
              <div><Label>Commission %</Label><Input className="mt-1" type="number" value={form?.commissionRate ?? ""} onChange={e => setForm(f => ({ ...f, commissionRate: e.target.value ? Number(e.target.value) : null }))} /></div>
            </div>

            {/* ── Additional Fees ────────────────────────────── */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Additional Fees ({form?.currency ?? "USD"})</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Application Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = None" value={form?.applicationFee ?? ""} onChange={e => setForm(f => ({ ...f, applicationFee: e.target.value ? Number(e.target.value) : null }))} />
                </div>
                <div>
                  <Label className="text-xs">Advanced Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = None" value={form?.advancedFee ?? ""} onChange={e => setForm(f => ({ ...f, advancedFee: e.target.value ? Number(e.target.value) : null }))} />
                </div>
                <div>
                  <Label className="text-xs">Deposit Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = None" value={form?.depositFee ?? ""} onChange={e => setForm(f => ({ ...f, depositFee: e.target.value ? Number(e.target.value) : null }))} />
                </div>
                <div>
                  <Label className="text-xs">Service Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = None" value={form?.serviceFeeAmount ?? ""} onChange={e => setForm(f => ({ ...f, serviceFeeAmount: e.target.value ? Number(e.target.value) : null }))} />
                </div>
                <div>
                  <Label className="text-xs">Discounted Fee</Label>
                  <Input className="mt-1" type="number" placeholder="Discounted amount" value={form?.discountedFee ?? ""} onChange={e => setForm(f => ({ ...f, discountedFee: e.target.value ? Number(e.target.value) : null }))} />
                </div>
                <div>
                  <Label className="text-xs">Language Fee</Label>
                  <Input className="mt-1" type="number" placeholder="0 = None" value={form?.languageFee ?? ""} onChange={e => setForm(f => ({ ...f, languageFee: e.target.value ? Number(e.target.value) : null }))} />
                </div>
              </div>
            </div>

            <div>
              <Label>Intake Periods</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {activeOpts("intake").map(ip => {
                  const selected = (form?.intakes ?? "").split(",").map(s => s.trim()).filter(Boolean).includes(ip);
                  return (
                    <Badge
                      key={ip}
                      variant={selected ? "default" : "outline"}
                      className={`cursor-pointer text-xs ${selected ? "" : "opacity-60 hover:opacity-100"}`}
                      onClick={() => {
                        const current = (form?.intakes ?? "").split(",").map(s => s.trim()).filter(Boolean);
                        const next = selected ? current.filter(c => c !== ip) : [...current, ip];
                        setForm(f => ({ ...f, intakes: next.join(", ") }));
                      }}
                    >{ip}</Badge>
                  );
                })}
              </div>
            </div>
            <div><Label>Requirements</Label><Textarea className="mt-1" rows={2} placeholder="IELTS 6.0, GPA 3.0…" value={form?.requirements ?? ""} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} /></div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={form?.isActive ?? true} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending || !form?.name || !form?.universityId}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delId !== null} onOpenChange={o => !o && setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Program</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this program?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDelOpen} onOpenChange={o => !o && setBulkDelOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Bulk Delete</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{selected.size}</strong> selected programs? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDelOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting…" : `Delete ${selected.size} Programs`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Programs" template={template} headers={headers} onImport={handleBulkImport} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   OPTIONS TAB
══════════════════════════════════════════════════════════ */

type CatalogOption = { id: number; category: string; value: string; sortOrder: number; isActive: boolean };

const OPTION_CATEGORIES = [
  { key: "degree", label: "Degree", description: "Academic degree types (Bachelor, Master, etc.)" },
  { key: "language", label: "Language", description: "Languages of instruction" },
  { key: "duration", label: "Duration", description: "Program duration options" },
  { key: "fee_type", label: "Fee Type", description: "Fee calculation types" },
  { key: "intake", label: "Intake Periods", description: "Enrollment periods" },
  { key: "field", label: "Field", description: "Academic fields / study areas" },
];

function OptionsTab() {
  const [activeCategory, setActiveCategory] = useState(OPTION_CATEGORIES[0].key);
  const [editItem, setEditItem] = useState<CatalogOption | null>(null);
  const [newValue, setNewValue] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: optionsResp, isLoading } = useQuery({
    queryKey: ["catalog-options"],
    queryFn: () => api("/api/catalog-options"),
  });

  const grouped: Record<string, CatalogOption[]> = (optionsResp as any)?.grouped || {};
  const items = grouped[activeCategory] || [];
  const catMeta = OPTION_CATEGORIES.find(c => c.key === activeCategory)!;

  async function handleAdd() {
    if (!newValue.trim()) return;
    setSaving(true);
    try {
      await api("/api/catalog-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: activeCategory, value: newValue.trim(), sortOrder: items.length + 1 }),
      });
      setNewValue("");
      setAddMode(false);
      qc.invalidateQueries({ queryKey: ["catalog-options"] });
    } catch { }
    setSaving(false);
  }

  async function handleUpdate(item: CatalogOption, updates: Partial<CatalogOption>) {
    await api(`/api/catalog-options/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    qc.invalidateQueries({ queryKey: ["catalog-options"] });
    setEditItem(null);
  }

  async function handleDelete(id: number) {
    if (!confirm("Are you sure you want to delete this option?")) return;
    await api(`/api/catalog-options/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["catalog-options"] });
  }

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
      <div className="space-y-1">
        {OPTION_CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => { setActiveCategory(cat.key); setAddMode(false); setEditItem(null); }}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeCategory === cat.key ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            {cat.label}
            <span className="ml-2 text-xs opacity-60">({(grouped[cat.key] || []).length})</span>
          </button>
        ))}
      </div>

      <div className="border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div>
            <h3 className="text-sm font-semibold">{catMeta.label}</h3>
            <p className="text-xs text-muted-foreground">{catMeta.description}</p>
          </div>
          <Button size="sm" onClick={() => { setAddMode(true); setNewValue(""); }} disabled={addMode}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>

        {addMode && (
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-green-50/50">
            <Input
              autoFocus
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAddMode(false); }}
              placeholder={`Enter new ${catMeta.label.toLowerCase()} value...`}
              className="flex-1"
            />
            <Button size="sm" onClick={handleAdd} disabled={saving || !newValue.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAddMode(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        <div className="divide-y">
          {items.length === 0 && !addMode && (
            <p className="text-center text-muted-foreground text-sm py-8">No options yet. Click "Add" to create one.</p>
          )}
          {items.map((item, idx) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 group">
              <span className="text-xs text-muted-foreground w-6 text-center">{idx + 1}</span>
              {editItem?.id === item.id ? (
                <Input
                  autoFocus
                  className="flex-1 h-8"
                  value={editItem.value}
                  onChange={e => setEditItem({ ...editItem, value: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleUpdate(item, { value: editItem.value });
                    if (e.key === "Escape") setEditItem(null);
                  }}
                />
              ) : (
                <span className={`flex-1 text-sm ${!item.isActive ? "line-through text-muted-foreground" : ""}`}>{item.value}</span>
              )}
              {!item.isActive && <Badge variant="outline" className="text-[10px] bg-muted">Inactive</Badge>}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {editItem?.id === item.id ? (
                  <>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleUpdate(item, { value: editItem.value })}><Check className="w-3.5 h-3.5 text-green-600" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditItem(null)}><X className="w-3.5 h-3.5" /></Button>
                  </>
                ) : (
                  <>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditItem({ ...item })}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleUpdate(item, { isActive: !item.isActive })}>
                      {item.isActive ? <Lock className="w-3.5 h-3.5 text-orange-500" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(item.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════ */
export default function AdminCatalog() {
  const tabs = [
    { value: "countries", label: "Countries", icon: Globe },
    { value: "cities", label: "Cities", icon: Building2 },
    { value: "universities", label: "Universities", icon: GraduationCap },
    { value: "programs", label: "Programs", icon: BookOpen },
    { value: "options", label: "Options", icon: Settings2 },
  ];

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Catalog Management</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage countries, cities, universities and programs</p>
      </div>
      <Tabs defaultValue="countries" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
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
              <h2 className="text-base font-semibold flex items-center gap-2"><Globe className="h-4 w-4 text-primary" />Countries</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Manage all countries in the system</p>
            </div>
            <CountriesTab />
          </Card>
        </TabsContent>

        <TabsContent value="cities">
          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />Cities</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Manage cities linked to countries</p>
            </div>
            <CitiesTab />
          </Card>
        </TabsContent>

        <TabsContent value="universities">
          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><GraduationCap className="h-4 w-4 text-primary" />Universities</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Manage partner universities and institutions</p>
            </div>
            <UniversitiesTab />
          </Card>
        </TabsContent>

        <TabsContent value="programs">
          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Programs</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Manage university programs, fees and commission rates</p>
            </div>
            <ProgramsTab />
          </Card>
        </TabsContent>

        <TabsContent value="options">
          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" />Catalog Options</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Manage dropdown values used across programs (Degree, Language, Duration, Fee Type, Intakes, Field)</p>
            </div>
            <OptionsTab />
          </Card>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
