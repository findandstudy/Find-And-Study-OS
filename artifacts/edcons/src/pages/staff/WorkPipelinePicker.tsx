import { useI18n } from "@/hooks/use-i18n";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  parsePipelineFavorites,
  pipelineFavoritesKey,
} from "@/lib/pipelineFavorites";
import { request, type Board, type Row } from "./useWorkPipelines";

type Page = { items: Row<Board>[]; nextOffset: number | null };
export function WorkPipelinePicker({
  userId,
  selected,
  current,
  lang,
  choose,
  create,
}: {
  userId: number | undefined;
  selected: string;
  current?: Board;
  lang: string;
  choose: (id: string) => void;
  create?: () => void;
}) {
  const { t, isRTL } = useI18n();
  const storageKey = pipelineFavoritesKey(userId);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      return parsePipelineFavorites(localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null) {
        try {
          setFavoriteIds(
            parsePipelineFavorites(localStorage.getItem(storageKey)),
          );
        } catch {
          setFavoriteIds([]);
        }
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey]);
  const toggle = (id: string) => {
    setFavoriteIds((previous) => {
      const next = previous.includes(id)
        ? previous.filter((x) => x !== id)
        : previous.length < 100
          ? [...previous, id]
          : previous;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Preference still works for this session. */
      }
      return next;
    });
  };
  const favorites = useQuery({
    queryKey: ["work-pipeline-favorites", userId, favoriteIds.join(",")],
    queryFn: () => request<Page>(`?ids=${favoriteIds.join(",")}`),
    enabled: favoriteIds.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const all = useInfiniteQuery({
    queryKey: ["work-pipeline-picker", userId, debounced],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      request<Page>(`?offset=${pageParam}&q=${encodeURIComponent(debounced)}`),
    getNextPageParam: (p) => p.nextOffset ?? undefined,
    enabled: open,
    staleTime: 0,
  });
  const rows = all.data?.pages.flatMap((p) => p.items) ?? [];
  const pins = favoriteIds.flatMap(
    (id) =>
      favorites.data?.items.find((r) => r.document.id === id) ??
      rows.find((r) => r.document.id === id) ??
      (current?.id === id ? { document: current, revision: 0 } : []),
  );
  const pick = (id: string) => {
    choose(id);
    setOpen(false);
    setSearch("");
  };
  const starLabel = (name: string, pinned: boolean) =>
    `${name}: ${pinned ? t("workPipelines.removeFavorite") : t("workPipelines.addFavorite")}`;
  return (
    <div className="flex flex-1 min-w-0 items-center gap-2 flex-wrap">
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="rounded-full gap-2 min-w-0 max-w-full sm:max-w-80"
            aria-label={t("workPipelines.choosePipeline")}
          >
            <span className="truncate">
              {current?.name || t("workPipelines.choosePipeline")}
            </span>
            <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          dir={isRTL ? "rtl" : "ltr"}
          className="w-96 max-w-[calc(100vw-2rem)] p-2"
        >
          <div className="relative mb-2">
            <Search className="absolute start-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              autoFocus
              maxLength={120}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("workPipelines.searchPipelines")}
              placeholder={t("workPipelines.searchPipelinesText")}
              className="ps-9"
            />
          </div>
          <div
            className="max-h-80 overflow-y-auto space-y-1"
            aria-busy={all.isFetching}
          >
            {all.isPending ? (
              <p role="status" className="p-3 text-sm text-muted-foreground">
                {t("workPipelines.loading")}
              </p>
            ) : all.isError ? (
              <div role="alert" className="p-3">
                <p className="text-sm">
                  {t("workPipelines.pipelinesCouldNotBeLoaded")}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void all.refetch()}
                >
                  {t("workPipelines.retry")}
                </Button>
              </div>
            ) : !rows.length ? (
              <p className="p-3 text-sm text-muted-foreground">
                {t("workPipelines.noPipelinesFound")}
              </p>
            ) : (
              rows.map(({ document: b }) => {
                const pinned = favoriteIds.includes(b.id);
                return (
                  <div
                    key={b.id}
                    className={`flex items-center rounded-xl ${b.id === selected ? "bg-primary/10" : "hover:bg-muted"}`}
                  >
                    <button
                      type="button"
                      className="flex items-center flex-1 min-w-0 text-start gap-2 px-3 py-2.5 text-sm"
                      onClick={() => pick(b.id)}
                      aria-current={b.id === selected ? "page" : undefined}
                    >
                      <Check
                        className={`w-4 h-4 shrink-0 ${b.id === selected ? "text-primary" : "invisible"}`}
                      />
                      <span className="truncate">{b.name}</span>
                      {b.archived && (
                        <span className="text-xs text-muted-foreground">
                          {t("campaigns.tabs.archived")}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="p-2.5 shrink-0 rounded-lg hover:bg-primary/10 disabled:opacity-40"
                      onClick={() => toggle(b.id)}
                      aria-label={starLabel(b.name, pinned)}
                      aria-pressed={pinned}
                      disabled={!pinned && favoriteIds.length >= 100}
                    >
                      <Star
                        className={`w-4 h-4 ${pinned ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`}
                      />
                    </button>
                  </div>
                );
              })
            )}
            {all.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={all.isFetchingNextPage}
                onClick={() => void all.fetchNextPage()}
              >
                {t("workPipelines.showMore")}
              </Button>
            )}
          </div>
          {create && (
            <Button
              variant="ghost"
              className="w-full justify-start mt-2 border-t rounded-none"
              onClick={() => {
                setOpen(false);
                create();
              }}
            >
              <Plus className="w-4 h-4 me-2" />
              {t("workPipelines.create")}
            </Button>
          )}
        </PopoverContent>
      </Popover>
      {current && (
        <button
          type="button"
          className="p-2 rounded-full border hover:bg-muted"
          aria-label={starLabel(current.name, favoriteIds.includes(selected))}
          aria-pressed={favoriteIds.includes(selected)}
          onClick={() => toggle(selected)}
          disabled={
            !favoriteIds.includes(selected) && favoriteIds.length >= 100
          }
        >
          <Star
            className={`w-4 h-4 ${favoriteIds.includes(selected) ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`}
          />
        </button>
      )}
      {pins.length > 0 && (
        <nav
          aria-label={t("workPipelines.favoritePipelines")}
          className="flex items-center gap-2 overflow-x-auto min-w-0 flex-1 basis-full sm:basis-auto py-1"
        >
          {pins.map(({ document: b }) => (
            <button
              key={b.id}
              type="button"
              onClick={() => choose(b.id)}
              aria-current={b.id === selected ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm whitespace-nowrap ${b.id === selected ? "bg-primary text-primary-foreground" : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Star
                className={`w-3 h-3 ${b.id === selected ? "fill-current" : "fill-amber-400 text-amber-500"}`}
              />
              {b.name}
            </button>
          ))}
        </nav>
      )}
      {favorites.isError && (
        <button
          type="button"
          className="text-xs text-destructive"
          onClick={() => void favorites.refetch()}
        >
          {t("workPipelines.retryFavorites")}
        </button>
      )}
    </div>
  );
}
