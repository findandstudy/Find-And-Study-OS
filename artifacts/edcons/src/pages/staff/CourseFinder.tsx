import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import {
  Search, Heart, Send, Info, GraduationCap, Globe, Clock,
  Languages, DollarSign, BookOpen, Building2, MapPin,
  ChevronLeft, ChevronRight, X, FileText, ExternalLink,
  Mail, Phone, User, Award, Calendar, Check, Loader2, UserSearch,
  Download, CheckSquare, Square, FileDown, LayoutGrid, List, ArrowUpDown,
  ArrowUp, ArrowDown,
} from "lucide-react";
import { generateProposalPdf } from "@/lib/generateProposalPdf";
import * as XLSX from "xlsx";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { ...opts, credentials: "include" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

type Program = {
  id: number;
  name: string;
  degree?: string | null;
  field?: string | null;
  language?: string | null;
  duration?: string | null;
  tuitionFee?: number | null;
  currency?: string | null;
  scholarship?: number | null;
  intakes?: string | null;
  requirements?: string | null;
  commissionRate?: number | null;
  applicationFee?: number | null;
  advancedFee?: number | null;
  depositFee?: number | null;
  serviceFeeAmount?: number | null;
  discountedFee?: number | null;
  languageFee?: number | null;
  feeType?: string | null;
  isActive?: boolean;
  universityId: number;
  universityName: string;
  universityLogoUrl?: string | null;
  universityCountry?: string | null;
  universityCity?: string | null;
  universityStatus?: string | null;
  universityType?: string | null;
  universityWebsite?: string | null;
  universityDescription?: string | null;
  universityRanking?: number | null;
  universityQsRanking?: number | null;
  universityTimesRanking?: number | null;
  universityAddress?: string | null;
  universityTaxType?: string | null;
  universityContactName?: string | null;
  universityContactPhone?: string | null;
  universityContactEmail?: string | null;
};

type FilterOptions = {
  countries: string[];
  cities: string[];
  universityTypes: string[];
  universities: { id: number; name: string }[];
  degrees: string[];
  languages: string[];
  feeRange: { min: number; max: number };
};

type Filters = {
  country: string;
  city: string;
  universityType: string;
  universityId: string;
  level: string;
  language: string;
  search: string;
  feeMin: string;
  feeMax: string;
};

const SHOW_COMMISSION_ROLES = ["super_admin", "agent", "sub_agent"];

function formatCurrency(amount: number | null | undefined, currency = "USD") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function calcCommissionAmount(program: Program): number | null {
  if (program.commissionRate == null) return null;
  const effectiveFee = program.discountedFee ?? program.tuitionFee;
  if (effectiveFee == null) return null;
  return Math.round((effectiveFee * program.commissionRate) / 100);
}

function ensureUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://${url}`;
}

