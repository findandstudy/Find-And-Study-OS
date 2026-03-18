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
import {
  Search, Heart, Send, Info, GraduationCap, Globe, Clock,
  Languages, DollarSign, BookOpen, Building2, MapPin,
  ChevronLeft, ChevronRight, X, Percent, FileText, Tag,
} from "lucide-react";

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
  isActive?: boolean;
  universityId: number;
  universityName: string;
  universityLogoUrl?: string | null;
  universityCountry?: string | null;
  universityCity?: string | null;
  universityStatus?: string | null;
  universityType?: string | null;
};

type Filters = {
  country: string;
  level: string;
  language: string;
  search: string;
};

const SHOW_COMMISSION_ROLES = ["super_admin", "agent", "sub_agent"];

function formatCurrency(amount: number | null | undefined, currency = "USD") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export default function CourseFinder() {
  const { user } = useAuth(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ country: "", level: "", language: "", search: "" });
  const [page, setPage] = useState(1);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const showCommission = user && SHOW_COMMISSION_ROLES.includes(user.role);

  const { data: filterOptions } = useQuery<{ countries: string[]; degrees: string[]; languages: string[] }>({
    queryKey: ["course-finder-filters"],
    queryFn: () => apiFetch(`${BASE_URL}/api/course-finder/filters`),
    staleTime: 5 * 60_000,
  });

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", "24");
    if (filters.country) p.set("country", filters.country);
    if (filters.level) p.set("level", filters.level);
    if (filters.language) p.set("language", filters.language);
    if (filters.search) p.set("search", filters.search);
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

  function handleFilterChange(key: keyof Filters, value: string) {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  }

  function clearFilters() {
    setFilters({ country: "", level: "", language: "", search: "" });
    setPage(1);
  }

  const hasActiveFilters = filters.country || filters.level || filters.language || filters.search;

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

          <div className="flex flex-wrap gap-3 items-end">
            <div className="min-w-[160px] space-y-1">
              <Label className="text-xs text-muted-foreground">Country</Label>
              <Select value={filters.country} onValueChange={v => handleFilterChange("country", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Countries" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="_all">All Countries</SelectItem>
                  {filterOptions?.countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[140px] space-y-1">
              <Label className="text-xs text-muted-foreground">Level</Label>
              <Select value={filters.level} onValueChange={v => handleFilterChange("level", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Levels" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Levels</SelectItem>
                  {filterOptions?.degrees.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[140px] space-y-1">
              <Label className="text-xs text-muted-foreground">Language</Label>
              <Select value={filters.language} onValueChange={v => handleFilterChange("language", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="All Languages" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Languages</SelectItem>
                  {filterOptions?.languages.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs text-muted-foreground">
                <X className="w-3 h-3 mr-1" /> Clear
              </Button>
            )}
            {meta && (
              <div className="ml-auto text-sm text-muted-foreground">
                {meta.total} program{meta.total !== 1 ? "s" : ""} found
              </div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border rounded-2xl p-5 animate-pulse space-y-4">
                <div className="flex gap-3 items-center">
                  <div className="w-12 h-12 bg-muted rounded-xl" />
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
        ) : programs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium">No programs found</p>
            <p className="text-sm">Try adjusting your filters or search terms</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {programs.map(prog => (
              <ProgramCard
                key={prog.id}
                program={prog}
                isWishlisted={wishlistIds.includes(prog.id)}
                onToggleWishlist={() => toggleWishlist(prog.id)}
                onInfo={() => setSelectedProgram(prog)}
                showCommission={!!showCommission}
              />
            ))}
          </div>
        )}

        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground px-3">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>
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
    </DashboardLayout>
  );
}

function ProgramCard({ program: p, isWishlisted, onToggleWishlist, onInfo, showCommission }: {
  program: Program;
  isWishlisted: boolean;
  onToggleWishlist: () => void;
  onInfo: () => void;
  showCommission: boolean;
}) {
  const effectiveFee = p.discountedFee ?? p.tuitionFee;
  const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;

  return (
    <div className="bg-card border rounded-2xl overflow-hidden hover:shadow-md transition-shadow group">
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {p.universityLogoUrl ? (
              <img src={p.universityLogoUrl} alt={p.universityName} className="w-full h-full object-contain" />
            ) : (
              <Building2 className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">{p.universityName}</p>
            <h3 className="font-semibold text-sm leading-tight line-clamp-2 mt-0.5">{p.name}</h3>
          </div>
          <button onClick={onToggleWishlist} className="shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors" title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}>
            <Heart className={`w-4 h-4 transition-colors ${isWishlisted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {p.degree && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 rounded-md"><GraduationCap className="w-3 h-3 mr-0.5" />{p.degree}</Badge>}
          {p.language && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 rounded-md"><Languages className="w-3 h-3 mr-0.5" />{p.language}</Badge>}
          {p.duration && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 rounded-md"><Clock className="w-3 h-3 mr-0.5" />{p.duration}</Badge>}
          {p.universityCountry && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 rounded-md"><Globe className="w-3 h-3 mr-0.5" />{p.universityCountry}</Badge>}
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tuition:</span>
            <span className="font-medium">{formatCurrency(p.tuitionFee, p.currency ?? "USD")}</span>
          </div>
          {hasDiscount && (
            <div className="flex justify-between">
              <span className="text-amber-600">Discounted:</span>
              <span className="font-medium text-amber-600">{formatCurrency(p.discountedFee, p.currency ?? "USD")}</span>
            </div>
          )}
          {p.applicationFee != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">App Fee:</span>
              <span className="font-medium">{formatCurrency(p.applicationFee, p.currency ?? "USD")}</span>
            </div>
          )}
          {p.intakes && (
            <div className="flex justify-between col-span-2">
              <span className="text-muted-foreground">Intakes:</span>
              <span className="font-medium truncate ml-2">{p.intakes}</span>
            </div>
          )}
          {showCommission && p.commissionRate != null && (
            <div className="flex justify-between">
              <span className="text-indigo-600">Commission:</span>
              <span className="font-semibold text-indigo-600">{p.commissionRate}%</span>
            </div>
          )}
        </div>

        {p.universityStatus && (
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${p.universityStatus === "open" ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="text-[10px] text-muted-foreground capitalize">{p.universityStatus} for applications</span>
          </div>
        )}
      </div>

      <div className="border-t flex">
        <button
          onClick={onInfo}
          className="flex-1 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors flex items-center justify-center gap-1"
        >
          <Info className="w-3.5 h-3.5" /> Details
        </button>
        <div className="w-px bg-border" />
        <button
          className="flex-1 py-2.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-1"
        >
          <Send className="w-3.5 h-3.5" /> Apply
        </button>
      </div>
    </div>
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

  const sections: { title: string; icon: typeof GraduationCap; items: { label: string; value: string | null | undefined }[] }[] = [
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
        ...(hasDiscount ? [{ label: "Discounted Fee", value: formatCurrency(p.discountedFee, cur) }] : []),
        { label: "Application Fee", value: formatCurrency(p.applicationFee, cur) },
        { label: "Deposit Fee", value: formatCurrency(p.depositFee, cur) },
        { label: "Advanced Fee", value: formatCurrency(p.advancedFee, cur) },
        { label: "Language Fee", value: formatCurrency(p.languageFee, cur) },
        { label: "Service Fee", value: formatCurrency(p.serviceFeeAmount, cur) },
        { label: "Scholarship", value: p.scholarship != null ? formatCurrency(p.scholarship, cur) : null },
        ...(showCommission ? [{ label: "Commission Rate", value: p.commissionRate != null ? `${p.commissionRate}%` : null }] : []),
      ],
    },
  ];

  return (
    <Dialog open={!!p} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
              {p.universityLogoUrl ? (
                <img src={p.universityLogoUrl} alt={p.universityName} className="w-full h-full object-contain" />
              ) : (
                <Building2 className="w-7 h-7 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{p.universityName}</p>
              <DialogTitle className="text-lg">{p.name}</DialogTitle>
              <div className="flex gap-1.5 mt-1.5">
                {p.degree && <Badge variant="secondary" className="text-xs">{p.degree}</Badge>}
                {hasDiscount && <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-200">İndirimli</Badge>}
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
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium text-right max-w-[60%]">{item.value}</span>
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
