import { useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListLeads, useUpdateLead, useCreateLead } from "@workspace/api-client-react";
import { useSeason } from "@/contexts/SeasonContext";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Plus, Search, Filter, ExternalLink, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const COLUMNS = [
  { id: "new", title: "New" },
  { id: "contacted", title: "Contacted" },
  { id: "interested", title: "Interested" },
  { id: "qualified", title: "Qualified" },
  { id: "converted", title: "Converted" },
];

function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (!num || isNaN(num)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
}

function LeadCard({
  lead,
  onView,
  showRevenue,
}: {
  lead: any;
  onView: (id: number) => void;
  showRevenue: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-card rounded-xl border ${
        isDragging
          ? "border-primary shadow-xl opacity-50 z-50 relative"
          : "border-border shadow-sm hover:shadow-md"
      } mb-3 transition-shadow duration-200`}
    >
      <div
        {...attributes}
        {...listeners}
        className={`p-4 pb-2 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
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
        <p className="text-xs text-muted-foreground truncate">
          {lead.email || lead.phone || "No contact info"}
        </p>
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

function DroppableColumn({
  col,
  leads,
  showRevenue,
  onView,
}: {
  col: { id: string; title: string };
  leads: any[];
  showRevenue: boolean;
  onView: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });

  const totalRevenue = showRevenue
    ? leads.reduce((sum, l) => sum + (parseFloat(l.estimatedValue) || 0), 0)
    : 0;

  return (
    <div className="w-80 flex flex-col max-h-full bg-secondary/50 rounded-2xl border border-border/50 overflow-hidden">
      <div className="p-4 border-b border-border/50 bg-card/50 shrink-0">
        <div className="flex justify-between items-center">
          <h3 className="font-display font-bold text-foreground">{col.title}</h3>
          <span className="w-6 h-6 rounded-full bg-background flex items-center justify-center text-xs font-bold text-muted-foreground border shadow-sm">
            {leads.length}
          </span>
        </div>
        {showRevenue && totalRevenue > 0 && (
          <div className="mt-2 flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg px-2.5 py-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
              {formatCurrency(totalRevenue)}
            </span>
          </div>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`p-3 flex-1 overflow-y-auto custom-scrollbar transition-colors duration-150 ${
          isOver ? "bg-primary/5" : ""
        }`}
      >
        <SortableContext
          items={leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onView={onView}
              showRevenue={showRevenue}
            />
          ))}
          {leads.length === 0 && (
            <div className="h-24 border-2 border-dashed border-border/50 rounded-xl flex items-center justify-center text-muted-foreground text-sm font-medium">
              Drop here
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

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

export default function LeadsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [activeId, setActiveId] = useState<number | null>(null);

  const { user } = useAuth(true, [
    "super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant",
  ]);

  const canSeeRevenue =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "agent";

  const { season } = useSeason();
  const { data, isLoading } = useListLeads({ search, season, limit: 100 } as any);
  const updateLead = useUpdateLead();
  const createLead = useCreateLead();
  const queryClient = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const leads = data?.data || [];

  const activeCard = activeId ? leads.find((l) => l.id === activeId) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const leadId = active.id as number;
    const overId = over.id;

    let targetStatus: string;
    if (COLUMNS.some((c) => c.id === overId)) {
      targetStatus = overId as string;
    } else {
      const overLead = leads.find((l) => l.id === overId);
      if (!overLead) return;
      targetStatus = overLead.status;
    }

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === targetStatus) return;

    updateLead.mutate(
      { id: leadId, data: { status: targetStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
          toast({ title: "Lead moved", description: `Moved to ${targetStatus}` });
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
    const payload: any = { ...form, status: "new", season };
    if (form.estimatedValue) {
      payload.estimatedValue = parseFloat(form.estimatedValue);
    } else {
      delete payload.estimatedValue;
    }
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

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Lead Pipeline</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage and convert prospective students.
            </p>
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
            <Button variant="outline" size="icon" className="rounded-full">
              <Filter className="w-4 h-4" />
            </Button>
            <Button
              className="rounded-full shadow-lg shadow-primary/20"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" /> Add Lead
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
          <div className="flex gap-6 h-full min-w-max px-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              {COLUMNS.map((col) => {
                const columnLeads = leads.filter((l) => l.status === col.id);
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Lead</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                placeholder="First name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name *</Label>
              <Input
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                placeholder="Last name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+1 555 000 0000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nationality</Label>
              <Input
                value={form.nationality}
                onChange={(e) => setForm({ ...form, nationality: e.target.value })}
                placeholder="e.g. Turkish"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Interested Program</Label>
              <Input
                value={form.interestedProgram}
                onChange={(e) => setForm({ ...form, interestedProgram: e.target.value })}
                placeholder="e.g. Computer Science"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Interested Country</Label>
              <Input
                value={form.interestedCountry}
                onChange={(e) => setForm({ ...form, interestedCountry: e.target.value })}
                placeholder="e.g. Canada"
              />
            </div>
            {canSeeRevenue && (
              <div className="space-y-1.5 col-span-2">
                <Label className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  Estimated Value (USD)
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  value={form.estimatedValue}
                  onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
                  placeholder="e.g. 5000"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createLead.isPending || !form.firstName || !form.lastName}
            >
              {createLead.isPending ? "Creating…" : "Create Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
