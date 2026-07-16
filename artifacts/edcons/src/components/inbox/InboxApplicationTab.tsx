import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useCountrySearch } from "@/hooks/use-countries";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import type { InboxConversationDetailResponse } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Plus,
  GraduationCap,
  Trash2,
  UserPlus,
  Lock,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UniRow {
  id: number;
  name: string;
}

interface ProgRow {
  id: number;
  name: string;
  degree?: string | null;
}

interface AppRow {
  id: number;
  programName?: string | null;
  universityName?: string | null;
  country?: string | null;
  stage?: string | null;
  season?: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface InboxApplicationTabProps {
  detail: InboxConversationDetailResponse;
  conversationId: number;
  onUpdated?: () => void;
}

export function InboxApplicationTab({
  detail,
  onUpdated,
}: InboxApplicationTabProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── All hooks unconditional ───────────────────────────────────────────────
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedUniversityId, setSelectedUniversityId] = useState("");
  const [selectedUniversityName, setSelectedUniversityName] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedProgramName, setSelectedProgramName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Student from detail (may be null if not yet linked)
  const student = (detail as any).student as
    | { id: number; interestedLevel?: string | null; firstName?: string | null; lastName?: string | null }
    | null
    | undefined;
  const studentId = student?.id;

  // Countries — load all upfront (same pattern as LeadDetailSidebar line 190)
  const { data: countries = [] } = useCountrySearch("");

  // Universities — server-side, enabled when country selected
  const { data: uniData, isLoading: unisLoading } = useQuery<{ data: UniRow[] }>({
    queryKey: ["inbox-app-universities", selectedCountry],
    queryFn: () =>
      fetch(
        `${BASE_URL}/api/universities?country=${encodeURIComponent(selectedCountry)}&limit=100`,
        { credentials: "include" }
      ).then((r) => r.json()),
    enabled: !!selectedCountry,
    staleTime: 30_000,
  });

  // Programs — server-side, enabled when university selected
  const { data: progData, isLoading: progsLoading } = useQuery<{ data: ProgRow[] }>({
    queryKey: ["inbox-app-programs", selectedUniversityId],
    queryFn: () =>
      fetch(
        `${BASE_URL}/api/programs?universityId=${selectedUniversityId}&limit=100`,
        { credentials: "include" }
      ).then((r) => r.json()),
    enabled: !!selectedUniversityId,
    staleTime: 30_000,
  });

