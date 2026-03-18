import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSeason } from "@/contexts/SeasonContext";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, Plus, LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown,
  Trash2, Pencil, ChevronLeft, ChevronRight, TrendingUp, Filter,
  User, X, Check, GraduationCap, BookOpen, FileCheck, Send,
  Eye, Stamp, CheckCircle, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePipelineStages, type PipelineStage } from "@/hooks/use-pipeline-stages";
import { EditStagesDialog } from "@/components/EditStagesDialog";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const VIEW_KEY = "edcons_applications_view";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
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
  { value: "foundation", label: "Foundation" },
  { value: "diploma", label: "Diploma" },
  { value: "undergraduate", label: "Undergraduate" },
  { value: "masters", label: "Masters" },
  { value: "mba", label: "MBA" },
  { value: "doctorate", label: "Doctorate" },
  { value: "certificate", label: "Certificate" },
  { value: "language_school", label: "Language School" },
];

const INSTRUCTION_LANGUAGES = [
  "English", "Turkish", "French", "German", "Arabic", "Russian",
  "Dutch", "Spanish", "Italian", "Chinese", "Japanese", "Portuguese",
];

const STUDY_COUNTRIES = [
  "United Kingdom", "United States", "Canada", "Australia", "Germany",
  "France", "Netherlands", "Turkey", "Ireland", "New Zealand",
  "Sweden", "Norway", "Denmark", "Switzerland", "Austria",
  "Italy", "Spain", "Poland", "Czech Republic", "Hungary",
  "Japan", "South Korea", "Singapore", "Malaysia", "UAE",
  "Qatar", "Saudi Arabia", "South Africa", "Brazil", "Argentina",
];

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

