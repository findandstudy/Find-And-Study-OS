import { AdminPageActions, AdminPageDescription, AdminPageHeader, AdminPageTitle } from "@/components/layout/AdminPage";
import {WorkStageNotifications} from "@/components/notifications/WorkStageNotifications";
import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { WorkPipelineActivity } from "./WorkPipelineActivity";
import { WorkPipelineBoardViewport } from "./WorkPipelineBoardViewport";
import { WorkPipelineExcel } from "./WorkPipelineExcel";
import { WorkPipelinePicker } from "./WorkPipelinePicker";
import { useRef, useState } from "react";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
  pointerWithin,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { AssignPopover } from "@/components/AssignPopover";
import {
  Plus,
  Search,
  Filter,
  LayoutGrid,
  List,
  Settings2,
  Eye,
  MessageSquare,
  ArrowUp,
  ArrowDown,
  X,
  CalendarClock,
  Trophy,
  GripVertical,
  XCircle,
} from "lucide-react";
import {
  useWorkPipelines,
  request,
  cardData,
  type Row,
  type Card,
  type Stage,
} from "./useWorkPipelines";

type Model = ReturnType<typeof useWorkPipelines>;

type PipelineBulkAction =
  | { type: "assign"; assigneeId: number }
  | { type: "move"; stageId: string }
  | { type: "delete" };

type PipelineSelection = {
  boardId: string;
  cards: { id: string; revision: number }[];
};

const BULK_LIMIT = 200;

