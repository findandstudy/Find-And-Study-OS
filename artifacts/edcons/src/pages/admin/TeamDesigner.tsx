import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  Building2,
  Check,
  ChevronRight,
  GripVertical,
  Link2,
  List,
  Loader2,
  Maximize2,
  Minus,
  Network,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/hooks/use-i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  getPersonaTeamPreviewMenuLink,
  PERSONA_TEAM_PREVIEW_PATH,
} from "@/lib/personaTeamPreviewNavigation";
import {
  addDesignerMember,
  updateDesignerMember,
  reparentDesignerMember,
  removeDesignerMember,
  getDesignerDescendantKeys,
  getDesignerParentOptions,
  layoutDesignerTeam,
  validateDesignerTeam,
  DESIGNER_NODE_WIDTH,
  DESIGNER_NODE_HEIGHT,
  type DesignerTeam,
  type DesignerMember,
  type DesignerPositions,
} from "@/lib/personaTeamDesigner";
import "./team-designer.css";

// A view-only design sandbox. No persistence, real personas, tool permissions,
// approval, provider, budget or execution APIs are imported by this page.
type Snapshot = { team: DesignerTeam; positions: DesignerPositions };
type Viewport = { x: number; y: number; scale: number };
type Gesture = {
  pointerId: number;
  key: string | null;
  x: number;
  y: number;
  before: Snapshot;
  viewport: Viewport;
  moved: boolean;
};
type Copy = (tr: string, en: string) => string;
const WIDTH = DESIGNER_NODE_WIDTH;
const HEIGHT = DESIGNER_NODE_HEIGHT;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