  // Existing applications for this student
  const { data: appsData, isLoading: appsLoading } = useQuery<{ data: AppRow[] }>({
    queryKey: ["inbox-student-apps", studentId],
    queryFn: () =>
      fetch(
        `${BASE_URL}/api/applications?studentId=${studentId}&limit=100`,
        { credentials: "include" }
      ).then((r) => r.json()),
    enabled: !!studentId,
    staleTime: 15_000,
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const universities: UniRow[] = uniData?.data ?? [];
  const programs: ProgRow[] = progData?.data ?? [];
  const apps: AppRow[] = appsData?.data ?? [];

  const countryOptions = countries.map((c) => ({ value: c.name, label: c.name }));
  const uniOptions = universities.map((u) => ({ value: String(u.id), label: u.name }));
  const progOptions = programs.map((p) => ({ value: String(p.id), label: p.name }));

  const level = student?.interestedLevel ?? "";
  const canAdd = !!selectedCountry && !!studentId && !submitting;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleCountryChange(v: string) {
    setSelectedCountry(v);
    setSelectedUniversityId("");
    setSelectedUniversityName("");
    setSelectedProgramId("");
    setSelectedProgramName("");
  }

  function handleUniversityChange(v: string) {
    const uni = universities.find((u) => String(u.id) === v);
    setSelectedUniversityId(v);
    setSelectedUniversityName(uni?.name ?? "");
    setSelectedProgramId("");
    setSelectedProgramName("");
  }

  function handleProgramChange(v: string) {
    const prog = programs.find((p) => String(p.id) === v);
    setSelectedProgramId(v);
    setSelectedProgramName(prog?.name ?? "");
  }

  async function handleAdd() {
    if (!studentId || !selectedCountry) return;
    setSubmitting(true);
    try {
      const season = String(new Date().getFullYear());
      await customFetch(`${BASE_URL}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          stage: "inquiry",
          season,
          country: selectedCountry || null,
          universityId: selectedUniversityId
            ? parseInt(selectedUniversityId, 10)
            : null,
          universityName: selectedUniversityName || null,
          programId: selectedProgramId
            ? parseInt(selectedProgramId, 10)
            : null,
          programName: selectedProgramName || null,
          level: level || null,
        }),
      });
      toast({ title: t("inbox.applicationTab.added") });
      await queryClient.invalidateQueries({
        queryKey: ["inbox-student-apps", studentId],
      });
      // Reset selectors
      setSelectedCountry("");
      setSelectedUniversityId("");
      setSelectedUniversityName("");
      setSelectedProgramId("");
      setSelectedProgramName("");
      onUpdated?.();
    } catch (err: any) {
      let msg = String(
        err?.data?.error ?? err?.body?.error ?? err?.message ?? ""
      );
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.missingFields)
          msg = `Missing fields: ${(parsed.missingFields as string[]).join(", ")}`;
        else if (parsed?.error) msg = parsed.error;
      } catch {
        /* not JSON */
      }
      toast({
        title: t("inbox.applicationTab.addFailed"),
        description: msg || undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(appId: number) {
    setDeletingId(appId);
    try {
      await customFetch(`${BASE_URL}/api/applications/${appId}`, {
        method: "DELETE",
      });
      await queryClient.invalidateQueries({
        queryKey: ["inbox-student-apps", studentId],
      });
      toast({ title: t("inbox.applicationTab.deleted") });
    } catch {
      toast({
        title: t("inbox.applicationTab.deleteFailed"),
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  // ── No-student guard (after all hooks) ───────────────────────────────────
  if (!student) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 text-center gap-3">
        <UserPlus className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">
          {t("inbox.applicationTab.noStudent")}
        </p>
        <p className="text-xs text-muted-foreground max-w-[200px]">
          {t("inbox.applicationTab.noStudentDesc")}
        </p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Form section ─────────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-3 border-b space-y-2.5 shrink-0">
        {/* Country */}
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
            {t("inbox.applicationTab.country")}
          </div>
          <SearchableSelect
            value={selectedCountry}
            onChange={handleCountryChange}
            options={countryOptions}
            placeholder={t("inbox.applicationTab.selectCountry")}
            searchPlaceholder={t("inbox.applicationTab.searchCountry")}
            clearable
          />
        </div>

        {/* University */}
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
            {t("inbox.applicationTab.university")}
          </div>
          {unisLoading && selectedCountry ? (
            <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/30 gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">…</span>
            </div>
          ) : (
            <SearchableSelect
              value={selectedUniversityId}
              onChange={handleUniversityChange}
              options={uniOptions}
              placeholder={
                !selectedCountry
                  ? t("inbox.applicationTab.selectCountryFirst")
                  : uniOptions.length === 0
                    ? t("inbox.applicationTab.noUniversities")
                    : t("inbox.applicationTab.selectUniversity")
              }
              searchPlaceholder={t("inbox.applicationTab.searchUniversity")}
              disabled={!selectedCountry || uniOptions.length === 0}
              clearable
            />
          )}
        </div>

        {/* Level — read-only, from student */}
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
            {t("inbox.applicationTab.level")}
            <Lock className="w-2.5 h-2.5 text-muted-foreground/60" />
          </div>
          <div className="h-10 px-3 flex items-center gap-2 rounded-md border border-input bg-muted/40 cursor-default">
            <span className="text-sm flex-1 truncate text-muted-foreground">
              {level || t("inbox.applicationTab.levelNotSet")}
            </span>
            <span className="text-[10px] text-muted-foreground/60 bg-muted rounded px-1.5 py-0.5 shrink-0">
              {t("inbox.applicationTab.levelAuto")}
            </span>
          </div>
        </div>

        {/* Program */}
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
            {t("inbox.applicationTab.program")}
          </div>
          {progsLoading && selectedUniversityId ? (
            <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/30 gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">…</span>
            </div>
          ) : (
            <SearchableSelect
              value={selectedProgramId}
              onChange={handleProgramChange}
              options={progOptions}
              placeholder={
                !selectedUniversityId
                  ? t("inbox.applicationTab.selectUniversityFirst")
                  : progOptions.length === 0
                    ? t("inbox.applicationTab.noPrograms")
                    : t("inbox.applicationTab.selectProgram")
              }
              searchPlaceholder={t("inbox.applicationTab.searchProgram")}
              disabled={!selectedUniversityId || progOptions.length === 0}
              clearable
            />
          )}
        </div>

        {/* Add button */}
        <Button
          className="w-full h-8 text-xs gap-1.5"
          onClick={() => {
            void handleAdd();
          }}
          disabled={!canAdd}
        >
          {submitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          {t("inbox.applicationTab.addBtn")}
        </Button>
      </div>

      {/* ── Applications list ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-3 space-y-2">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
          {t("inbox.applicationTab.applications")}
          {apps.length > 0 && (
            <span className="ms-1.5 text-[10px] bg-muted rounded-full px-1.5 py-0.5">
              {apps.length}
            </span>
          )}
        </div>

        {appsLoading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>…</span>
          </div>
        ) : apps.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">
            {t("inbox.applicationTab.noApps")}
          </p>
        ) : (
          apps.map((app) => (
            <div
              key={app.id}
              className="flex items-start gap-2 p-2.5 rounded-lg border bg-muted/20 group"
            >
              <GraduationCap className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate leading-tight">
                  {app.programName ??
                    app.universityName ??
                    t("inbox.applicationTab.unknownProgram")}
                </p>
                {(app.universityName || app.country) && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {[app.universityName, app.country]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {app.stage ?? "inquiry"}
                  {app.season ? ` · ${app.season}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleDelete(app.id);
                }}
                disabled={deletingId === app.id}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors mt-0.5 opacity-0 group-hover:opacity-100"
                aria-label="Delete"
              >
                {deletingId === app.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
