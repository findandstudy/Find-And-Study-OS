/**
 * PortalMembersDialog.tsx — Phase 3 multi-portal MEMBERSHIP
 *
 * Manages the member universities of a multi-portal account, sourced directly
 * from the FAS-OS catalog (universities table) keyed by catalog id. Replaces the
 * Phase 2 universityKey-based MultiPortalMembersDialog.
 *
 *  - Loads current members:  GET  /portal-automation/accounts/:key/members
 *  - Searches the catalog:   GET  /portal-automation/catalog-universities?q=
 *  - Saves the member set:   PUT  /portal-automation/accounts/:key/members
 *
 * A catalog university already owned by a DIFFERENT account → 409 ALREADY_ASSIGNED.
 * The user is then asked to confirm a force-move (retry with force=true).
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { Network, Plus, Check, X, Loader2 } from "lucide-react";

interface PortalAccount {
  universityKey: string;
  universityName: string;
}

interface CatalogUniversity {
  id: number;
  name: string;
  country: string;
}

interface MemberRow {
  catalogUniversityId: number;
  enabled: boolean;
  universityName: string;
  country: string;
}

interface MembersResponse {
  portalKey: string;
  members: MemberRow[];
}

interface PortalMembersDialogProps {
  /** The multi-portal account whose members are managed (null = closed). */
  portal: PortalAccount | null;
  onClose: () => void;
  onSaved: () => void;
}

export function PortalMembersDialog({ portal, onClose, onSaved }: PortalMembersDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  // Selected catalog ids → display label, so chips render without re-fetching.
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogUniversity[]>([]);
  const [searching, setSearching] = useState(false);

  // 409 force-move confirmation state.
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Load current members whenever a portal is opened.
  useEffect(() => {
    if (!portal) return;
    let cancelled = false;
    setLoading(true);
    setSelected(new Map());
    setQuery("");
    setResults([]);
    (async () => {
      try {
        const res = await customFetch<MembersResponse>(
          `/api/portal-automation/accounts/${encodeURIComponent(portal.universityKey)}/members`,
        );
        if (!cancelled) {
          setSelected(
            new Map(res.members.map((m) => [m.catalogUniversityId, m.universityName])),
          );
        }
      } catch {
        if (!cancelled) {
          toast({ title: t("portalAutomation.members.loadError"), variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [portal, t, toast]);

  // Debounced catalog search.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!portal) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      let cancelled = false;
      setSearching(true);
      (async () => {
        try {
          const params = new URLSearchParams({ pageSize: "20" });
          if (query.trim()) params.set("q", query.trim());
          const res = await customFetch<{ data: CatalogUniversity[] }>(
            `/api/portal-automation/catalog-universities?${params.toString()}`,
          );
          if (!cancelled) setResults(res.data);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
      return () => { cancelled = true; };
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, portal]);

  const toggle = (uni: CatalogUniversity) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(uni.id)) next.delete(uni.id);
      else next.set(uni.id, uni.name);
      return next;
    });
  };

  const removeMember = (id: number) => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const persist = async (force: boolean): Promise<void> => {
    if (!portal) return;
    setSaving(true);
    try {
      await customFetch<MembersResponse>(
        `/api/portal-automation/accounts/${encodeURIComponent(portal.universityKey)}/members`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            catalogUniversityIds: Array.from(selected.keys()),
            force,
          }),
        },
      );
      toast({ title: t("portalAutomation.members.saveSuccess") });
      setConflictMessage(null);
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // A selected school belongs to another account — ask to force-move.
        const data = err.data as { message?: string } | null;
        setConflictMessage(data?.message ?? t("portalAutomation.members.conflictBody"));
        return;
      }
      toast({ title: t("portalAutomation.members.saveError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const selectedList = useMemo(
    () => Array.from(selected.entries()).map(([id, name]) => ({ id, name })),
    [selected],
  );

  return (
    <>
      <Dialog open={!!portal} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="w-4 h-4" />
              {t("portalAutomation.members.title")}
              {portal && (
                <span className="text-sm font-normal text-muted-foreground">
                  — {portal.universityName}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              {t("portalAutomation.members.description")}
            </p>

            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-md" />)}
              </div>
            ) : (
              <>
                {/* Catalog multi-select (server-side search) */}
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {t("portalAutomation.members.addMembers")}
                      <Plus className="w-4 h-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder={t("portalAutomation.members.searchPlaceholder")}
                        value={query}
                        onValueChange={setQuery}
                      />
                      <CommandList>
                        {searching ? (
                          <div className="py-4 flex justify-center">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <CommandEmpty>{t("portalAutomation.members.noCandidates")}</CommandEmpty>
                        )}
                        <CommandGroup>
                          {results.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={String(c.id)}
                              onSelect={() => toggle(c)}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${selected.has(c.id) ? "opacity-100" : "opacity-0"}`}
                              />
                              <span className="font-medium">{c.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {c.country}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {/* Selected members */}
                <div className="min-h-[60px] rounded-lg border p-2">
                  {selectedList.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">
                      {t("portalAutomation.members.noMembers")}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedList.map((m) => (
                        <Badge key={m.id} variant="secondary" className="gap-1 pr-1">
                          {m.name}
                          <button
                            type="button"
                            onClick={() => removeMember(m.id)}
                            className="ml-0.5 rounded-sm hover:bg-muted-foreground/20"
                            aria-label={t("common.remove")}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => persist(false)} disabled={saving || loading}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {saving
                ? t("portalAutomation.members.saving")
                : t("portalAutomation.members.saveButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 409 force-move confirmation */}
      <AlertDialog
        open={conflictMessage !== null}
        onOpenChange={(o) => { if (!o) setConflictMessage(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("portalAutomation.members.conflictTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{conflictMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => persist(true)} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("portalAutomation.members.forceMove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
