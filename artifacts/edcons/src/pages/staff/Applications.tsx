import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { QuickContactDialog } from "@/components/QuickContact";
import { AssignPopover } from "@/components/AssignPopover";
import { RowActionsMenu } from "@/components/RowActionsMenu";
import { StageDocUploadDialog } from "@/components/StageDocUploadDialog";
import { useSeason } from "@/contexts/SeasonContext";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CountryFlag } from "@/components/CountryFlag";
import { OriginBadge } from "@/components/OriginBadge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TablePagination, useTablePagination } from "@/components/TablePagination";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, Plus, LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown,
  Trash2, Pencil, ChevronLeft, ChevronRight, TrendingUp, Filter,
  User, X, Check, GraduationCap, BookOpen, FileCheck, Send,
  Eye, Stamp, CheckCircle, XCircle, Trophy, MessageSquare, Mail,
  UserPlus, UserCheck2, Download, Building2, MapPin, Award, ExternalLink, Globe, DollarSign,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePipelineStages, type PipelineStage } from "@/hooks/use-pipeline-stages";
import { BulkActionBar } from "@/components/BulkActionBar";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const VIEW_KEY = "edcons_applications_view";

function getCsrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function apiFetch(url: string, opts?: RequestInit) {
  const headers = new Headers(opts?.headers);
  if (opts?.method && opts.method !== "GET" && opts.method !== "HEAD") {
    headers.set("x-csrf-token", getCsrfToken());
  }
  const r = await fetch(url, { credentials: "include", ...opts, headers });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(text || `HTTP ${r.status}`);
  }
  if (r.status === 204) return undefined;
  return r.json();
}

const STAGE_COLORS = [
  "bg-slate-100 text-slate-700 border-slate-200",
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-violet-100 text-violet-700 border-violet-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-orange-100 text-orange-700 border-orange-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-teal-100 text-teal-700 border-teal-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
];
const WON_COLOR = "bg-green-100 text-green-700 border-green-200";
const LOST_COLOR = "bg-rose-100 text-rose-700 border-rose-200";

function getStageColor(stage: PipelineStage, index: number): string {
  if (stage.variant === "won") return WON_COLOR;
  if (stage.variant === "lost") return LOST_COLOR;
  return STAGE_COLORS[index % STAGE_COLORS.length];
}

const STUDY_LEVELS = [
  { value: "Bachelor", label: "Bachelor" },
  { value: "Master", label: "Master" },
  { value: "Ph.D", label: "Ph.D" },
  { value: "Associate", label: "Associate" },
  { value: "Language Course", label: "Language Course" },
  { value: "Foundation", label: "Foundation" },
  { value: "Pathway Programs", label: "Pathway Programs" },
];

const INSTRUCTION_LANGUAGES = [
  "English", "Turkish", "French", "German", "Arabic", "Russian",
  "Dutch", "Spanish", "Italian", "Chinese", "Japanese", "Portuguese",
];

type CountryRecord = { id: number; name: string; code: string; flagEmoji?: string; isActive: boolean };

function useCountries() {
  return useQuery<CountryRecord[]>({
    queryKey: ["countries-all"],
    queryFn: async () => {
      const res = await apiFetch(`${BASE_URL}/api/countries?limit=500`);
      return res.data ?? res;
    },
    staleTime: 5 * 60_000,
  });
}