function MemberEditor({
  member,
  team,
  copy,
  onApply,
  onDelete,
  onConnect,
}: {
  member: DesignerMember;
  team: DesignerTeam;
  copy: Copy;
  onApply: (
    patch: Pick<DesignerMember, "name" | "purpose" | "output" | "parent">,
  ) => void;
  onDelete: () => void;
  onConnect: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [purpose, setPurpose] = useState(member.purpose);
  const [output, setOutput] = useState(member.output);
  const [parent, setParent] = useState(member.parent ?? "");
  useEffect(() => {
    setName(member.name);
    setPurpose(member.purpose);
    setOutput(member.output);
    setParent(member.parent ?? "");
  }, [member]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({
          name: name.trim(),
          purpose: purpose.trim(),
          output: output.trim(),
          parent: parent || null,
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="team-member-name">{copy("Ad", "Name")}</Label>
        <Input
          id="team-member-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-member-parent">
          {copy("Bağlı olduğu birim", "Reports to")}
        </Label>
        <select
          id="team-member-parent"
          className="team-designer-select"
          disabled={member.kind === "manager"}
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        >
          {member.kind === "manager" ? (
            <option value="">
              {copy("Takımın yöneticisi", "Team manager")}
            </option>
          ) : (
            getDesignerParentOptions(team, member.key).map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))
          )}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-member-purpose">
          {copy("Talimatlar", "Instructions")}
        </Label>
        <Textarea
          id="team-member-purpose"
          rows={4}
          maxLength={2000}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          {copy(
            "Bu üyenin ne yapmasını istediğinizi yazın.",
            "Describe what this member should do.",
          )}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-member-output">
          {copy("Beklenen çıktı", "Expected output")}
        </Label>
        <Textarea
          id="team-member-output"
          rows={3}
          maxLength={2000}
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          required
        />
      </div>
      <Button
        className="w-full"
        type="submit"
        disabled={!name.trim() || !purpose.trim() || !output.trim()}
      >
        <Check />
        {copy("Uygula", "Apply changes")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {copy(
          "Yalnız bu açık önizlemede uygulanır. Görev başlatmaz.",
          "Applies only to this open preview. Does not run tasks.",
        )}
      </p>
      {member.kind !== "manager" && (
        <div className="flex justify-between gap-2 border-t pt-3">
          <Button type="button" size="sm" variant="outline" onClick={onConnect}>
            <Link2 />
            {copy("Bağlantı değiştir", "Change connection")}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-destructive"
            onClick={onDelete}
            aria-label={copy("Üyeyi sil", "Delete member")}
            title={copy("Üyeyi sil", "Delete member")}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </form>
  );
}

export default function TeamDesigner() {
  const { lang, dir } = useI18n();
  const { user } = useAuth();
  const copy: Copy = (tr, en) => (lang === "tr" ? tr : en);
  const smallScreen = useIsMobile();
  const [compactInspector, setCompactInspector] = useState(
    () => window.innerWidth < 1100,
  );
  const mobile = smallScreen || compactInspector;
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1099px)");
    const update = () => setCompactInspector(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const current = useRef<Snapshot | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [loadState, setLoadState] = useState<
    "loading" | "error" | "denied" | "ready"
  >("loading");
  const [retry, setRetry] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [view, setView] = useState("tree");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [viewport, setViewport] = useState<Viewport>({
    x: 24,
    y: 24,
    scale: 1,
  });
  const viewportRef = useRef(viewport);
  const canvas = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const initiallyFitted = useRef(false);
  const allowed = Boolean(
    getPersonaTeamPreviewMenuLink(
      window.location.origin,
      user?.role ?? "",
      lang,
    ),
  );
  useEffect(() => {
    if (!past.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [past.length]);
  const replace = useCallback((next: Snapshot) => {
    current.current = next;
    setSnapshot(next);
  }, []);
  const moveViewport = (next: Viewport) => {
    viewportRef.current = next;
    setViewport(next);
  };

  useEffect(() => {
    const abort = new AbortController();
    setLoadState(allowed ? "loading" : "denied");
    setSnapshot(null);
    current.current = null;
    setPast([]);
    setFuture([]);
    initiallyFitted.current = false;
    if (!allowed) return () => abort.abort();
    const timeout = window.setTimeout(() => {
      abort.abort();
      setLoadState("error");
    }, 12_000);
    // Never use a browser auth cache as authority. This one fixed read is
    // protected by the existing canonical session guard on every request.
    void fetch(`${PERSONA_TEAM_PREVIEW_PATH}template.json`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: abort.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if ([401, 403, 404].includes(res.status)) {
          if (!abort.signal.aborted) setLoadState("denied");
          return;
        }
        if (
          !res.ok ||
          !res.headers.get("content-type")?.includes("application/json")
        )
          throw Error("PREVIEW_UNAVAILABLE");
        const team = validateDesignerTeam(await res.json());
        if (abort.signal.aborted) return;
        replace({ team, positions: layoutDesignerTeam(team) });
        setSelectedKey(team.members[0].key);
        setLoadState("ready");
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoadState("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      abort.abort();
    };
  }, [allowed, retry, user?.id, replace]);

  const fit = useCallback(() => {
    const state = current.current;
    const bounds = canvas.current?.getBoundingClientRect();
    if (!state || !bounds?.width || !bounds.height) return;
    const points = Object.values(state.positions);
    const left = Math.min(...points.map((p) => p.x)),
      top = Math.min(...points.map((p) => p.y));
    const width = Math.max(...points.map((p) => p.x + WIDTH)) - left;
    const height = Math.max(...points.map((p) => p.y + HEIGHT)) - top;
    const scale = clamp(
      Math.min((bounds.width - 64) / width, (bounds.height - 80) / height),
      0.2,
      1,
    );
    const next = {
      x: (bounds.width - width * scale) / 2 - left * scale,
      y: Math.max(24, (bounds.height - height * scale) / 2) - top * scale,
      scale,
    };
    viewportRef.current = next;
    setViewport(next);
  }, []);
  useEffect(() => {
    if (!snapshot || view !== "tree" || !canvas.current) return;
    const observer = new ResizeObserver(() => {
      if (!initiallyFitted.current) {
        fit();
        initiallyFitted.current = true;
      }
    });
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [Boolean(snapshot), view, fit]);

  const commit = (
    next: Snapshot,
    message?: string,
    previous = current.current,
  ) => {
    if (!previous) return;
    setPast((items) => [...items.slice(-29), previous]);
    setFuture([]);
    replace(next);
    setNotice(message ?? copy("Önizleme güncellendi.", "Preview updated."));
  };
  const apply = (operation: () => Snapshot, message?: string) => {
    try {
      commit(operation(), message);
    } catch {
      setNotice(
        copy(
          "Bu değişiklik uygulanamadı. Bir üye kendisine veya altındaki bir üyeye bağlanamaz; uzmanlar yönetici olamaz. Takım en fazla 20 üyeden oluşabilir.",
          "Cannot apply this change. Members cannot report to themselves or their descendants; specialists cannot be parents. A team can have up to 20 members.",
        ),
      );
    }
  };
  const undo = () => {
    if (!current.current || !past.length) return;
    const present = current.current;
    setFuture((items) => [present, ...items].slice(0, 30));
    replace(past[past.length - 1]);
    setPast((items) => items.slice(0, -1));
    setConnectingKey(null);
    setNotice(copy("Son değişiklik geri alındı.", "Last change undone."));
  };
  const redo = () => {
    if (!current.current || !future.length) return;
    const present = current.current;
    setPast((items) => [...items, present].slice(-30));
    replace(future[0]);
    setFuture((items) => items.slice(1));
    setConnectingKey(null);
    setNotice(copy("Değişiklik yeniden uygulandı.", "Change redone."));
  };
  const selected =
    snapshot?.team.members.find((member) => member.key === selectedKey) ??
    snapshot?.team.members[0];
  const kindLabel = (kind: DesignerMember["kind"]) =>
    kind === "manager"
      ? copy("Genel müdür", "General manager")
      : kind === "department"
        ? copy("Birim", "Department")
        : copy("Uzman", "Specialist");
  const iconFor = (kind: DesignerMember["kind"]) =>
    kind === "specialist"
      ? UserRound
      : kind === "department"
        ? Building2
        : Network;
  const connect = (key: string, parent: string) => {
    const state = current.current;
    if (!state) return;
    apply(
      () => ({
        ...state,
        team: reparentDesignerMember(state.team, key, parent),
      }),
      copy("Bağlantı güncellendi.", "Connection updated."),
    );
    setConnectingKey(null);
  };
  const choose = (key: string) => {
    if (connectingKey) {
      connect(connectingKey, key);
      return;
    }
    setSelectedKey(key);
    if (mobile) setSheetOpen(true);
  };
  const startConnect = (key: string) => {
    setConnectingKey(key);
    setSheetOpen(false);
    setNotice(
      copy(
        "Bağlanacak yönetici veya birim kartına tıklayın. İptal için Escape.",
        "Select the manager or department to report to. Press Escape to cancel.",
      ),
    );
  };
  const add = (kind: "department" | "specialist") => {
    const state = current.current;
    if (!state || !selected) return;
    const parent =
      selected.kind === "specialist" ? selected.parent! : selected.key;
    apply(
      () => {
        const team = addDesignerMember(state.team, kind, parent, {
          name:
            kind === "department"
              ? copy("Yeni birim", "New department")
              : copy("Yeni uzman", "New specialist"),
          purpose: copy(
            "Görev ve sorumlulukları buraya yazın.",
            "Describe responsibilities here.",
          ),
          output: copy(
            "Beklenen çıktıyı buraya yazın.",
            "Describe the expected output here.",
          ),
        });
        const added = team.members.find(
          (member) => !state.team.members.some((old) => old.key === member.key),
        )!;
        setSelectedKey(added.key);
        if (mobile) setSheetOpen(true);
        initiallyFitted.current = false;
        return { team, positions: layoutDesignerTeam(team) };
      },
      copy(
        "Üye eklendi. Ayrıntılarını düzenleyebilirsiniz.",
        "Member added. You can edit its details.",
      ),
    );
    requestAnimationFrame(fit);
  };
  const zoom = (factor: number) => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds) return;
    const old = viewportRef.current,
      scale = clamp(old.scale * factor, 0.2, 2);
    const x = bounds.width / 2,
      y = bounds.height / 2;
    moveViewport({
      scale,
      x: x - ((x - old.x) * scale) / old.scale,
      y: y - ((y - old.y) * scale) / old.scale,
    });
  };
  const start = (event: PointerEvent, key: string | null) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      gesture.current ||
      connectingKey ||
      !current.current
    )
      return;
    event.stopPropagation();
    gesture.current = {
      pointerId: event.pointerId,
      key,
      x: event.clientX,
      y: event.clientY,
      before: current.current,
      viewport: viewportRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (key) setSelectedKey(key);
  };
  const dropTarget = (event: PointerEvent, active: Gesture) => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds || !active.key) return null;
    const x =
      (event.clientX - bounds.left - viewportRef.current.x) /
      viewportRef.current.scale;
    const y =
      (event.clientY - bounds.top - viewportRef.current.y) /
      viewportRef.current.scale;
    return (
      active.before.team.members.find((member) => {
        const p = active.before.positions[member.key];
        return (
          member.key !== active.key &&
          x >= p.x &&
          x <= p.x + WIDTH &&
          y >= p.y &&
          y <= p.y + HEIGHT
        );
      })?.key ?? null
    );
  };
  const move = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x,
      dy = event.clientY - active.y;
    if (!active.moved && Math.hypot(dx, dy) < 5) return;
    active.moved = true;
    setDragging(true);
    if (!active.key) {
      moveViewport({
        ...active.viewport,
        x: active.viewport.x + dx,
        y: active.viewport.y + dy,
      });
    } else {
      const origin = active.before.positions[active.key];
      replace({
        ...active.before,
        positions: {
          ...active.before.positions,
          [active.key]: {
            x: clamp(origin.x + dx / active.viewport.scale, 0, 3800),
            y: clamp(origin.y + dy / active.viewport.scale, 0, 3800),
          },
        },
      });
      setDropKey(dropTarget(event, active));
    }
  };
  const end = (event: PointerEvent, cancel = false) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    setDropKey(null);
    if (cancel) {
      replace(active.before);
      moveViewport(active.viewport);
      return;
    }
    if (!active.key) return;
    if (!active.moved) {
      choose(active.key);
      return;
    }
    const target = dropTarget(event, active);
    let next = current.current!;
    if (target) {
      try {
        const team = reparentDesignerMember(
          active.before.team,
          active.key,
          target,
        );
        next = { team, positions: layoutDesignerTeam(team) };
      } catch {
        replace(active.before);
        setNotice(
          copy(
            "Bu bağlantı geçerli değil. Kart önceki yerine döndü.",
            "This connection is not valid. The card returned to its previous position.",
          ),
        );
        return;
      }
    }
    commit(
      next,
      target
        ? copy(
            "Kart yeni birime bağlandı.",
            "Card connected to its new parent.",
          )
        : copy(
            "Kartın konumu değişti; bağlantısı korundu.",
            "Card moved; its connection is unchanged.",
          ),
      active.before,
    );
  };
  const editor = selected && snapshot && (
    <MemberEditor
      key={selected.key}
      member={selected}
      team={snapshot.team}
      copy={copy}
      onApply={(patch) =>
        apply(() => {
          const state = current.current!;
          let team = updateDesignerMember(state.team, selected.key, {
            name: patch.name,
            purpose: patch.purpose,
            output: patch.output,
          });
          if (patch.parent !== selected.parent && patch.parent)
            team = reparentDesignerMember(team, selected.key, patch.parent);
          return { ...state, team };
        })
      }
      onDelete={() => setDeleteKey(selected.key)}
      onConnect={() => startConnect(selected.key)}
    />
  );

  if (!allowed || loadState === "denied")
    return (
      <Card data-testid="persona-team-preview-error" className="p-8 space-y-3">
        <ShieldCheck className="text-muted-foreground" />
        <h1 className="text-lg font-semibold">
          {copy("Önizleme kullanılamıyor", "Preview unavailable")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {copy(
            "Bu ekran yalnız staging ortamında, geçerli yönetici oturumuyla açılabilir. Yetki veya çalışma izni verilmez.",
            "This preview requires an active administrator session on staging. No access or execution permissions are granted.",
          )}
        </p>
      </Card>
    );
  if (loadState !== "ready" || !snapshot)
    return (
      <Card
        data-testid={
          loadState === "error"
            ? "persona-team-preview-error"
            : "persona-team-preview-loading"
        }
        className="p-8 space-y-4"
        role="status"
      >
        {loadState === "error" ? (
          <>
            <p>
              {copy(
                "Önizleme yüklenemedi. Tasarım alanı açılmadı.",
                "Could not load the preview. The editor has not been opened.",
              )}
            </p>
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              {copy("Tekrar dene", "Try again")}
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {copy("Takım hazırlanıyor…", "Loading team…")}
          </p>
        )}
      </Card>
    );

  const pendingDelete = snapshot.team.members.find((m) => m.key === deleteKey);
  return (
    <section
      className="team-designer space-y-4"
      data-testid="persona-team-preview"
      dir={dir}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setConnectingKey(null);
          setNotice("");
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          !(
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement ||
            event.target instanceof HTMLSelectElement
          )
        ) {
          if (event.key.toLowerCase() === "z") {
            event.preventDefault();
            event.shiftKey ? redo() : undo();
          }
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {copy("Takım Tasarımcısı", "Team Designer")}
            </h1>
            <Badge variant="secondary" className="font-normal">
              {copy("Önizleme", "Preview")}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy(
              "Birimleri ve uzmanları aynı çalışma alanında düzenleyin.",
              "Organize departments and specialists in one workspace.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => add("department")}
            disabled={snapshot.team.members.length >= 20}
          >
            <Building2 />
            <Plus className="h-3 w-3" />
            {copy("Yeni birim", "Add department")}
          </Button>
          <Button
            size="sm"
            onClick={() => add("specialist")}
            disabled={snapshot.team.members.length >= 20}
          >
            <Plus />
            {copy("Yeni uzman", "Add specialist")}
          </Button>
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {copy(
            "Yalnız tasarım önizlemesi. Değişiklikler bu ekran açıkken tutulur; ayrılınca veya yenileyince silinir. Gerçek veri girmeyin. Kayıt ve görev çalıştırma kapalı.",
            "Design preview only. Changes last while this screen is open and are lost on leaving or refreshing. Do not enter real data. Saving and task execution are disabled.",
          )}
        </span>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <Tabs value={view} onValueChange={setView}>
            <TabsList className="h-9">
              <TabsTrigger value="tree" className="gap-1.5">
                <Network className="h-4 w-4" />
                {copy("Organizasyon", "Organization")}
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-1.5">
                <List className="h-4 w-4" />
                {copy("Üyeler", "Members")}{" "}
                <span className="text-xs text-muted-foreground">
                  {snapshot.team.members.length}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1.5">
            <div className="relative w-36 sm:w-44">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 ps-8"
                maxLength={100}
                placeholder={copy("Üye bul…", "Find member…")}
                aria-label={copy("Üye bul", "Find member")}
              />
            </div>
            <Button
              data-testid="team-undo"
              size="icon"
              variant="ghost"
              disabled={!past.length}
              onClick={undo}
              title={copy("Geri al", "Undo")}
              aria-label={copy("Geri al", "Undo")}
            >
              <Undo2 />
            </Button>
            <Button
              data-testid="team-redo"
              size="icon"
              variant="ghost"
              disabled={!future.length}
              onClick={redo}
              title={copy("Yinele", "Redo")}
              aria-label={copy("Yinele", "Redo")}
            >
              <Redo2 />
            </Button>
          </div>
        </div>
        <div className="flex min-w-0">
          <div className="min-w-0 flex-1">
            {connectingKey && (
              <div className="flex items-center justify-between gap-2 border-b bg-primary/5 px-3 py-2 text-xs">
                <span>
                  {copy(
                    "Bağlanacak yönetici veya birime tıklayın.",
                    "Select the manager or department to report to.",
                  )}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setConnectingKey(null)}
                  aria-label={copy("Bağlamayı iptal et", "Cancel connection")}
                >
                  <X />
                </Button>
              </div>
            )}
            {view === "tree" ? (
              <div
                ref={canvas}
                data-testid="team-canvas"
                role="region"
                aria-label={copy(
                  "Takım organizasyon haritası",
                  "Team organization map",
                )}
                className={cn(
                  "team-designer-canvas",
                  dragging && "is-dragging",
                )}
                onPointerDown={(e) => {
                  if ((e.target as Element).closest("button")) return;
                  start(e, null);
                }}
                onPointerMove={move}
                onPointerUp={(e) => end(e)}
                onPointerCancel={(e) => end(e, true)}
                onLostPointerCapture={(e) => end(e, true)}
              >
                <div
                  className="team-designer-plane"
                  style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                  }}
                >
                  <svg
                    className="team-designer-lines"
                    width="4200"
                    height="4200"
                    aria-hidden="true"
                  >
                    {snapshot.team.members
                      .filter((member) => member.parent)
                      .map((member) => {
                        const a = snapshot.positions[member.parent!],
                          b = snapshot.positions[member.key];
                        if (!a || !b) return null;
                        const x1 = a.x + WIDTH / 2,
                          y1 = a.y + HEIGHT,
                          x2 = b.x + WIDTH / 2,
                          y2 = b.y;
                        return (
                          <path
                            key={member.key}
                            d={`M${x1},${y1} C${x1},${y1 + 45} ${x2},${y2 - 45} ${x2},${y2}`}
                            className={
                              member.key === selected?.key ? "selected" : ""
                            }
                          />
                        );
                      })}
                  </svg>
                  {snapshot.team.members.map((member) => {
                    const position = snapshot.positions[member.key],
                      Icon = iconFor(member.kind);
                    const highlighted =
                      Boolean(search) &&
                      member.name
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase());
                    return (
                      <div
                        key={member.key}
                        className="team-designer-node"
                        style={{
                          left: position.x,
                          top: position.y,
                          width: WIDTH,
                          height: HEIGHT,
                        }}
                      >
                        <button
                          type="button"
                          data-testid={`team-node-${member.key}`}
                          className={cn(
                            "team-designer-node-body",
                            selected?.key === member.key && "is-selected",
                            highlighted && "is-match",
                            dropKey === member.key && "is-drop-target",
                          )}
                          aria-label={`${member.name} · ${kindLabel(member.kind)}`}
                          aria-pressed={selected?.key === member.key}
                          onPointerDown={(e) => start(e, member.key)}
                          onClick={(e) => {
                            if (e.detail === 0 || connectingKey)
                              choose(member.key);
                          }}
                          onKeyDown={(e) => {
                            if (!e.key.startsWith("Arrow") || connectingKey)
                              return;
                            e.preventDefault();
                            const delta = e.shiftKey ? 40 : 10;
                            const x = clamp(
                              position.x +
                                (e.key === "ArrowRight"
                                  ? delta
                                  : e.key === "ArrowLeft"
                                    ? -delta
                                    : 0),
                              0,
                              3800,
                            );
                            const y = clamp(
                              position.y +
                                (e.key === "ArrowDown"
                                  ? delta
                                  : e.key === "ArrowUp"
                                    ? -delta
                                    : 0),
                              0,
                              3800,
                            );
                            commit({
                              ...snapshot,
                              positions: {
                                ...snapshot.positions,
                                [member.key]: { x, y },
                              },
                            });
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {kindLabel(member.kind)}
                            </span>
                            <GripVertical className="ms-auto h-3.5 w-3.5 text-muted-foreground/60" />
                          </span>
                          <span
                            className="mt-2 block truncate pe-5 text-sm font-semibold"
                            title={member.name}
                          >
                            {member.name}
                          </span>
                        </button>
                        {member.kind !== "manager" && (
                          <button
                            className="team-designer-connect"
                            type="button"
                            onClick={() => startConnect(member.key)}
                            aria-label={`${copy("Bağlantı değiştir", "Change connection")}: ${member.name}`}
                            title={copy(
                              "Bağlantı değiştir",
                              "Change connection",
                            )}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div
                  className="team-designer-map-tools"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Button
                    data-testid="team-zoom-out"
                    size="icon"
                    variant="ghost"
                    onClick={() => zoom(1 / 1.2)}
                    disabled={viewport.scale <= 0.2}
                    aria-label={copy("Uzaklaştır", "Zoom out")}
                    title={copy("Uzaklaştır", "Zoom out")}
                  >
                    <Minus />
                  </Button>
                  <span
                    data-testid="team-zoom-level"
                    className="min-w-10 text-center text-xs tabular-nums"
                  >
                    {Math.round(viewport.scale * 100)}%
                  </span>
                  <Button
                    data-testid="team-zoom-in"
                    size="icon"
                    variant="ghost"
                    onClick={() => zoom(1.2)}
                    disabled={viewport.scale >= 2}
                    aria-label={copy("Yakınlaştır", "Zoom in")}
                    title={copy("Yakınlaştır", "Zoom in")}
                  >
                    <Plus />
                  </Button>
                  <span className="mx-1 h-4 border-e" />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={fit}
                    aria-label={copy("Ekrana sığdır", "Fit to screen")}
                    title={copy("Ekrana sığdır", "Fit to screen")}
                  >
                    <Maximize2 />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      commit({
                        ...snapshot,
                        positions: layoutDesignerTeam(snapshot.team),
                      });
                      requestAnimationFrame(fit);
                    }}
                    aria-label={copy("Otomatik düzenle", "Auto arrange")}
                    title={copy("Otomatik düzenle", "Auto arrange")}
                  >
                    <RotateCcw />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="team-designer-list divide-y">
                {snapshot.team.members
                  .filter((member) =>
                    member.name
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                  )
                  .map((member) => {
                    const Icon = iconFor(member.kind),
                      parent = snapshot.team.members.find(
                        (m) => m.key === member.parent,
                      );
                    return (
                      <button
                        type="button"
                        key={member.key}
                        onClick={() => choose(member.key)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/50",
                          selected?.key === member.key && "bg-primary/5",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {member.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {kindLabel(member.kind)}
                            {parent ? ` · ${parent.name}` : ""}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                      </button>
                    );
                  })}
                {!snapshot.team.members.some((member) =>
                  member.name
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                ) && (
                  <p className="p-6 text-sm text-muted-foreground">
                    {copy("Eşleşen üye yok.", "No matching members.")}
                  </p>
                )}
              </div>
            )}
          </div>
          {!mobile && (
            <aside
              className="team-designer-inspector border-s bg-card p-4"
              aria-label={copy("Üye ayrıntıları", "Member details")}
            >
              <div className="mb-4 border-b pb-3">
                <p className="text-sm font-semibold">
                  {copy("Üye ayrıntıları", "Member details")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected ? kindLabel(selected.kind) : ""}
                </p>
              </div>
              {editor}
            </aside>
          )}
        </div>
        <div
          className="border-t px-3 py-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {notice ||
            copy(
              "Taşı: kartı sürükleyin · Bağla: birimin üzerine bırakın veya bağlantı simgesini kullanın · Kaydır: boş alanı tutun",
              "Move: drag a card · Connect: drop onto a parent or use the link icon · Pan: drag empty space",
            )}
        </div>
      </Card>
      {mobile && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side={dir === "rtl" ? "left" : "right"}
            className="w-[min(92vw,380px)] overflow-y-auto"
          >
            <SheetHeader className="mb-5">
              <SheetTitle>
                {copy("Üye ayrıntıları", "Member details")}
              </SheetTitle>
            </SheetHeader>
            {editor}
          </SheetContent>
        </Sheet>
      )}
      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setDeleteKey(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {copy(
                "Üye taslaktan çıkarılsın mı?",
                "Remove this member from the draft?",
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name} —{" "}
              {copy(
                "Bu üye ve altındaki üyeler kaldırılır. Geri al ile geri getirebilirsiniz.",
                "This member and its descendants will be removed. You can restore them with Undo.",
              )}{" "}
              {pendingDelete &&
              getDesignerDescendantKeys(snapshot.team, pendingDelete.key)
                .length > 1
                ? `(${getDesignerDescendantKeys(snapshot.team, pendingDelete.key).length - 1} ${copy("alt üye", "descendants")})`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy("Vazgeç", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (!pendingDelete) return;
                apply(
                  () => {
                    const team = removeDesignerMember(
                      snapshot.team,
                      pendingDelete.key,
                      { mode: "subtree" },
                    );
                    setSelectedKey(pendingDelete.parent);
                    setSheetOpen(false);
                    return { team, positions: layoutDesignerTeam(team) };
                  },
                  copy(
                    "Üye taslaktan çıkarıldı.",
                    "Member removed from draft.",
                  ),
                );
                setDeleteKey(null);
              }}
            >
              {copy("Taslaktan çıkar", "Remove from draft")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
