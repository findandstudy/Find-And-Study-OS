import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Archive, ArchiveRestore, GripVertical, ArrowRight, MessageSquarePlus,
  Pencil, Trash2, RotateCcw, X, ClipboardList, CheckCircle2, Circle, Clock,
} from "lucide-react";

const ADMIN_ROLES = ["super_admin", "admin", "manager"] as const;
const MANAGE_ROLES = [...ADMIN_ROLES, "staff", "consultant", "editor", "accountant"] as const;

type TaskNote = { id: string; text: string; createdAt: string; authorName: string };
type Task = {
  id: number;
  title: string;
  description: string | null;
  assignedTo: number | null;
  assignedToName: string | null;
  dueDate: string | null;
  priority: "low" | "medium" | "high";
  status: "todo" | "in_progress" | "done";
  taskNotes: TaskNote[] | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type Assignee = { id: number; firstName: string | null; lastName: string | null; email: string | null; role: string };

const STATUS_FLOW: Record<Task["status"], Task["status"] | null> = {
  todo: "in_progress",
  in_progress: "done",
  done: null,
};

const PRIORITY_COLORS: Record<Task["priority"], string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const COLUMN_DOT_COLORS: Record<Task["status"], string> = {
  todo: "bg-slate-400",
  in_progress: "bg-blue-500",
  done: "bg-green-500",
};

function toastApiError(toast: ReturnType<typeof useToast>["toast"], err: unknown, fallback: string) {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      // Session-expired toast is handled centrally; suppress duplicate.
      return;
    }
    const data = err.data as { error?: string; message?: string } | null;
    const msg = data?.error || data?.message || err.message || fallback;
    toast({ title: fallback, description: msg, variant: "destructive" });
    return;
  }
  if (err instanceof Error) {
    toast({ title: fallback, description: err.message, variant: "destructive" });
    return;
  }
  toast({ title: fallback, variant: "destructive" });
}

function formatNoteDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function displayName(u: Assignee): string {
  const full = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return full || u.email || `User #${u.id}`;
}

type TaskFormState = {
  title: string;
  description: string;
  assignedTo: string;
  assignedToName: string;
  dueDate: string;
  priority: Task["priority"];
  status: Task["status"];
};

const EMPTY_FORM: TaskFormState = {
  title: "",
  description: "",
  assignedTo: "unassigned",
  assignedToName: "",
  dueDate: "",
  priority: "medium",
  status: "todo",
};

