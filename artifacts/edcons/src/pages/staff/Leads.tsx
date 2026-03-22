import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TableSkeleton } from "@/components/ui/page-skeleton";
import { useListLeads, useUpdateLead, useCreateLead, useDeleteLead, customFetch } from "@workspace/api-client-react";
import { useSeason } from "@/contexts/SeasonContext";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Plus, Search, Filter, Eye, TrendingUp, X, UserCheck2,
  ChevronDown, GripVertical, Check, Trophy, XCircle, LayoutGrid, List,
  ArrowUpDown, ArrowUp, ArrowDown, Trash2, Pencil,
} from "lucide-react";
import { TablePagination, useTablePagination } from "@/components/TablePagination";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CountryFlag } from "@/components/CountryFlag";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
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
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePipelineStages, type PipelineStage } from "@/hooks/use-pipeline-stages";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

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

const SOURCES = ["website", "referral", "social_media", "walk_in", "partner", "other"];

type ColVariant = "default" | "won" | "lost";

interface ColDef {
  id: string;
  title: string;
  variant?: ColVariant;
}

const VIEW_KEY = "edcons_leads_view";

function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (!num || isNaN(num)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const LEAD_STAGE_COLORS = [
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-purple-100 text-purple-700 border-purple-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
  "bg-teal-100 text-teal-700 border-teal-200",
  "bg-orange-100 text-orange-700 border-orange-200",
];
const LEAD_WON_COLOR = "bg-emerald-100 text-emerald-700 border-emerald-200";
const LEAD_LOST_COLOR = "bg-rose-100 text-rose-700 border-rose-200";

function getLeadStageColor(stage: PipelineStage, index: number): string {
  if (stage.variant === "won") return LEAD_WON_COLOR;
  if (stage.variant === "lost") return LEAD_LOST_COLOR;
  return LEAD_STAGE_COLORS[index % LEAD_STAGE_COLORS.length];
}

/* ── LeadCard ──────────────────────────────────────────────── */
function LeadCard({ lead, onView, showRevenue, variant, assignedUserName, onAssignToMe, isAdmin }: {
  lead: any; onView: (id: number) => void; showRevenue: boolean; variant?: ColVariant;
  assignedUserName?: string; onAssignToMe?: (id: number) => void; isAdmin?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const cardBg =
    variant === "won" ? "bg-emerald-50 border-emerald-200 hover:border-emerald-300" :
    variant === "lost" ? "bg-rose-50 border-rose-200 hover:border-rose-300" :
    "bg-card border-border hover:shadow-md";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border ${
        isDragging ? "border-primary shadow-xl opacity-50 z-50 relative" : cardBg
      } mb-3 transition-shadow duration-200`}
    >
      <div {...attributes} {...listeners} className={`p-4 pb-2 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}>
        <div className="flex justify-between items-start mb-2">
          <h4 className="font-bold text-sm text-foreground line-clamp-1">
            {lead.firstName} {lead.lastName}
          </h4>
          {lead.source && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
              {lead.source}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{lead.email || lead.phone || "No contact info"}</p>
        {lead.interestedProgram && (
          <p className="text-xs font-medium text-primary mt-2 truncate bg-primary/5 block max-w-full px-2 py-1 rounded-md">
            {lead.interestedProgram}
          </p>
        )}
        {showRevenue && lead.estimatedValue && parseFloat(lead.estimatedValue) > 0 && (
          <div className="mt-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(lead.estimatedValue)}
            </span>
          </div>
        )}
      </div>
      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          {lead.assignedToId ? (
            <span className="text-[10px] text-muted-foreground truncate" title={assignedUserName}>
              <UserCheck2 className="w-3 h-3 inline mr-0.5" />{assignedUserName || "Assigned"}
            </span>
          ) : onAssignToMe ? (
            <button
              onClick={(e) => { e.stopPropagation(); onAssignToMe(lead.id); }}
              className="text-[10px] text-primary hover:underline font-medium"
            >
              Assign to Me
            </button>
          ) : null}
        </div>
        <button
          onClick={() => onView(lead.id)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          <Eye className="w-3 h-3" /> View
        </button>
      </div>
    </div>
  );
}

/* ── DroppableColumn ──────────────────────────────────────── */
function DroppableColumn({ col, leads, showRevenue, onView, staffUsersMap, onAssignToMe, isAdmin }: {
  col: ColDef; leads: any[]; showRevenue: boolean; onView: (id: number) => void;
  staffUsersMap?: Record<number, string>; onAssignToMe?: (id: number) => void; isAdmin?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const totalRevenue = showRevenue ? leads.reduce((sum, l) => sum + (parseFloat(l.estimatedValue) || 0), 0) : 0;
  const v = col.variant ?? "default";

  const headerBg =
    v === "won" ? "bg-emerald-100/80 border-emerald-200/70" :
    v === "lost" ? "bg-rose-100/80 border-rose-200/70" :
    "bg-card/50 border-border/50";

  const colBg =
    v === "won" ? "bg-emerald-50/60 border-emerald-200/50" :
    v === "lost" ? "bg-rose-50/60 border-rose-200/50" :
    "bg-secondary/50 border-border/50";

  const dropBg =
    v === "won" ? (isOver ? "bg-emerald-100/60" : "") :
    v === "lost" ? (isOver ? "bg-rose-100/60" : "") :
    (isOver ? "bg-primary/5" : "");

  const badgeBg =
    v === "won" ? "bg-emerald-200/60 text-emerald-800 border-emerald-300/50" :
    v === "lost" ? "bg-rose-200/60 text-rose-800 border-rose-300/50" :
    "bg-background text-muted-foreground border shadow-sm";

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
            <h3 className={`font-display font-bold ${
              v === "won" ? "text-emerald-800" : v === "lost" ? "text-rose-700" : "text-foreground"
            }`}>{col.title}</h3>
          </div>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${badgeBg}`}>
            {leads.length}
          </span>
        </div>
        {showRevenue && totalRevenue > 0 && (
          <div className="mt-2 flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 rounded-lg px-2.5 py-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-700">{formatCurrency(totalRevenue)}</span>
          </div>
        )}
      </div>
      <div ref={setNodeRef} className={`p-3 flex-1 overflow-y-auto custom-scrollbar transition-colors duration-150 ${dropBg}`}>
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onView={onView} showRevenue={showRevenue} variant={v} assignedUserName={lead.assignedToId && staffUsersMap ? staffUsersMap[lead.assignedToId] : undefined} onAssignToMe={onAssignToMe} isAdmin={isAdmin} />
          ))}
          {leads.length === 0 && (
            <div className={`h-20 border-2 border-dashed rounded-xl flex items-center justify-center text-sm font-medium ${emptyBorder}`}>
              Drop here
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}


/* ── FilterPopover ────────────────────────────────────────── */
function FilterPopover({ filters, onChange, columns }: {
  filters: { source: string; status: string };
  onChange: (f: { source: string; status: string }) => void;
  columns: ColDef[];
}) {
  const [open, setOpen] = useState(false);
  const hasActive = filters.source !== "all" || filters.status !== "all";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={`rounded-full relative ${hasActive ? "border-primary text-primary bg-primary/5" : ""}`}
        >
          <Filter className="w-4 h-4" />
          {hasActive && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4 space-y-4" align="end">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Filtreler</p>
          {hasActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={() => onChange({ source: "all", status: "all" })}
            >
              Temizle
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Source</Label>
          <Select value={filters.source} onValueChange={v => onChange({ ...filters, source: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {SOURCES.map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Stage</Label>
          <Select value={filters.status} onValueChange={v => onChange({ ...filters, status: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {columns.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button size="sm" className="w-full" onClick={() => setOpen(false)}>
          Uygula
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/* ── NationalityCombobox ──────────────────────────────────── */
function NationalityCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: allCountries = [] } = useCountries();
  const [inputVal, setInputVal] = useState(value);
  const [open, setOpen] = useState(false);

  useEffect(() => { setInputVal(value); }, [value]);

  const filtered = inputVal
    ? allCountries.filter(c => c.name.toLowerCase().includes(inputVal.toLowerCase()))
    : allCountries;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative cursor-text" onClick={() => setOpen(true)}>
          <Input
            value={inputVal}
            onChange={e => { setInputVal(e.target.value); onChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Select or type..."
            autoComplete="off"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] max-h-48 overflow-y-auto" align="start" onOpenAutoFocus={e => e.preventDefault()}>
        {filtered.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">{inputVal ? "No match — custom value OK" : "No countries loaded"}</div>}
        {filtered.map(c => (
          <button key={c.id} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary/70 transition-colors flex items-center gap-2 ${c.name === value ? "bg-primary/10 font-medium" : ""}`}
            onMouseDown={e => { e.preventDefault(); onChange(c.name); setInputVal(c.name); setOpen(false); }}>
            <CountryFlag code={c.code} size="sm" />
            {c.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* ── CountrySelect (active destinations only) ────────────── */
function CountrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: allCountries = [] } = useCountries();
  const activeDestinations = useMemo(() => allCountries.filter(c => c.isActive), [allCountries]);

  return (
    <Select value={value || "__clear"} onValueChange={v => onChange(v === "__clear" ? "" : v)}>
      <SelectTrigger><SelectValue placeholder="Select destination..." /></SelectTrigger>
      <SelectContent className="max-h-60">
        <SelectItem value="__clear" className="text-muted-foreground">— None —</SelectItem>
        {activeDestinations.length === 0 && <SelectItem value="__empty" disabled>No active destinations</SelectItem>}
        {activeDestinations.map(c => (
          <SelectItem key={c.id} value={c.name}>
            <span className="inline-flex items-center gap-1.5"><CountryFlag code={c.code} size="sm" />{c.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── EditLeadDialog ───────────────────────────────────────── */
function EditLeadDialog({ open, onClose, lead, canSeeRevenue, columns }: {
  open: boolean; onClose: () => void; lead: any; canSeeRevenue: boolean; columns: ColDef[];
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, status: "new" });
  const updateLead = useUpdateLead();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (open && lead) {
      const parsed = parsePhoneCode(lead.phone || "");
      setForm({
        firstName: lead.firstName || "",
        lastName: lead.lastName || "",
        email: lead.email || "",
        phoneCode: parsed.phoneCode,
        phone: parsed.phone,
        source: lead.source || "website",
        interestedProgram: lead.interestedProgram || "",
        interestedCountry: lead.interestedCountry || "",
        nationality: lead.nationality || "",
        estimatedValue: lead.estimatedValue ? String(lead.estimatedValue) : "",
        status: lead.status || "new",
      });
    }
  }, [open, lead]);

  function handleSave() {
    if (!lead || !form.firstName || !form.lastName) return;
    const { phoneCode, ...rest } = form;
    const payload: any = { ...rest, phone: form.phone ? `${phoneCode}${form.phone}` : "" };
    const parsedVal = parseFloat(form.estimatedValue);
    if (form.estimatedValue && !isNaN(parsedVal)) payload.estimatedValue = parsedVal;
    else delete payload.estimatedValue;

    updateLead.mutate(
      { id: lead.id, data: payload },
      {
        onSuccess: () => {
          toast({ title: "Lead updated" });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
          onClose();
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to update lead", variant: "destructive" });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit Lead</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>First Name *</Label>
            <Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Last Name *</Label>
            <Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <div className="flex gap-1">
              <Select value={form.phoneCode} onValueChange={v => setForm({ ...form, phoneCode: v })}>
                <SelectTrigger className="w-[90px] shrink-0 px-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PHONE_CODES.map(pc => (
                    <SelectItem key={`${pc.code}-${pc.country}`} value={pc.code}>
                      <span className="inline-flex items-center gap-1.5"><CountryFlag code={pc.country} size="sm" />{pc.code}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="flex-1 min-w-0" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="555 000 0000" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Nationality</Label>
            <NationalityCombobox value={form.nationality} onChange={v => setForm({ ...form, nationality: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select value={form.source} onValueChange={v => setForm({ ...form, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCES.map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {columns.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Interested Program</Label>
            <Input value={form.interestedProgram} onChange={e => setForm({ ...form, interestedProgram: e.target.value })} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Interested Country</Label>
            <CountrySelect value={form.interestedCountry} onChange={v => setForm({ ...form, interestedCountry: v })} />
          </div>
          {canSeeRevenue && (
            <div className="space-y-1.5 col-span-2">
              <Label className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                Estimated Value (USD)
              </Label>
              <Input type="number" min="0" step="100" value={form.estimatedValue} onChange={e => setForm({ ...form, estimatedValue: e.target.value })} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateLead.isPending || !form.firstName || !form.lastName}>
            {updateLead.isPending ? "Saving…" : "Save Changes"}
          </Button>
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
        <DialogHeader>
          <DialogTitle>Delete {count} Lead{count > 1 ? "s" : ""}?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          This action cannot be undone. The selected lead{count > 1 ? "s" : ""} and all associated data will be permanently removed.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : `Delete ${count} Lead${count > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── SortHeader ──────────────────────────────────────────── */
type SortKey = "name" | "email" | "status" | "source" | "program" | "country" | "value" | "date";
type SortDir = "asc" | "desc";

function SortHeader({ label, sortKey, currentSort, onSort }: {
  label: string; sortKey: SortKey;
  currentSort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <TableHead
      className="cursor-pointer select-none hover:bg-muted/50 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        {active ? (
          currentSort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />
        )}
      </div>
    </TableHead>
  );
}

/* ── PHONE CODES ─────────────────────────────────────────── */
const PHONE_CODES = [
  { code: "+90", country: "TR" },
  { code: "+1", country: "US" },
  { code: "+44", country: "GB" },
  { code: "+49", country: "DE" },
  { code: "+33", country: "FR" },
  { code: "+39", country: "IT" },
  { code: "+34", country: "ES" },
  { code: "+31", country: "NL" },
  { code: "+46", country: "SE" },
  { code: "+47", country: "NO" },
  { code: "+45", country: "DK" },
  { code: "+41", country: "CH" },
  { code: "+43", country: "AT" },
  { code: "+48", country: "PL" },
  { code: "+7", country: "RU" },
  { code: "+380", country: "UA" },
  { code: "+86", country: "CN" },
  { code: "+81", country: "JP" },
  { code: "+82", country: "KR" },
  { code: "+91", country: "IN" },
  { code: "+92", country: "PK" },
  { code: "+93", country: "AF" },
  { code: "+966", country: "SA" },
  { code: "+971", country: "AE" },
  { code: "+964", country: "IQ" },
  { code: "+98", country: "IR" },
  { code: "+962", country: "JO" },
  { code: "+961", country: "LB" },
  { code: "+20", country: "EG" },
  { code: "+212", country: "MA" },
  { code: "+234", country: "NG" },
  { code: "+254", country: "KE" },
  { code: "+55", country: "BR" },
  { code: "+52", country: "MX" },
  { code: "+61", country: "AU" },
  { code: "+64", country: "NZ" },
  { code: "+60", country: "MY" },
  { code: "+65", country: "SG" },
  { code: "+66", country: "TH" },
  { code: "+84", country: "VN" },
  { code: "+62", country: "ID" },
  { code: "+63", country: "PH" },
  { code: "+880", country: "BD" },
  { code: "+94", country: "LK" },
  { code: "+977", country: "NP" },
  { code: "+251", country: "ET" },
  { code: "+255", country: "TZ" },
  { code: "+233", country: "GH" },
];

function parsePhoneCode(fullPhone: string): { phoneCode: string; phone: string } {
  if (!fullPhone) return { phoneCode: "+90", phone: "" };
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  const matched = sorted.find(pc => fullPhone.startsWith(pc.code));
  if (matched) return { phoneCode: matched.code, phone: fullPhone.slice(matched.code.length).trim() };
  return { phoneCode: "+90", phone: fullPhone.replace(/^\+/, "").trim() };
}

/* ── EMPTY_FORM ───────────────────────────────────────────── */
const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phoneCode: "+90",
  phone: "",
  source: "website",
  interestedProgram: "",
  interestedCountry: "",
  nationality: "",
  estimatedValue: "",
  status: "new",
};

/* ── LeadsPage ────────────────────────────────────────────── */
export default function LeadsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [filters, setFilters] = useState({ source: "all", status: "all" });
  const { stages: pipelineStages } = usePipelineStages("lead");
  const [viewMode, setViewMode] = useState<"pipeline" | "list">(() => {
    return (localStorage.getItem(VIEW_KEY) as "pipeline" | "list") || "pipeline";
  });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "date", dir: "desc" });
  const [editLead, setEditLead] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);

  const pg = useTablePagination(25);

  const { user } = useAuth(true, [
    "super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant",
  ]);
  const canSeeRevenue = user?.role === "super_admin" || user?.role === "admin" || user?.role === "agent";
  const isAdmin = user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";

  const { season } = useSeason();
  const { data, isLoading } = useListLeads({ search, season, limit: 200 } as any);

  const { data: staffUsersData } = useQuery({
    queryKey: ["staff-users-list"],
    queryFn: () => customFetch("/api/users") as Promise<any>,
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });
  const staffUsers = (isAdmin && staffUsersData)
    ? (Array.isArray(staffUsersData) ? staffUsersData : staffUsersData?.data || []).filter((u: any) => ["super_admin", "admin", "manager", "staff", "consultant", "accountant", "editor"].includes(u.role))
    : [];
  const queryClient = useQueryClient();
  const updateLead = useUpdateLead();
  const createLead = useCreateLead();
  const deleteLead = useDeleteLead();

  const staffUsersMap = useMemo(() => {
    const m: Record<number, string> = {};
    staffUsers.forEach((u: any) => { m[u.id] = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email; });
    return m;
  }, [staffUsers]);

  async function handleAssignToMe(leadId: number) {
    try {
      await customFetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: user!.id }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead assigned to you" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const allLeads = data?.data || [];

  const columns: ColDef[] = pipelineStages.map(s => ({
    id: s.key,
    title: s.label,
    variant: (s.variant as ColVariant) || undefined,
  }));

  const allColumnIds = new Set(columns.map(c => c.id));
  const leadStageMap = Object.fromEntries(pipelineStages.map((s, i) => [s.key, { ...s, _index: i }]));

  const filteredLeads = allLeads.filter((l: any) => {
    if (filters.source !== "all" && l.source !== filters.source) return false;
    if (filters.status !== "all" && l.status !== filters.status) return false;
    return true;
  });

  const sortedLeads = useMemo(() => {
    const arr = [...filteredLeads];
    arr.sort((a: any, b: any) => {
      let valA: any, valB: any;
      switch (sort.key) {
        case "name": valA = `${a.firstName} ${a.lastName}`.toLowerCase(); valB = `${b.firstName} ${b.lastName}`.toLowerCase(); break;
        case "email": valA = (a.email || "").toLowerCase(); valB = (b.email || "").toLowerCase(); break;
        case "status": valA = a.status || ""; valB = b.status || ""; break;
        case "source": valA = a.source || ""; valB = b.source || ""; break;
        case "program": valA = (a.interestedProgram || "").toLowerCase(); valB = (b.interestedProgram || "").toLowerCase(); break;
        case "country": valA = (a.interestedCountry || "").toLowerCase(); valB = (b.interestedCountry || "").toLowerCase(); break;
        case "value": valA = parseFloat(a.estimatedValue) || 0; valB = parseFloat(b.estimatedValue) || 0; break;
        case "date": valA = a.createdAt || ""; valB = b.createdAt || ""; break;
        default: return 0;
      }
      if (valA < valB) return sort.dir === "asc" ? -1 : 1;
      if (valA > valB) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredLeads, sort]);

  const { paged: pagedLeads, total: totalLeadsCount } = pg.paginate(sortedLeads);

  useEffect(() => { pg.setPage(1); setSelectedIds(new Set()); }, [search, filters, sort]);

  const activeCard = activeId ? allLeads.find((l: any) => l.id === activeId) : null;

  function toggleView(mode: "pipeline" | "list") {
    setViewMode(mode);
    localStorage.setItem(VIEW_KEY, mode);
    setSelectedIds(new Set());
  }

  function handleSort(key: SortKey) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const pagedIds = useMemo(() => new Set(pagedLeads.map((l: any) => l.id)), [pagedLeads]);
  const allPageSelected = pagedLeads.length > 0 && pagedLeads.every((l: any) => selectedIds.has(l.id));

  function toggleSelectAll() {
    if (allPageSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pagedIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pagedIds.forEach(id => next.add(id));
        return next;
      });
    }
  }

  async function handleBulkDelete() {
    setDeleteInProgress(true);
    const ids = Array.from(selectedIds);
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteLead.mutateAsync({ id });
      } catch {
        failed++;
      }
    }
    setDeleteInProgress(false);
    setDeleteOpen(false);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    if (failed === 0) {
      toast({ title: `${ids.length} lead${ids.length > 1 ? "s" : ""} deleted` });
    } else {
      toast({ title: "Some leads could not be deleted", variant: "destructive" });
    }
  }

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as number);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const leadId = active.id as number;
    const overId = over.id;

    let targetStatus: string;
    if (allColumnIds.has(overId as string)) {
      targetStatus = overId as string;
    } else {
      const overLead = allLeads.find((l: any) => l.id === overId);
      if (!overLead) return;
      targetStatus = overLead.status;
    }

    const lead = allLeads.find((l: any) => l.id === leadId);
    if (!lead || lead.status === targetStatus) return;

    updateLead.mutate(
      { id: leadId, data: { status: targetStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
          const colLabel = columns.find(c => c.id === targetStatus)?.title ?? targetStatus;
          toast({ title: `Lead moved to ${colLabel}` });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to move lead", variant: "destructive" });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        },
      }
    );
  };

  function handleCreate() {
    if (!form.firstName || !form.lastName) return;
    const defaultStatus = pipelineStages.length > 0 ? pipelineStages[0].key : "new";
    const { phoneCode, ...formRest } = form;
    const payload: any = { ...formRest, phone: form.phone ? `${phoneCode}${form.phone}` : "", status: defaultStatus, season };
    const parsedCreate = parseFloat(form.estimatedValue);
    if (form.estimatedValue && !isNaN(parsedCreate)) payload.estimatedValue = parsedCreate;
    else delete payload.estimatedValue;

    createLead.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: "Lead created" });
          setCreateOpen(false);
          setForm(EMPTY_FORM);
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        },
      }
    );
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <TableSkeleton />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex flex-col">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground">Leads</h1>
              <p className="text-muted-foreground text-sm mt-1">Manage and convert prospective students.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search leads..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white dark:bg-black/20 border-border rounded-full"
              />
            </div>
            <FilterPopover filters={filters} onChange={setFilters} columns={columns} />

            <div className="flex items-center border rounded-full overflow-hidden">
              <button
                onClick={() => toggleView("pipeline")}
                className={`p-2 transition-colors ${viewMode === "pipeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                title="Pipeline view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => toggleView("list")}
                className={`p-2 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            {selectedIds.size > 0 && (
              <Button variant="destructive" size="sm" className="rounded-full" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="w-4 h-4 mr-1" />
                Delete ({selectedIds.size})
              </Button>
            )}

            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Lead
            </Button>
          </div>
        </div>

        {/* ── Pipeline board ─────────────────────────────────── */}
        {viewMode === "pipeline" && (
          <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
            <div className="flex gap-5 h-full min-w-max px-1">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                {columns.map((col) => {
                  const columnLeads = filteredLeads.filter((l: any) => l.status === col.id);
                  return (
                    <DroppableColumn
                      key={col.id}
                      col={col}
                      leads={columnLeads}
                      showRevenue={canSeeRevenue}
                      onView={(id) => setLocation(`/staff/leads/${id}`)}
                      staffUsersMap={staffUsersMap}
                      onAssignToMe={!isAdmin ? handleAssignToMe : undefined}
                      isAdmin={isAdmin}
                    />
                  );
                })}

                <DragOverlay>
                  {activeCard ? (
                    <div className="bg-card rounded-xl border border-primary shadow-2xl p-4 w-72 opacity-95 rotate-1">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold text-sm text-foreground">
                          {activeCard.firstName} {activeCard.lastName}
                        </h4>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {activeCard.email || activeCard.phone || "No contact info"}
                      </p>
                      {activeCard.interestedProgram && (
                        <p className="text-xs font-medium text-primary mt-2 truncate bg-primary/5 block max-w-full px-2 py-1 rounded-md">
                          {activeCard.interestedProgram}
                        </p>
                      )}
                      {canSeeRevenue && activeCard.estimatedValue && parseFloat(activeCard.estimatedValue) > 0 && (
                        <div className="mt-2 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-emerald-500" />
                          <span className="text-xs font-semibold text-emerald-600">
                            {formatCurrency(activeCard.estimatedValue)}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </div>
        )}

        {/* ── List view ──────────────────────────────────────── */}
        {viewMode === "list" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border">
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allPageSelected}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <SortHeader label="Name" sortKey="name" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Email" sortKey="email" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Source" sortKey="source" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Program" sortKey="program" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Country" sortKey="country" currentSort={sort} onSort={handleSort} />
                    {canSeeRevenue && (
                      <SortHeader label="Value" sortKey="value" currentSort={sort} onSort={handleSort} />
                    )}
                    <TableHead>Assigned</TableHead>
                    <SortHeader label="Created" sortKey="date" currentSort={sort} onSort={handleSort} />
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={canSeeRevenue ? 11 : 10} className="text-center py-12 text-muted-foreground">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : pagedLeads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canSeeRevenue ? 11 : 10} className="text-center py-12 text-muted-foreground">
                        No leads found
                      </TableCell>
                    </TableRow>
                  ) : pagedLeads.map((lead: any) => (
                    <TableRow
                      key={lead.id}
                      className={`cursor-pointer hover:bg-muted/30 transition-colors ${selectedIds.has(lead.id) ? "bg-primary/5" : ""}`}
                    >
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(lead.id)}
                          onCheckedChange={() => toggleSelect(lead.id)}
                        />
                      </TableCell>
                      <TableCell
                        className="font-medium"
                        onClick={() => setLocation(`/staff/leads/${lead.id}`)}
                      >
                        {lead.firstName} {lead.lastName}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground"
                        onClick={() => setLocation(`/staff/leads/${lead.id}`)}
                      >
                        {lead.email || "-"}
                      </TableCell>
                      <TableCell onClick={() => setLocation(`/staff/leads/${lead.id}`)}>
                        {(() => {
                          const sm = leadStageMap[lead.status];
                          const color = sm ? getLeadStageColor(sm, sm._index) : "bg-gray-100 text-gray-700 border-gray-200";
                          return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${color}`}>{sm?.label || lead.status}</span>;
                        })()}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground capitalize"
                        onClick={() => setLocation(`/staff/leads/${lead.id}`)}
                      >
                        {lead.source?.replace(/_/g, " ") || "-"}
                      </TableCell>
                      <TableCell
                        className="max-w-[150px] truncate"
                        onClick={() => setLocation(`/staff/leads/${lead.id}`)}
                      >
                        {lead.interestedProgram || "-"}
                      </TableCell>
                      <TableCell onClick={() => setLocation(`/staff/leads/${lead.id}`)}>
                        {lead.interestedCountry || "-"}
                      </TableCell>
                      {canSeeRevenue && (
                        <TableCell onClick={() => setLocation(`/staff/leads/${lead.id}`)}>
                          {lead.estimatedValue ? (
                            <span className="text-emerald-600 font-medium">{formatCurrency(lead.estimatedValue)}</span>
                          ) : "-"}
                        </TableCell>
                      )}
                      <TableCell onClick={e => e.stopPropagation()}>
                        {lead.assignedToId ? (
                          <span className="text-xs text-muted-foreground">{staffUsersMap[lead.assignedToId] || "Assigned"}</span>
                        ) : !isAdmin ? (
                          <button onClick={() => handleAssignToMe(lead.id)} className="text-xs text-primary hover:underline font-medium">Assign to Me</button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground text-xs"
                        onClick={() => setLocation(`/staff/leads/${lead.id}`)}
                      >
                        {formatDate(lead.createdAt)}
                      </TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditLead(lead)}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit lead"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { setSelectedIds(new Set([lead.id])); setDeleteOpen(true); }}
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            title="Delete lead"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <TablePagination
              currentPage={pg.page}
              totalItems={totalLeadsCount}
              pageSize={pg.pageSize}
              onPageChange={pg.setPage}
              onPageSizeChange={pg.setPageSize}
            />
          </div>
        )}
      </div>


      {/* ── Edit Lead Dialog ───────────────────────────────── */}
      <EditLeadDialog
        open={!!editLead}
        onClose={() => setEditLead(null)}
        lead={editLead}
        canSeeRevenue={canSeeRevenue}
        columns={columns}
      />

      {/* ── Delete Confirm Dialog ──────────────────────────── */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false); }}
        count={selectedIds.size}
        onConfirm={handleBulkDelete}
        isPending={deleteInProgress}
      />

      {/* ── Create Lead Dialog ─────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add New Lead</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="First name" />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name *</Label>
              <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Last name" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <div className="flex gap-1">
                <Select value={form.phoneCode} onValueChange={v => setForm({ ...form, phoneCode: v })}>
                  <SelectTrigger className="w-[90px] shrink-0 px-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PHONE_CODES.map(pc => (
                      <SelectItem key={`${pc.code}-${pc.country}`} value={pc.code}>
                        <span className="inline-flex items-center gap-1.5"><CountryFlag code={pc.country} size="sm" />{pc.code}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input className="flex-1 min-w-0" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="555 000 0000" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nationality</Label>
              <NationalityCombobox value={form.nationality} onChange={v => setForm({ ...form, nationality: v })} />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Interested Program</Label>
              <Input value={form.interestedProgram} onChange={(e) => setForm({ ...form, interestedProgram: e.target.value })} placeholder="e.g. Computer Science" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Interested Country</Label>
              <CountrySelect value={form.interestedCountry} onChange={v => setForm({ ...form, interestedCountry: v })} />
            </div>
            {canSeeRevenue && (
              <div className="space-y-1.5 col-span-2">
                <Label className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  Estimated Value (USD)
                </Label>
                <Input type="number" min="0" step="100" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} placeholder="e.g. 5000" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createLead.isPending || !form.firstName || !form.lastName}>
              {createLead.isPending ? "Creating…" : "Create Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
