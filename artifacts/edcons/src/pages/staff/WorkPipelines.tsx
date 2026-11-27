import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Plus,
  Columns3,
  List,
  Settings2,
  GripVertical,
  Calendar,
  UserRound,
  Star,
  Search,
  ArrowUp,
  ArrowDown,
  X,
  MessageSquare,
  CheckSquare,
} from "lucide-react";
import { workPipelinesEn, workPipelinesTr } from "./workPipelinesCopy";
import "./workPipelines.css";

type Stage = {
  id: string;
  name: string;
  color: string;
  result: "open" | "won" | "closed";
};
type Source = { kind: "channel" | "embed" | "web"; key: string };
type Event = {
  id: string;
  at: string;
  by: number | null;
  action: string;
  text: string;
};
type Board = {
  id: string;
  name: string;
  description: string;
  stages: Stage[];
  memberIds: number[];
  sources: Source[];
  archived: boolean;
  createdBy: number;
  history: Event[];
};
type Card = {
  id: string;
  title: string;
  description: string;
  stageId: string;
  assigneeId: number | null;
  dueDate: string | null;
  priority: "low" | "normal" | "high";
  status: "active" | "waiting" | "done" | "cancelled";
  contactName: string;
  email: string;
  phone: string;
  tasks: { id: string; title: string; done: boolean }[];
  notes: Event[];
  history: Event[];
  source?: { kind: string; key: string; conversationId?: number };
};
type Row<T> = { document: T; revision: number };
const request = <T,>(url: string, method = "GET", body?: unknown) =>
  customFetch<T>(`/api/work-pipelines${url}`, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
const boardData = (b: Board) => ({
  name: b.name,
  description: b.description,
  stages: b.stages,
  memberIds: b.memberIds,
  sources: b.sources,
  archived: b.archived,
});
const cardData = (c: Card) => ({
  title: c.title,
  description: c.description,
  stageId: c.stageId,
  assigneeId: c.assigneeId,
  dueDate: c.dueDate,
  priority: c.priority,
  status: c.status,
  contactName: c.contactName,
  email: c.email,
  phone: c.phone,
  tasks: c.tasks,
});
const newStage = (name: string): Stage => ({
  id: crypto.randomUUID(),
  name,
  color: "#2563eb",
  result: "open",
});
export default function WorkPipelines() {
  const { lang } = useI18n(),
    { user } = useAuth();
  const l = lang === "tr" ? workPipelinesTr : workPipelinesEn;
  const qc = useQueryClient();
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("pipeline") || "",
  );
  const [view, setView] = useState<"board" | "table">("board"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [boardDraft, setBoardDraft] = useState<Row<Board> | null>(null),
    [cardDraft, setCardDraft] = useState<Row<Card> | null>(null),
    [note, setNote] = useState(""),
    [newTask, setNewTask] = useState("");
  const [pins, setPins] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`work-pipeline-pins:${user?.id}`) || "[]",
      );
    } catch {
      return [];
    }
  });
  const feature = useQuery({
    queryKey: ["work-pipeline-feature", user?.id],
    queryFn: () => request<{ enabled: boolean }>("/feature"),
    retry: false,
  });
  const options = useQuery({
    queryKey: ["work-pipeline-options", user?.id],
    queryFn: () =>
      request<{
        people: { id: number; name: string; role: string }[];
        sources: (Source & { label: string })[];
        canManage: boolean;
      }>("/options"),
    enabled: feature.data?.enabled === true,
  });
  const boards = useInfiniteQuery({
    queryKey: ["work-pipeline-boards", user?.id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      request<{ items: Row<Board>[]; nextOffset: number | null }>(
        `?offset=${pageParam}`,
      ),
    getNextPageParam: (p) => p.nextOffset ?? undefined,
    enabled: feature.data?.enabled === true,
  });
  const allBoards = boards.data?.pages.flatMap((p) => p.items) || [];
  const cards = useInfiniteQuery({
    queryKey: ["work-pipeline-cards", user?.id, selected, query],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      request<{
        board: Row<Board>;
        items: Row<Card>[];
        nextOffset: number | null;
      }>(
        `/${selected}/cards?offset=${pageParam}&q=${encodeURIComponent(query)}`,
      ),
    getNextPageParam: (p) => p.nextOffset ?? undefined,
    enabled: !!selected && feature.data?.enabled === true,
  });
  const current =
      cards.data?.pages[0]?.board ||
      allBoards.find((b) => b.document.id === selected),
    b = current?.document,
    rows = cards.data?.pages.flatMap((p) => p.items) || [];
  useEffect(() => {
    if (!selected && allBoards[0]) setSelected(allBoards[0].document.id);
  }, [allBoards.length, selected]);
  const choose = (id: string) => {
    setSelected(id);
    setQuery("");
    setError("");
    history.replaceState(null, "", `${location.pathname}?pipeline=${id}`);
  };
  const person = (id: number | null) =>
    options.data?.people.find((p) => p.id === id)?.name ||
    (id ? `#${id}` : l.none);
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["work-pipeline-boards"] }),
      qc.invalidateQueries({ queryKey: ["work-pipeline-cards"] }),
    ]);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || l.error);
    } finally {
      setBusy(false);
    }
  };
  const createBoard = () => {
    setError("");
    setBoardDraft({
      revision: 0,
      document: {
        id: "",
        name: "",
        description: "",
        stages: [
          newStage(lang === "tr" ? "Yeni" : "New"),
          newStage(lang === "tr" ? "İşlemde" : "In progress"),
          {
            ...newStage(lang === "tr" ? "Tamamlandı" : "Completed"),
            color: "#059669",
            result: "won",
          },
        ],
        memberIds: [],
        sources: [],
        archived: false,
        createdBy: user!.id,
        history: [],
      },
    });
  };
  const createCard = (stageId?: string) => {
    if (!b) return;
    setError("");
    setNote("");
    setNewTask("");
    setCardDraft({
      revision: 0,
      document: {
        id: "",
        title: "",
        description: "",
        stageId: stageId || b.stages[0].id,
        assigneeId: null,
        dueDate: null,
        priority: "normal",
        status: "active",
        contactName: "",
        email: "",
        phone: "",
        tasks: [],
        notes: [],
        history: [],
      },
    });
  };
  const editCard = (r: Row<Card>) => {
    setError("");
    setNote("");
    setNewTask("");
    setCardDraft(structuredClone(r));
  };
  const move = (r: Row<Card>, stageId: string) =>
    run(async () => {
      await request(`/${selected}/cards/${r.document.id}`, "PUT", {
        data: { ...cardData(r.document), stageId },
        revision: r.revision,
      });
      await refresh();
    });
  const saveBoard = () =>
    run(async () => {
      if (!boardDraft) return;
      const r = await request<Row<Board>>(
        boardDraft.revision ? `/${boardDraft.document.id}` : "",
        "" + (boardDraft.revision ? "PUT" : "POST"),
        { data: boardData(boardDraft.document), revision: boardDraft.revision },
      );
      setBoardDraft(null);
      choose(r.document.id);
      await refresh();
    });
  const saveCard = () =>
    run(async () => {
      if (!cardDraft) return;
      await request(
        `/${selected}/cards${cardDraft.revision ? `/${cardDraft.document.id}` : ""}`,
        cardDraft.revision ? "PUT" : "POST",
        {
          data: cardData(cardDraft.document),
          revision: cardDraft.revision,
          note,
        },
      );
      setCardDraft(null);
      await refresh();
    });
  const pin = (id: string) => {
    const next = pins.includes(id)
      ? pins.filter((p) => p !== id)
      : [...pins, id];
    setPins(next);
    localStorage.setItem(
      `work-pipeline-pins:${user?.id}`,
      JSON.stringify(next),
    );
  };
  const boardEdit = (patch: Partial<Board>) =>
    setBoardDraft((d) =>
      d ? { ...d, document: { ...d.document, ...patch } } : d,
    );
  const cardEdit = (patch: Partial<Card>) =>
    setCardDraft((d) =>
      d ? { ...d, document: { ...d.document, ...patch } } : d,
    );
  const errorBox = (message: string) => (
    <div role="alert" className="wp-error">
      {message}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError("");
          void refresh();
        }}
      >
        {l.retry}
      </Button>
    </div>
  );
  const events = (items: Event[]) =>
    items.length ? (
      <ol className="wp-history">
        {[...items].reverse().map((e) => (
          <li key={e.id}>
            <span>
              {person(e.by)} · {new Date(e.at).toLocaleString(lang)}
            </span>
            <p>
              {e.action === "note"
                ? e.text
                : (
                    {
                      created: l.created,
                      updated: l.updated,
                      captured: l.captured,
                      "note-added": l.noteAdded,
                      settings: l.settings,
                    } as Record<string, string>
                  )[e.action] || e.action}
              {e.action !== "note" && e.text ? ` · ${e.text}` : ""}
            </p>
          </li>
        ))}
      </ol>
    ) : (
      <p className="wp-muted">{l.noHistory}</p>
    );
  if (feature.isPending)
    return (
      <div className="wp-page" role="status">
        {l.loading}
      </div>
    );
  if (!feature.data?.enabled)
    return (
      <div className="wp-page">
        {feature.error ? errorBox(feature.error.message) : l.noPipelines}
      </div>
    );
  return (
    <div
      className="wp-page"
      dir={lang === "ar" || lang === "fa" ? "rtl" : "ltr"}
    >
      <header className="wp-header">
        <div>
          <p className="wp-eyebrow">WORKSPACE</p>
          <h1>{l.title}</h1>
          <p>{l.intro}</p>
        </div>
        {options.data?.canManage && (
          <Button onClick={createBoard}>
            <Plus size={16} />
            {l.create}
          </Button>
        )}
      </header>
      {(error || boards.error || cards.error || options.error) &&
        !boardDraft &&
        !cardDraft &&
        errorBox(
          error ||
            boards.error?.message ||
            cards.error?.message ||
            options.error?.message ||
            l.error,
        )}
      {boards.isPending ? (
        <p role="status">{l.loading}</p>
      ) : !allBoards.length ? (
        <section className="wp-empty">
          <Columns3 />
          <h2>{l.empty}</h2>
          <p>{l.emptyHelp}</p>
          {options.data?.canManage && (
            <Button onClick={createBoard}>{l.create}</Button>
          )}
        </section>
      ) : (
        <>
          <div className="wp-toolbar">
            <label className="wp-picker">
              <span className="sr-only">{l.all}</span>
              <select value={selected} onChange={(e) => choose(e.target.value)}>
                {allBoards.map((r) => (
                  <option key={r.document.id} value={r.document.id}>
                    {r.document.name}
                    {r.document.archived ? ` (${l.archive})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {boards.hasNextPage && (
              <Button
                variant="outline"
                onClick={() => void boards.fetchNextPage()}
              >
                {l.more}
              </Button>
            )}
            {b && (
              <Button
                variant="ghost"
                aria-label={l.pin}
                onClick={() => pin(b.id)}
              >
                <Star
                  fill={pins.includes(b.id) ? "currentColor" : "none"}
                  size={18}
                />
              </Button>
            )}
            <div className="wp-spacer" />
            <Button
              aria-pressed={view === "board"}
              variant={view === "board" ? "secondary" : "ghost"}
              onClick={() => setView("board")}
            >
              <Columns3 size={16} />
              {l.board}
            </Button>
            <Button
              aria-pressed={view === "table"}
              variant={view === "table" ? "secondary" : "ghost"}
              onClick={() => setView("table")}
            >
              <List size={16} />
              {l.table}
            </Button>
            {options.data?.canManage && current && (
              <Button
                variant="outline"
                aria-label={l.settings}
                onClick={() => {
                  setError("");
                  setBoardDraft(structuredClone(current));
                }}
              >
                <Settings2 size={16} />
              </Button>
            )}
          </div>
          {pins.length > 0 && (
            <nav aria-label={l.favorites} className="wp-tabs">
              {allBoards
                .filter((r) => pins.includes(r.document.id))
                .map((r) => (
                  <button
                    key={r.document.id}
                    aria-current={
                      r.document.id === selected ? "page" : undefined
                    }
                    onClick={() => choose(r.document.id)}
                  >
                    {r.document.name}
                  </button>
                ))}
            </nav>
          )}
          {b && (
            <>
              <div className="wp-board-heading">
                <div>
                  <h2>{b.name}</h2>
                  <p>{b.description}</p>
                </div>
                <div className="wp-search">
                  <Search size={16} />
                  <Input
                    aria-label={l.search}
                    placeholder={l.search}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <Button disabled={b.archived} onClick={() => createCard()}>
                  <Plus size={16} />
                  {l.card}
                </Button>
              </div>
              {b.archived && (
                <p role="status" className="wp-banner">
                  {l.archivedHelp}
                </p>
              )}
              {cards.isPending ? (
                <p role="status">{l.loading}</p>
              ) : view === "board" ? (
                <div className="wp-board">
                  {b.stages.map((stage) => {
                    const stageCards = rows.filter(
                      (r) => r.document.stageId === stage.id,
                    );
                    return (
                      <section
                        className="wp-column"
                        key={stage.id}
                        onDragOver={(e) => {
                          if (!b.archived) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (b.archived || busy) return;
                          const r = rows.find(
                            (r) =>
                              r.document.id ===
                              e.dataTransfer.getData("text/plain"),
                          );
                          if (r && r.document.stageId !== stage.id)
                            void move(r, stage.id);
                        }}
                        aria-label={stage.name}
                      >
                        <div className="wp-column-title">
                          <span style={{ background: stage.color }} />
                          <h3>{stage.name}</h3>
                          <b>{stageCards.length}</b>
                          <button
                            aria-label={`${l.card}: ${stage.name}`}
                            disabled={b.archived}
                            onClick={() => createCard(stage.id)}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                        <div className="wp-column-cards">
                          {stageCards.map((r) => (
                            <article
                              key={r.document.id}
                              draggable={!busy && !b.archived}
                              onDragStart={(e) =>
                                e.dataTransfer.setData(
                                  "text/plain",
                                  r.document.id,
                                )
                              }
                              className="wp-card"
                            >
                              <div className="wp-card-top">
                                <span
                                  className={`wp-priority wp-priority-${r.document.priority}`}
                                >
                                  {l[r.document.priority]}
                                </span>
                                <GripVertical size={14} />
                              </div>
                              <button
                                className="wp-card-title"
                                onClick={() => editCard(r)}
                              >
                                {r.document.title}
                              </button>
                              {r.document.contactName && (
                                <p className="wp-muted">
                                  {r.document.contactName}
                                </p>
                              )}
                              <div className="wp-card-meta">
                                <span>
                                  <UserRound size={13} />
                                  {person(r.document.assigneeId)}
                                </span>
                                {r.document.dueDate && (
                                  <span>
                                    <Calendar size={13} />
                                    {r.document.dueDate}
                                  </span>
                                )}
                              </div>
                              <div className="wp-card-footer">
                                <span>{l[r.document.status]}</span>
                                {r.document.tasks.length > 0 && (
                                  <span>
                                    <CheckSquare size={13} />
                                    {
                                      r.document.tasks.filter((t) => t.done)
                                        .length
                                    }
                                    /{r.document.tasks.length}
                                  </span>
                                )}
                                {r.document.source && (
                                  <span>{r.document.source.kind}</span>
                                )}
                              </div>
                              <label
                                className="sr-only"
                                htmlFor={`move-${r.document.id}`}
                              >
                                {l.move}
                              </label>
                              <select
                                id={`move-${r.document.id}`}
                                aria-label={`${l.move}: ${r.document.title}`}
                                className="wp-card-move"
                                value={stage.id}
                                disabled={busy || b.archived}
                                onChange={(e) => void move(r, e.target.value)}
                              >
                                {b.stages.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </article>
                          ))}
                          {!stageCards.length && (
                            <button
                              className="wp-drop-empty"
                              disabled={b.archived}
                              onClick={() => createCard(stage.id)}
                            >
                              {l.drop}
                            </button>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="wp-table-wrap">
                  <table className="wp-table">
                    <thead>
                      <tr>
                        {[
                          l.titleField,
                          l.stage,
                          l.assignee,
                          l.due,
                          l.status,
                          l.source,
                        ].map((v) => (
                          <th key={v}>{v}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.document.id}>
                          <td>
                            <button onClick={() => editCard(r)}>
                              {r.document.title}
                            </button>
                          </td>
                          <td>
                            <select
                              aria-label={`${l.move}: ${r.document.title}`}
                              disabled={busy || b.archived}
                              value={r.document.stageId}
                              onChange={(e) => void move(r, e.target.value)}
                            >
                              {b.stages.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>{person(r.document.assigneeId)}</td>
                          <td>{r.document.dueDate || "—"}</td>
                          <td>{l[r.document.status]}</td>
                          <td>{r.document.source?.kind || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!rows.length && <p className="wp-empty">{l.noCards}</p>}
                </div>
              )}
              {cards.hasNextPage && (
                <Button
                  className="mt-4"
                  variant="outline"
                  disabled={cards.isFetchingNextPage}
                  onClick={() => void cards.fetchNextPage()}
                >
                  {l.more}
                </Button>
              )}
            </>
          )}
        </>
      )}
      <Dialog
        open={!!boardDraft}
        onOpenChange={(open) => {
          if (!open && !busy) setBoardDraft(null);
        }}
      >
        <DialogContent className="wp-dialog">
          <DialogTitle>
            {boardDraft?.revision ? l.settings : l.create}
          </DialogTitle>
          {boardDraft && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveBoard();
              }}
              className="wp-form"
            >
              {error && errorBox(error)}
              <label>
                {l.name}
                <Input
                  required
                  maxLength={120}
                  value={boardDraft.document.name}
                  onChange={(e) => boardEdit({ name: e.target.value })}
                />
              </label>
              <label>
                {l.description}
                <Textarea
                  value={boardDraft.document.description}
                  onChange={(e) => boardEdit({ description: e.target.value })}
                />
              </label>
              <fieldset>
                <legend>{l.stages}</legend>
                {boardDraft.document.stages.map((s, i) => (
                  <div className="wp-stage-edit" key={s.id}>
                    <input
                      type="color"
                      aria-label={`${s.name} color`}
                      value={s.color}
                      onChange={(e) =>
                        boardEdit({
                          stages: boardDraft.document.stages.map((x) =>
                            x.id === s.id ? { ...x, color: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      aria-label={`${l.stage} ${i + 1}`}
                      required
                      value={s.name}
                      onChange={(e) =>
                        boardEdit({
                          stages: boardDraft.document.stages.map((x) =>
                            x.id === s.id ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <select
                      aria-label={`${s.name} result`}
                      value={s.result}
                      onChange={(e) =>
                        boardEdit({
                          stages: boardDraft.document.stages.map((x) =>
                            x.id === s.id
                              ? {
                                  ...x,
                                  result: e.target.value as Stage["result"],
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      {["open", "won", "closed"].map((v) => (
                        <option key={v} value={v}>
                          {l[v as "open"]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={l.up}
                      disabled={i === 0}
                      onClick={() => {
                        const a = [...boardDraft.document.stages];
                        [a[i - 1], a[i]] = [a[i], a[i - 1]];
                        boardEdit({ stages: a });
                      }}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={l.down}
                      disabled={i === boardDraft.document.stages.length - 1}
                      onClick={() => {
                        const a = [...boardDraft.document.stages];
                        [a[i + 1], a[i]] = [a[i], a[i + 1]];
                        boardEdit({ stages: a });
                      }}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={l.remove}
                      disabled={boardDraft.document.stages.length === 1}
                      onClick={() =>
                        boardEdit({
                          stages: boardDraft.document.stages.filter(
                            (x) => x.id !== s.id,
                          ),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    boardEdit({
                      stages: [
                        ...boardDraft.document.stages,
                        newStage(l.newStage),
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  {l.addStage}
                </Button>
              </fieldset>
              <fieldset>
                <legend>{l.team}</legend>
                <div className="wp-check-list">
                  {options.data?.people.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={boardDraft.document.memberIds.includes(p.id)}
                        onChange={(e) =>
                          boardEdit({
                            memberIds: e.target.checked
                              ? [...boardDraft.document.memberIds, p.id]
                              : boardDraft.document.memberIds.filter(
                                  (id) => id !== p.id,
                                ),
                          })
                        }
                      />
                      {p.name} <small>{p.role}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>{l.sources}</legend>
                <p className="wp-muted">{l.sourceHelp}</p>
                <div className="wp-check-list">
                  {options.data?.sources.map((s) => (
                    <label key={s.kind + s.key}>
                      <input
                        type="checkbox"
                        checked={boardDraft.document.sources.some(
                          (v) => v.kind === s.kind && v.key === s.key,
                        )}
                        onChange={(e) =>
                          boardEdit({
                            sources: e.target.checked
                              ? [
                                  ...boardDraft.document.sources,
                                  { kind: s.kind, key: s.key },
                                ]
                              : boardDraft.document.sources.filter(
                                  (v) => v.kind !== s.kind || v.key !== s.key,
                                ),
                          })
                        }
                      />
                      <span>
                        {s.label}
                        <small>{s.kind}</small>
                      </span>
                    </label>
                  ))}
                  {!options.data?.sources.length && <p>{l.noSources}</p>}
                </div>
              </fieldset>
              <label className="wp-inline">
                <input
                  type="checkbox"
                  checked={boardDraft.document.archived}
                  onChange={(e) => boardEdit({ archived: e.target.checked })}
                />
                {l.archive}
              </label>
              <footer>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBoardDraft(null)}
                  disabled={busy}
                >
                  {l.cancel}
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? l.loading : l.save}
                </Button>
              </footer>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!cardDraft}
        onOpenChange={(open) => {
          if (!open && !busy) setCardDraft(null);
        }}
      >
        <SheetContent className="wp-sheet">
          <SheetTitle>
            {cardDraft?.revision ? cardDraft.document.title : l.card}
          </SheetTitle>
          {cardDraft && b && (
            <form
              className="wp-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveCard();
              }}
            >
              {error && errorBox(error)}
              <fieldset disabled={busy || b.archived}>
                <label>
                  {l.titleField}
                  <Input
                    required
                    maxLength={200}
                    value={cardDraft.document.title}
                    onChange={(e) => cardEdit({ title: e.target.value })}
                  />
                </label>
                <label>
                  {l.description}
                  <Textarea
                    rows={4}
                    value={cardDraft.document.description}
                    onChange={(e) => cardEdit({ description: e.target.value })}
                  />
                </label>
                <div className="wp-form-grid">
                  <label>
                    {l.stage}
                    <select
                      value={cardDraft.document.stageId}
                      onChange={(e) => cardEdit({ stageId: e.target.value })}
                    >
                      {b.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {l.assignee}
                    <select
                      value={cardDraft.document.assigneeId || ""}
                      onChange={(e) =>
                        cardEdit({
                          assigneeId: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    >
                      <option value="">{l.none}</option>
                      {options.data?.people
                        .filter(
                          (p) =>
                            b.memberIds.includes(p.id) || p.id === b.createdBy,
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {l.due}
                    <Input
                      type="date"
                      value={cardDraft.document.dueDate || ""}
                      onChange={(e) =>
                        cardEdit({ dueDate: e.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    {l.priority}
                    <select
                      value={cardDraft.document.priority}
                      onChange={(e) =>
                        cardEdit({
                          priority: e.target.value as Card["priority"],
                        })
                      }
                    >
                      {["low", "normal", "high"].map((v) => (
                        <option key={v} value={v}>
                          {l[v as "low"]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {l.status}
                    <select
                      value={cardDraft.document.status}
                      onChange={(e) =>
                        cardEdit({ status: e.target.value as Card["status"] })
                      }
                    >
                      {["active", "waiting", "done", "cancelled"].map((v) => (
                        <option key={v} value={v}>
                          {l[v as "active"]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {l.contact}
                    <Input
                      value={cardDraft.document.contactName}
                      onChange={(e) =>
                        cardEdit({ contactName: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {l.email}
                    <Input
                      type="email"
                      value={cardDraft.document.email}
                      onChange={(e) => cardEdit({ email: e.target.value })}
                    />
                  </label>
                  <label>
                    {l.phone}
                    <Input
                      value={cardDraft.document.phone}
                      onChange={(e) => cardEdit({ phone: e.target.value })}
                    />
                  </label>
                </div>
                <h3>{l.tasks}</h3>
                {cardDraft.document.tasks.map((t) => (
                  <div className="wp-task" key={t.id}>
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={(e) =>
                        cardEdit({
                          tasks: cardDraft.document.tasks.map((x) =>
                            x.id === t.id
                              ? { ...x, done: e.target.checked }
                              : x,
                          ),
                        })
                      }
                    />
                    <span>{t.title}</span>
                    <button
                      type="button"
                      aria-label={l.remove}
                      onClick={() =>
                        cardEdit({
                          tasks: cardDraft.document.tasks.filter(
                            (x) => x.id !== t.id,
                          ),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <div className="wp-inline">
                  <Input
                    aria-label={l.addTask}
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!newTask.trim()}
                    onClick={() => {
                      cardEdit({
                        tasks: [
                          ...cardDraft.document.tasks,
                          {
                            id: crypto.randomUUID(),
                            title: newTask.trim(),
                            done: false,
                          },
                        ],
                      });
                      setNewTask("");
                    }}
                  >
                    {l.addTask}
                  </Button>
                </div>
                {cardDraft.revision > 0 && (
                  <>
                    <h3>{l.notes}</h3>
                    {events(cardDraft.document.notes)}
                    <Textarea
                      aria-label={l.newNote}
                      placeholder={l.newNote}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <p className="wp-muted">{l.noteSave}</p>
                  </>
                )}
              </fieldset>
              {cardDraft.document.source?.conversationId && (
                <a
                  className="wp-conversation-link"
                  href={`/staff/messages?conversation=${cardDraft.document.source.conversationId}`}
                >
                  <MessageSquare size={16} />
                  {l.inbox}
                </a>
              )}
              {cardDraft.revision > 0 && (
                <section>
                  <h3>{l.history}</h3>
                  {events(cardDraft.document.history)}
                </section>
              )}
              <footer>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setCardDraft(null)}
                >
                  {l.close}
                </Button>
                <Button type="submit" disabled={busy || b.archived}>
                  {busy ? l.loading : l.save}
                </Button>
              </footer>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
