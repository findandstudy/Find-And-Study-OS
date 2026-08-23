import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { ADMIN_ROLES as _ADMIN_ROLES } from "@workspace/roles";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { invalidateFollowUpWorkspaceQueries } from "@/lib/workspaceQueryInvalidation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  UserRound,
} from "lucide-react";

const ADMIN_ROLES = _ADMIN_ROLES as readonly string[];

type Assignee = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string;
};

type RelatedRecord = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

type FollowUp = {
  id: number;
  leadId: number | null;
  studentId: number | null;
  resourceType: "lead" | "student" | "standalone";
  resourceId: number | null;
  title: string;
  scheduledAt: string;
  completed: boolean;
  completedAt: string | null;
  assignedToId: number | null;
  assignedToName: string | null;
  notes: string | null;
  relatedName: string | null;
  relatedEmail: string | null;
  createdById: number | null;
  createdByName: string | null;
  updatedById: number | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

type FollowUpCounts = {
  all: number;
  today: number;
  next7: number;
  overdue: number;
  completed: number;
};

type FollowUpResponse = {
  data: FollowUp[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    counts: FollowUpCounts;
  };
};

type RangeFilter = "all" | "today" | "next7" | "overdue" | "completed";

type FollowUpForm = {
  title: string;
  scheduledAt: string;
  assignedToId: string;
  notes: string;
};

function displayName(user: Assignee | RelatedRecord): string {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.email || `#${user.id}`;
}

function toDateTimeLocal(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function defaultScheduledAt(days = 1): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  return toDateTimeLocal(date);
}

function toastError(
  toast: ReturnType<typeof useToast>["toast"],
  error: unknown,
  fallback: string,
): void {
  if (error instanceof ApiError) {
    if (error.status === 401) return;
    const data = error.data as { error?: string; message?: string } | null;
    toast({ title: fallback, description: data?.error || data?.message || error.message, variant: "destructive" });
    return;
  }
  toast({ title: fallback, description: error instanceof Error ? error.message : undefined, variant: "destructive" });
}

export default function FollowUpsPanel() {
  const { user } = useAuth(true);
  const { t, lang, localePath } = useI18n();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const isAdmin = ADMIN_ROLES.includes(user?.role || "");

  const [items, setItems] = useState<FollowUp[]>([]);
  const [meta, setMeta] = useState<FollowUpResponse["meta"]>({
    total: 0,
    page: 1,
    limit: 25,
    totalPages: 0,
    counts: { all: 0, today: 0, next7: 0, overdue: 0, completed: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeFilter>("all");
  const [status, setStatus] = useState("all");
  const [resourceType, setResourceType] = useState("all");
  const [assignedTo, setAssignedTo] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("scheduledAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkAssignee, setBulkAssignee] = useState("unassigned");

  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<"lead" | "student">("lead");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordResults, setRecordResults] = useState<RelatedRecord[]>([]);
  const [recordSearching, setRecordSearching] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RelatedRecord | null>(null);
  const [form, setForm] = useState<FollowUpForm>({
    title: "",
    scheduledAt: defaultScheduledAt(),
    assignedToId: user?.id ? String(user.id) : "unassigned",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [range, status, resourceType, assignedTo, debouncedSearch, from, to]);

  const loadAssignees = useCallback(async () => {
    try {
      const response = await customFetch<{ data: Assignee[] }>("/api/tasks/assignees");
      setAssignees(response.data || []);
    } catch {
      setAssignees([]);
    }
  }, []);

  const loadFollowUps = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: "25",
      range,
      status,
      resourceType,
      assignedTo,
      search: debouncedSearch,
      from,
      to,
      sortKey,
      sortDir,
      tzOffsetMinutes: String(new Date().getTimezoneOffset()),
    });
    try {
      const response = await customFetch<FollowUpResponse>(`/api/follow-ups?${params.toString()}`);
      setItems(response.data || []);
      setMeta(response.meta);
      setSelectedIds(previous => {
        const visible = new Set((response.data || []).map(item => item.id));
        return new Set(Array.from(previous).filter(id => visible.has(id)));
      });
    } catch (error) {
      toastError(toast, error, t("followUps.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [assignedTo, debouncedSearch, from, page, range, resourceType, sortDir, sortKey, status, t, to, toast, user]);

  useEffect(() => { void loadAssignees(); }, [loadAssignees]);
  useEffect(() => { void loadFollowUps(); }, [loadFollowUps]);

  useEffect(() => {
    if (!createOpen || selectedRecord || recordSearch.trim().length < 2) {
      setRecordResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRecordSearching(true);
      const params = new URLSearchParams({ page: "1", limit: "12", search: recordSearch.trim(), includeFacets: "0" });
      try {
        const response = await customFetch<{ data: RelatedRecord[] }>(
          `/api/${createType === "lead" ? "leads" : "students"}?${params.toString()}`,
          { signal: controller.signal },
        );
        setRecordResults(response.data || []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setRecordResults([]);
      } finally {
        setRecordSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [createOpen, createType, recordSearch, selectedRecord]);

  useEffect(() => {
    if (typeof window === "undefined" || items.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("followUpId"));
    if (!Number.isFinite(id)) return;
    const target = items.find(item => item.id === id);
    if (!target) return;
    openEdit(target);
    params.delete("followUpId");
    const query = params.toString();
    setLocation(`${localePath("/staff/tasks")}${query ? `?${query}` : ""}`, { replace: true });
  }, [items, localePath, setLocation]);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [lang]);

  function resetCreate(): void {
    setSelectedRecord(null);
    setRecordSearch("");
    setRecordResults([]);
    setCreateType("lead");
    setForm({
      title: "",
      scheduledAt: defaultScheduledAt(),
      assignedToId: user?.id ? String(user.id) : "unassigned",
      notes: "",
    });
  }

  function openCreate(): void {
    resetCreate();
    setCreateOpen(true);
  }

  function openEdit(item: FollowUp): void {
    setEditing(item);
    setForm({
      title: item.title,
      scheduledAt: toDateTimeLocal(item.scheduledAt),
      assignedToId: item.assignedToId == null ? "unassigned" : String(item.assignedToId),
      notes: item.notes || "",
    });
  }

  async function createFollowUp(): Promise<void> {
    if (!selectedRecord || !form.title.trim() || !form.scheduledAt) {
      toast({ title: t("followUps.requiredFields"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        resourceType: createType,
        resourceId: selectedRecord.id,
        title: form.title.trim(),
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        notes: form.notes.trim() || null,
      };
      if (isAdmin) {
        payload.assignedToId = form.assignedToId === "unassigned" ? null : Number(form.assignedToId);
      }
      await customFetch("/api/follow-ups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast({ title: t("followUps.created") });
      setCreateOpen(false);
      resetCreate();
      setRange("all");
      setPage(1);
      await invalidateFollowUpWorkspaceQueries(queryClient);
      await loadFollowUps();
    } catch (error) {
      toastError(toast, error, t("followUps.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function updateFollowUp(item: FollowUp, updates: Record<string, unknown>): Promise<boolean> {
    try {
      const updated = await customFetch<FollowUp>(`/api/follow-ups/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      setItems(previous => previous.map(row => row.id === item.id ? updated : row));
      await invalidateFollowUpWorkspaceQueries(queryClient);
      await loadFollowUps();
      return true;
    } catch (error) {
      toastError(toast, error, t("followUps.saveFailed"));
      return false;
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editing || !form.title.trim() || !form.scheduledAt) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        title: form.title.trim(),
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        notes: form.notes.trim() || null,
      };
      if (isAdmin) {
        updates.assignedToId = form.assignedToId === "unassigned" ? null : Number(form.assignedToId);
      }
      if (await updateFollowUp(editing, updates)) {
        toast({ title: t("followUps.updated") });
        setEditing(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function bulkUpdate(updates: Record<string, unknown>): Promise<void> {
    if (selectedIds.size === 0) return;
    setBulkSaving(true);
    try {
      await customFetch("/api/follow-ups/bulk", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), ...updates }),
      });
      setSelectedIds(new Set());
      toast({ title: t("followUps.bulkUpdated") });
      await invalidateFollowUpWorkspaceQueries(queryClient);
      await loadFollowUps();
    } catch (error) {
      toastError(toast, error, t("followUps.saveFailed"));
    } finally {
      setBulkSaving(false);
    }
  }

  function toggleSelection(id: number, checked: boolean): void {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function clearFilters(): void {
    setSearch("");
    setStatus("all");
    setResourceType("all");
    setAssignedTo("all");
    setFrom("");
    setTo("");
    setRange("all");
  }

  function relatedUrl(item: FollowUp): string | null {
    if (!item.resourceId) return null;
    if (item.resourceType === "student") return localePath(`/staff/students/${item.resourceId}`);
    if (item.resourceType === "lead") return localePath(`/staff/leads/${item.resourceId}`);
    return null;
  }

  function changeSort(nextKey: string): void {
    if (sortKey === nextKey) setSortDir(previous => previous === "asc" ? "desc" : "asc");
    else {
      setSortKey(nextKey);
      setSortDir("asc");
    }
    setPage(1);
  }

  const allSelected = items.length > 0 && items.every(item => selectedIds.has(item.id));
  const someSelected = items.some(item => selectedIds.has(item.id));
  const hasAdvancedFilters = search || status !== "all" || resourceType !== "all" || assignedTo !== "all" || from || to;
  const rangeOptions: Array<{ key: RangeFilter; icon?: typeof AlertTriangle }> = [
    { key: "all" },
    { key: "today", icon: CalendarClock },
    { key: "next7", icon: Clock3 },
    { key: "overdue", icon: AlertTriangle },
    { key: "completed", icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-5" data-testid="follow-ups-panel">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate} data-testid="button-new-follow-up">
          <Plus className="w-4 h-4 mr-1.5" />
          {t("followUps.new")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("followUps.rangeLabel")}>
        {rangeOptions.map(({ key, icon: Icon }) => {
          const active = range === key;
          const count = meta.counts[key];
          const danger = key === "overdue" && count > 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setRange(key);
                setStatus("all");
              }}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? danger ? "bg-red-600 text-white border-red-600" : "bg-primary text-primary-foreground border-primary"
                  : danger ? "bg-background text-red-700 border-red-300 hover:bg-red-50" : "bg-background hover:bg-muted"
              }`}
              data-testid={`follow-up-range-${key}`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {t(`followUps.ranges.${key}`)}
              <span className={`min-w-5 h-4 rounded-full px-1 text-[10px] ${active ? "bg-white/20" : "bg-muted text-muted-foreground"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border bg-card p-3 space-y-3" data-testid="follow-up-filters">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t("followUps.search")}
            className="pl-9"
            data-testid="input-follow-up-search"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
          <Select value={status} onValueChange={value => {
            setStatus(value);
            if (value !== "all") setRange("all");
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("followUps.filters.allStatuses")}</SelectItem>
              <SelectItem value="pending">{t("followUps.pending")}</SelectItem>
              <SelectItem value="completed">{t("followUps.completed")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={resourceType} onValueChange={setResourceType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("followUps.filters.allTypes")}</SelectItem>
              <SelectItem value="lead">{t("followUps.lead")}</SelectItem>
              <SelectItem value="student">{t("followUps.student")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={assignedTo} onValueChange={setAssignedTo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("followUps.filters.allAssignees")}</SelectItem>
              <SelectItem value="me">{t("followUps.filters.mine")}</SelectItem>
              <SelectItem value="unassigned">{t("followUps.unassigned")}</SelectItem>
              {assignees.map(assignee => <SelectItem key={assignee.id} value={String(assignee.id)}>{displayName(assignee)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={event => setFrom(event.target.value)} aria-label={t("followUps.filters.from")} />
          <Input type="date" value={to} onChange={event => setTo(event.target.value)} aria-label={t("followUps.filters.to")} />
          <Button variant="ghost" disabled={!hasAdvancedFilters && range === "all"} onClick={clearFilters}>{t("followUps.filters.clear")}</Button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2" data-testid="follow-up-bulk-toolbar">
          <span className="text-sm">{t("followUps.selected", { count: selectedIds.size })}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={bulkSaving} onClick={() => void bulkUpdate({ completed: true })}>
              <Check className="w-4 h-4 mr-1.5" /> {t("followUps.completeSelected")}
            </Button>
            {isAdmin && (
              <>
                <Select value={bulkAssignee} onValueChange={setBulkAssignee}>
                  <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">{t("followUps.unassigned")}</SelectItem>
                    {assignees.map(assignee => <SelectItem key={assignee.id} value={String(assignee.id)}>{displayName(assignee)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkSaving}
                  onClick={() => void bulkUpdate({ assignedToId: bulkAssignee === "unassigned" ? null : Number(bulkAssignee) })}
                >
                  <UserRound className="w-4 h-4 mr-1.5" /> {t("followUps.assignSelected")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("followUps.loading")}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <ListChecks className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="font-semibold">{t("followUps.empty")}</h3>
            <p className="text-sm text-muted-foreground mt-1">{t("followUps.emptyHint")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={value => setSelectedIds(value === true ? new Set(items.map(item => item.id)) : new Set())}
                      aria-label={t("followUps.selectAll")}
                    />
                  </TableHead>
                  <TableHead><SortButton label={t("followUps.columns.followUp")} active={sortKey === "title"} onClick={() => changeSort("title")} /></TableHead>
                  <TableHead><SortButton label={t("followUps.columns.related")} active={sortKey === "related"} onClick={() => changeSort("related")} /></TableHead>
                  <TableHead><SortButton label={t("followUps.columns.assignee")} active={sortKey === "assignee"} onClick={() => changeSort("assignee")} /></TableHead>
                  <TableHead><SortButton label={t("followUps.columns.date")} active={sortKey === "scheduledAt"} onClick={() => changeSort("scheduledAt")} /></TableHead>
                  <TableHead><SortButton label={t("followUps.columns.status")} active={sortKey === "status"} onClick={() => changeSort("status")} /></TableHead>
                  <TableHead className="text-right">{t("followUps.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => {
                  const scheduled = new Date(item.scheduledAt);
                  const overdue = !item.completed && scheduled.getTime() < Date.now();
                  const href = relatedUrl(item);
                  return (
                    <TableRow key={item.id} className={overdue ? "bg-red-50/50 dark:bg-red-950/10" : ""} data-testid={`follow-up-row-${item.id}`}>
                      <TableCell>
                        <Checkbox checked={selectedIds.has(item.id)} onCheckedChange={value => toggleSelection(item.id, value === true)} />
                      </TableCell>
                      <TableCell className="min-w-64">
                        <button type="button" className="text-left" onClick={() => openEdit(item)}>
                          <div className={`font-medium ${item.completed ? "line-through text-muted-foreground" : ""}`}>{item.title}</div>
                          {item.notes && <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{item.notes}</div>}
                        </button>
                      </TableCell>
                      <TableCell className="min-w-52">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{t(`followUps.${item.resourceType}`)}</Badge>
                          <div>
                            <div className="text-sm font-medium">{item.relatedName || `#${item.resourceId ?? item.id}`}</div>
                            {item.relatedEmail && <div className="text-xs text-muted-foreground">{item.relatedEmail}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{item.assignedToName || t("followUps.unassigned")}</TableCell>
                      <TableCell className={overdue ? "text-red-700 dark:text-red-400 font-medium" : ""}>
                        <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          {overdue && <AlertTriangle className="w-3.5 h-3.5" />}
                          {dateFormatter.format(scheduled)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={item.completed ? "bg-green-100 text-green-700 hover:bg-green-100" : overdue ? "bg-red-100 text-red-700 hover:bg-red-100" : "bg-blue-100 text-blue-700 hover:bg-blue-100"}>
                          {item.completed ? t("followUps.completed") : overdue ? t("followUps.overdue") : t("followUps.pending")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {href && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation(href)} title={t("followUps.openRecord")}>
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)} title={t("followUps.edit")}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => void updateFollowUp(item, { completed: !item.completed })}
                            title={item.completed ? t("followUps.reopen") : t("followUps.complete")}
                          >
                            {item.completed ? <RotateCcw className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {!loading && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("followUps.page", { page: meta.page, total: meta.totalPages })}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= meta.totalPages} onClick={() => setPage(value => value + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) resetCreate(); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("followUps.new")}</DialogTitle>
            <DialogDescription>{t("followUps.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("followUps.recordType")}</Label>
                <Select value={createType} onValueChange={value => { setCreateType(value as "lead" | "student"); setSelectedRecord(null); setRecordSearch(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead">{t("followUps.lead")}</SelectItem>
                    <SelectItem value="student">{t("followUps.student")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("followUps.relatedRecord")}</Label>
                {selectedRecord ? (
                  <button type="button" className="w-full h-10 rounded-md border px-3 text-left text-sm" onClick={() => setSelectedRecord(null)}>
                    {displayName(selectedRecord)} · #{selectedRecord.id}
                  </button>
                ) : (
                  <Input value={recordSearch} onChange={event => setRecordSearch(event.target.value)} placeholder={t("followUps.searchRecord")} />
                )}
              </div>
            </div>
            {!selectedRecord && recordSearch.trim().length >= 2 && (
              <div className="rounded-md border max-h-48 overflow-y-auto">
                {recordSearching ? (
                  <div className="p-3 text-sm text-muted-foreground">{t("followUps.searching")}</div>
                ) : recordResults.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">{t("followUps.noRecords")}</div>
                ) : recordResults.map(record => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => { setSelectedRecord(record); setRecordResults([]); }}
                    className="w-full px-3 py-2 text-left hover:bg-muted border-b last:border-b-0"
                  >
                    <div className="text-sm font-medium">{displayName(record)} · #{record.id}</div>
                    {record.email && <div className="text-xs text-muted-foreground">{record.email}</div>}
                  </button>
                ))}
              </div>
            )}
            <FollowUpFields form={form} setForm={setForm} assignees={assignees} isAdmin={isAdmin} t={t} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("followUps.cancel")}</Button>
            <Button disabled={saving || !selectedRecord || !form.title.trim() || !form.scheduledAt} onClick={() => void createFollowUp()}>
              {saving ? t("followUps.saving") : t("followUps.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("followUps.edit")}</SheetTitle>
            <SheetDescription>
              {editing?.relatedName || `#${editing?.resourceId ?? editing?.id}`} · {editing ? t(`followUps.${editing.resourceType}`) : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="py-6 space-y-4">
            <FollowUpFields form={form} setForm={setForm} assignees={assignees} isAdmin={isAdmin} t={t} showSnooze />
            {editing && (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <div>{t("followUps.createdBy")}: {editing.createdByName || "—"}</div>
                <div>{t("followUps.updatedBy")}: {editing.updatedByName || "—"}</div>
              </div>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("followUps.cancel")}</Button>
            <Button disabled={saving || !form.title.trim() || !form.scheduledAt} onClick={() => void saveEdit()}>
              {saving ? t("followUps.saving") : t("followUps.save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}>
      {label}<ArrowUpDown className="h-3.5 w-3.5" />
    </button>
  );
}

function FollowUpFields({
  form,
  setForm,
  assignees,
  isAdmin,
  t,
  showSnooze = false,
}: {
  form: FollowUpForm;
  setForm: Dispatch<SetStateAction<FollowUpForm>>;
  assignees: Assignee[];
  isAdmin: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  showSnooze?: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label>{t("followUps.title")}</Label>
        <Input value={form.title} onChange={event => setForm(previous => ({ ...previous, title: event.target.value }))} maxLength={500} />
      </div>
      <div className="space-y-1.5">
        <Label>{t("followUps.scheduledAt")}</Label>
        <Input
          type="datetime-local"
          value={form.scheduledAt}
          min={toDateTimeLocal(new Date())}
          onChange={event => setForm(previous => ({ ...previous, scheduledAt: event.target.value }))}
        />
        {showSnooze && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(previous => ({ ...previous, scheduledAt: defaultScheduledAt(1) }))}>{t("followUps.tomorrow")}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(previous => ({ ...previous, scheduledAt: defaultScheduledAt(7) }))}>{t("followUps.nextWeek")}</Button>
          </div>
        )}
      </div>
      {isAdmin && (
        <div className="space-y-1.5">
          <Label>{t("followUps.assignee")}</Label>
          <Select value={form.assignedToId} onValueChange={value => setForm(previous => ({ ...previous, assignedToId: value }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">{t("followUps.unassigned")}</SelectItem>
              {assignees.map(assignee => <SelectItem key={assignee.id} value={String(assignee.id)}>{displayName(assignee)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{t("followUps.notes")}</Label>
        <Textarea rows={4} value={form.notes} onChange={event => setForm(previous => ({ ...previous, notes: event.target.value }))} maxLength={2000} />
      </div>
    </>
  );
}