export default function TasksPage() {
  const { user } = useAuth(true);
  const { t } = useI18n();
  const { toast } = useToast();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [notesTask, setNotesTask] = useState<Task | null>(null);
  const [newNoteText, setNewNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const role = user?.role || "";
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(role);
  const canManage = (MANAGE_ROLES as readonly string[]).includes(role);

  const loadTasks = useCallback(async (archived: boolean) => {
    setLoading(true);
    try {
      const res = await customFetch<{ data: Task[] }>(`/api/tasks?archived=${archived ? "true" : "false"}`);
      setTasks(res.data || []);
    } catch (err) {
      toastApiError(toast, err, t("tasks.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  const loadAssignees = useCallback(async () => {
    try {
      const res = await customFetch<{ data: Assignee[] }>(`/api/tasks/assignees`);
      setAssignees(res.data || []);
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadTasks(showArchived);
    }
  }, [user, showArchived, loadTasks]);

  useEffect(() => {
    if (user) void loadAssignees();
  }, [user, loadAssignees]);

  function openCreate() {
    setEditingTask(null);
    setForm(EMPTY_FORM);
    setEditOpen(true);
  }

  function openEdit(task: Task) {
    setEditingTask(task);
    setForm({
      title: task.title,
      description: task.description ?? "",
      assignedTo: task.assignedTo == null ? "unassigned" : String(task.assignedTo),
      assignedToName: task.assignedToName ?? "",
      dueDate: task.dueDate ?? "",
      priority: task.priority,
      status: task.status,
    });
    setEditOpen(true);
  }

  async function saveTask() {
    if (!form.title.trim()) {
      toast({ title: t("tasks.titleRequired"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        dueDate: form.dueDate || null,
        priority: form.priority,
        status: form.status,
      };
      if (form.assignedTo === "unassigned") {
        payload.assignedTo = null;
        payload.assignedToName = null;
      } else {
        payload.assignedTo = Number(form.assignedTo);
        payload.assignedToName = form.assignedToName || null;
      }

      if (editingTask) {
        await customFetch(`/api/tasks/${editingTask.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast({ title: t("tasks.updated") });
      } else {
        await customFetch(`/api/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast({ title: t("tasks.created") });
      }
      setEditOpen(false);
      void loadTasks(showArchived);
    } catch (err) {
      toastApiError(toast, err, t("tasks.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function moveToStatus(task: Task, status: Task["status"]) {
    if (status === task.status) return;
    try {
      await customFetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      void loadTasks(showArchived);
    } catch (err) {
      toastApiError(toast, err, t("tasks.moveFailed"));
    }
  }

  async function advanceStatus(task: Task) {
    const next = STATUS_FLOW[task.status];
    if (!next) return;
    await moveToStatus(task, next);
  }

  async function archiveTask(task: Task) {
    if (!confirm(t("tasks.confirmArchive"))) return;
    try {
      await customFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      toast({ title: t("tasks.archived") });
      void loadTasks(showArchived);
    } catch (err) {
      toastApiError(toast, err, t("tasks.archiveFailed"));
    }
  }

  async function restoreTask(task: Task) {
    try {
      await customFetch(`/api/tasks/restore/${task.id}`, { method: "POST" });
      toast({ title: t("tasks.restored") });
      void loadTasks(showArchived);
    } catch (err) {
      toastApiError(toast, err, t("tasks.restoreFailed"));
    }
  }

  async function addNote() {
    if (!notesTask || !newNoteText.trim()) return;
    setAddingNote(true);
    try {
      const res = await customFetch<Task>(`/api/tasks/${notesTask.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newNoteText.trim() }),
      });
      setNotesTask(res);
      setTasks(prev => prev.map(tk => tk.id === res.id ? res : tk));
      setNewNoteText("");
    } catch (err) {
      toastApiError(toast, err, t("tasks.noteAddFailed"));
    } finally {
      setAddingNote(false);
    }
  }

  async function deleteNote(noteId: string) {
    if (!notesTask) return;
    try {
      const res = await customFetch<Task>(`/api/tasks/${notesTask.id}/notes/${noteId}`, { method: "DELETE" });
      setNotesTask(res);
      setTasks(prev => prev.map(tk => tk.id === res.id ? res : tk));
    } catch (err) {
      toastApiError(toast, err, t("tasks.noteDeleteFailed"));
    }
  }

  const grouped = useMemo(() => {
    const out: Record<Task["status"], Task[]> = { todo: [], in_progress: [], done: [] };
    for (const tk of tasks) out[tk.status].push(tk);
    return out;
  }, [tasks]);

  const totalCount = tasks.length;

  // ------------------------ Drag & Drop ------------------------
  const [dragging, setDragging] = useState<{ id: number; status: Task["status"]; x: number; y: number } | null>(null);
  const [hoverColumn, setHoverColumn] = useState<Task["status"] | null>(null);
  const dragStartRef = useRef<{ id: number; status: Task["status"]; x: number; y: number; started: boolean } | null>(null);
  const columnRefs = useRef<Record<Task["status"], HTMLDivElement | null>>({ todo: null, in_progress: null, done: null });
  const tasksRef = useRef<Task[]>([]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const findColumnAt = useCallback((x: number, y: number): Task["status"] | null => {
    for (const status of ["todo", "in_progress", "done"] as const) {
      const el = columnRefs.current[status];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return status;
    }
    return null;
  }, []);

  const moveToStatusRef = useRef(moveToStatus);
  useEffect(() => { moveToStatusRef.current = moveToStatus; });

  function handleCardPointerDown(e: React.PointerEvent, task: Task) {
    if (!canManage || showArchived) return;
    if (e.button !== 0) return;
    dragStartRef.current = { id: task.id, status: task.status, x: e.clientX, y: e.clientY, started: false };

    const onPointerMove = (ev: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!start.started && Math.hypot(dx, dy) > 5) {
        start.started = true;
        setDragging({ id: start.id, status: start.status, x: ev.clientX, y: ev.clientY });
      }
      if (start.started) {
        setDragging(d => d ? { ...d, x: ev.clientX, y: ev.clientY } : d);
        setHoverColumn(findColumnAt(ev.clientX, ev.clientY));
      }
    };
    const onPointerUp = (ev: PointerEvent) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (start?.started) {
        const target = findColumnAt(ev.clientX, ev.clientY);
        if (target && target !== start.status) {
          const tk = tasksRef.current.find(t => t.id === start.id);
          if (tk) void moveToStatusRef.current(tk, target);
        }
      }
      setDragging(null);
      setHoverColumn(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }
  // -------------------------------------------------------------

  const draggingTask = dragging ? tasks.find(t => t.id === dragging.id) : null;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-tasks-title">{t("tasks.title")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("tasks.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showArchived ? "default" : "outline"}
              size="sm"
              onClick={() => setShowArchived(s => !s)}
              data-testid="button-toggle-archive"
            >
              {showArchived ? <ArchiveRestore className="w-4 h-4 mr-1.5" /> : <Archive className="w-4 h-4 mr-1.5" />}
              {showArchived ? t("tasks.viewActive") : t("tasks.viewArchive")}
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={openCreate} data-testid="button-new-task">
                <Plus className="w-4 h-4 mr-1.5" />
                {t("tasks.newTask")}
              </Button>
            )}
          </div>
        </div>

        {/* Empty / Loading */}
        {loading ? (
          <div className="text-sm text-muted-foreground">{t("tasks.loading")}</div>
        ) : totalCount === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-10 text-center">
            <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold">{showArchived ? t("tasks.emptyArchive") : t("tasks.emptyActive")}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {showArchived ? t("tasks.emptyArchiveHint") : t("tasks.emptyActiveHint")}
            </p>
            {isAdmin && !showArchived && (
              <Button size="sm" className="mt-4" onClick={openCreate} data-testid="button-empty-create">
                <Plus className="w-4 h-4 mr-1.5" />
                {t("tasks.createTask")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(["todo", "in_progress", "done"] as const).map(status => {
              const items = grouped[status];
              const isHover = hoverColumn === status && dragging && dragging.status !== status;
              return (
                <div
                  key={status}
                  ref={el => { columnRefs.current[status] = el; }}
                  className={`rounded-xl border bg-card p-3 min-h-[200px] transition-all ${
                    isHover ? "border-dashed border-primary ring-2 ring-primary/30" : "border-border"
                  }`}
                  data-testid={`column-${status}`}
                >
                  <div className="flex items-center gap-2 px-1 pb-2 mb-2 border-b">
                    <span className={`w-2 h-2 rounded-full ${COLUMN_DOT_COLORS[status]}`} />
                    <h2 className="text-sm font-semibold">{t(`tasks.col.${status}`)}</h2>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{items.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {items.map(task => {
                      const isDragSelf = dragging?.id === task.id;
                      const noteCount = (task.taskNotes?.length) || 0;
                      const next = STATUS_FLOW[task.status];
                      const canEditThis = isAdmin || (canManage && task.assignedTo === user?.id);
                      return (
                        <div
                          key={task.id}
                          className={`group rounded-lg border bg-background p-3 cursor-pointer transition ${
                            isDragSelf ? "opacity-40 scale-95" : "hover:border-primary/50 hover:shadow-sm"
                          }`}
                          onClick={() => setNotesTask(task)}
                          data-testid={`task-card-${task.id}`}
                        >
                          <div className="flex items-start gap-2">
                            {canManage && !showArchived && (
                              <span
                                className="mt-0.5 text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing"
                                onPointerDown={(e) => handleCardPointerDown(e, task)}
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`drag-handle-${task.id}`}
                              >
                                <GripVertical className="w-4 h-4" />
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium leading-snug break-words ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                                {task.title}
                              </div>
                              {task.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                <Badge variant="secondary" className={`text-[10px] h-5 px-1.5 ${PRIORITY_COLORS[task.priority]}`}>
                                  {t(`tasks.priority.${task.priority}`)}
                                </Badge>
                                {task.dueDate && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <Clock className="w-3 h-3" />
                                    {task.dueDate}
                                  </span>
                                )}
                                {task.assignedToName && (
                                  <span className="inline-flex items-center gap-1 text-[10px] bg-muted/60 rounded-full px-1.5 py-0.5">
                                    {task.assignedToName}
                                  </span>
                                )}
                                {noteCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <MessageSquarePlus className="w-3 h-3" />
                                    {noteCount}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                              {!showArchived ? (
                                <>
                                  {next && canManage && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6"
                                      title={t(`tasks.advanceTo.${next}`)}
                                      onClick={() => advanceStatus(task)}
                                      data-testid={`button-advance-${task.id}`}
                                    >
                                      <ArrowRight className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    title={t("tasks.viewNotes")}
                                    onClick={() => setNotesTask(task)}
                                    data-testid={`button-notes-${task.id}`}
                                  >
                                    <MessageSquarePlus className="w-3.5 h-3.5" />
                                  </Button>
                                  {canEditThis && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6"
                                      title={t("tasks.edit")}
                                      onClick={() => openEdit(task)}
                                      data-testid={`button-edit-${task.id}`}
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                  {isAdmin && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 text-destructive hover:text-destructive"
                                      title={t("tasks.archive")}
                                      onClick={() => archiveTask(task)}
                                      data-testid={`button-archive-${task.id}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                </>
                              ) : (
                                isAdmin && (
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    title={t("tasks.restore")}
                                    onClick={() => restoreTask(task)}
                                    data-testid={`button-restore-${task.id}`}
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </Button>
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {items.length === 0 && (
                      <div className="text-xs text-muted-foreground/60 italic px-2 py-3 text-center">
                        {t("tasks.colEmpty")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating drag ghost */}
      {dragging && draggingTask && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border bg-background shadow-lg p-2 max-w-[260px] opacity-90"
          style={{ left: dragging.x + 12, top: dragging.y + 12 }}
        >
          <div className="text-xs font-medium truncate">{draggingTask.title}</div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTask ? t("tasks.editTask") : t("tasks.newTask")}</DialogTitle>
            <DialogDescription>{t("tasks.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="task-title">{t("tasks.fields.title")} *</Label>
              <Input
                id="task-title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                data-testid="input-task-title"
              />
            </div>
            <div>
              <Label htmlFor="task-desc">{t("tasks.fields.description")}</Label>
              <Textarea
                id="task-desc"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                data-testid="input-task-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("tasks.fields.status")}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as Task["status"] }))}>
                  <SelectTrigger data-testid="select-task-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">{t("tasks.col.todo")}</SelectItem>
                    <SelectItem value="in_progress">{t("tasks.col.in_progress")}</SelectItem>
                    <SelectItem value="done">{t("tasks.col.done")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("tasks.fields.priority")}</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as Task["priority"] }))}>
                  <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t("tasks.priority.low")}</SelectItem>
                    <SelectItem value="medium">{t("tasks.priority.medium")}</SelectItem>
                    <SelectItem value="high">{t("tasks.priority.high")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="task-due">{t("tasks.fields.dueDate")}</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  data-testid="input-task-due"
                />
              </div>
              <div>
                <Label>{t("tasks.fields.assignTo")}</Label>
                <Select
                  value={form.assignedTo}
                  onValueChange={v => {
                    if (v === "unassigned") {
                      setForm(f => ({ ...f, assignedTo: "unassigned", assignedToName: "" }));
                    } else {
                      const a = assignees.find(x => String(x.id) === v);
                      setForm(f => ({
                        ...f,
                        assignedTo: v,
                        assignedToName: a ? displayName(a) : "",
                      }));
                    }
                  }}
                >
                  <SelectTrigger data-testid="select-task-assignee"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">{t("tasks.unassigned")}</SelectItem>
                    {assignees.map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>{displayName(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>{t("tasks.cancel")}</Button>
            <Button onClick={saveTask} disabled={saving} data-testid="button-save-task">
              {saving ? t("tasks.saving") : t("tasks.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes Dialog */}
      <Dialog open={!!notesTask} onOpenChange={(o) => { if (!o) { setNotesTask(null); setNewNoteText(""); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{notesTask?.title}</DialogTitle>
            {notesTask?.description && (
              <DialogDescription>{notesTask.description}</DialogDescription>
            )}
          </DialogHeader>
          {notesTask && (
            <>
              <div className="flex flex-wrap items-center gap-1.5 -mt-1">
                <Badge variant="secondary" className={`text-[10px] h-5 px-1.5 ${PRIORITY_COLORS[notesTask.priority]}`}>
                  {t(`tasks.priority.${notesTask.priority}`)}
                </Badge>
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  {t(`tasks.col.${notesTask.status}`)}
                </Badge>
                {notesTask.dueDate && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="w-3 h-3" /> {notesTask.dueDate}
                  </span>
                )}
                {notesTask.assignedToName && (
                  <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5">{notesTask.assignedToName}</span>
                )}
              </div>

              <div className="border-t pt-3 space-y-2 max-h-[300px] overflow-y-auto">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("tasks.notes")}</h3>
                {(!notesTask.taskNotes || notesTask.taskNotes.length === 0) ? (
                  <p className="text-xs text-muted-foreground italic">{t("tasks.noNotes")}</p>
                ) : (
                  notesTask.taskNotes.map(n => (
                    <div key={n.id} className="rounded-md border bg-muted/40 p-2 group">
                      <div className="flex items-start gap-2">
                        <p className="flex-1 text-sm whitespace-pre-wrap break-words">{n.text}</p>
                        {isAdmin && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100"
                            onClick={() => deleteNote(n.id)}
                            data-testid={`button-delete-note-${n.id}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {n.authorName} — {formatNoteDate(n.createdAt)}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {(() => {
                const canComment = isAdmin || notesTask.assignedTo === user?.id || notesTask.assignedTo === null;
                if (!canComment) return null;
                return (
                  <div className="border-t pt-3 space-y-2">
                    <Textarea
                      rows={2}
                      placeholder={t("tasks.addNotePlaceholder")}
                      value={newNoteText}
                      onChange={e => setNewNoteText(e.target.value)}
                      data-testid="input-new-note"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={!newNoteText.trim() || addingNote}
                        onClick={addNote}
                        data-testid="button-add-note"
                      >
                        {addingNote ? t("tasks.adding") : t("tasks.add")}
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