function generateIntakes(): string[] {
  const intakes: string[] = [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const months = [
    { label: "Sep", month: 8 }, { label: "Jan", month: 0 },
    { label: "Feb", month: 1 }, { label: "May", month: 4 },
  ];
  for (let y = year; y <= year + 3; y++) {
    for (const m of months) {
      if (y === year && m.month < month) continue;
      intakes.push(`${m.label} ${y}`);
    }
  }
  return intakes;
}
const INTAKES = generateIntakes();

function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (!num || isNaN(num)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type Student = { id: number; firstName: string; lastName: string; email?: string | null; nationality?: string | null };

/* ── StudentSearchInput ──────────────────────────────────── */
function StudentSearchInput({ value, onChange }: { value: Student | null; onChange: (s: Student | null) => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: studentsResp, isLoading } = useQuery({
    queryKey: ["students-search", debouncedQuery],
    queryFn: () => apiFetch(`${BASE_URL}/api/students?limit=20${debouncedQuery ? `&search=${encodeURIComponent(debouncedQuery)}` : ""}`),
    enabled: open,
  });
  const students: Student[] = studentsResp?.data ?? [];

  if (value) {
    return (
      <div className="flex items-center gap-2 p-2.5 border border-primary rounded-xl bg-primary/5">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{value.firstName} {value.lastName}</p>
          {value.email && <p className="text-xs text-muted-foreground truncate">{value.email}</p>}
        </div>
        <button type="button" onClick={() => { onChange(null); setQuery(""); }} className="p-1 rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative cursor-text" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input ref={inputRef} placeholder="Search student..." value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} className="pl-9 rounded-xl" autoComplete="off" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] max-h-64 overflow-y-auto" align="start" onOpenAutoFocus={e => e.preventDefault()}>
        {isLoading && <div className="p-3 text-sm text-muted-foreground text-center">Searching...</div>}
        {!isLoading && students.length === 0 && <div className="p-4 text-sm text-muted-foreground text-center">{query.length === 0 ? "Start typing to search" : "No students found"}</div>}
        {students.map(student => (
          <button key={student.id} type="button" className="w-full flex items-center gap-3 p-3 hover:bg-secondary/70 transition-colors text-left border-b border-border/50 last:border-0" onMouseDown={e => { e.preventDefault(); onChange(student); setQuery(""); setOpen(false); }}>
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-primary" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{student.firstName} {student.lastName}</p>
              <p className="text-xs text-muted-foreground truncate">{student.email || student.nationality || "—"}</p>
            </div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

type ColVariant = "won" | "lost" | undefined;

function ensureUrl(u?: string | null) {
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function UniversityInfoPopup({ universityId, onClose }: { universityId: number; onClose: () => void }) {
  const { data: uni, isLoading } = useQuery<any>({
    queryKey: ["university-info", universityId],
    queryFn: () => apiFetch(`${BASE_URL}/api/universities/${universityId}`),
    enabled: !!universityId,
  });

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : uni ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl border-2 border-muted bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {uni.logoUrl ? (
                    <img src={uni.logoUrl} alt={uni.name} className="w-full h-full object-contain p-1" />
                  ) : (
                    <Building2 className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-lg">{uni.name}</DialogTitle>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {uni.universityType && <Badge variant="secondary" className="text-xs">{uni.universityType}</Badge>}
                    {uni.status && (
                      <Badge variant="outline" className={`text-xs ${uni.status === "open" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-amber-300 text-amber-700 bg-amber-50"}`}>
                        {uni.status === "open" ? "Open" : "Closed"}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-4 mt-3">
              {uni.description && <p className="text-sm text-muted-foreground leading-relaxed">{uni.description}</p>}
              <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> Location</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {uni.country && <div><span className="text-muted-foreground text-xs">Country</span><p className="font-medium">{uni.country}</p></div>}
                  {uni.city && <div><span className="text-muted-foreground text-xs">City</span><p className="font-medium">{uni.city}</p></div>}
                </div>
                {uni.address && <div><span className="text-muted-foreground text-xs">Address</span><p className="text-sm font-medium">{uni.address}</p></div>}
              </div>
              {(uni.qsRanking || uni.timesRanking || uni.ranking) && (
                <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2"><Award className="w-4 h-4 text-primary" /> Rankings</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {uni.qsRanking && <div className="text-center bg-white rounded-lg p-2 border"><p className="text-lg font-bold text-primary">#{uni.qsRanking}</p><p className="text-[10px] text-muted-foreground font-medium">QS World</p></div>}
                    {uni.timesRanking && <div className="text-center bg-white rounded-lg p-2 border"><p className="text-lg font-bold text-primary">#{uni.timesRanking}</p><p className="text-[10px] text-muted-foreground font-medium">Times HE</p></div>}
                    {uni.ranking && <div className="text-center bg-white rounded-lg p-2 border"><p className="text-lg font-bold text-primary">#{uni.ranking}</p><p className="text-[10px] text-muted-foreground font-medium">National</p></div>}
                  </div>
                </div>
              )}
              {(uni.contactName || uni.contactEmail || uni.contactPhone) && (
                <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Contact</h4>
                  <div className="space-y-2">
                    {uni.contactName && <div className="flex items-center gap-2 text-sm"><User className="w-3.5 h-3.5 text-muted-foreground" /><span className="font-medium">{uni.contactName}</span></div>}
                    {uni.contactEmail && <a href={`mailto:${uni.contactEmail}`} className="flex items-center gap-2 text-sm text-primary hover:underline"><Mail className="w-3.5 h-3.5" />{uni.contactEmail}</a>}
                    {uni.contactPhone && <a href={`tel:${uni.contactPhone}`} className="flex items-center gap-2 text-sm text-primary hover:underline"><MessageSquare className="w-3.5 h-3.5" />{uni.contactPhone}</a>}
                  </div>
                </div>
              )}
              {ensureUrl(uni.website) && (
                <a href={ensureUrl(uni.website)!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
                  <Globe className="w-4 h-4" /> Visit Website <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">University information not available.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProgramInfoPopup({ programId, onClose }: { programId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["program-info", programId],
    queryFn: () => apiFetch(`${BASE_URL}/api/course-finder?programId=${programId}&limit=1`),
    enabled: !!programId,
  });
  const p = Array.isArray(data?.data) ? data.data[0] : Array.isArray(data) ? data[0] : null;

  const fmtCur = (v: any, cur = "USD") => v != null && v !== "" ? `$${Number(v).toLocaleString()}` : null;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : p ? (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="w-14 h-14 rounded-xl border-2 border-muted bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {p.universityLogoUrl ? (
                    <img src={p.universityLogoUrl} alt={p.universityName} className="w-full h-full object-contain p-1" />
                  ) : (
                    <Building2 className="w-7 h-7 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">{p.universityName}</p>
                  <DialogTitle className="text-lg">{p.name}</DialogTitle>
                  <div className="flex gap-1.5 mt-1.5">
                    {p.degree && <Badge variant="secondary" className="text-xs">{p.degree}</Badge>}
                    {p.universityStatus && (
                      <Badge variant="outline" className={`text-xs ${p.universityStatus === "open" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-amber-300 text-amber-700 bg-amber-50"}`}>
                        {p.universityStatus}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-4 mt-3">
              <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2"><GraduationCap className="w-4 h-4 text-primary" /> Program Details</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground text-xs">Program Name</span><p className="font-medium">{p.name}</p></div>
                  {p.degree && <div><span className="text-muted-foreground text-xs">Degree / Level</span><p className="font-medium">{p.degree}</p></div>}
                  {p.language && <div><span className="text-muted-foreground text-xs">Language</span><p className="font-medium">{p.language}</p></div>}
                  {p.duration && <div><span className="text-muted-foreground text-xs">Duration</span><p className="font-medium">{p.duration}</p></div>}
                  {p.intakes && <div><span className="text-muted-foreground text-xs">Intakes</span><p className="font-medium">{p.intakes}</p></div>}
                  {p.field && <div><span className="text-muted-foreground text-xs">Field of Study</span><p className="font-medium">{p.field}</p></div>}
                </div>
              </div>
              <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> University</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {p.universityName && <div><span className="text-muted-foreground text-xs">University</span><p className="font-medium">{p.universityName}</p></div>}
                  {p.universityCountry && <div><span className="text-muted-foreground text-xs">Country</span><p className="font-medium">{p.universityCountry}</p></div>}
                  {p.universityCity && <div><span className="text-muted-foreground text-xs">City</span><p className="font-medium">{p.universityCity}</p></div>}
                  {p.universityStatus && <div><span className="text-muted-foreground text-xs">Status</span><p className="font-medium">{p.universityStatus}</p></div>}
                </div>
              </div>
              <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> Fees & Finance</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {fmtCur(p.tuitionFee) && <div><span className="text-muted-foreground text-xs">Tuition Fee</span><p className="font-medium">{fmtCur(p.tuitionFee)}</p></div>}
                  {p.feeType && <div><span className="text-muted-foreground text-xs">Fee Type</span><p className="font-medium">{p.feeType}</p></div>}
                  {fmtCur(p.applicationFee) && <div><span className="text-muted-foreground text-xs">Application Fee</span><p className="font-medium">{fmtCur(p.applicationFee)}</p></div>}
                  {fmtCur(p.depositFee) && <div><span className="text-muted-foreground text-xs">Deposit Fee</span><p className="font-medium">{fmtCur(p.depositFee)}</p></div>}
                  {fmtCur(p.serviceFeeAmount) && <div><span className="text-muted-foreground text-xs">Service Fee</span><p className="font-medium">{fmtCur(p.serviceFeeAmount)}</p></div>}
                  {fmtCur(p.commissionAmount) && <div><span className="text-muted-foreground text-xs">Commission</span><p className="font-medium text-emerald-600">{fmtCur(p.commissionAmount)}</p></div>}
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">Program information not available.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── DraggableAppCard ─────────────────────────────────────── */
function DraggableAppCard({ app, onView, variant, assignedUserName, onAssign, staffUsersList, currentUserId }: { app: any; onView: (id: number) => void; variant?: ColVariant; assignedUserName?: string; onAssign?: (entityId: number, userId: number) => void; staffUsersList?: { id: number; name: string }[]; currentUserId?: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const [contactOpen, setContactOpen] = useState(false);
  const [contactChannel, setContactChannel] = useState<"email" | "whatsapp" | "internal">("internal");
  const [uniInfoOpen, setUniInfoOpen] = useState(false);
  const [progInfoId, setProgInfoId] = useState<number | null>(null);
  const [, setLoc] = useLocation();

  const isDirect = !app.originType || app.originType === "direct";
  const cardBg =
    variant === "won" ? "bg-emerald-50 border-emerald-200 hover:border-emerald-300" :
    variant === "lost" ? "bg-rose-50 border-rose-200 hover:border-rose-300" :
    isDirect ? "bg-blue-50 border-blue-200 hover:border-blue-300 hover:shadow-md" :
    "bg-card border-border hover:shadow-md";

  function openContact(ch: "email" | "whatsapp" | "internal") {
    setContactChannel(ch);
    setContactOpen(true);
  }

  const studentName = `${app.studentFirstName || ""} ${app.studentLastName || ""}`.trim() || "Student";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border ${isDragging ? "border-primary shadow-xl opacity-50 z-50 relative" : cardBg} mb-3 transition-shadow duration-200`}
    >
      <div {...attributes} {...listeners} className={`p-4 pb-2 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}>
        <div className="flex justify-between items-start mb-1.5">
          <h4
            className="font-bold text-sm text-foreground line-clamp-1 hover:text-primary hover:underline cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); if (app.studentId) setLoc(`/staff/students/${app.studentId}`); }}
          >
            {app.studentFirstName} {app.studentLastName}
          </h4>
        </div>
        {app.universityName && (
          <p
            className="text-xs text-muted-foreground truncate hover:text-primary hover:underline cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); if (app.universityId) setUniInfoOpen(true); }}
          >{app.universityName}</p>
        )}
        {app.programName && (
          <p
            className="text-xs font-medium text-primary mt-1.5 truncate bg-primary/5 block max-w-full px-2 py-1 rounded-md hover:bg-primary/15 hover:underline cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); if (app.programId) setProgInfoId(app.programId); }}
          >{app.programName}</p>
        )}
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {app.country && <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">{app.country}</span>}
          <OriginBadge originType={app.originType || "direct"} originDisplayName={app.originDisplayName} />
          {app.commissionAmount && parseFloat(app.commissionAmount) > 0 && (
            <div className="flex items-center gap-1 ml-auto">
              <TrendingUp className="w-3 h-3 text-emerald-500" />
              <span className="text-xs font-semibold text-emerald-600">{formatCurrency(parseFloat(app.commissionAmount))}</span>
            </div>
          )}
        </div>
      </div>
      {app.agentName && (
        <div className="px-4 pb-1.5">
          <span
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium cursor-pointer hover:bg-amber-100 hover:border-amber-300 transition-colors max-w-full truncate"
            onClick={(e) => { e.stopPropagation(); setLoc(`/staff/agents/${app.agentId}`); }}
            title={`Agent: ${app.agentName}`}
          >
            <Building2 className="w-3 h-3 shrink-0" />{app.agentName}
          </span>
        </div>
      )}
      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          {onAssign && staffUsersList ? (
            <AssignPopover
              assignedUserName={assignedUserName}
              staffUsers={staffUsersList}
              currentUserId={currentUserId}
              onAssign={(userId) => onAssign(app.id, userId)}
            />
          ) : assignedUserName ? (
            <span className="text-[10px] text-muted-foreground truncate" title={assignedUserName}>
              <UserCheck2 className="w-3 h-3 inline mr-0.5" />{assignedUserName}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); openContact("internal"); }} title="Message"
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          {app.studentEmail && (
            <button onClick={(e) => { e.stopPropagation(); openContact("email"); }} title="Email"
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
              <Mail className="w-3.5 h-3.5" />
            </button>
          )}
          {app.studentPhone && (
            <button onClick={(e) => { e.stopPropagation(); openContact("whatsapp"); }} title="WhatsApp"
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </button>
          )}
          <button
            onClick={() => onView(app.id)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
          >
            <Eye className="w-3 h-3" /> View
          </button>
        </div>
      </div>
      <QuickContactDialog
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        channel={contactChannel}
        setChannel={setContactChannel}
        name={studentName}
        email={app.studentEmail}
        phone={app.studentPhone}
        entityType="application"
        entityId={app.id}
        hideEmail={!app.studentEmail}
        hideWhatsApp={!app.studentPhone}
      />
      {uniInfoOpen && app.universityId && (
        <UniversityInfoPopup universityId={app.universityId} onClose={() => setUniInfoOpen(false)} />
      )}
      {progInfoId && (
        <ProgramInfoPopup programId={progInfoId} onClose={() => setProgInfoId(null)} />
      )}
    </div>
  );
}

/* ── DroppableAppColumn ──────────────────────────────────── */
function DroppableAppColumn({ stage, label, variant, apps, onView, staffUsersMap, onAssign, staffUsersList, currentUserId }: {
  stage: string; label: string; variant?: string | null; apps: any[]; onView: (id: number) => void;
  staffUsersMap?: Record<number, string>; onAssign?: (entityId: number, userId: number) => void;
  staffUsersList?: { id: number; name: string }[]; currentUserId?: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const v = variant as ColVariant;
  const totalRevenue = apps.reduce((sum, a) => sum + (parseFloat(a.commissionAmount) || 0), 0);

  const colBg =
    v === "won" ? "bg-emerald-50/60 border-emerald-200/50" :
    v === "lost" ? "bg-rose-50/60 border-rose-200/50" :
    "bg-secondary/50 border-border/50";

  const headerBg =
    v === "won" ? "bg-emerald-100/80 border-emerald-200/70" :
    v === "lost" ? "bg-rose-100/80 border-rose-200/70" :
    "bg-card/50 border-border/50";

  const badgeBg =
    v === "won" ? "bg-emerald-200/60 text-emerald-800 border-emerald-300/50" :
    v === "lost" ? "bg-rose-200/60 text-rose-800 border-rose-300/50" :
    "bg-background text-muted-foreground border shadow-sm";

  const dropBg =
    v === "won" ? (isOver ? "bg-emerald-100/60" : "") :
    v === "lost" ? (isOver ? "bg-rose-100/60" : "") :
    (isOver ? "bg-primary/5" : "");

  const emptyBorder =
    v === "won" ? "border-emerald-300/50 text-emerald-500" :
    v === "lost" ? "border-rose-300/50 text-rose-400" :
    "border-border/50 text-muted-foreground";

  const icon =
    v === "won" ? <Trophy className="w-4 h-4 text-emerald-500 shrink-0" /> :
    v === "lost" ? <XCircle className="w-4 h-4 text-rose-400 shrink-0" /> :
    null;

  return (
    <div className={`w-72 flex flex-col max-h-full rounded-2xl border overflow-hidden ${colBg}`}>
      <div className={`p-4 border-b shrink-0 ${headerBg}`}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5">
            {icon}
            <h3 className={`font-display font-bold text-sm ${v === "won" ? "text-emerald-800" : v === "lost" ? "text-rose-700" : "text-foreground"}`}>{label}</h3>
          </div>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${badgeBg}`}>{apps.length}</span>
        </div>
        {totalRevenue > 0 && (
          <div className="mt-2 flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 rounded-lg px-2.5 py-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-700">{formatCurrency(totalRevenue)}</span>
          </div>
        )}
      </div>
      <div ref={setNodeRef} className={`p-3 flex-1 overflow-y-auto custom-scrollbar transition-colors duration-150 ${dropBg}`}>
        <SortableContext items={apps.map(a => a.id)} strategy={verticalListSortingStrategy}>
          {apps.map((app: any) => (
            <DraggableAppCard key={app.id} app={app} onView={onView} variant={v} assignedUserName={app.assignedToId && staffUsersMap ? staffUsersMap[app.assignedToId] : undefined} onAssign={onAssign} staffUsersList={staffUsersList} currentUserId={currentUserId} />
          ))}
          {apps.length === 0 && (
            <div className={`h-20 border-2 border-dashed rounded-xl flex items-center justify-center text-sm font-medium ${emptyBorder}`}>
              Drop here
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

/* ── SortHeader ──────────────────────────────────────────── */
type SortKey = "student" | "stage" | "country" | "university" | "program" | "level" | "intake" | "fee" | "date";
type SortDir = "asc" | "desc";

function SortHeader({ label, sortKey, currentSort, onSort }: {
  label: string; sortKey: SortKey; currentSort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => onSort(sortKey)}>
      <div className="flex items-center gap-1">
        {label}
        {active ? (currentSort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />}
      </div>
    </TableHead>
  );
}

/* ── EditApplicationDialog ───────────────────────────────── */
function EditApplicationDialog({ open, onClose, app, stages }: { open: boolean; onClose: () => void; app: any; stages: PipelineStage[] }) {
  const [form, setForm] = useState({
    stage: "", level: "", country: "", universityId: "", universityName: "",
    programId: "", programName: "", intake: "", instructionLanguage: "",
    tuitionFee: "", notes: "",
  });
  const [docUploadDialog, setDocUploadDialog] = useState<{ targetStage: string; targetStageLabel: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allCountries = [] } = useCountries();
  const activeDestinations = useMemo(() => allCountries.filter(c => c.isActive), [allCountries]);

  const { data: uniData } = useQuery<{ data: Array<{ id: number; name: string }> }>({
    queryKey: ["universities-by-country", form.country],
    queryFn: () => apiFetch(`${BASE_URL}/api/universities?country=${encodeURIComponent(form.country)}&limit=100`),
    enabled: !!form.country,
  });
  const universities = uniData?.data ?? [];

  const { data: progData } = useQuery<{ data: Array<{ id: number; name: string; degree?: string | null; language?: string | null; tuitionFee?: number | null; discountedFee?: number | null; commissionRate?: number | null }> }>({
    queryKey: ["programs-by-university", form.universityId],
    queryFn: () => apiFetch(`${BASE_URL}/api/programs?universityId=${form.universityId}&limit=100`),
    enabled: !!form.universityId,
  });
  const programs = progData?.data ?? [];

  function degreeToLevel(degree?: string | null): string {
    if (!degree) return "";
    const d = degree.toLowerCase();
    if (d.includes("phd") || d.includes("doctorate")) return "doctorate";
    if (d.includes("mba")) return "mba";
    if (d.includes("msc") || d.includes("ma") || d.includes("master")) return "masters";
    if (d.includes("bsc") || d.includes("ba") || d.includes("undergrad")) return "undergraduate";
    if (d.includes("diploma")) return "diploma";
    if (d.includes("foundation")) return "foundation";
    return "";
  }

  const updateApp = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiFetch(`${BASE_URL}/api/applications/${app?.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { toast({ title: "Application updated" }); queryClient.invalidateQueries({ queryKey: ["applications"] }); onClose(); },
    onError: () => { toast({ title: "Error", description: "Failed to update", variant: "destructive" }); },
  });

  useEffect(() => {
    if (open && app) {
      setForm({
        stage: app.stage || "inquiry",
        level: app.level || "",
        country: app.country || "",
        universityId: app.universityId ? String(app.universityId) : "",
        universityName: app.universityName || "",
        programId: app.programId ? String(app.programId) : "",
        programName: app.programName || "",
        intake: app.intake || "",
        instructionLanguage: app.instructionLanguage || "",
        tuitionFee: app.tuitionFee ? String(app.tuitionFee) : "",
        notes: app.notes || "",
      });
    }
  }, [open, app]);

  function handleCountryChange(country: string) {
    if (country === form.country) return;
    setForm({ ...form, country, universityId: "", universityName: "", programId: "", programName: "" });
  }

  function handleUniversityChange(uniId: string) {
    const uni = universities.find(u => String(u.id) === uniId);
    setForm({ ...form, universityId: uniId, universityName: uni?.name ?? "", programId: "", programName: "" });
  }

  function handleProgramChange(progId: string) {
    const prog = programs.find(p => String(p.id) === progId);
    if (!prog) return;
    const autoLevel = degreeToLevel(prog.degree);
    const autoLang = prog.language && INSTRUCTION_LANGUAGES.includes(prog.language) ? prog.language : form.instructionLanguage;
    const effectiveFee = prog.discountedFee ?? prog.tuitionFee;
    const autoFee = effectiveFee != null ? String(effectiveFee) : form.tuitionFee;
    setForm({ ...form, programId: progId, programName: prog.name, level: autoLevel || form.level, instructionLanguage: autoLang, tuitionFee: autoFee });
  }

  async function handleSave() {
    const fee = parseFloat(form.tuitionFee);
    const payload: any = {
      stage: form.stage,
      level: form.level || null,
      country: form.country || null,
      universityId: form.universityId ? parseInt(form.universityId, 10) : null,
      universityName: form.universityName || null,
      programId: form.programId ? parseInt(form.programId, 10) : null,
      programName: form.programName || null,
      intake: form.intake || null,
      instructionLanguage: form.instructionLanguage || null,
      tuitionFee: form.tuitionFee && !isNaN(fee) ? fee : null,
      notes: form.notes || null,
    };

    try {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)![1]) : "";
      const res = await fetch(`${BASE_URL}/api/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: "Application updated" });
        queryClient.invalidateQueries({ queryKey: ["applications"] });
        onClose();
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 422 && body.code === "DOCS_REQUIRED") {
        const stageLabel = stages.find(s => s.key === form.stage)?.label ?? form.stage;
        setDocUploadDialog({ targetStage: form.stage, targetStageLabel: stageLabel });
      } else {
        toast({ title: "Error", description: body.error || "Failed to update", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    }
  }

  const selectedProgForFee = programs.find(p => String(p.id) === form.programId);
  const hasDiscountedFee = selectedProgForFee != null && selectedProgForFee.discountedFee != null;

  return (
    <>
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Application</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Stage</Label>
            <Select value={form.stage} onValueChange={v => setForm({ ...form, stage: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{stages.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Country</Label>
            <Select value={form.country} onValueChange={handleCountryChange}>
              <SelectTrigger><SelectValue placeholder="Select country..." /></SelectTrigger>
              <SelectContent className="max-h-60">{activeDestinations.map(c => <SelectItem key={c.id} value={c.name}><span className="inline-flex items-center gap-1.5"><CountryFlag code={c.code} size="sm" />{c.name}</span></SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>University</Label>
            <Select value={form.universityId} onValueChange={handleUniversityChange} disabled={!form.country}>
              <SelectTrigger>
                <SelectValue placeholder={!form.country ? "Select country first..." : universities.length === 0 ? "No universities found" : "Select university..."} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {universities.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.universityName && !form.universityId && (
              <p className="text-xs text-muted-foreground mt-1">Current: {form.universityName}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Level</Label>
            <Select value={form.level} onValueChange={v => setForm({ ...form, level: v })}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{STUDY_LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Program</Label>
            <Select value={form.programId} onValueChange={handleProgramChange} disabled={!form.universityId}>
              <SelectTrigger>
                <SelectValue placeholder={!form.universityId ? "Select university first..." : programs.length === 0 ? "No programs found" : "Select program..."} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {programs.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}{p.degree && <span className="text-muted-foreground ml-1 text-xs">({p.degree})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.programName && !form.programId && (
              <p className="text-xs text-muted-foreground mt-1">Current: {form.programName}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={form.instructionLanguage} onValueChange={v => setForm({ ...form, instructionLanguage: v })}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{INSTRUCTION_LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Intake</Label>
            <Select value={form.intake} onValueChange={v => setForm({ ...form, intake: v })}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{INTAKES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label className="flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              Tuition Fee (USD)
              {hasDiscountedFee && <span className="text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Discounted</span>}
            </Label>
            <Input type="number" min="0" step="100" value={form.tuitionFee} onChange={e => setForm({ ...form, tuitionFee: e.target.value })} />
            {selectedProgForFee && (selectedProgForFee.tuitionFee != null || selectedProgForFee.discountedFee != null || selectedProgForFee.commissionRate != null) && (
              <div className="flex flex-wrap gap-3 text-xs mt-1">
                {selectedProgForFee.tuitionFee != null && <span className="text-muted-foreground">Standard: <strong>${selectedProgForFee.tuitionFee.toLocaleString()}</strong></span>}
                {selectedProgForFee.discountedFee != null && <span className="text-amber-600">Discounted: <strong>${selectedProgForFee.discountedFee.toLocaleString()}</strong></span>}
                {selectedProgForFee.commissionRate != null && <span className="text-indigo-600">Commission: <strong>{selectedProgForFee.commissionRate}%</strong></span>}
              </div>
            )}
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Notes</Label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateApp.isPending}>{updateApp.isPending ? "Saving..." : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {docUploadDialog && app && (
      <StageDocUploadDialog
        open={!!docUploadDialog}
        onClose={() => setDocUploadDialog(null)}
        applicationId={app.id}
        targetStage={docUploadDialog.targetStage}
        targetStageLabel={docUploadDialog.targetStageLabel}
        onUploaded={() => {
          queryClient.invalidateQueries({ queryKey: ["applications"] });
          onClose();
        }}
      />
    )}
    </>
  );
}

/* ── DeleteConfirmDialog ─────────────────────────────────── */
function DeleteConfirmDialog({ open, onClose, count, onConfirm, isPending }: {
  open: boolean; onClose: () => void; count: number; onConfirm: () => void; isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Delete {count} Application{count > 1 ? "s" : ""}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground py-2">This action cannot be undone.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>{isPending ? "Deleting..." : `Delete ${count}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── FilterPopover ────────────────────────────────────────── */
type AppFilters = { stage: string; country: string; source: string; university: string; universityType: string; agent: string; assignedTo: string; dateRange: string; originType: string };
const DEFAULT_FILTERS: AppFilters = { stage: "all", country: "all", source: "all", university: "all", universityType: "all", agent: "all", assignedTo: "all", dateRange: "all", originType: "all" };

function isDateInRange(dateStr: string, range: string): boolean {
  if (range === "all") return true;
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "today") return d >= today;
  if (range === "yesterday") { const y = new Date(today); y.setDate(y.getDate() - 1); return d >= y && d < today; }
  if (range === "last7") { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
  if (range === "thisMonth") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (range === "thisYear") return d.getFullYear() === now.getFullYear();
  return true;
}

function FilterPopover({ filters, onChange, stages, apps, staffUsersList }: {
  stages: PipelineStage[];
  filters: AppFilters;
  onChange: (f: AppFilters) => void;
  apps: any[];
  staffUsersList: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const hasActive = Object.entries(filters).some(([, v]) => v !== "all");
  const { data: allCountries = [] } = useCountries();

  const countriesInApps = useMemo(() => {
    const seen = new Set<string>();
    apps.forEach((a: any) => { if (a.country) seen.add(a.country); });
    return allCountries.filter(c => seen.has(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  }, [apps, allCountries]);

  const uniqueUniversities = useMemo(() => {
    const map = new Map<number, string>();
    apps.forEach((a: any) => { if (a.universityId && a.universityName) map.set(a.universityId, a.universityName); });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [apps]);

  const uniqueAgents = useMemo(() => {
    const map = new Map<number, string>();
    apps.forEach((a: any) => { if (a.agentId && a.agentName) map.set(a.agentId, a.agentName); });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [apps]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className={`rounded-full relative ${hasActive ? "border-primary text-primary bg-primary/5" : ""}`}>
          <Filter className="w-4 h-4" />
          {hasActive && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4 space-y-3 max-h-[70vh] overflow-y-auto" align="end">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Filters</p>
          {hasActive && <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => onChange({ ...DEFAULT_FILTERS })}>Clear</Button>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Stage</Label>
          <Select value={filters.stage} onValueChange={v => onChange({ ...filters, stage: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {stages.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Study Country</Label>
          <Select value={filters.country} onValueChange={v => onChange({ ...filters, country: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="all">All</SelectItem>
              {countriesInApps.map(c => <SelectItem key={c.id} value={c.name}><span className="inline-flex items-center gap-1.5"><CountryFlag code={c.code} size="sm" />{c.name}</span></SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">University</Label>
          <Select value={filters.university} onValueChange={v => onChange({ ...filters, university: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="all">All</SelectItem>
              {uniqueUniversities.map(([id, name]) => <SelectItem key={id} value={String(id)}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">University Type</Label>
          <Select value={filters.universityType} onValueChange={v => onChange({ ...filters, universityType: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="state">State</SelectItem>
              <SelectItem value="private">Private</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Agent</Label>
          <Select value={filters.agent} onValueChange={v => onChange({ ...filters, agent: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="none">No Agent (Staff)</SelectItem>
              {uniqueAgents.map(([id, name]) => <SelectItem key={id} value={String(id)}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Origin</Label>
          <Select value={filters.originType} onValueChange={v => onChange({ ...filters, originType: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="sub_agent">Sub-Agent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Assigned To</Label>
          <Select value={filters.assignedTo} onValueChange={v => onChange({ ...filters, assignedTo: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {staffUsersList.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Origin</Label>
          <Select value={filters.originType} onValueChange={v => onChange({ ...filters, originType: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="sub_agent">Sub-Agent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Created Date</Label>
          <Select value={filters.dateRange} onValueChange={v => onChange({ ...filters, dateRange: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="last7">Last 7 Days</SelectItem>
              <SelectItem value="thisMonth">This Month</SelectItem>
              <SelectItem value="thisYear">This Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="w-full" onClick={() => setOpen(false)}>Apply</Button>
      </PopoverContent>
    </Popover>
  );
}

/* ── AddApplicationModal ─────────────────────────────────── */
function AddApplicationModal({ open, onClose, onSuccess, defaultStage }: { open: boolean; onClose: () => void; onSuccess: () => void; defaultStage?: string }) {
  const { toast } = useToast();
  const { season } = useSeason();
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [form, setForm] = useState({ country: "", universityId: "", universityName: "", programId: "", programName: "", level: "", instructionLanguage: "", intake: "", tuitionFee: "", notes: "" });

  const { data: allCountriesAdd = [] } = useCountries();
  const activeDestinations = useMemo(() => allCountriesAdd.filter(c => c.isActive), [allCountriesAdd]);

  const { data: uniData } = useQuery<{ data: Array<{ id: number; name: string }> }>({
    queryKey: ["universities-by-country", form.country],
    queryFn: () => apiFetch(`${BASE_URL}/api/universities?country=${encodeURIComponent(form.country)}&limit=100`),
    enabled: !!form.country,
  });
  const universities = uniData?.data ?? [];

  const { data: progData } = useQuery<{ data: Array<{ id: number; name: string; degree?: string | null; language?: string | null; intakes?: string | null; tuitionFee?: number | null; discountedFee?: number | null; commissionRate?: number | null }> }>({
    queryKey: ["programs-by-university", form.universityId],
    queryFn: () => apiFetch(`${BASE_URL}/api/programs?universityId=${form.universityId}&limit=100`),
    enabled: !!form.universityId,
  });
  const programs = progData?.data ?? [];

  function degreeToLevel(degree?: string | null): string {
    if (!degree) return "";
    const d = degree.toLowerCase();
    if (d.includes("phd") || d.includes("doctorate")) return "doctorate";
    if (d.includes("mba")) return "mba";
    if (d.includes("msc") || d.includes("ma") || d.includes("master")) return "masters";
    if (d.includes("bsc") || d.includes("ba") || d.includes("undergrad")) return "undergraduate";
    if (d.includes("diploma")) return "diploma";
    if (d.includes("foundation")) return "foundation";
    return "";
  }

  function handleProgramSelect(programId: string) {
    const prog = programs.find(p => String(p.id) === programId);
    if (!prog) return;
    const autoLevel = degreeToLevel(prog.degree);
    const autoLang = prog.language && INSTRUCTION_LANGUAGES.includes(prog.language) ? prog.language : form.instructionLanguage;
    const effectiveFee = prog.discountedFee ?? prog.tuitionFee;
    const autoFee = effectiveFee != null ? String(effectiveFee) : form.tuitionFee;
    setForm({ ...form, programId, programName: prog.name, level: autoLevel || form.level, instructionLanguage: autoLang, tuitionFee: autoFee });
  }

  const createApplication = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiFetch(`${BASE_URL}/api/applications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { toast({ title: "Application created" }); handleClose(); onSuccess(); },
    onError: (err: any) => {
      let desc = err?.message || "Failed";
      try {
        const parsed = JSON.parse(desc);
        if (parsed?.missingFields) {
          desc = `Student is missing required fields: ${parsed.missingFields.join(", ")}. Please complete the student profile first.`;
        } else if (parsed?.error) {
          desc = parsed.error;
        }
      } catch {}
      toast({ title: "Failed", description: desc, variant: "destructive" });
    },
  });

  function handleClose() { setSelectedStudent(null); setForm({ country: "", universityId: "", universityName: "", programId: "", programName: "", level: "", instructionLanguage: "", intake: "", tuitionFee: "", notes: "" }); onClose(); }

  function handleSubmit() {
    if (!selectedStudent) { toast({ title: "Select a student", variant: "destructive" }); return; }
    if (!form.country) { toast({ title: "Select a country", variant: "destructive" }); return; }
    if (!form.level) { toast({ title: "Select a level", variant: "destructive" }); return; }
    const fee = parseFloat(form.tuitionFee);
    createApplication.mutate({
      studentId: selectedStudent.id, stage: defaultStage || "inquiry", season,
      country: form.country || null,
      universityId: form.universityId ? parseInt(form.universityId, 10) : null,
      universityName: form.universityName || null,
      programId: form.programId ? parseInt(form.programId, 10) : null,
      level: form.level || null, programName: form.programName || null,
      instructionLanguage: form.instructionLanguage || null, intake: form.intake || null,
      tuitionFee: form.tuitionFee && !isNaN(fee) ? fee : null, notes: form.notes || null,
    });
  }

  const addSelProgForFee = programs.find(p => String(p.id) === form.programId);
  const addHasDiscountedFee = addSelProgForFee != null && addSelProgForFee.discountedFee != null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-xl font-display">New Application</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label className="font-semibold flex items-center gap-1.5"><User className="w-4 h-4 text-primary" /> Student <span className="text-destructive">*</span></Label>
            <StudentSearchInput value={selectedStudent} onChange={setSelectedStudent} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-semibold">Country <span className="text-destructive">*</span></Label>
              <Select value={form.country} onValueChange={v => setForm({ ...form, country: v, universityId: "", universityName: "", programId: "", programName: "", level: "", instructionLanguage: "", intake: "" })}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="max-h-60">{activeDestinations.map(c => <SelectItem key={c.id} value={c.name}><span className="inline-flex items-center gap-1.5"><CountryFlag code={c.code} size="sm" />{c.name}</span></SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">University</Label>
              <Select value={form.universityId} onValueChange={v => { const uni = universities.find(u => String(u.id) === v); setForm({ ...form, universityId: v, universityName: uni?.name ?? "", programId: "", programName: "", level: "", instructionLanguage: "", intake: "" }); }} disabled={!form.country || universities.length === 0}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder={!form.country ? "Select country first..." : universities.length === 0 ? "No universities" : "Select..."} /></SelectTrigger>
                <SelectContent className="max-h-60">{universities.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Level <span className="text-destructive">*</span></Label>
              <Select value={form.level} onValueChange={v => setForm({ ...form, level: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{STUDY_LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Program</Label>
              <Select value={form.programId} onValueChange={handleProgramSelect} disabled={!form.universityId || programs.length === 0}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder={!form.universityId ? "Select uni first..." : programs.length === 0 ? "No programs" : "Select..."} /></SelectTrigger>
                <SelectContent className="max-h-60">{programs.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.degree && <span className="text-muted-foreground ml-1 text-xs">({p.degree})</span>}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Language</Label>
              <Select value={form.instructionLanguage} onValueChange={v => setForm({ ...form, instructionLanguage: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{INSTRUCTION_LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Intake</Label>
              <Select value={form.intake} onValueChange={v => setForm({ ...form, intake: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{INTAKES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label className="font-semibold flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                Tuition Fee (USD)
                {addHasDiscountedFee && <span className="text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Discounted</span>}
              </Label>
              <Input type="number" min="0" step="100" value={form.tuitionFee} onChange={e => setForm({ ...form, tuitionFee: e.target.value })} placeholder="e.g. 15000" className="rounded-xl" />
              {addSelProgForFee && (addSelProgForFee.tuitionFee != null || addSelProgForFee.discountedFee != null || addSelProgForFee.commissionRate != null) && (
                <div className="flex flex-wrap gap-3 text-xs">
                  {addSelProgForFee.tuitionFee != null && <span className="text-muted-foreground">Standard: <strong>${addSelProgForFee.tuitionFee.toLocaleString()}</strong></span>}
                  {addSelProgForFee.discountedFee != null && <span className="text-amber-600">Discounted: <strong>${addSelProgForFee.discountedFee.toLocaleString()}</strong></span>}
                  {addSelProgForFee.commissionRate != null && <span className="text-indigo-600">Commission: <strong>{addSelProgForFee.commissionRate}%</strong></span>}
                </div>
              )}
            </div>
            <div className="space-y-2 col-span-2">
              <Label className="font-semibold">Notes</Label>
              <textarea placeholder="Notes..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} className="rounded-xl">Cancel</Button>
          <Button onClick={handleSubmit} disabled={createApplication.isPending || !selectedStudent || !form.country || !form.level} className="rounded-xl">{createApplication.isPending ? "Creating..." : "Create Application"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── ApplicationsPage ────────────────────────────────────── */
export default function ApplicationsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { season } = useSeason();
  const { user } = useAuth(true, ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant"]);

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"pipeline" | "list">(() => (localStorage.getItem(VIEW_KEY) as "pipeline" | "list") || "pipeline");
  const [filters, setFilters] = useState<AppFilters>({ ...DEFAULT_FILTERS });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "date", dir: "desc" });
  const [editApp, setEditApp] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tableUniInfoId, setTableUniInfoId] = useState<number | null>(null);
  const [tableProgInfoId, setTableProgInfoId] = useState<number | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const pg = useTablePagination(25);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [docUploadDialog, setDocUploadDialog] = useState<{ appId: number; targetStage: string; targetStageLabel: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const { stages: pipelineStages } = usePipelineStages("application");
  const stageOrder = pipelineStages.map(s => s.key);
  const stageMap = Object.fromEntries(pipelineStages.map((s, i) => [s.key, { ...s, _index: i }]));

  const { data: applicationsResp, isLoading } = useQuery({
    queryKey: ["applications", season, search],
    queryFn: () => apiFetch(`${BASE_URL}/api/applications?season=${encodeURIComponent(season)}&limit=500${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });
  const allApps: any[] = applicationsResp?.data || [];

  const isAdmin = user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";

  const { data: staffUsersData } = useQuery({
    queryKey: ["staff-users-list"],
    queryFn: () => apiFetch(`${BASE_URL}/api/users`),
    staleTime: 5 * 60 * 1000,
  });
  const staffUsers = staffUsersData
    ? (Array.isArray(staffUsersData) ? staffUsersData : staffUsersData?.data || []).filter((u: any) => ["super_admin", "admin", "manager", "staff", "consultant", "accountant", "editor"].includes(u.role))
    : [];
  const staffUsersMap = useMemo(() => {
    const m: Record<number, string> = {};
    staffUsers.forEach((u: any) => { m[u.id] = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email; });
    return m;
  }, [staffUsers]);

  const staffUsersList = useMemo(() =>
    staffUsers.map((u: any) => ({ id: u.id, name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email })),
    [staffUsers]
  );

  async function handleAssign(appId: number, userId: number) {
    try {
      await apiFetch(`${BASE_URL}/api/applications/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: userId }),
      });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      toast({ title: "Application assigned" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  const filteredApps = allApps.filter((a: any) => {
    if (filters.stage !== "all" && a.stage !== filters.stage) return false;
    if (filters.country !== "all" && a.country !== filters.country) return false;
    if (filters.source === "agent" && !a.agentId) return false;
    if (filters.source === "staff" && a.agentId) return false;
    if (filters.university !== "all" && String(a.universityId) !== filters.university) return false;
    if (filters.universityType !== "all") {
      const uType = (a.universityType || "").toLowerCase();
      if (uType !== filters.universityType) return false;
    }
    if (filters.agent !== "all") {
      if (filters.agent === "none") { if (a.agentId) return false; }
      else if (String(a.agentId) !== filters.agent) return false;
    }
    if (filters.assignedTo !== "all") {
      if (filters.assignedTo === "unassigned") { if (a.assignedToId) return false; }
      else if (String(a.assignedToId) !== filters.assignedTo) return false;
    }
    if (filters.originType !== "all" && (a.originType || "direct") !== filters.originType) return false;
    if (filters.dateRange !== "all" && a.createdAt && !isDateInRange(a.createdAt, filters.dateRange)) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = `${a.studentFirstName || ""} ${a.studentLastName || ""}`.toLowerCase();
      if (!name.includes(q) && !(a.universityName || "").toLowerCase().includes(q) && !(a.programName || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sortedApps = useMemo(() => {
    const arr = [...filteredApps];
    arr.sort((a: any, b: any) => {
      let valA: any, valB: any;
      switch (sort.key) {
        case "student": valA = `${a.studentFirstName} ${a.studentLastName}`.toLowerCase(); valB = `${b.studentFirstName} ${b.studentLastName}`.toLowerCase(); break;
        case "stage": valA = stageOrder.indexOf(a.stage); valB = stageOrder.indexOf(b.stage); break;
        case "country": valA = (a.country || "").toLowerCase(); valB = (b.country || "").toLowerCase(); break;
        case "university": valA = (a.universityName || "").toLowerCase(); valB = (b.universityName || "").toLowerCase(); break;
        case "program": valA = (a.programName || "").toLowerCase(); valB = (b.programName || "").toLowerCase(); break;
        case "level": valA = a.level || ""; valB = b.level || ""; break;
        case "intake": valA = a.intake || ""; valB = b.intake || ""; break;
        case "fee": valA = parseFloat(a.commissionAmount) || 0; valB = parseFloat(b.commissionAmount) || 0; break;
        case "date": valA = a.createdAt || ""; valB = b.createdAt || ""; break;
        default: return 0;
      }
      if (valA < valB) return sort.dir === "asc" ? -1 : 1;
      if (valA > valB) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredApps, sort, stageOrder]);

  const { paged: pagedApps, total: totalAppsCount } = pg.paginate(sortedApps);

  useEffect(() => { pg.setPage(1); setSelectedIds(new Set()); }, [search, filters, sort]);

  const pagedIds = useMemo(() => new Set(pagedApps.map((a: any) => a.id)), [pagedApps]);
  const allPageSelected = pagedApps.length > 0 && pagedApps.every((a: any) => selectedIds.has(a.id));

  function toggleView(mode: "pipeline" | "list") { setViewMode(mode); localStorage.setItem(VIEW_KEY, mode); setSelectedIds(new Set()); }
  function handleSort(key: SortKey) { setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }); }
  function toggleSelect(id: number) { setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleSelectAll() {
    if (allPageSelected) { setSelectedIds(prev => { const next = new Set(prev); pagedIds.forEach(id => next.delete(id)); return next; }); }
    else { setSelectedIds(prev => { const next = new Set(prev); pagedIds.forEach(id => next.add(id)); return next; }); }
  }

  const allColumnIds = new Set(pipelineStages.map(s => s.key));
  const activeCard = activeId ? allApps.find((a: any) => a.id === activeId) : null;

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as number);

  const isSuperAdmin = user?.role === "super_admin";

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    if (!isSuperAdmin) {
      toast({ title: "Only Super Admin can move cards", variant: "destructive" });
      return;
    }

    const appId = active.id as number;
    const overId = over.id;

    let targetStage: string;
    if (allColumnIds.has(overId as string)) {
      targetStage = overId as string;
    } else {
      const overApp = allApps.find((a: any) => a.id === overId);
      if (!overApp) return;
      targetStage = overApp.stage;
    }

    const app = allApps.find((a: any) => a.id === appId);
    if (!app || app.stage === targetStage) return;

    const colLabel = pipelineStages.find(s => s.key === targetStage)?.label ?? targetStage;

    fetch(`${BASE_URL}/api/applications/${appId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)![1]) : "" },
      credentials: "include",
      body: JSON.stringify({ stage: targetStage }),
    }).then(async (res) => {
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["applications"] });
        queryClient.invalidateQueries({ queryKey: [`/api/applications/${appId}`] });
        toast({ title: `Application moved → ${colLabel}` });
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 422 && body.code === "DOCS_REQUIRED") {
        setDocUploadDialog({ appId, targetStage, targetStageLabel: colLabel });
      } else {
        toast({ title: "Error", description: body.error || "Could not move application", variant: "destructive" });
      }
    }).catch(() => {
      toast({ title: "Error", description: "Could not move application", variant: "destructive" });
    });
  };

  const deleteApp = useMutation({ mutationFn: (id: number) => apiFetch(`${BASE_URL}/api/applications/${id}`, { method: "DELETE" }) });

  async function handleBulkDelete() {
    setDeleteInProgress(true);
    try {
      const res = await apiFetch(`${BASE_URL}/api/applications/bulk-action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selectedIds), action: "delete" }) });
      const d = res as any;
      toast({ title: `${d.updated} application${d.updated !== 1 ? "s" : ""} deleted` });
    } catch { toast({ title: "Some could not be deleted", variant: "destructive" }); }
    setDeleteInProgress(false); setDeleteOpen(false); setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["applications"] });
  }

  async function handleBulkAssign(userId: number) {
    try {
      const res = await apiFetch(`${BASE_URL}/api/applications/bulk-action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selectedIds), action: "assign", assignedToId: userId }) });
      const d = res as any;
      toast({ title: `${d.updated} application${d.updated !== 1 ? "s" : ""} assigned` });
    } catch { toast({ title: "Could not assign applications", variant: "destructive" }); }
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["applications"] });
  }

  async function handleBulkMoveStage(stage: string) {
    try {
      const res = await apiFetch(`${BASE_URL}/api/applications/bulk-action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selectedIds), action: "move", stage }) });
      const d = res as any;
      toast({ title: `${d.updated} application${d.updated !== 1 ? "s" : ""} moved` });
    } catch { toast({ title: "Could not move applications", variant: "destructive" }); }
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["applications"] });
  }

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Applications</h1>
            <p className="text-muted-foreground text-sm mt-1">Track student applications through every stage.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search applications..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white dark:bg-black/20 border-border rounded-full" />
            </div>
            <FilterPopover filters={filters} onChange={setFilters} stages={pipelineStages} apps={allApps} staffUsersList={staffUsersList} />
            <div className="flex items-center border rounded-full overflow-hidden">
              <button onClick={() => toggleView("pipeline")} className={`p-2 transition-colors ${viewMode === "pipeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`} title="Pipeline view"><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => toggleView("list")} className={`p-2 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`} title="List view"><List className="w-4 h-4" /></button>
            </div>
            <BulkActionBar
              selectedCount={selectedIds.size}
              onDelete={() => setDeleteOpen(true)}
              onAssign={handleBulkAssign}
              onMove={handleBulkMoveStage}
              stages={pipelineStages.map(s => ({ key: s.key, label: s.label }))}
              staffUsers={staffUsersList}
              entityLabel="applications"
              moveLabel="Move Stage"
            />
            {isAdmin && (
              <Button variant="outline" size="sm" className="rounded-full h-8 gap-1.5" onClick={() => { const a = document.createElement("a"); a.href = `${BASE_URL}/api/export/applications?season=${encodeURIComponent(season || "")}`; a.click(); }}>
                <Download className="w-3.5 h-3.5" /> Excel
              </Button>
            )}
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New Application
            </Button>
          </div>
        </div>

        {viewMode === "pipeline" && (
          <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
            <div className="flex gap-5 h-full min-w-max px-1">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                {pipelineStages.map(s => {
                  const stageApps = filteredApps.filter((a: any) => a.stage === s.key).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                  return <DroppableAppColumn key={s.key} stage={s.key} label={s.label} variant={s.variant} apps={stageApps} onView={id => setLocation(`/staff/applications/${id}`)} staffUsersMap={staffUsersMap} onAssign={handleAssign} staffUsersList={staffUsersList} currentUserId={user?.id} />;
                })}

                <DragOverlay>
                  {activeCard ? (
                    <div className="bg-card rounded-xl border border-primary shadow-2xl p-4 w-72 opacity-95 rotate-1">
                      <div className="flex justify-between items-start mb-1.5">
                        <h4 className="font-bold text-sm text-foreground">
                          {activeCard.studentFirstName} {activeCard.studentLastName}
                        </h4>
                      </div>
                      {activeCard.universityName && <p className="text-xs text-muted-foreground truncate">{activeCard.universityName}</p>}
                      {activeCard.programName && (
                        <p className="text-xs font-medium text-primary mt-1.5 truncate bg-primary/5 block max-w-full px-2 py-1 rounded-md">
                          {activeCard.programName}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        {activeCard.country && <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">{activeCard.country}</span>}
                        {activeCard.commissionAmount && parseFloat(activeCard.commissionAmount) > 0 && (
                          <div className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3 text-emerald-500" />
                            <span className="text-xs font-semibold text-emerald-600">{formatCurrency(parseFloat(activeCard.commissionAmount))}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </div>
        )}

        {viewMode === "list" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border">
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-10"><Checkbox checked={allPageSelected} onCheckedChange={toggleSelectAll} /></TableHead>
                    <SortHeader label="Student" sortKey="student" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Stage" sortKey="stage" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Country" sortKey="country" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="University" sortKey="university" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Program" sortKey="program" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Level" sortKey="level" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Intake" sortKey="intake" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Commission" sortKey="fee" currentSort={sort} onSort={handleSort} />
                    <TableHead>Assigned</TableHead>
                    <SortHeader label="Created" sortKey="date" currentSort={sort} onSort={handleSort} />
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={12} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
                  ) : pagedApps.length === 0 ? (
                    <TableRow><TableCell colSpan={12} className="text-center py-12 text-muted-foreground">No applications found</TableCell></TableRow>
                  ) : pagedApps.map((app: any) => {
                    const sm = stageMap[app.stage];
                    const stageColor = sm ? getStageColor(sm, sm._index) : "bg-gray-100 text-gray-700 border-gray-200";
                    const stageLabel = sm?.label || app.stage;
                    const levelLabel = STUDY_LEVELS.find(l => l.value === app.level)?.label || app.level || "-";
                    return (
                      <TableRow key={app.id} className={`hover:bg-muted/30 transition-colors cursor-pointer ${selectedIds.has(app.id) ? "bg-primary/5" : ""}`} onClick={() => setLocation(`/staff/applications/${app.id}`)}>
                        <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selectedIds.has(app.id)} onCheckedChange={() => toggleSelect(app.id)} /></TableCell>
                        <TableCell className="font-medium"><div className="flex items-center gap-1.5"><span className="hover:text-primary hover:underline cursor-pointer transition-colors" onClick={(e) => { e.stopPropagation(); if (app.studentId) setLocation(`/staff/students/${app.studentId}`); }}>{app.studentFirstName} {app.studentLastName}</span><OriginBadge originType={app.originType} originDisplayName={app.originDisplayName} /></div></TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${stageColor}`}>{stageLabel}</span></TableCell>
                        <TableCell className="text-muted-foreground">{app.country || "-"}</TableCell>
                        <TableCell className="max-w-[150px] truncate">{app.universityId ? <span className="hover:text-primary hover:underline cursor-pointer transition-colors" onClick={(e) => { e.stopPropagation(); setTableUniInfoId(app.universityId); }}>{app.universityName || "-"}</span> : (app.universityName || "-")}</TableCell>
                        <TableCell className="max-w-[250px]">{app.programId ? <span className="hover:text-primary hover:underline cursor-pointer transition-colors line-clamp-2" title={app.programName || ""} onClick={(e) => { e.stopPropagation(); setTableProgInfoId(app.programId); }}>{app.programName || "-"}</span> : <span className="line-clamp-2" title={app.programName || ""}>{app.programName || "-"}</span>}</TableCell>
                        <TableCell>{levelLabel}</TableCell>
                        <TableCell>{app.intake || "-"}</TableCell>
                        <TableCell>{app.commissionAmount && parseFloat(app.commissionAmount) > 0 ? <span className="text-emerald-600 font-medium">{formatCurrency(parseFloat(app.commissionAmount))}</span> : "-"}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <AssignPopover
                            assignedUserName={app.assignedToId ? staffUsersMap[app.assignedToId] : undefined}
                            staffUsers={staffUsersList}
                            currentUserId={user?.id}
                            onAssign={(userId) => handleAssign(app.id, userId)}
                            size="list"
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{formatDate(app.createdAt)}</TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <RowActionsMenu
                            entityType="application"
                            entityId={app.id}
                            entityName={`${app.studentFirstName} ${app.studentLastName}`}
                            currentAgentId={app.agentId}
                            currentAgentName={app.agentName}
                            currentAssignedToId={app.assignedToId}
                            staffUsersMap={staffUsersMap}
                            staffUsersList={staffUsersList}
                            currentUserId={user?.id}
                            isAdmin={isAdmin}
                            onEdit={() => setEditApp(app)}
                            onDelete={() => { setSelectedIds(new Set([app.id])); setDeleteOpen(true); }}
                            onAssign={(uid) => handleAssign(app.id, uid)}
                            onRefresh={() => queryClient.invalidateQueries({ queryKey: ["applications"] })}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <TablePagination
              currentPage={pg.page}
              totalItems={totalAppsCount}
              pageSize={pg.pageSize}
              onPageChange={pg.setPage}
              onPageSizeChange={pg.setPageSize}
            />
          </div>
        )}
      </div>

      <EditApplicationDialog open={!!editApp} onClose={() => setEditApp(null)} app={editApp} stages={pipelineStages} />
      <DeleteConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} count={selectedIds.size} onConfirm={handleBulkDelete} isPending={deleteInProgress} />
      <AddApplicationModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["applications"] })} defaultStage={pipelineStages[0]?.key} />
      {docUploadDialog && (
        <StageDocUploadDialog
          open={!!docUploadDialog}
          onClose={() => setDocUploadDialog(null)}
          applicationId={docUploadDialog.appId}
          targetStage={docUploadDialog.targetStage}
          targetStageLabel={docUploadDialog.targetStageLabel}
          onUploaded={() => {
            queryClient.invalidateQueries({ queryKey: ["applications"] });
            queryClient.invalidateQueries({ queryKey: [`/api/applications/${docUploadDialog.appId}`] });
          }}
        />
      )}
      {tableUniInfoId && (
        <UniversityInfoPopup universityId={tableUniInfoId} onClose={() => setTableUniInfoId(null)} />
      )}
      {tableProgInfoId && (
        <ProgramInfoPopup programId={tableProgInfoId} onClose={() => setTableProgInfoId(null)} />
      )}
    </DashboardLayout>
  );
}