function ContactCard({
  row,
  stage,
  m,
  selected,
  selectionDisabled,
  onSelect,
}: {
  row: Row<Card>;
  stage: Stage;
  m: Model;
  selected: boolean;
  selectionDisabled: boolean;
  onSelect: (id: string) => void;
}) {
  const c = row.document;
  const selectable = !m.b?.archived;
  const moveable = selectable && !m.busy;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: c.id, data: { stageId: stage.id }, disabled: !moveable });
  const people =
    m.options.data?.people.filter(
      (p) => m.b?.memberIds.includes(p.id) || m.b?.createdBy === p.id,
    ) || [];
  const color =
    stage.result === "won"
      ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/40"
      : stage.result === "closed"
        ? "bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-700/40"
        : "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/40";
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl border overflow-hidden mb-3 transition-shadow duration-200 ${selected ? "ring-2 ring-inset ring-primary " : ""}${isDragging ? "border-primary shadow-xl opacity-50 relative z-50" : color + " hover:shadow-md"}`}
    >
      <div
        className={`p-3 pb-2 ${isDragging ? "cursor-grabbing" : moveable ? "cursor-grab" : ""}`}
        onPointerDown={(event) => {
          const target = event.target;
          if (moveable && event.pointerType === "mouse" && target instanceof Element && !target.closest("button")) {
            listeners?.onPointerDown?.(event);
          }
        }}
      >
        <div className="flex items-start gap-2 mb-2">
          {selectable && (
            <Checkbox
              className="mt-2"
              aria-label={m.t("agentStudents.selectRow") + " " + c.title}
              checked={selected}
              disabled={m.busy || (selectionDisabled && !selected)}
              onCheckedChange={() => onSelect(c.id)}
            />
          )}
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">
              {c.title
                .split(/\s+/)
                .slice(0, 2)
                .map((s) => s[0])
                .join("")}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h4
              className="font-bold text-sm text-foreground truncate"
              title={c.title}
            >
              {c.title}
            </h4>
            {c.source && (
              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground mt-1">
                {c.source.kind === "channel"
                  ? m.l.messages
                  : c.source.kind === "embed"
                    ? m.t("workPipelines.embedForms")
                    : m.t("workPipelines.webLead")}
              </span>
            )}
          </div>
          {selectable && (
            <Button
              {...attributes}
              {...listeners}
              ref={setActivatorNodeRef}
              type="button"
              size="icon"
              variant="ghost"
              aria-label={m.t("workPipelines.dragCard", { name: c.title })}
              className={isDragging ? "size-8 shrink-0 touch-none cursor-grabbing" : "size-8 shrink-0 touch-none cursor-grab"}
              disabled={m.busy}
            >
              <GripVertical className="size-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {c.email || c.phone ? <bdi dir="ltr">{c.email || c.phone}</bdi> : m.l.noContact}
        </p>
        {c.description && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2 whitespace-pre-line">
            {c.description}
          </p>
        )}
      </div>
      {c.followUps?.some((f) => !f.completed) && (
        <p className="px-4 pb-2 flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="w-3 h-3" />
          {new Date(
            [...c.followUps]
              .filter((f) => !f.completed)
              .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]
              .scheduledAt,
          ).toLocaleString(m.lang, { dateStyle: "short", timeStyle: "short" })}
        </p>
      )}
      <div className="px-4 pb-3 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {m.b?.archived ? (
            <span className="text-xs text-muted-foreground">
              {m.person(c.assigneeId)}
            </span>
          ) : (
            <AssignPopover
              copy={{ assign: m.t("workPipelines.assign"), search: m.t("workPipelines.searchTeam"), empty: m.t("workPipelines.noTeamResults"), me: m.t("workPipelines.me") }}
              assignedUserName={people.find((p) => p.id === c.assigneeId)?.name}
              staffUsers={people}
              currentUserId={m.user?.id}
              onAssign={(id) =>
                void m.run(async () => {
                  await request(`/${m.selected}/cards/${c.id}`, "PATCH", {
                    patch: { assigneeId: id },
                    revision: row.revision,
                  });
                  await m.refresh();
                })
              }
            />
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {c.source?.conversationId && (
            <a
              href={`/staff/messages?conversation=${c.source.conversationId}`}
              title={m.l.inbox}
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            onClick={() => m.editCard(row)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
          >
            <Eye className="w-3 h-3" />
            {m.l.view}
          </button>
        </div>
      </div>
    </div>
  );
}
function StageColumn({
  stage,
  rows,
  m,
  selectedIds,
  selectionDisabled,
  onSelect,
}: {
  stage: Stage;
  rows: Row<Card>[];
  m: Model;
  selectedIds: ReadonlySet<string> | null;
  selectionDisabled: boolean;
  onSelect: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    disabled: m.busy || m.b?.archived,
  });
  const won = stage.result === "won",
    lost = stage.result === "closed";
  return (
    <div
      ref={setNodeRef}
      className={`flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden rounded-2xl border sm:w-72 ${won ? "bg-emerald-50/60 border-emerald-200/50 dark:bg-emerald-900/20 dark:border-emerald-700/30" : lost ? "bg-rose-50/60 border-rose-200/50 dark:bg-rose-900/20 dark:border-rose-700/30" : "bg-secondary/50 border-border/50"}`}
    >
      <div
        className={`p-4 border-b shrink-0 ${won ? "bg-emerald-100/80 border-emerald-200/70 dark:bg-emerald-900/40" : lost ? "bg-rose-100/80 border-rose-200/70 dark:bg-rose-900/40" : "bg-card/50 border-border/50"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {won ? (
              <Trophy className="w-4 h-4 text-emerald-500" />
            ) : lost ? (
              <XCircle className="w-4 h-4 text-rose-400" />
            ) : null}
            <h3 className="min-w-0 break-words font-display font-bold">{stage.name}</h3>
          </div>
          <span className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold border bg-background text-muted-foreground shadow-sm">
            {rows.length}
          </span>
        </div>
      </div>
      <div
        data-work-pipeline-stage-scroll=""
        tabIndex={0}
        role="region"
        aria-label={stage.name}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 custom-scrollbar transition-colors ${isOver ? "bg-primary/5" : ""}`}
      >
        <SortableContext
          items={rows.map((r) => r.document.id)}
          strategy={verticalListSortingStrategy}
        >
          {rows.map((r) => (
            <ContactCard
              key={r.document.id}
              row={r}
              stage={stage}
              m={m}
              selected={selectedIds?.has(r.document.id) ?? false}
              selectionDisabled={m.busy || selectionDisabled}
              onSelect={onSelect}
            />
          ))}
          {!rows.length && (
            <div className="h-20 border-2 border-dashed border-border/50 rounded-xl flex items-center justify-center text-sm font-medium text-muted-foreground">
              {m.b?.archived ? m.l.noCards : m.l.dropHere}
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

export default function WorkPipelines() {
  const { lang: uiLanguage } = useUiLanguage();
  const { toast } = useToast();
  const m = useWorkPipelines(),
    { l, b, firstActiveBoardId } = m;
  const [settings, setSettings] = useState<
    "create" | "rename" | "stages" | "sources" | "team"
  >("create");
  const [assignment, setAssignment] = useState("all"),
    [stageFilter, setStageFilter] = useState("all"),
    [active, setActive] = useState<string | null>(null);
  const keyboardStage = useRef<string | null>(null);
  const people =
    m.options.data?.people.filter(
      (p) => b?.memberIds.includes(p.id) || b?.createdBy === p.id,
    ) || [];
  const rows = m.rows.filter(
    (r) =>
      (stageFilter === "all" || r.document.stageId === stageFilter) &&
      (assignment === "all" ||
        (assignment === "none"
          ? r.document.assigneeId === null
          : String(r.document.assigneeId) === assignment)),
  );
  const [selection, setSelection] = useState<{ boardId: string; ids: Set<string> }>({ boardId: "", ids: new Set() });
  const [deleteDraft, setDeleteDraft] = useState<PipelineSelection | null>(null);
  const canSelect = Boolean(b && !b.archived);
  const selectedIds = selection.boardId === m.selected ? selection.ids : null;
  const selectedRows = canSelect ? rows.filter((r) => selectedIds?.has(r.document.id)) : [];
  const selectedCount = selectedRows.length;
  const allSelected = selectedCount > 0 && selectedCount >= Math.min(rows.length, BULK_LIMIT);
  const atLimit = selectedCount >= BULK_LIMIT;
  const selectAllState = allSelected || (selectedCount > 0 ? "indeterminate" : false);
  const clearSelection = () => setSelection({ boardId: m.selected, ids: new Set() });
  const toggleSelection = (id: string) => {
    if (!canSelect || m.busy) return;
    setSelection((previous) => {
      const next = new Set(previous.boardId === m.selected ? previous.ids : []);
      if (!next.delete(id) && next.size < BULK_LIMIT) next.add(id);
      return { boardId: m.selected, ids: next };
    });
  };
  const toggleAll = () => {
    setSelection({
      boardId: m.selected,
      ids: allSelected ? new Set() : new Set(rows.slice(0, BULK_LIMIT).map((r) => r.document.id)),
    });
  };
  const selectionSnapshot = (): PipelineSelection => ({
    boardId: m.selected,
    cards: selectedRows.map((r) => ({ id: r.document.id, revision: r.revision })),
  });
  const visibleStages = b?.stages.filter((stage) => stageFilter === "all" || stageFilter === stage.id) ?? [];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      scrollBehavior: "auto",
      coordinateGetter(event, { context }) {
        const key = event.code;
        if (key !== "ArrowLeft" && key !== "ArrowRight") return;
        event.preventDefault();

        const currentStageId = keyboardStage.current ?? context.over?.id ?? context.active?.data.current?.stageId;
        const currentIndex = visibleStages.findIndex((stage) => stage.id === currentStageId);
        if (currentIndex < 0 || !context.collisionRect) return;
        const nextKey = m.isRTL ? "ArrowLeft" : "ArrowRight";
        const step = key === nextKey ? 1 : -1;
        const destination = visibleStages[currentIndex + step];
        if (!destination) return;
        const column = context.droppableContainers.get(destination.id)?.node.current;
        if (!column) return;

        keyboardStage.current = destination.id;
        column.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        const rect = column.getBoundingClientRect();
        return {
          x: rect.left + (rect.width - context.collisionRect.width) / 2,
          y: rect.top + (rect.height - context.collisionRect.height) / 2,
        };
      },
    }),
  );
  const selectBoard = (id: string) => {
    setDeleteDraft(null);
    setSelection({ boardId: id, ids: new Set() });
    m.choose(id);
    setStageFilter("all");
    setAssignment("all");
  };
  const openSettings = (kind: typeof settings) => {
    setSettings(kind);
    m.setError("");
    if (kind === "create") m.createBoard();
    else if (m.current) m.setBoardDraft(structuredClone(m.current));
  };
  const dragEnd = (e: DragEndEvent) => {
    const overId = keyboardStage.current ?? e.over?.id;
    keyboardStage.current = null;
    setActive(null);
    if (!overId || m.busy || b?.archived) return;
    const row = m.rows.find((r) => r.document.id === String(e.active.id));
    const target =
      b?.stages.find((s) => s.id === String(overId)) ||
      b?.stages.find(
        (s) =>
          s.id ===
          m.rows.find((r) => r.document.id === String(overId))?.document
            .stageId,
      );
    if (row && target && row.document.stageId !== target.id)
      void m.move(row, target.id);
  };
  const runBulk = (action: PipelineBulkAction, snapshot = selectionSnapshot()) => {
    if (m.busy || !canSelect || !snapshot.cards.length || snapshot.boardId !== m.selected) return;
    void m.run(async () => {
      try {
        await request("/" + snapshot.boardId + "/cards/bulk", "POST", { cards: snapshot.cards, action });
      } catch (error) {
        setDeleteDraft(null);
        await m.refresh();
        throw error;
      }
      setDeleteDraft(null);
      clearSelection();
      await m.refresh();
      toast({ title: m.t("common.saved") });
    });
  };
  const notice = (message: string) => (
    <div
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-sm p-3 flex items-center justify-between gap-3"
    >
      {message}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          m.setError("");
          void m.refresh();
        }}
      >
        {l.retry}
      </Button>
    </div>
  );
  const error =
    m.error ||
    m.boards.error?.message ||
    m.cards.error?.message ||
    m.options.error?.message;
  if (m.feature.isPending) return <p role="status">{l.loading}</p>;
  if (!m.feature.data?.enabled) return <p role="alert">{l.noPipelines}</p>;
  return (
    <div
      className="flex h-[calc(100dvh-8rem)] min-h-0 w-full min-w-0 flex-col"
      dir={m.isRTL ? "rtl" : "ltr"}
    >
      <AdminPageHeader className="mb-4 shrink-0 min-w-0">
        <div>
          <AdminPageTitle>
            {l.title}
          </AdminPageTitle>
          <AdminPageDescription>{l.simpleIntro}</AdminPageDescription>
        </div>
        <AdminPageActions className="w-full xl:w-auto xl:justify-end">
          <div className="relative w-full sm:w-56 lg:w-64">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={l.search}
              aria-label={l.search}
              className="ps-9"
              value={m.query}
              onChange={(e) => { clearSelection(); m.setQuery(e.target.value); }}
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="rounded-full gap-2">
                <Filter className="w-4 h-4" />
                {l.filters}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-4" align="end">
              <div className="space-y-2">
                <Label>{l.stage}</Label>
                <Select value={stageFilter} onValueChange={(value) => { clearSelection(); setStageFilter(value); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{l.allStages}</SelectItem>
                    {b?.stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{l.assignee}</Label>
                <Select value={assignment} onValueChange={(value) => { clearSelection(); setAssignment(value); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{l.everyone}</SelectItem>
                    <SelectItem value="none">{l.none}</SelectItem>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </PopoverContent>
          </Popover>
          {b && (
            <WorkPipelineExcel
              key={b.id}
              id={b.id}
              name={b.name}
              lang={m.lang}
              archived={b.archived}
              query={m.query}
              stage={stageFilter}
              assignee={assignment}
              refresh={m.refresh}
            />
          )}
          <div className="flex items-center border rounded-full overflow-hidden">
            {(["board", "table"] as const).map((v) => (
              <button
                key={v}
                aria-label={v === "board" ? l.board : l.table}
                aria-pressed={m.view === v}
                className={`p-2 transition-colors ${m.view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                onClick={() => m.setView(v)}
              >
                {v === "board" ? (
                  <LayoutGrid className="w-4 h-4" />
                ) : (
                  <List className="w-4 h-4" />
                )}
              </button>
            ))}
          </div>
          <Button
            disabled={!b || b.archived || m.busy}
            onClick={() => m.createCard()}
          >
            <Plus className="w-4 h-4 me-2" />
            {l.addRecord}
          </Button>
        </AdminPageActions>
      </AdminPageHeader>
      <div className="mb-4 flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <WorkPipelinePicker
          key={m.user?.id ?? "anonymous"}
          userId={m.user?.id}
          selected={m.selected}
          current={b}
          lang={m.lang}
          choose={selectBoard}
          create={
            m.options.data?.canManage ? () => openSettings("create") : undefined
          }
        />
        {m.options.data?.canManage && b && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="rounded-full"
                aria-label={l.settings}
              >
                <Settings2 className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-1" align="end">
              {(["rename", "stages", "team", "sources"] as const).map(
                (kind) => (
                  <button
                    key={kind}
                    className="w-full text-start px-3 py-2 rounded-md text-sm hover:bg-muted"
                    onClick={() => openSettings(kind)}
                  >
                    {kind === "rename"
                      ? l.rename
                      : kind === "stages"
                        ? l.stages
                        : kind === "team"
                          ? l.team
                          : l.sources}
                  </button>
                ),
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {canSelect && (selectedCount > 0 || (m.view === "board" && rows.length > 0)) && (
        <AdminPageActions className="mb-3 shrink-0" data-testid="work-pipeline-selection">
          {m.view === "board" && (
            <label className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <Checkbox checked={selectAllState} onCheckedChange={toggleAll} disabled={m.busy} />
              {m.t("common.selectAll")}
            </label>
          )}
          <BulkActionBar
            selectedCount={selectedCount}
            disabled={m.busy}
            staffUsers={people}
            stages={b?.stages.map((stage) => ({ key: stage.id, label: stage.name })) ?? []}
            assignPrompt={l.assignee}
            moveLabel={m.t("workPipelines.moveStage")}
            movePrompt={l.stage}
            onAssign={(assigneeId) => runBulk({ type: "assign", assigneeId })}
            onMove={(stageId) => runBulk({ type: "move", stageId })}
            onDelete={m.options.data?.canManage ? () => {
              m.setError("");
              setDeleteDraft(selectionSnapshot());
            } : undefined}
          />
          {selectedCount > 0 && (
            <Button variant="ghost" size="sm" disabled={m.busy} onClick={clearSelection}>
              {m.t("agentStudents.clearSelection")}
            </Button>
          )}
          {atLimit && rows.length > BULK_LIMIT && (
            <p role="status" className="text-xs text-muted-foreground">
              {m.t("workPipelines.bulkLimit", { count: BULK_LIMIT })}
            </p>
          )}
        </AdminPageActions>
      )}
      {error && !m.boardDraft && !m.cardDraft && !deleteDraft && notice(error)}
      {b?.archived && (
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <p>{l.archivedHelp}</p>
          {firstActiveBoardId && (
            <Button variant="link" size="sm" className="h-auto min-h-0 p-0" onClick={() => selectBoard(firstActiveBoardId)}>
              {m.t("workPipelines.openActivePipeline")}
            </Button>
          )}
        </div>
      )}
      {m.boards.isPending || (Boolean(m.selected) && m.cards.isPending) ? (
        <p role="status">{l.loading}</p>
      ) : !b ? (
        <div className="p-10 text-center text-muted-foreground">
          <p>{l.empty}</p>
          {m.options.data?.canManage && (
            <Button
              className="rounded-full mt-4"
              onClick={() => openSettings("create")}
            >
              {l.create}
            </Button>
          )}
        </div>
      ) : m.view === "board" ? (
        <WorkPipelineBoardViewport
          key={b.id}
          label={l.board}
          previousLabel={m.t("common.previous")}
          nextLabel={m.t("common.next")}
          isRTL={m.isRTL}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={(args) => {
              if (!args.pointerCoordinates) {
                if (keyboardStage.current) return [{ id: keyboardStage.current }];
                return closestCenter({
                  ...args,
                  droppableContainers: args.droppableContainers.filter(({ id }) =>
                    visibleStages.some((stage) => stage.id === id),
                  ),
                });
              }
              const hits = pointerWithin(args);
              const column = hits.find((hit) => b.stages.some((s) => s.id === hit.id));
              return column ? [column] : hits;
            }}
            onDragStart={(e) => {
              keyboardStage.current = null;
              setActive(String(e.active.id));
            }}
            onDragEnd={dragEnd}
            onDragCancel={() => {
              keyboardStage.current = null;
              setActive(null);
            }}
          >
            {visibleStages.map((s) => (
              <StageColumn
                key={s.id}
                stage={s}
                rows={rows.filter((r) => r.document.stageId === s.id)}
                m={m}
                selectedIds={selectedIds}
                selectionDisabled={atLimit}
                onSelect={toggleSelection}
              />
            ))}
            <DragOverlay>
              {active && (
                <div className="w-72 bg-card border border-primary rounded-xl shadow-2xl p-4 font-bold text-sm rotate-1">
                  {m.rows.find((r) => r.document.id === active)?.document.title}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </WorkPipelineBoardViewport>
      ) : (
        <div className="flex min-h-52 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {canSelect && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label={m.t("common.selectAll")}
                        checked={selectAllState}
                        disabled={m.busy || !rows.length}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                  )}
                  {[
                    l.name,
                    l.email,
                    l.phone,
                    l.stage,
                    l.source,
                    l.assignee,
                    l.manage,
                  ].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.document.id} data-state={selectedIds?.has(r.document.id) ? "selected" : undefined}>
                    {canSelect && (
                      <TableCell>
                        <Checkbox
                          aria-label={m.t("agentStudents.selectRow") + " " + r.document.title}
                          checked={selectedIds?.has(r.document.id) ?? false}
                          disabled={m.busy || (atLimit && !selectedIds?.has(r.document.id))}
                          onCheckedChange={() => toggleSelection(r.document.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <button
                        className="font-medium text-primary hover:underline"
                        onClick={() => m.editCard(r)}
                      >
                        {r.document.title}
                      </button>
                    </TableCell>
                    <TableCell><bdi dir="ltr">{r.document.email || "—"}</bdi></TableCell>
                    <TableCell><bdi dir="ltr">{r.document.phone || "—"}</bdi></TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-1 rounded-full bg-secondary">
                        {
                          b.stages.find((s) => s.id === r.document.stageId)
                            ?.name
                        }
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.document.source?.kind === "channel"
                        ? l.messages
                        : r.document.source?.kind === "embed"
                          ? m.t("workPipelines.embedForms")
                          : r.document.source?.kind === "web"
                            ? m.t("workPipelines.webLead")
                            : "—"}
                    </TableCell>
                    <TableCell>{m.person(r.document.assigneeId)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => m.editCard(r)}
                      >
                        <Eye className="w-3 h-3 me-1" />
                        {l.view}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!rows.length && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {l.noCards}
              </p>
            )}
          </div>
        </div>
      )}
      {m.cards.hasNextPage && (
        <Button
          variant="outline"
          className="rounded-full self-start mt-2"
          disabled={m.cards.isFetchingNextPage}
          onClick={() => void m.cards.fetchNextPage()}
        >
          {l.more}
        </Button>
      )}
      <AlertDialog open={Boolean(deleteDraft)} onOpenChange={(open) => { if (!open && !m.busy) setDeleteDraft(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.t("common.deleteSelected", { n: deleteDraft?.cards.length ?? 0 })}</AlertDialogTitle>
            <AlertDialogDescription>{m.t("workPipelines.deleteRecordsHelp")}</AlertDialogDescription>
          </AlertDialogHeader>
          {m.error && notice(m.error)}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={m.busy}>{l.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={m.busy}
              onClick={(event) => {
                event.preventDefault();
                if (deleteDraft) runBulk({ type: "delete" }, deleteDraft);
              }}
            >
              {m.busy ? l.loading : m.t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={!!m.boardDraft}
        onOpenChange={(open) => {
          if (!open && !m.busy) m.setBoardDraft(null);
        }}
      >
        <DialogContent
          closeLabel={m.t("common.close")}
          className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle>
              {settings === "create"
                ? l.create
                : settings === "rename"
                  ? l.rename
                  : settings === "stages"
                    ? l.stages
                    : settings === "team"
                      ? l.team
                      : l.sources}
            </DialogTitle>
          </DialogHeader>
          {m.boardDraft && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void m.saveBoard();
              }}
              className="space-y-4"
            >
              {m.error && notice(m.error)}
              {(settings === "create" || settings === "rename") && (
                <div className="space-y-2">
                  <Label htmlFor="pipeline-name">{l.name}</Label>
                  <Input
                    id="pipeline-name"
                    autoFocus
                    required
                    maxLength={120}
                    value={m.boardDraft.document.name}
                    onChange={(e) => m.boardEdit({ name: e.target.value })}
                  />
                </div>
              )}
              {(settings === "create" || settings === "team") && (
                <div className="space-y-2">
                  <Label>{l.team}</Label>
                  <p className="text-xs text-muted-foreground">
                    {m.t("workPipelines.chooseTeamMembersWhoCan")}
                  </p>
                  {m.options.data?.people
                    .filter((p) => p.id !== m.boardDraft!.document.createdBy)
                    .map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={m.boardDraft!.document.memberIds.includes(
                            p.id,
                          )}
                          onChange={(e) =>
                            m.boardEdit({
                              memberIds: e.target.checked
                                ? [...m.boardDraft!.document.memberIds, p.id]
                                : m.boardDraft!.document.memberIds.filter(
                                    (id) => id !== p.id,
                                  ),
                            })
                          }
                        />
                        {p.name}
                      </label>
                    ))}
                </div>
              )}
              {settings === "stages" && (
                <>
                  <div className="space-y-3">
                    {m.boardDraft.document.stages.map((s, i) => (
                      <div className="space-y-3 rounded-lg border p-3" key={s.id}><div className="flex items-center gap-2">
                        <Input
                          aria-label={`${l.stage} ${i + 1}`}
                          required
                          value={s.name}
                          onChange={(e) =>
                            m.boardEdit({
                              stages: m.boardDraft!.document.stages.map((x) =>
                                x.id === s.id
                                  ? { ...x, name: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                        <Select
                          value={s.result}
                          onValueChange={(value) =>
                            m.boardEdit({
                              stages: m.boardDraft!.document.stages.map((x) =>
                                x.id === s.id
                                  ? { ...x, result: value as Stage["result"] }
                                  : x,
                              ),
                            })
                          }
                        >
                          <SelectTrigger
                            aria-label={`${s.name}: ${l.status}`}
                            className="w-28 shrink-0"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">{l.open}</SelectItem>
                            <SelectItem value="won">{l.completed}</SelectItem>
                            <SelectItem value="closed">{l.closed}</SelectItem>
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          aria-label={l.up}
                          disabled={!i}
                          onClick={() => {
                            const a = [...m.boardDraft!.document.stages];
                            [a[i - 1], a[i]] = [a[i], a[i - 1]];
                            m.boardEdit({ stages: a });
                          }}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={l.down}
                          disabled={
                            i === m.boardDraft!.document.stages.length - 1
                          }
                          onClick={() => {
                            const a = [...m.boardDraft!.document.stages];
                            [a[i + 1], a[i]] = [a[i], a[i + 1]];
                            m.boardEdit({ stages: a });
                          }}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={l.remove}
                          disabled={m.boardDraft!.document.stages.length === 1}
                          onClick={() =>
                            m.boardEdit({
                              stages: m.boardDraft!.document.stages.filter(
                                (x) => x.id !== s.id,
                              ),
                            })
                          }
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div><WorkStageNotifications value={s} onChange={patch=>m.boardEdit({stages:m.boardDraft!.document.stages.map(x=>x.id===s.id?{...x,...patch}:x)})}/></div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() =>
                      m.boardEdit({
                        stages: [
                          ...m.boardDraft!.document.stages,
                          {
                            id: crypto.randomUUID(),
                            name: l.newStage,
                            color: "#2563eb",
                            result: "open",
                          },
                        ],
                      })
                    }
                  >
                    <Plus className="w-3.5 h-3.5 me-1" />
                    {l.addStage}
                  </Button>
                </>
              )}
              {settings === "sources" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {m.t("workPipelines.createTheFormInThe")}
                  </p>
                  <div className="flex items-center gap-3">
                    <a
                      className="text-sm text-primary hover:underline"
                      href="/admin/embeds"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {m.t("workPipelines.manageEmbedForms")}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={m.options.isFetching}
                      onClick={() => void m.options.refetch()}
                    >
                      {m.t("workPipelines.refreshList")}
                    </Button>
                  </div>
                  {(["embed", "channel", "web"] as const).map((kind) => (
                    <div key={kind} className="space-y-2">
                      <h3 className="font-medium text-sm">
                        {kind === "embed"
                          ? m.t("workPipelines.embedForms")
                          : kind === "channel"
                            ? m.t("workPipelines.messageChannels")
                            : m.t("workPipelines.webLead")}
                      </h3>
                      {m.options.data?.sources
                        .filter((s) => s.kind === kind)
                        .map((s) => {
                          const binding = m.options.data?.bindings?.find(
                            (x) => x.kind === s.kind && x.source_key === s.key,
                          );
                          const elsewhere =
                            binding &&
                            binding.board_id !== m.boardDraft!.document.id;
                          return (
                            <label
                              key={s.kind + s.key}
                              className={
                                "flex items-start gap-2 text-sm rounded-lg border p-3 " +
                                (elsewhere ? "opacity-60" : "")
                              }
                            >
                              <input
                                type="checkbox"
                                className="mt-1"
                                disabled={Boolean(elsewhere) || m.busy}
                                checked={m.boardDraft!.document.sources.some(
                                  (x) => x.kind === s.kind && x.key === s.key,
                                )}
                                onChange={(e) =>
                                  m.boardEdit({
                                    sources: e.target.checked
                                      ? [
                                          ...m.boardDraft!.document.sources,
                                          { kind: s.kind, key: s.key },
                                        ]
                                      : m.boardDraft!.document.sources.filter(
                                          (x) =>
                                            x.kind !== s.kind ||
                                            x.key !== s.key,
                                        ),
                                  })
                                }
                              />
                              <span>
                                {s.kind === "web"
                                  ? m.t("workPipelines.webLead") +
                                    ": " +
                                    s.label.replace(/^Web-to-lead: /, "")
                                  : s.label}
                                {elsewhere && (
                                  <span className="block text-xs text-muted-foreground">
                                    {m.t("workPipelines.connectedPipeline")}
                                    {binding.board_name}
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      {!m.options.data?.sources.some(
                        (s) => s.kind === kind,
                      ) && (
                        <p className="text-xs text-muted-foreground">
                          {m.t("workPipelines.noActiveSources")}
                        </p>
                      )}
                    </div>
                  ))}
                  {m.options.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      {l.error}
                    </p>
                  )}
                </>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  type="button"
                  className="rounded-full"
                  disabled={m.busy}
                  onClick={() => m.setBoardDraft(null)}
                >
                  {l.cancel}
                </Button>
                <Button
                  type="submit"
                  disabled={m.busy}
                  className="rounded-full"
                >
                  {m.busy ? l.loading : l.save}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!m.cardDraft}
        onOpenChange={(open) => {
          if (!open && !m.busy) m.setCardDraft(null);
        }}
      >
        <DialogContent
          closeLabel={m.t("common.close")}
          className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle>
              {b?.archived ? m.cardDraft?.document.title : m.cardDraft?.revision ? l.editRecord : l.addRecord}
            </DialogTitle>
          </DialogHeader>
          {m.cardDraft && b && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void m.saveCard();
              }}
              className="space-y-4"
            >
              {m.error && notice(m.error)}
              <fieldset disabled={b.archived || m.busy} className="min-w-0 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="record-name">{l.recordName}</Label>
                  <Input
                    id="record-name"
                    required
                    maxLength={200}
                    value={m.cardDraft.document.title}
                    onChange={(e) => m.cardEdit({ title: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0 space-y-2 sm:col-span-2">
                    <Label htmlFor="record-email">{l.email}</Label>
                    <Input
                      id="record-email"
                      type="email"
                      autoComplete="email"
                      value={m.cardDraft.document.email}
                      onChange={(e) => m.cardEdit({ email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="record-phone">{l.phone}</Label>
                    <PhoneInput
                      id="record-phone"
                      name="phone"
                      disabled={m.busy}
                      value={m.cardDraft.document.phone}
                      onChange={(phone) => m.cardEdit({ phone })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{l.stage}</Label>
                    <Select
                      value={m.cardDraft.document.stageId}
                      onValueChange={(stageId) => m.cardEdit({ stageId })}
                    >
                      <SelectTrigger aria-label={l.stage}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {b.stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{l.assignee}</Label>
                    <Select
                      value={
                        m.cardDraft.document.assigneeId
                          ? String(m.cardDraft.document.assigneeId)
                          : "none"
                      }
                      onValueChange={(v) =>
                        m.cardEdit({
                          assigneeId: v === "none" ? null : Number(v),
                        })
                      }
                    >
                      <SelectTrigger aria-label={l.assignee}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{l.none}</SelectItem>
                        {people.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="record-description">{l.description}</Label>
                  <Textarea
                    id="record-description"
                    rows={3}
                    value={m.cardDraft.document.description}
                    onChange={(e) => m.cardEdit({ description: e.target.value })}
                  />
                </div>
              </fieldset>
              {m.cardDraft.revision > 0 && (
                <WorkPipelineActivity
                  key={m.cardDraft.document.id}
                  row={m.cardDraft}
                  boardId={b.id}
                  lang={m.lang}
                  person={m.person}
                  busy={m.busy}
                  disabled={b.archived}
                  people={(m.options.data?.people ?? []).filter(
                    (p) => p.id === b.createdBy || b.memberIds.includes(p.id),
                  )}
                  save={m.saveActivity}
                />
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  disabled={m.busy}
                  onClick={() => m.setCardDraft(null)}
                >
                  {l.cancel}
                </Button>
                <Button
                  type="submit"
                  className="rounded-full"
                  disabled={m.busy || b.archived}
                >
                  {m.busy ? l.loading : l.save}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
