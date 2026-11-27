import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  pointerWithin,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Trophy,
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
function ContactCard({
  row,
  stage,
  m,
}: {
  row: Row<Card>;
  stage: Stage;
  m: Model;
}) {
  const c = row.document,
    { attributes, listeners, setNodeRef, transform, transition, isDragging } =
      useSortable({ id: c.id, disabled: m.busy || m.b?.archived });
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
      className={`rounded-xl border overflow-hidden mb-3 transition-shadow duration-200 ${isDragging ? "border-primary shadow-xl opacity-50 relative z-50" : color + " hover:shadow-md"}`}
    >
      <div
        {...attributes}
        {...listeners}
        className={`p-4 pb-2 ${m.b?.archived ? "cursor-default" : isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <div className="flex items-start gap-2 mb-2">
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
                    ? "Embed"
                    : "Web-to-lead"}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {c.email || c.phone || m.l.noContact}
        </p>
        {c.description && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2 whitespace-pre-line">
            {c.description}
          </p>
        )}
      </div>
      <div className="px-4 pb-3 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {m.b?.archived ? (
            <span className="text-xs text-muted-foreground">
              {m.person(c.assigneeId)}
            </span>
          ) : (
            <AssignPopover
              assignedUserName={people.find((p) => p.id === c.assigneeId)?.name}
              staffUsers={people}
              onAssign={(id) =>
                void m.run(async () => {
                  await request(`/${m.selected}/cards/${c.id}`, "PUT", {
                    data: { ...cardData(c), assigneeId: id },
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
}: {
  stage: Stage;
  rows: Row<Card>[];
  m: Model;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    disabled: m.busy || m.b?.archived,
  });
  const won = stage.result === "won",
    lost = stage.result === "closed";
  return (
    <div
      className={`w-72 flex flex-col max-h-full rounded-2xl border overflow-hidden ${won ? "bg-emerald-50/60 border-emerald-200/50 dark:bg-emerald-900/20 dark:border-emerald-700/30" : lost ? "bg-rose-50/60 border-rose-200/50 dark:bg-rose-900/20 dark:border-rose-700/30" : "bg-secondary/50 border-border/50"}`}
    >
      <div
        className={`p-4 border-b shrink-0 ${won ? "bg-emerald-100/80 border-emerald-200/70 dark:bg-emerald-900/40" : lost ? "bg-rose-100/80 border-rose-200/70 dark:bg-rose-900/40" : "bg-card/50 border-border/50"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {won ? (
              <Trophy className="w-4 h-4 text-emerald-500" />
            ) : lost ? (
              <XCircle className="w-4 h-4 text-rose-400" />
            ) : null}
            <h3 className="font-display font-bold">{stage.name}</h3>
          </div>
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border bg-background text-muted-foreground shadow-sm">
            {rows.length}
          </span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`p-3 flex-1 overflow-y-auto custom-scrollbar transition-colors ${isOver ? "bg-primary/5" : ""}`}
      >
        <SortableContext
          items={rows.map((r) => r.document.id)}
          strategy={verticalListSortingStrategy}
        >
          {rows.map((r) => (
            <ContactCard key={r.document.id} row={r} stage={stage} m={m} />
          ))}
          {!rows.length && (
            <div className="h-20 border-2 border-dashed border-border/50 rounded-xl flex items-center justify-center text-sm font-medium text-muted-foreground">
              {m.l.dropHere}
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

export default function WorkPipelines() {
  const m = useWorkPipelines(),
    { l, b } = m;
  const [settings, setSettings] = useState<
    "create" | "rename" | "stages" | "sources"
  >("create");
  const [assignment, setAssignment] = useState("all"),
    [stageFilter, setStageFilter] = useState("all"),
    [active, setActive] = useState<string | null>(null);
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const selectBoard = (id: string) => {
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
    setActive(null);
    if (!e.over || m.busy || b?.archived) return;
    const row = m.rows.find((r) => r.document.id === String(e.active.id));
    const target =
      b?.stages.find((s) => s.id === String(e.over!.id)) ||
      b?.stages.find(
        (s) =>
          s.id ===
          m.rows.find((r) => r.document.id === String(e.over!.id))?.document
            .stageId,
      );
    if (row && target && row.document.stageId !== target.id)
      void m.move(row, target.id);
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
  if (!m.feature.data?.enabled)
    return <p role="alert">{m.feature.error?.message || l.noPipelines}</p>;
  return (
    <div
      className="h-[calc(100vh-8rem)] flex flex-col"
      dir={m.lang === "ar" || m.lang === "fa" ? "rtl" : "ltr"}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">
            Pipelines
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{l.simpleIntro}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-64">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={l.search}
              aria-label={l.search}
              className="ps-9 bg-white dark:bg-black/20 border-border rounded-full"
              value={m.query}
              onChange={(e) => m.setQuery(e.target.value)}
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
                <Select value={stageFilter} onValueChange={setStageFilter}>
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
                <Select value={assignment} onValueChange={setAssignment}>
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
            className="rounded-full shadow-lg shadow-primary/20"
            disabled={!b || b.archived}
            onClick={() => m.createCard()}
          >
            <Plus className="w-4 h-4 me-2" />
            {l.addRecord}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <nav
          aria-label={l.title}
          className="flex-1 flex items-center gap-2 overflow-x-auto pb-1"
        >
          {m.allBoards.map((r) => (
            <button
              key={r.document.id}
              aria-current={r.document.id === m.selected ? "page" : undefined}
              onClick={() => selectBoard(r.document.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${r.document.id === m.selected ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              {r.document.name}
            </button>
          ))}
          {m.boards.hasNextPage && (
            <Button
              variant="ghost"
              onClick={() => void m.boards.fetchNextPage()}
            >
              {l.more}
            </Button>
          )}
          {m.options.data?.canManage && (
            <Button
              variant="outline"
              size="icon"
              className="rounded-full shrink-0"
              aria-label={l.create}
              title={l.create}
              onClick={() => openSettings("create")}
            >
              <Plus className="w-4 h-4" />
            </Button>
          )}
        </nav>
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
              {(["rename", "stages", "sources"] as const).map((kind) => (
                <button
                  key={kind}
                  className="w-full text-start px-3 py-2 rounded-md text-sm hover:bg-muted"
                  onClick={() => openSettings(kind)}
                >
                  {kind === "rename"
                    ? l.rename
                    : kind === "stages"
                      ? l.stages
                      : l.sources}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {error && !m.boardDraft && !m.cardDraft && notice(error)}
      {b?.archived && (
        <p className="text-sm text-muted-foreground mb-3">{l.archivedHelp}</p>
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
        <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
          <div className="flex gap-5 h-full min-w-max px-1">
            <DndContext
              sensors={sensors}
              collisionDetection={(args) => {
                const hits = pointerWithin(args);
                const column = hits.find((hit) =>
                  b.stages.some((s) => s.id === hit.id),
                );
                return column
                  ? [column]
                  : hits.length
                    ? hits
                    : closestCorners(args);
              }}
              onDragStart={(e) => setActive(String(e.active.id))}
              onDragEnd={dragEnd}
              onDragCancel={() => setActive(null)}
            >
              {b.stages
                .filter((s) => stageFilter === "all" || stageFilter === s.id)
                .map((s) => (
                  <StageColumn
                    key={s.id}
                    stage={s}
                    rows={rows.filter((r) => r.document.stageId === s.id)}
                    m={m}
                  />
                ))}
              <DragOverlay>
                {active && (
                  <div className="w-72 bg-card border border-primary rounded-xl shadow-2xl p-4 font-bold text-sm rotate-1">
                    {
                      m.rows.find((r) => r.document.id === active)?.document
                        .title
                    }
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border">
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
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
                  <TableRow key={r.document.id}>
                    <TableCell>
                      <button
                        className="font-medium text-primary hover:underline"
                        onClick={() => m.editCard(r)}
                      >
                        {r.document.title}
                      </button>
                    </TableCell>
                    <TableCell>{r.document.email || "—"}</TableCell>
                    <TableCell>{r.document.phone || "—"}</TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-1 rounded-full bg-secondary">
                        {
                          b.stages.find((s) => s.id === r.document.stageId)
                            ?.name
                        }
                      </span>
                    </TableCell>
                    <TableCell>{r.document.source?.kind || "—"}</TableCell>
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
      <Dialog
        open={!!m.boardDraft}
        onOpenChange={(open) => {
          if (!open && !m.busy) m.setBoardDraft(null);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {settings === "create"
                ? l.create
                : settings === "rename"
                  ? l.rename
                  : settings === "stages"
                    ? l.stages
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
              {settings === "stages" && (
                <>
                  <div className="space-y-3">
                    {m.boardDraft.document.stages.map((s, i) => (
                      <div className="flex items-center gap-2" key={s.id}>
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
                      </div>
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
                  <p className="text-xs text-muted-foreground">
                    {l.simpleSourceHelp}
                  </p>
                  <div className="space-y-3">
                    {m.options.data?.sources.map((s) => (
                      <label
                        key={s.kind + s.key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
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
                                    (x) => x.kind !== s.kind || x.key !== s.key,
                                  ),
                            })
                          }
                        />
                        {s.label}
                      </label>
                    ))}
                    {!m.options.data?.sources.length && (
                      <p className="text-sm text-muted-foreground">
                        {l.noSources}
                      </p>
                    )}
                  </div>
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
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {m.cardDraft?.revision ? l.editRecord : l.addRecord}
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="record-email">{l.email}</Label>
                  <Input
                    id="record-email"
                    type="email"
                    value={m.cardDraft.document.email}
                    onChange={(e) => m.cardEdit({ email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="record-phone">{l.phone}</Label>
                  <Input
                    id="record-phone"
                    value={m.cardDraft.document.phone}
                    onChange={(e) => m.cardEdit({ phone: e.target.value })}
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
              {m.cardDraft.revision > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">
                    {l.notes} / {l.history}
                  </summary>
                  <div className="space-y-3 mt-3">
                    {[
                      ...m.cardDraft.document.notes,
                      ...m.cardDraft.document.history,
                    ]
                      .sort((a, b) => b.at.localeCompare(a.at))
                      .map((e) => (
                        <div key={e.id} className="text-xs border-s-2 ps-3">
                          <p className="text-muted-foreground">
                            {m.person(e.by)} ·{" "}
                            {new Date(e.at).toLocaleString(m.lang)}
                          </p>
                          <p className="whitespace-pre-line">
                            {e.action === "note"
                              ? e.text
                              : e.action === "captured"
                                ? l.captured
                                : e.action === "created"
                                  ? l.created
                                  : l.updated}
                            {e.action !== "note" && e.text
                              ? ` · ${e.text}`
                              : ""}
                          </p>
                        </div>
                      ))}
                    <Textarea
                      placeholder={l.newNote}
                      aria-label={l.newNote}
                      rows={2}
                      value={m.note}
                      onChange={(e) => m.setNote(e.target.value)}
                    />
                  </div>
                </details>
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