/* ── PipelineColumn ──────────────────────────────────────── */
function PipelineColumn({ stage, label, variant, apps, onView }: {
  stage: string; label: string; variant?: string | null; apps: any[]; onView: (id: number) => void;
}) {
  const v = variant as "won" | "lost" | undefined;
  const totalRevenue = apps.reduce((sum, a) => sum + (a.tuitionFee || 0), 0);

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

  return (
    <div className={`w-72 flex flex-col max-h-full rounded-2xl border overflow-hidden ${colBg}`}>
      <div className={`p-4 border-b shrink-0 ${headerBg}`}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5">
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
      <div className="p-3 flex-1 overflow-y-auto custom-scrollbar">
        {apps.map((app: any) => {
          const cardBg = v === "won" ? "bg-emerald-50 border-emerald-200 hover:border-emerald-300" : v === "lost" ? "bg-rose-50 border-rose-200 hover:border-rose-300" : "bg-card border-border hover:shadow-md";
          return (
            <div key={app.id} onClick={() => onView(app.id)} className={`rounded-xl border ${cardBg} mb-3 p-4 cursor-pointer transition-shadow duration-200`}>
              <div className="flex justify-between items-start mb-1.5">
                <h4 className="font-bold text-sm text-foreground line-clamp-1">
                  {app.studentFirstName} {app.studentLastName}
                </h4>
              </div>
              {app.universityName && <p className="text-xs text-muted-foreground truncate">{app.universityName}</p>}
              {app.programName && (
                <p className="text-xs font-medium text-primary mt-1.5 truncate bg-primary/5 inline-block px-2 py-1 rounded-md">{app.programName}</p>
              )}
              <div className="mt-2 flex items-center justify-between">
                {app.country && <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">{app.country}</span>}
                {app.tuitionFee && app.tuitionFee > 0 && (
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-600">{formatCurrency(app.tuitionFee)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {apps.length === 0 && (
          <div className={`h-20 border-2 border-dashed rounded-xl flex items-center justify-center text-sm font-medium ${v === "won" ? "border-emerald-300/50 text-emerald-500" : v === "lost" ? "border-rose-300/50 text-rose-400" : "border-border/50 text-muted-foreground"}`}>
            No applications
          </div>
        )}
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
  const [form, setForm] = useState({ stage: "", level: "", country: "", universityName: "", programName: "", intake: "", instructionLanguage: "", tuitionFee: "", notes: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
        universityName: app.universityName || "",
        programName: app.programName || "",
        intake: app.intake || "",
        instructionLanguage: app.instructionLanguage || "",
        tuitionFee: app.tuitionFee ? String(app.tuitionFee) : "",
        notes: app.notes || "",
      });
    }
  }, [open, app]);

  function handleSave() {
    const payload: any = { ...form };
    const fee = parseFloat(form.tuitionFee);
    if (form.tuitionFee && !isNaN(fee)) payload.tuitionFee = fee;
    else delete payload.tuitionFee;
    updateApp.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
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
            <Label>Level</Label>
            <Select value={form.level} onValueChange={v => setForm({ ...form, level: v })}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{STUDY_LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Country</Label>
            <Select value={form.country} onValueChange={v => setForm({ ...form, country: v })}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent className="max-h-60">{STUDY_COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
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
            <Label>University</Label>
            <Input value={form.universityName} onChange={e => setForm({ ...form, universityName: e.target.value })} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Program</Label>
            <Input value={form.programName} onChange={e => setForm({ ...form, programName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={form.instructionLanguage} onValueChange={v => setForm({ ...form, instructionLanguage: v })}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{INSTRUCTION_LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Tuition Fee (USD)</Label>
            <Input type="number" min="0" step="100" value={form.tuitionFee} onChange={e => setForm({ ...form, tuitionFee: e.target.value })} />
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
function FilterPopover({ filters, onChange, stages }: {
  stages: PipelineStage[];
  filters: { stage: string; country: string };
  onChange: (f: { stage: string; country: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasActive = filters.stage !== "all" || filters.country !== "all";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className={`rounded-full relative ${hasActive ? "border-primary text-primary bg-primary/5" : ""}`}>
          <Filter className="w-4 h-4" />
          {hasActive && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4 space-y-4" align="end">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Filters</p>
          {hasActive && <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => onChange({ stage: "all", country: "all" })}>Clear</Button>}
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
          <Label className="text-xs">Country</Label>
          <Select value={filters.country} onValueChange={v => onChange({ ...filters, country: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="all">All</SelectItem>
              {STUDY_COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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

  const { data: uniData } = useQuery<{ data: Array<{ id: number; name: string }> }>({
    queryKey: ["universities-by-country", form.country],
    queryFn: () => apiFetch(`${BASE_URL}/api/universities?country=${encodeURIComponent(form.country)}&limit=100`),
    enabled: !!form.country,
  });
  const universities = uniData?.data ?? [];

  const { data: progData } = useQuery<{ data: Array<{ id: number; name: string; degree?: string | null; language?: string | null; intakes?: string | null }> }>({
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
    setForm({ ...form, programId, programName: prog.name, level: autoLevel || form.level, instructionLanguage: autoLang });
  }

  const createApplication = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiFetch(`${BASE_URL}/api/applications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { toast({ title: "Application created" }); handleClose(); onSuccess(); },
    onError: (err: any) => { toast({ title: "Failed", description: err?.message, variant: "destructive" }); },
  });

  function handleClose() { setSelectedStudent(null); setForm({ country: "", universityId: "", universityName: "", programId: "", programName: "", level: "", instructionLanguage: "", intake: "", tuitionFee: "", notes: "" }); onClose(); }

  function handleSubmit() {
    if (!selectedStudent) { toast({ title: "Select a student", variant: "destructive" }); return; }
    if (!form.country) { toast({ title: "Select a country", variant: "destructive" }); return; }
    if (!form.level) { toast({ title: "Select a level", variant: "destructive" }); return; }
    const fee = parseFloat(form.tuitionFee);
    createApplication.mutate({
      studentId: selectedStudent.id, stage: defaultStage || "inquiry", season,
      country: form.country || null, universityName: form.universityName || null,
      level: form.level || null, programName: form.programName || null,
      instructionLanguage: form.instructionLanguage || null, intake: form.intake || null,
      tuitionFee: form.tuitionFee && !isNaN(fee) ? fee : null, notes: form.notes || null,
    });
  }

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
                <SelectContent className="max-h-60">{STUDY_COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
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
              <Label className="font-semibold flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Tuition Fee (USD)</Label>
              <Input type="number" min="0" step="100" value={form.tuitionFee} onChange={e => setForm({ ...form, tuitionFee: e.target.value })} placeholder="e.g. 15000" />
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
  const [filters, setFilters] = useState({ stage: "all", country: "all" });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "date", dir: "desc" });
  const [editApp, setEditApp] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [editStagesOpen, setEditStagesOpen] = useState(false);
  const LIST_PAGE_SIZE = 50;

  const { stages: pipelineStages, saveStages, isSaving: isSavingStages } = usePipelineStages("application");
  const stageOrder = pipelineStages.map(s => s.key);
  const stageMap = Object.fromEntries(pipelineStages.map((s, i) => [s.key, { ...s, _index: i }]));

  const { data: applicationsResp, isLoading } = useQuery({
    queryKey: ["applications", season, search],
    queryFn: () => apiFetch(`${BASE_URL}/api/applications?season=${encodeURIComponent(season)}&limit=500${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });
  const allApps: any[] = applicationsResp?.data || [];

  const filteredApps = allApps.filter((a: any) => {
    if (filters.stage !== "all" && a.stage !== filters.stage) return false;
    if (filters.country !== "all" && a.country !== filters.country) return false;
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
        case "fee": valA = a.tuitionFee || 0; valB = b.tuitionFee || 0; break;
        case "date": valA = a.createdAt || ""; valB = b.createdAt || ""; break;
        default: return 0;
      }
      if (valA < valB) return sort.dir === "asc" ? -1 : 1;
      if (valA > valB) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredApps, sort, stageOrder]);

  const totalListPages = Math.max(1, Math.ceil(sortedApps.length / LIST_PAGE_SIZE));
  const pagedApps = sortedApps.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE);

  useEffect(() => { setListPage(1); setSelectedIds(new Set()); }, [search, filters, sort]);
  useEffect(() => { if (listPage > totalListPages) setListPage(Math.max(1, totalListPages)); }, [totalListPages, listPage]);

  const pagedIds = useMemo(() => new Set(pagedApps.map((a: any) => a.id)), [pagedApps]);
  const allPageSelected = pagedApps.length > 0 && pagedApps.every((a: any) => selectedIds.has(a.id));

  function toggleView(mode: "pipeline" | "list") { setViewMode(mode); localStorage.setItem(VIEW_KEY, mode); setSelectedIds(new Set()); }
  function handleSort(key: SortKey) { setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }); }
  function toggleSelect(id: number) { setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleSelectAll() {
    if (allPageSelected) { setSelectedIds(prev => { const next = new Set(prev); pagedIds.forEach(id => next.delete(id)); return next; }); }
    else { setSelectedIds(prev => { const next = new Set(prev); pagedIds.forEach(id => next.add(id)); return next; }); }
  }

  const deleteApp = useMutation({ mutationFn: (id: number) => apiFetch(`${BASE_URL}/api/applications/${id}`, { method: "DELETE" }) });

  async function handleBulkDelete() {
    setDeleteInProgress(true);
    const ids = Array.from(selectedIds);
    let failed = 0;
    for (const id of ids) { try { await deleteApp.mutateAsync(id); } catch { failed++; } }
    setDeleteInProgress(false); setDeleteOpen(false); setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    if (failed === 0) toast({ title: `${ids.length} application${ids.length > 1 ? "s" : ""} deleted` });
    else toast({ title: "Some could not be deleted", variant: "destructive" });
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
            <FilterPopover filters={filters} onChange={setFilters} stages={pipelineStages} />
            <div className="flex items-center border rounded-full overflow-hidden">
              <button onClick={() => toggleView("pipeline")} className={`p-2 transition-colors ${viewMode === "pipeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`} title="Pipeline view"><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => toggleView("list")} className={`p-2 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`} title="List view"><List className="w-4 h-4" /></button>
            </div>
            {selectedIds.size > 0 && (
              <Button variant="destructive" size="sm" className="rounded-full" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="w-4 h-4 mr-1" /> Delete ({selectedIds.size})
              </Button>
            )}
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditStagesOpen(true)}>
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Stages
            </Button>
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New Application
            </Button>
          </div>
        </div>

        {viewMode === "pipeline" && (
          <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
            <div className="flex gap-5 h-full min-w-max px-1">
              {pipelineStages.map(s => {
                const stageApps = filteredApps.filter((a: any) => a.stage === s.key);
                return <PipelineColumn key={s.key} stage={s.key} label={s.label} variant={s.variant} apps={stageApps} onView={id => setEditApp(allApps.find((a: any) => a.id === id))} />;
              })}
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
                    <SortHeader label="Fee" sortKey="fee" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Created" sortKey="date" currentSort={sort} onSort={handleSort} />
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
                  ) : pagedApps.length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">No applications found</TableCell></TableRow>
                  ) : pagedApps.map((app: any) => {
                    const sm = stageMap[app.stage];
                    const stageColor = sm ? getStageColor(sm, sm._index) : "bg-gray-100 text-gray-700 border-gray-200";
                    const stageLabel = sm?.label || app.stage;
                    const levelLabel = STUDY_LEVELS.find(l => l.value === app.level)?.label || app.level || "-";
                    return (
                      <TableRow key={app.id} className={`hover:bg-muted/30 transition-colors ${selectedIds.has(app.id) ? "bg-primary/5" : ""}`}>
                        <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selectedIds.has(app.id)} onCheckedChange={() => toggleSelect(app.id)} /></TableCell>
                        <TableCell className="font-medium">{app.studentFirstName} {app.studentLastName}</TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${stageColor}`}>{stageLabel}</span></TableCell>
                        <TableCell className="text-muted-foreground">{app.country || "-"}</TableCell>
                        <TableCell className="max-w-[150px] truncate">{app.universityName || "-"}</TableCell>
                        <TableCell className="max-w-[150px] truncate">{app.programName || "-"}</TableCell>
                        <TableCell>{levelLabel}</TableCell>
                        <TableCell>{app.intake || "-"}</TableCell>
                        <TableCell>{app.tuitionFee ? <span className="text-emerald-600 font-medium">{formatCurrency(app.tuitionFee)}</span> : "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{formatDate(app.createdAt)}</TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEditApp(app)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => { setSelectedIds(new Set([app.id])); setDeleteOpen(true); }} className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {totalListPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
                <p className="text-sm text-muted-foreground">Showing {(listPage - 1) * LIST_PAGE_SIZE + 1}–{Math.min(listPage * LIST_PAGE_SIZE, sortedApps.length)} of {sortedApps.length}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={listPage <= 1} onClick={() => setListPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
                  <span className="text-sm font-medium">{listPage} / {totalListPages}</span>
                  <Button variant="outline" size="sm" disabled={listPage >= totalListPages} onClick={() => setListPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <EditStagesDialog
        open={editStagesOpen}
        onClose={() => setEditStagesOpen(false)}
        stages={pipelineStages}
        onSave={async (s) => { await saveStages(s); }}
        isSaving={isSavingStages}
        entityLabel="Application"
      />
      <EditApplicationDialog open={!!editApp} onClose={() => setEditApp(null)} app={editApp} stages={pipelineStages} />
      <DeleteConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} count={selectedIds.size} onConfirm={handleBulkDelete} isPending={deleteInProgress} />
      <AddApplicationModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["applications"] })} defaultStage={pipelineStages[0]?.key} />
    </DashboardLayout>
  );
}
