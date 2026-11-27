import { useLocation } from "wouter";
import { subscribeToNavigation } from "@/lib/navigation";
import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useAuth } from "@/hooks/use-auth";
import { workPipelinesEn, workPipelinesTr } from "./workPipelinesCopy";
export type Stage = {
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
export type Board = {
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
export type FollowUp = {
  id: string;
  title: string;
  notes: string;
  scheduledAt: string;
  assigneeId: number;
  completed: boolean;
  createdBy: number;
  remindedAt: string | null;
};
export type Card = {
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
  followUps?: FollowUp[];
  notes: Event[];
  history: Event[];
  source?: { kind: string; key: string; conversationId?: number };
};
export type Row<T> = { document: T; revision: number };
export const request = <T>(url: string, method = "GET", body?: unknown) =>
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
export const cardData = (c: Card) => ({
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
export function useWorkPipelines() {
  const { lang } = useI18n(),
    { user } = useAuth();
  const l = lang === "tr" ? workPipelinesTr : workPipelinesEn;
  const qc = useQueryClient();
  const [route] = useLocation();
  const [urlSearch, setUrlSearch] = useState(location.search);
  useEffect(() => {
    const sync = () => setUrlSearch(location.search);
    const off = subscribeToNavigation(sync);
    window.addEventListener("popstate", sync);
    return () => {
      off();
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const linkParams = new URLSearchParams(
    route.includes("?") ? route.slice(route.indexOf("?")) : urlSearch,
  );
  const linkedBoard = linkParams.get("pipeline");
  const linkedCard = linkParams.get("card");
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("pipeline") || "",
  );
  useEffect(() => {
    if (linkedBoard && linkedBoard !== selected) {
      setSelected(linkedBoard);
      setCardDraft(null);
      setQuery("");
    }
  }, [linkedBoard, selected]);
  const [view, setView] = useState<"board" | "table">(() =>
      localStorage.getItem("work-pipeline-view") === "table"
        ? "table"
        : "board",
    ),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [boardDraft, setBoardDraft] = useState<Row<Board> | null>(null),
    [cardDraft, setCardDraft] = useState<Row<Card> | null>(null),
    [note, setNote] = useState("");
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
        bindings?: {
          kind: string;
          source_key: string;
          board_id: string;
          board_name: string;
        }[];
        canManage: boolean;
      }>("/options"),
    enabled: feature.data?.enabled === true,
    refetchOnWindowFocus: true,
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
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    // Switching boards must never display/export the previous board's data.
    placeholderData: undefined,
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
  useEffect(() => {
    localStorage.setItem("work-pipeline-view", view);
  }, [view]);
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
      qc.invalidateQueries({ queryKey: ["work-pipeline-options"] }),
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
  const saveActivity = async (activity: unknown) => {
    if (!cardDraft || busy) return false;
    setBusy(true);
    setError("");
    try {
      const result = await request<Row<Card>>(
        "/" + selected + "/cards/" + cardDraft.document.id + "/activity",
        "POST",
        { revision: cardDraft.revision, activity },
      );
      setCardDraft({
        ...result,
        document: { ...result.document, ...cardData(cardDraft.document) },
      });
      await refresh();
      await qc.invalidateQueries({ queryKey: ["work-pipeline-dashboard"] });
      await qc.invalidateQueries({ queryKey: ["notification-section-counts"] });
      return true;
    } catch (e: any) {
      setError(e.message || l.error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const openedLink = useRef("");
  useEffect(() => {
    const id = linkedCard;
    if (
      !id ||
      !b ||
      (linkedBoard && linkedBoard !== selected) ||
      openedLink.current === selected + id
    )
      return;
    openedLink.current = selected + id;
    let disposed = false;
    request<Row<Card>>("/" + selected + "/cards/" + encodeURIComponent(id))
      .then((r) => {
        if (!disposed) setCardDraft(r);
      })
      .catch((e) => {
        if (!disposed) setError(e.message || l.error);
      });
    return () => {
      disposed = true;
      openedLink.current = "";
    };
  }, [selected, b?.id, linkedBoard, linkedCard]);
  const boardEdit = (patch: Partial<Board>) =>
    setBoardDraft((d) =>
      d ? { ...d, document: { ...d.document, ...patch } } : d,
    );
  const cardEdit = (patch: Partial<Card>) =>
    setCardDraft((d) =>
      d ? { ...d, document: { ...d.document, ...patch } } : d,
    );

  return {
    lang,
    user,
    l,
    selected,
    choose,
    view,
    setView,
    query,
    setQuery,
    error,
    setError,
    busy,
    boardDraft,
    setBoardDraft,
    cardDraft,
    setCardDraft,
    note,
    setNote,
    feature,
    options,
    boards,
    allBoards,
    cards,
    current,
    b,
    rows,
    person,
    refresh,
    run,
    createBoard,
    createCard,
    editCard,
    move,
    saveBoard,
    saveCard,
    saveActivity,
    boardEdit,
    cardEdit,
  };
}