export default function CourseFinder() {
  const { user } = useAuth(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({
    country: "", city: "", universityType: "", universityId: "",
    level: "", language: "", search: "", feeMin: "", feeMax: "",
  });
  const [page, setPage] = useState(1);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [selectedUniversity, setSelectedUniversity] = useState<Program | null>(null);
  const [applyProgram, setApplyProgram] = useState<Program | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortField, setSortField] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const showCommission = user && SHOW_COMMISSION_ROLES.includes(user.role);
  const isAgent = user && ["agent", "sub_agent"].includes(user.role);
  const canExportExcel = user && ["super_admin", "admin"].includes(user.role);

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["course-finder-filters"],
    queryFn: () => apiFetch(`${BASE_URL}/api/course-finder/filters`),
    staleTime: 5 * 60_000,
  });

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", "24");
    if (filters.country) p.set("country", filters.country);
    if (filters.city) p.set("city", filters.city);
    if (filters.universityType) p.set("universityType", filters.universityType);
    if (filters.universityId) p.set("universityId", filters.universityId);
    if (filters.level) p.set("level", filters.level);
    if (filters.language) p.set("language", filters.language);
    if (filters.search) p.set("search", filters.search);
    if (filters.feeMin) p.set("feeMin", filters.feeMin);
    if (filters.feeMax) p.set("feeMax", filters.feeMax);
    return p.toString();
  }, [filters, page]);

  const { data, isLoading } = useQuery<{ data: Program[]; meta: { total: number; page: number; limit: number; totalPages: number } }>({
    queryKey: ["course-finder", queryParams],
    queryFn: () => apiFetch(`${BASE_URL}/api/course-finder?${queryParams}`),
  });

  const programs = data?.data ?? [];
  const meta = data?.meta;

  const { data: wishlistIds = [] } = useQuery<number[]>({
    queryKey: ["wishlists"],
    queryFn: () => apiFetch(`${BASE_URL}/api/wishlists`),
    enabled: !!user,
  });

  const addWishlist = useMutation({
    mutationFn: (programId: number) => apiFetch(`${BASE_URL}/api/wishlists`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ programId }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["wishlists"] }); toast({ title: "Added to wishlist" }); },
  });

  const removeWishlist = useMutation({
    mutationFn: (programId: number) => apiFetch(`${BASE_URL}/api/wishlists/${programId}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["wishlists"] }); toast({ title: "Removed from wishlist" }); },
  });

  function toggleWishlist(programId: number) {
    if (wishlistIds.includes(programId)) removeWishlist.mutate(programId);
    else addWishlist.mutate(programId);
  }

  function toggleSelect(programId: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(programId)) next.delete(programId);
      else next.add(programId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === programs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(programs.map(p => p.id)));
    }
  }

  const { data: settings } = useQuery<{ companyName?: string; companyEmail?: string; companyPhone?: string; logoUrl?: string | null }>({
    queryKey: ["settings-for-pdf"],
    queryFn: () => apiFetch(`${BASE_URL}/api/settings`),
    staleTime: 10 * 60_000,
  });

  const { data: agentProfile } = useQuery<{ logoUrl?: string | null; companyName?: string }>({
    queryKey: ["agent-me-pdf"],
    queryFn: () => apiFetch(`${BASE_URL}/api/agents/me`),
    enabled: !!isAgent,
    staleTime: 10 * 60_000,
  });

  async function handleGeneratePdf() {
    const selected = programs.filter(p => selectedIds.has(p.id));
    if (selected.length === 0) {
      toast({ title: "No programs selected", description: "Select one or more programs to generate a proposal.", variant: "destructive" });
      return;
    }
    setGeneratingPdf(true);
    try {
      let logoDataUrl: string | null = null;
      const logoSrc = isAgent && agentProfile?.logoUrl ? agentProfile.logoUrl : settings?.logoUrl;
      if (logoSrc) {
        try {
          const resp = await fetch(logoSrc);
          const blob = await resp.blob();
          logoDataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve("");
            reader.readAsDataURL(blob);
          });
        } catch {}
      }

      const name = isAgent && agentProfile?.companyName ? agentProfile.companyName : settings?.companyName || "EduCons";

      await generateProposalPdf({
        programs: selected,
        logoDataUrl,
        companyName: name,
        companyEmail: settings?.companyEmail || undefined,
        companyPhone: settings?.companyPhone || undefined,
        showCommission: !!showCommission,
      });
      toast({ title: "PDF generated", description: `Proposal with ${selected.length} program${selected.length !== 1 ? "s" : ""} downloaded.` });
    } catch (err: any) {
      toast({ title: "PDF generation failed", description: err.message || "Unknown error", variant: "destructive" });
    } finally {
      setGeneratingPdf(false);
    }
  }

  function handleFilterChange(key: keyof Filters, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
    setSelectedIds(new Set());
  }

  function clearFilters() {
    setFilters({ country: "", city: "", universityType: "", universityId: "", level: "", language: "", search: "", feeMin: "", feeMax: "" });
    setPage(1);
    setSelectedIds(new Set());
  }

  const hasActiveFilters = filters.country || filters.city || filters.universityType || filters.universityId || filters.level || filters.language || filters.search || filters.feeMin || filters.feeMax;

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const sortedPrograms = useMemo(() => {
    if (!sortField) return programs;
    const sorted = [...programs].sort((a, b) => {
      let va: any, vb: any;
      switch (sortField) {
        case "name": va = a.name; vb = b.name; break;
        case "university": va = a.universityName; vb = b.universityName; break;
        case "country": va = a.universityCountry || ""; vb = b.universityCountry || ""; break;
        case "tuition": va = a.discountedFee ?? a.tuitionFee ?? 0; vb = b.discountedFee ?? b.tuitionFee ?? 0; break;
        case "degree": va = a.degree || ""; vb = b.degree || ""; break;
        case "language": va = a.language || ""; vb = b.language || ""; break;
        default: return 0;
      }
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === "asc" ? (va - vb) : (vb - va);
    });
    return sorted;
  }, [programs, sortField, sortDir]);

  function exportToExcel() {
    if (!sortedPrograms.length) return;
    const rows = sortedPrograms.map(p => ({
      "Program Name": p.name,
      "University": p.universityName,
      "Country": p.universityCountry || "",
      "City": p.universityCity || "",
      "Degree": p.degree || "",
      "Language": p.language || "",
      "Duration": p.duration || "",
      "Tuition Fee": p.tuitionFee ?? "",
      "Discounted Fee": p.discountedFee ?? "",
      "Currency": p.currency || "USD",
      "Scholarship": p.scholarship ?? "",
      "Application Fee": p.applicationFee ?? "",
      "Commission Rate (%)": p.commissionRate ?? "",
      "Commission Amount": calcCommissionAmount(p) ?? "",
      "Fee Type": p.feeType || "",
      "Intakes": p.intakes || "",
      "University Type": p.universityType || "",
      "Status": p.universityStatus || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const colWidths = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length, 14) }));
    ws["!cols"] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Programs");
    XLSX.writeFile(wb, `programs_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: "Excel exported", description: `${rows.length} programs exported successfully.` });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Course Finder</h1>
          <p className="text-muted-foreground mt-1">Search and explore programs across all partner universities</p>
        </div>

        <div className="bg-card rounded-2xl border p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search programs or universities..."
              value={filters.search}
              onChange={e => handleFilterChange("search", e.target.value)}
              className="pl-10 rounded-xl h-11"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Country</Label>
              <Select value={filters.country} onValueChange={v => handleFilterChange("country", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Countries" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="_all">All Countries</SelectItem>
                  {filterOptions?.countries?.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">City</Label>
              <Select value={filters.city} onValueChange={v => handleFilterChange("city", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Cities" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="_all">All Cities</SelectItem>
                  {filterOptions?.cities?.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">University Type</Label>
              <Select value={filters.universityType} onValueChange={v => handleFilterChange("universityType", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="_all">All Types</SelectItem>
                  {filterOptions?.universityTypes?.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">University</Label>
              <Select value={filters.universityId} onValueChange={v => handleFilterChange("universityId", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Universities" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="_all">All Universities</SelectItem>
                  {filterOptions?.universities?.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Study Level</Label>
              <Select value={filters.level} onValueChange={v => handleFilterChange("level", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Levels" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Levels</SelectItem>
                  {filterOptions?.degrees?.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Language</Label>
              <Select value={filters.language} onValueChange={v => handleFilterChange("language", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Languages" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Languages</SelectItem>
                  {filterOptions?.languages?.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Tuition Fee {filters.feeMin || filters.feeMax ? (
                  <span className="text-primary">
                    ({filters.feeMin ? `$${Number(filters.feeMin).toLocaleString()}` : "$0"} – {filters.feeMax ? `$${Number(filters.feeMax).toLocaleString()}` : "Max"})
                  </span>
                ) : null}
              </Label>
              <div className="flex gap-1.5 items-center">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.feeMin}
                  onChange={e => handleFilterChange("feeMin", e.target.value)}
                  className="h-9 rounded-lg text-sm w-full"
                />
                <span className="text-muted-foreground text-xs shrink-0">–</span>
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.feeMax}
                  onChange={e => handleFilterChange("feeMax", e.target.value)}
                  className="h-9 rounded-lg text-sm w-full"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs text-muted-foreground">
                  <X className="w-3 h-3 mr-1" /> Clear Filters
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {programs.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="h-8 text-xs gap-1.5"
                  >
                    {selectedIds.size === programs.length ? (
                      <CheckSquare className="w-3.5 h-3.5 text-primary" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                    {selectedIds.size === programs.length ? "Deselect All" : "Select All"}
                  </Button>
                  {selectedIds.size > 0 && (
                    <Button
                      size="sm"
                      onClick={handleGeneratePdf}
                      disabled={generatingPdf}
                      className="h-8 text-xs gap-1.5 bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-700 text-white border-0 rounded-lg"
                    >
                      {generatingPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5" />
                      )}
                      Download Proposal ({selectedIds.size})
                    </Button>
                  )}
                </div>
              )}
              {canExportExcel && programs.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportToExcel}
                  className="h-8 text-xs gap-1.5 rounded-lg"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Excel
                </Button>
              )}
              <div className="flex items-center border rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 transition-colors ${viewMode === "grid" ? "bg-primary text-white" : "bg-card text-muted-foreground hover:text-foreground"}`}
                  title="Grid view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-primary text-white" : "bg-card text-muted-foreground hover:text-foreground"}`}
                  title="List view"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
              {meta && (
                <div className="text-sm text-muted-foreground">
                  {meta.total} program{meta.total !== 1 ? "s" : ""} found
                </div>
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-card border rounded-2xl p-5 animate-pulse space-y-4">
                  <div className="flex gap-3 items-center">
                    <div className="w-14 h-14 bg-muted rounded-xl" />
                    <div className="space-y-2 flex-1">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-card border rounded-2xl overflow-hidden">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border-b animate-pulse">
                  <div className="w-10 h-10 bg-muted rounded-lg" />
                  <div className="flex-1 space-y-2"><div className="h-4 bg-muted rounded w-1/3" /><div className="h-3 bg-muted rounded w-1/4" /></div>
                  <div className="h-4 bg-muted rounded w-20" />
                </div>
              ))}
            </div>
          )
        ) : programs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium">No programs found</p>
            <p className="text-sm">Try adjusting your filters or search terms</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {sortedPrograms.map(prog => (
              <ProgramCard
                key={prog.id}
                program={prog}
                isWishlisted={wishlistIds.includes(prog.id)}
                onToggleWishlist={() => toggleWishlist(prog.id)}
                onInfo={() => setSelectedProgram(prog)}
                onApply={() => setApplyProgram(prog)}
                onUniversityClick={() => setSelectedUniversity(prog)}
                showCommission={!!showCommission}
                isSelected={selectedIds.has(prog.id)}
                onToggleSelect={() => toggleSelect(prog.id)}
              />
            ))}
          </div>
        ) : (
          <ProgramListView
            programs={sortedPrograms}
            wishlistIds={wishlistIds}
            selectedIds={selectedIds}
            showCommission={!!showCommission}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
            onToggleSelect={toggleSelect}
            onToggleWishlist={toggleWishlist}
            onInfo={setSelectedProgram}
            onApply={setApplyProgram}
            onUniversityClick={setSelectedUniversity}
          />
        )}

        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage(p => p - 1); setSelectedIds(new Set()); }}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground px-3">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => { setPage(p => p + 1); setSelectedIds(new Set()); }}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <ProgramInfoDialog
        program={selectedProgram}
        onClose={() => setSelectedProgram(null)}
        showCommission={!!showCommission}
      />

      <UniversityInfoDialog
        program={selectedUniversity}
        onClose={() => setSelectedUniversity(null)}
      />

      <ApplyDialog
        program={applyProgram}
        onClose={() => setApplyProgram(null)}
      />
    </DashboardLayout>
  );
}

function SortHeader({ label, field, sortField, sortDir, onSort }: {
  label: string; field: string; sortField: string; sortDir: "asc" | "desc"; onSort: (f: string) => void;
}) {
  const active = sortField === field;
  return (
    <button onClick={() => onSort(field)} className="flex items-center gap-1 hover:text-foreground transition-colors group">
      <span>{label}</span>
      {active ? (
        sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      )}
    </button>
  );
}

function ProgramListView({ programs, wishlistIds, selectedIds, showCommission, sortField, sortDir, onSort, onToggleSelect, onToggleWishlist, onInfo, onApply, onUniversityClick }: {
  programs: Program[];
  wishlistIds: number[];
  selectedIds: Set<number>;
  showCommission: boolean;
  sortField: string;
  sortDir: "asc" | "desc";
  onSort: (field: string) => void;
  onToggleSelect: (id: number) => void;
  onToggleWishlist: (id: number) => void;
  onInfo: (p: Program) => void;
  onApply: (p: Program) => void;
  onUniversityClick: (p: Program) => void;
}) {
  return (
    <div className="bg-card border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground font-medium">
              <th className="p-3 w-10"></th>
              <th className="p-3 text-left min-w-[250px]">
                <SortHeader label="Program" field="name" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="p-3 text-left min-w-[160px]">
                <SortHeader label="University" field="university" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="p-3 text-left">
                <SortHeader label="Degree" field="degree" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="p-3 text-left">
                <SortHeader label="Country" field="country" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="p-3 text-left">
                <SortHeader label="Language" field="language" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="p-3 text-right">
                <SortHeader label="Tuition" field="tuition" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              </th>
              {showCommission && (
                <th className="p-3 text-right">Commission</th>
              )}
              <th className="p-3 text-center">Intakes</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-center w-[120px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {programs.map(p => {
              const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;
              const commissionAmount = calcCommissionAmount(p);
              const cur = p.currency ?? "USD";
              const isSelected = selectedIds.has(p.id);
              const isWishlisted = wishlistIds.includes(p.id);

              return (
                <tr
                  key={p.id}
                  className={`border-b last:border-b-0 hover:bg-muted/20 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                >
                  <td className="p-3">
                    <button onClick={() => onToggleSelect(p.id)} className="p-0.5 rounded hover:bg-muted/80">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </button>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg border bg-white flex items-center justify-center overflow-hidden shrink-0">
                        {p.universityLogoUrl ? (
                          <img src={p.universityLogoUrl} alt="" className="w-full h-full object-contain p-0.5" />
                        ) : (
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate max-w-[220px]">{p.name}</p>
                        {p.duration && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3" />{p.duration}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => onUniversityClick(p)}
                      className="text-sm text-foreground hover:text-primary hover:underline transition-colors truncate max-w-[150px] block text-left"
                    >
                      {p.universityName}
                    </button>
                  </td>
                  <td className="p-3">
                    {p.degree && (
                      <Badge className="text-[10px] px-2 py-0.5 h-auto rounded-full bg-primary/10 text-primary border-0 font-medium">
                        {p.degree}
                      </Badge>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="text-sm">
                      <span>{p.universityCountry || "—"}</span>
                      {p.universityCity && (
                        <span className="text-muted-foreground text-xs block">{p.universityCity}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-sm">{p.language || "—"}</td>
                  <td className="p-3 text-right">
                    <div>
                      {hasDiscount && (
                        <span className="text-xs text-muted-foreground line-through block">{formatCurrency(p.tuitionFee, cur)}</span>
                      )}
                      <span className={`text-sm font-semibold ${hasDiscount ? "text-emerald-600" : ""}`}>
                        {formatCurrency(hasDiscount ? p.discountedFee : p.tuitionFee, cur)}
                      </span>
                      {hasDiscount && (
                        <Badge className="text-[9px] px-1 py-0 h-3.5 bg-emerald-100 text-emerald-700 border-0 rounded-full ml-1">
                          -{Math.round(((p.tuitionFee! - p.discountedFee!) / p.tuitionFee!) * 100)}%
                        </Badge>
                      )}
                    </div>
                  </td>
                  {showCommission && (
                    <td className="p-3 text-right">
                      {commissionAmount != null ? (
                        <span className="text-sm font-semibold text-indigo-600">{formatCurrency(commissionAmount, cur)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  <td className="p-3 text-center">
                    {p.intakes ? (
                      <div className="flex flex-wrap gap-1 justify-center">
                        {p.intakes.split(",").slice(0, 3).map(intake => (
                          <Badge key={intake.trim()} variant="outline" className="text-[10px] px-1.5 py-0 h-4 rounded-full">
                            {intake.trim()}
                          </Badge>
                        ))}
                        {p.intakes.split(",").length > 3 && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 rounded-full">
                            +{p.intakes.split(",").length - 3}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {p.universityStatus && (
                      <div className="flex items-center gap-1.5 justify-center">
                        <div className={`w-2 h-2 rounded-full ${p.universityStatus === "open" ? "bg-emerald-500" : "bg-amber-500"}`} />
                        <span className="text-[11px] capitalize">{p.universityStatus === "open" ? "Open" : "Closed"}</span>
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onToggleWishlist(p.id)}
                        className="p-1.5 rounded-lg hover:bg-muted/80 transition-colors"
                        title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
                      >
                        <Heart className={`w-3.5 h-3.5 ${isWishlisted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
                      </button>
                      <button
                        onClick={() => onInfo(p)}
                        className="p-1.5 rounded-lg hover:bg-muted/80 transition-colors"
                        title="Details"
                      >
                        <Info className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => onApply(p)}
                        className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
                        title="Apply"
                      >
                        <Send className="w-3.5 h-3.5 text-primary" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProgramCard({ program: p, isWishlisted, onToggleWishlist, onInfo, onApply, onUniversityClick, showCommission, isSelected, onToggleSelect }: {
  program: Program;
  isWishlisted: boolean;
  onToggleWishlist: () => void;
  onInfo: () => void;
  onApply: () => void;
  onUniversityClick: () => void;
  showCommission: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;
  const commissionAmount = calcCommissionAmount(p);
  const cur = p.currency ?? "USD";
  const websiteUrl = ensureUrl(p.universityWebsite);

  return (
    <div className={`bg-card border rounded-2xl overflow-hidden hover:shadow-lg transition-all duration-200 group flex flex-col ${isSelected ? "ring-2 ring-primary border-primary/50" : ""}`}>
      <div className="p-5 space-y-4 flex-1">
        <div className="flex items-start gap-3">
          <button
            onClick={onToggleSelect}
            className="shrink-0 mt-1 p-0.5 rounded hover:bg-muted/80 transition-colors"
            title={isSelected ? "Deselect" : "Select for proposal"}
          >
            {isSelected ? (
              <CheckSquare className="w-4.5 h-4.5 text-primary" />
            ) : (
              <Square className="w-4.5 h-4.5 text-muted-foreground/50 group-hover:text-muted-foreground" />
            )}
          </button>
          {websiteUrl ? (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-14 h-14 rounded-xl border-2 border-muted bg-white flex items-center justify-center overflow-hidden shrink-0 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
              title={`Visit ${p.universityName} website`}
            >
              {p.universityLogoUrl ? (
                <img src={p.universityLogoUrl} alt={p.universityName} className="w-full h-full object-contain p-1" />
              ) : (
                <Building2 className="w-7 h-7 text-muted-foreground" />
              )}
            </a>
          ) : (
            <div className="w-14 h-14 rounded-xl border-2 border-muted bg-white flex items-center justify-center overflow-hidden shrink-0">
              {p.universityLogoUrl ? (
                <img src={p.universityLogoUrl} alt={p.universityName} className="w-full h-full object-contain p-1" />
              ) : (
                <Building2 className="w-7 h-7 text-muted-foreground" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <button
              onClick={onUniversityClick}
              className="text-xs text-muted-foreground hover:text-primary transition-colors truncate block max-w-full text-left hover:underline"
              title="View university details"
            >
              {p.universityName}
            </button>
            <h3 className="font-semibold text-sm leading-tight line-clamp-2 mt-0.5">{p.name}</h3>
          </div>
          <button onClick={onToggleWishlist} className="shrink-0 p-2 rounded-full hover:bg-muted/80 transition-colors" title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}>
            <Heart className={`w-5 h-5 transition-all ${isWishlisted ? "fill-red-500 text-red-500 scale-110" : "text-muted-foreground hover:text-red-400"}`} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {p.degree && (
            <Badge className="text-[10px] px-2 py-0.5 h-auto rounded-full bg-primary/10 text-primary border-0 font-medium">
              <GraduationCap className="w-3 h-3 mr-1" />{p.degree}
            </Badge>
          )}
          {p.language && (
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 h-auto rounded-full font-medium">
              <Languages className="w-3 h-3 mr-1" />{p.language}
            </Badge>
          )}
          {p.duration && (
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 h-auto rounded-full font-medium">
              <Clock className="w-3 h-3 mr-1" />{p.duration}
            </Badge>
          )}
          {p.universityCountry && (
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 h-auto rounded-full font-medium">
              <Globe className="w-3 h-3 mr-1" />{p.universityCountry}
            </Badge>
          )}
          {p.universityCity && (
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 h-auto rounded-full font-medium">
              <MapPin className="w-3 h-3 mr-1" />{p.universityCity}
            </Badge>
          )}
        </div>

        <div className="bg-muted/40 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Tuition</span>
              {p.feeType && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 rounded font-normal text-muted-foreground">{p.feeType}</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasDiscount && (
                <span className="text-xs text-muted-foreground line-through">{formatCurrency(p.tuitionFee, cur)}</span>
              )}
              <span className={`text-sm font-bold ${hasDiscount ? "text-emerald-600" : ""}`}>
                {formatCurrency(hasDiscount ? p.discountedFee : p.tuitionFee, cur)}
              </span>
              {hasDiscount && (
                <Badge className="text-[9px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 border-0 rounded-full">
                  SAVE {formatCurrency((p.tuitionFee ?? 0) - (p.discountedFee ?? 0), cur)}
                </Badge>
              )}
            </div>
          </div>

          {p.scholarship != null && p.scholarship > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-emerald-600 font-medium">Scholarship</span>
              <span className="text-xs font-semibold text-emerald-600">{formatCurrency(p.scholarship, cur)}</span>
            </div>
          )}

          {p.applicationFee != null && p.applicationFee > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">App Fee</span>
              <span className="text-xs font-medium">{formatCurrency(p.applicationFee, cur)}</span>
            </div>
          )}

          {p.intakes && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Intakes</span>
              <div className="flex gap-1">
                {p.intakes.split(",").map(intake => (
                  <Badge key={intake.trim()} variant="outline" className="text-[10px] px-1.5 py-0 h-4 rounded-full">
                    <Calendar className="w-2.5 h-2.5 mr-0.5" />{intake.trim()}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {showCommission && commissionAmount != null && (
            <div className="flex items-center justify-between pt-1 border-t border-dashed border-muted-foreground/20">
              <span className="text-xs font-medium text-indigo-600">Commission</span>
              <span className="text-sm font-bold text-indigo-600">{formatCurrency(commissionAmount, cur)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          {p.universityStatus && (
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${p.universityStatus === "open" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              <span className="text-[11px] text-muted-foreground capitalize font-medium">
                {p.universityStatus === "open" ? "Open for Applications" : "Closed"}
              </span>
            </div>
          )}
          {p.universityType && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 rounded-full">{p.universityType}</Badge>
          )}
        </div>
      </div>

      <div className="border-t grid grid-cols-2 divide-x">
        <button
          onClick={onInfo}
          className="py-3 text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors flex items-center justify-center gap-1.5"
        >
          <Info className="w-3.5 h-3.5" /> Details
        </button>
        <button
          onClick={onApply}
          className="py-3 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5" /> Apply
        </button>
      </div>
    </div>
  );
}

function UniversityInfoDialog({ program: p, onClose }: {
  program: Program | null;
  onClose: () => void;
}) {
  if (!p) return null;
  const websiteUrl = ensureUrl(p.universityWebsite);

  return (
    <Dialog open={!!p} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl border-2 border-muted bg-white flex items-center justify-center overflow-hidden shrink-0">
              {p.universityLogoUrl ? (
                <img src={p.universityLogoUrl} alt={p.universityName} className="w-full h-full object-contain p-1" />
              ) : (
                <Building2 className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg">{p.universityName}</DialogTitle>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {p.universityType && <Badge variant="secondary" className="text-xs">{p.universityType}</Badge>}
                {p.universityStatus && (
                  <Badge variant="outline" className={`text-xs ${p.universityStatus === "open" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-amber-300 text-amber-700 bg-amber-50"}`}>
                    {p.universityStatus === "open" ? "Open" : "Closed"}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-3">
          {p.universityDescription && (
            <p className="text-sm text-muted-foreground leading-relaxed">{p.universityDescription}</p>
          )}

          <div className="bg-muted/30 rounded-xl p-4 space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> Location</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {p.universityCountry && (
                <div>
                  <span className="text-muted-foreground text-xs">Country</span>
                  <p className="font-medium">{p.universityCountry}</p>
                </div>
              )}
              {p.universityCity && (
                <div>
                  <span className="text-muted-foreground text-xs">City</span>
                  <p className="font-medium">{p.universityCity}</p>
                </div>
              )}
            </div>
            {p.universityAddress && (
              <div>
                <span className="text-muted-foreground text-xs">Address</span>
                <p className="text-sm font-medium">{p.universityAddress}</p>
              </div>
            )}
          </div>

          {(p.universityQsRanking || p.universityTimesRanking || p.universityRanking) && (
            <div className="bg-muted/30 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Award className="w-4 h-4 text-primary" /> Rankings</h4>
              <div className="grid grid-cols-3 gap-3">
                {p.universityQsRanking && (
                  <div className="text-center bg-white rounded-lg p-2 border">
                    <p className="text-lg font-bold text-primary">#{p.universityQsRanking}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">QS World</p>
                  </div>
                )}
                {p.universityTimesRanking && (
                  <div className="text-center bg-white rounded-lg p-2 border">
                    <p className="text-lg font-bold text-primary">#{p.universityTimesRanking}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">Times HE</p>
                  </div>
                )}
                {p.universityRanking && (
                  <div className="text-center bg-white rounded-lg p-2 border">
                    <p className="text-lg font-bold text-primary">#{p.universityRanking}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">National</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {p.universityTaxType && (
            <div className="bg-muted/30 rounded-xl p-4 space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> Financial</h4>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax Type</span>
                <span className="font-medium capitalize">{p.universityTaxType}</span>
              </div>
            </div>
          )}

          {(p.universityContactName || p.universityContactEmail || p.universityContactPhone) && (
            <div className="bg-muted/30 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Contact Person</h4>
              <div className="space-y-2">
                {p.universityContactName && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-medium">{p.universityContactName}</span>
                  </div>
                )}
                {p.universityContactEmail && (
                  <a href={`mailto:${p.universityContactEmail}`} className="flex items-center gap-2 text-sm text-primary hover:underline">
                    <Mail className="w-3.5 h-3.5" />
                    {p.universityContactEmail}
                  </a>
                )}
                {p.universityContactPhone && (
                  <a href={`tel:${p.universityContactPhone}`} className="flex items-center gap-2 text-sm text-primary hover:underline">
                    <Phone className="w-3.5 h-3.5" />
                    {p.universityContactPhone}
                  </a>
                )}
              </div>
            </div>
          )}

          {websiteUrl && (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Visit University Website
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProgramInfoDialog({ program: p, onClose, showCommission }: {
  program: Program | null;
  onClose: () => void;
  showCommission: boolean;
}) {
  if (!p) return null;
  const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;
  const cur = p.currency ?? "USD";
  const commissionAmount = calcCommissionAmount(p);

  const sections: { title: string; icon: typeof GraduationCap; items: { label: string; value: string | null | undefined; highlight?: string }[] }[] = [
    {
      title: "Program Details",
      icon: GraduationCap,
      items: [
        { label: "Program Name", value: p.name },
        { label: "Degree / Level", value: p.degree },
        { label: "Field of Study", value: p.field },
        { label: "Language", value: p.language },
        { label: "Duration", value: p.duration },
        { label: "Intakes", value: p.intakes },
      ],
    },
    {
      title: "University",
      icon: Building2,
      items: [
        { label: "University", value: p.universityName },
        { label: "Country", value: p.universityCountry },
        { label: "City", value: p.universityCity },
        { label: "Type", value: p.universityType },
        { label: "Status", value: p.universityStatus },
      ],
    },
    {
      title: "Fees & Finance",
      icon: DollarSign,
      items: [
        { label: "Tuition Fee", value: formatCurrency(p.tuitionFee, cur) },
        ...(p.feeType ? [{ label: "Fee Type", value: p.feeType }] : []),
        ...(hasDiscount ? [{ label: "Discounted Fee", value: formatCurrency(p.discountedFee, cur), highlight: "amber" }] : []),
        { label: "Application Fee", value: formatCurrency(p.applicationFee, cur) },
        { label: "Deposit Fee", value: formatCurrency(p.depositFee, cur) },
        { label: "Advanced Fee", value: formatCurrency(p.advancedFee, cur) },
        { label: "Language Fee", value: formatCurrency(p.languageFee, cur) },
        { label: "Service Fee", value: formatCurrency(p.serviceFeeAmount, cur) },
        ...(p.scholarship != null && p.scholarship > 0 ? [{ label: "Scholarship", value: formatCurrency(p.scholarship, cur), highlight: "green" }] : []),
        ...(showCommission && commissionAmount != null ? [{ label: "Commission", value: formatCurrency(commissionAmount, cur), highlight: "indigo" }] : []),
      ],
    },
  ];

  return (
    <Dialog open={!!p} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl border-2 border-muted bg-white flex items-center justify-center overflow-hidden shrink-0">
              {p.universityLogoUrl ? (
                <img src={p.universityLogoUrl} alt={p.universityName} className="w-full h-full object-contain p-1" />
              ) : (
                <Building2 className="w-7 h-7 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{p.universityName}</p>
              <DialogTitle className="text-lg">{p.name}</DialogTitle>
              <div className="flex gap-1.5 mt-1.5">
                {p.degree && <Badge variant="secondary" className="text-xs">{p.degree}</Badge>}
                {hasDiscount && <Badge className="text-xs bg-emerald-100 text-emerald-700 border-emerald-200">Discounted</Badge>}
                {p.universityStatus && (
                  <Badge variant="outline" className={`text-xs ${p.universityStatus === "open" ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}`}>
                    {p.universityStatus}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-2">
                <section.icon className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">{section.title}</h3>
              </div>
              <div className="bg-muted/30 rounded-xl p-3 space-y-1.5">
                {section.items.filter(item => item.value && item.value !== "—").map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className={item.highlight === "amber" ? "text-amber-600" : item.highlight === "indigo" ? "text-indigo-600" : item.highlight === "green" ? "text-emerald-600" : "text-muted-foreground"}>{item.label}</span>
                    <span className={`font-medium text-right max-w-[60%] ${item.highlight === "amber" ? "text-amber-600" : item.highlight === "indigo" ? "text-indigo-600 font-semibold" : item.highlight === "green" ? "text-emerald-600 font-semibold" : ""}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {p.requirements && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Requirements</h3>
              </div>
              <div className="bg-muted/30 rounded-xl p-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{p.requirements}</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type StudentOption = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  nationality?: string | null;
  agentId?: number | null;
  createdAt: string;
};

function ApplyDialog({ program: p, onClose }: { program: Program | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentOption | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const debouncedSearch = useMemo(() => searchTerm.trim(), [searchTerm]);

  const { data: recentStudents = [], isLoading: loadingRecent } = useQuery<StudentOption[]>({
    queryKey: ["apply-recent-students"],
    queryFn: () => apiFetch(`${BASE_URL}/api/course-finder/students?limit=3`),
    enabled: !!p,
    staleTime: 30_000,
  });

  const { data: searchResults = [], isLoading: loadingSearch } = useQuery<StudentOption[]>({
    queryKey: ["apply-search-students", debouncedSearch],
    queryFn: () => apiFetch(`${BASE_URL}/api/course-finder/students?search=${encodeURIComponent(debouncedSearch)}&limit=10`),
    enabled: !!p && debouncedSearch.length >= 2,
    staleTime: 10_000,
  });

  const studentsToShow = debouncedSearch.length >= 2 ? searchResults : recentStudents;
  const isSearching = debouncedSearch.length >= 2 ? loadingSearch : loadingRecent;

  function handleClose() {
    setSearchTerm("");
    setSelectedStudent(null);
    setNotes("");
    setSubmitting(false);
    setSuccess(false);
    onClose();
  }

  async function handleSubmit() {
    if (!selectedStudent || !p) return;
    setSubmitting(true);
    try {
      await apiFetch(`${BASE_URL}/api/course-finder/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          programId: p.id,
          notes: notes || null,
        }),
      });
      setSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      toast({ title: "Başvuru oluşturuldu", description: `${selectedStudent.firstName} ${selectedStudent.lastName} → ${p.name}` });
      setTimeout(() => handleClose(), 1500);
    } catch (err: any) {
      toast({ title: "Hata", description: err.message || "Başvuru oluşturulamadı", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!p) return null;

  const effectiveFee = p.discountedFee ?? p.tuitionFee;
  const cur = p.currency ?? "USD";
  const commissionAmount = p.commissionRate && effectiveFee ? Math.round((effectiveFee * p.commissionRate) / 100) : null;

  return (
    <Dialog open={!!p} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Başvuru Oluştur</DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check className="w-8 h-8 text-emerald-600" />
            </div>
            <p className="text-lg font-semibold text-emerald-700">Başvuru Oluşturuldu!</p>
            <p className="text-sm text-muted-foreground text-center">
              Başvuru, komisyon ve hizmet bedeli kayıtları otomatik olarak oluşturuldu.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-muted/40 rounded-xl p-3 space-y-1.5">
              <p className="font-semibold text-sm">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.universityName} — {p.universityCountry}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {effectiveFee != null && (
                  <Badge variant="outline" className="text-xs">{formatCurrency(effectiveFee, cur)}</Badge>
                )}
                {p.feeType && (
                  <Badge variant="outline" className="text-xs">{p.feeType}</Badge>
                )}
                {p.scholarship != null && p.scholarship > 0 && (
                  <Badge className="text-xs bg-emerald-100 text-emerald-700 border-0">Burs: {formatCurrency(p.scholarship, cur)}</Badge>
                )}
                {commissionAmount != null && (
                  <Badge className="text-xs bg-indigo-100 text-indigo-700 border-0">Komisyon: {formatCurrency(commissionAmount, cur)}</Badge>
                )}
                {p.serviceFeeAmount != null && p.serviceFeeAmount > 0 && (
                  <Badge className="text-xs bg-amber-100 text-amber-700 border-0">H. Bedeli: {formatCurrency(p.serviceFeeAmount, cur)}</Badge>
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Öğrenci Seç</Label>
              <div className="relative mb-3">
                <UserSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="İsim, e-posta veya telefon ile ara..."
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); setSelectedStudent(null); }}
                  className="pl-10 rounded-lg"
                />
              </div>

              {!debouncedSearch && recentStudents.length > 0 && (
                <p className="text-[11px] text-muted-foreground mb-2 uppercase tracking-wide font-medium">Son Eklenen Öğrenciler</p>
              )}

              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {isSearching ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Aranıyor...</span>
                  </div>
                ) : studentsToShow.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <User className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">{debouncedSearch.length >= 2 ? "Öğrenci bulunamadı" : "Henüz öğrenci yok"}</p>
                  </div>
                ) : (
                  studentsToShow.map(s => {
                    const isSelected = selectedStudent?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedStudent(isSelected ? null : s)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-muted hover:border-primary/30 hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isSelected ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                          }`}>
                            {(s.firstName?.[0] || "").toUpperCase()}{(s.lastName?.[0] || "").toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{s.firstName} {s.lastName}</p>
                            <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                          </div>
                          {s.nationality && (
                            <Badge variant="outline" className="text-[10px] shrink-0">{s.nationality}</Badge>
                          )}
                          {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-1.5 block">Not (Opsiyonel)</Label>
              <Textarea
                rows={2}
                placeholder="Başvuru ile ilgili not ekleyebilirsiniz..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="resize-none rounded-lg"
              />
            </div>

            <div className="bg-blue-50 rounded-xl p-3 space-y-1">
              <p className="text-xs font-semibold text-blue-700">Başvuru ile otomatik oluşturulacaklar:</p>
              <ul className="text-xs text-blue-600 space-y-0.5">
                <li>• Başvuru kaydı (Applications → inquiry aşaması)</li>
                {commissionAmount != null && commissionAmount > 0 && (
                  <li>• Komisyon kaydı ({formatCurrency(commissionAmount, cur)} — potansiyel)</li>
                )}
                {p.serviceFeeAmount != null && p.serviceFeeAmount > 0 && (
                  <li>• Hizmet bedeli ({formatCurrency(p.serviceFeeAmount, cur)} — 2 taksit)</li>
                )}
              </ul>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={!selectedStudent || submitting}
              className="w-full rounded-xl h-11"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Oluşturuluyor...</>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Başvuru Oluştur</>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
