import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListLeads, useUpdateLead, useCreateLead } from "@workspace/api-client-react";
import { useSeason } from "@/contexts/SeasonContext";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Plus, Search, Filter, ExternalLink, TrendingUp, Settings2, X, ChevronDown, GripVertical, Check, Trophy, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const SOURCES = ["website", "referral", "social_media", "walk_in", "partner", "other"];

type ColVariant = "default" | "won" | "lost";

interface ColDef {
  id: string;
  title: string;
  variant?: ColVariant;
}

const DEFAULT_COLUMNS: ColDef[] = [
  { id: "new", title: "New" },
  { id: "contacted", title: "Contacted" },
  { id: "interested", title: "Interested" },
  { id: "qualified", title: "Qualified" },
  { id: "converted", title: "Converted" },
  { id: "won", title: "WON", variant: "won" },
  { id: "lost", title: "LOST", variant: "lost" },
];

const LS_KEY = "edcons_pipeline_labels";

function loadLabels(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLabels(labels: Record<string, string>) {
  localStorage.setItem(LS_KEY, JSON.stringify(labels));
}

function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (!num || isNaN(num)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
}

/* ── LeadCard ──────────────────────────────────────────────── */
function LeadCard({ lead, onView, showRevenue, variant }: {
  lead: any; onView: (id: number) => void; showRevenue: boolean; variant?: ColVariant;
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
          <p className="text-xs font-medium text-primary mt-2 truncate bg-primary/5 inline-block px-2 py-1 rounded-md">
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
      <div className="px-4 pb-3 flex justify-end">
        <button
          onClick={() => onView(lead.id)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          <ExternalLink className="w-3 h-3" /> View
        </button>
      </div>
    </div>
  );
}

/* ── DroppableColumn ──────────────────────────────────────── */
function DroppableColumn({ col, leads, showRevenue, onView }: {
  col: ColDef; leads: any[]; showRevenue: boolean; onView: (id: number) => void;
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
            <LeadCard key={lead.id} lead={lead} onView={onView} showRevenue={showRevenue} variant={v} />
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

/* ── EditStagesDialog ─────────────────────────────────────── */
function EditStagesDialog({ open, onClose, columns, onSave }: {
  open: boolean; onClose: () => void;
  columns: ColDef[];
  onSave: (labels: Record<string, string>) => void;
}) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      const init: Record<string, string> = {};
      columns.forEach(c => { init[c.id] = c.title; });
      setLabels(init);
    }
  }, [open, columns]);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Pipeline Aşamalarını Düzenle</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {columns.map(col => (
            <div key={col.id} className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                col.variant === "won" ? "bg-emerald-500" :
                col.variant === "lost" ? "bg-rose-500" :
                "bg-muted-foreground/40"
              }`} />
              <div className="flex-1">
                <Input
                  value={labels[col.id] ?? col.title}
                  onChange={e => setLabels(l => ({ ...l, [col.id]: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground w-16 shrink-0 font-mono">{col.id}</span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={() => { onSave(labels); onClose(); }}>
            <Check className="h-3.5 w-3.5 mr-1.5" />Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── FilterPopover ────────────────────────────────────────── */
function FilterPopover({ filters, onChange }: {
  filters: { source: string; status: string };
  onChange: (f: { source: string; status: string }) => void;
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
          <Label className="text-xs">Kaynak</Label>
          <Select value={filters.source} onValueChange={v => onChange({ ...filters, source: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              {SOURCES.map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Aşama</Label>
          <Select value={filters.status} onValueChange={v => onChange({ ...filters, status: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              {DEFAULT_COLUMNS.map(c => (
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

/* ── EMPTY_FORM ───────────────────────────────────────────── */
const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  source: "website",
  interestedProgram: "",
  interestedCountry: "",
  nationality: "",
  estimatedValue: "",
};

/* ── LeadsPage ────────────────────────────────────────────── */
export default function LeadsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editStagesOpen, setEditStagesOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [filters, setFilters] = useState({ source: "all", status: "all" });
  const [customLabels, setCustomLabels] = useState<Record<string, string>>(loadLabels);

  const { user } = useAuth(true, [
    "super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant",
  ]);
  const canSeeRevenue = user?.role === "super_admin" || user?.role === "admin" || user?.role === "agent";

  const { season } = useSeason();
  const { data, isLoading } = useListLeads({ search, season, limit: 200 } as any);
  const updateLead = useUpdateLead();
  const createLead = useCreateLead();
  const queryClient = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const allLeads = data?.data || [];

  const columns: ColDef[] = DEFAULT_COLUMNS.map(c => ({
    ...c,
    title: customLabels[c.id] || c.title,
  }));

  const allColumnIds = new Set(columns.map(c => c.id));

  const filteredLeads = allLeads.filter((l: any) => {
    if (filters.source !== "all" && l.source !== filters.source) return false;
    if (filters.status !== "all" && l.status !== filters.status) return false;
    return true;
  });

  const activeCard = activeId ? allLeads.find((l: any) => l.id === activeId) : null;

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
          toast({ title: `Lead taşındı → ${colLabel}` });
        },
        onError: () => {
          toast({ title: "Hata", description: "Lead taşınamadı", variant: "destructive" });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        },
      }
    );
  };

  function handleSaveLabels(labels: Record<string, string>) {
    setCustomLabels(labels);
    saveLabels(labels);
    toast({ title: "Pipeline güncellendi" });
  }

  function handleCreate() {
    if (!form.firstName || !form.lastName) return;
    const payload: any = { ...form, status: "new", season };
    if (form.estimatedValue) payload.estimatedValue = parseFloat(form.estimatedValue);
    else delete payload.estimatedValue;

    createLead.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: "Lead oluşturuldu" });
          setCreateOpen(false);
          setForm(EMPTY_FORM);
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        },
      }
    );
  }

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex flex-col">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground">Lead Pipeline</h1>
              <p className="text-muted-foreground text-sm mt-1">Manage and convert prospective students.</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground mt-0.5"
              title="Pipeline aşamalarını düzenle"
              onClick={() => setEditStagesOpen(true)}
            >
              <Settings2 className="w-4 h-4" />
            </Button>
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
            <FilterPopover filters={filters} onChange={setFilters} />
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Lead
            </Button>
          </div>
        </div>

        {/* ── Pipeline board ─────────────────────────────────── */}
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
                      <p className="text-xs font-medium text-primary mt-2 truncate bg-primary/5 inline-block px-2 py-1 rounded-md">
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
      </div>

      {/* ── Edit Stages Dialog ─────────────────────────────── */}
      <EditStagesDialog
        open={editStagesOpen}
        onClose={() => setEditStagesOpen(false)}
        columns={DEFAULT_COLUMNS}
        onSave={handleSaveLabels}
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
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
            </div>
            <div className="space-y-1.5">
              <Label>Nationality</Label>
              <Input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} placeholder="e.g. Turkish" />
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
              <Input value={form.interestedCountry} onChange={(e) => setForm({ ...form, interestedCountry: e.target.value })} placeholder="e.g. Canada" />
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
