/**
 * PortalSubmissionsTab.tsx — SUB-STEP G
 *
 * Portal submission tracking board.
 * GET  /api/portal-submissions  (with status/mode filters)
 * POST /api/portal-submissions/:id/retry
 * POST /api/portal-submissions/:id/cancel
 * POST /api/portal-submissions/:id/process       ← A4: manual process
 * POST /api/portal-submissions/process-queued    ← A4: drain all queued
 */

import { useState, useEffect, useCallback } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  RotateCcw, XCircle, Loader2, RefreshCw, ExternalLink,
  CheckCircle2, Clock, Play, AlertCircle, MinusCircle, SkipForward,
  PlayCircle, ListStart, Eye, Plus, Inbox, Layers, ArrowRight, Globe, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ManualSubmitDialog } from "@/components/admin/ManualSubmitDialog";
import {
  PortalEmptyState, PortalErrorState,
} from "@/components/admin/PortalTabStates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubmissionStatus =
  | "queued" | "running" | "submitted" | "already_exists"
  | "program_missing" | "failed" | "canceled" | "dry_run" | "program_full"
  | "exclusive_region";

type SubmissionMode = "dry" | "real";

interface SubmissionResultJson {
  adapterKey?: string;
  dryRun?: boolean;
  filledSlots?: string[];
  missingSlots?: string[];
  result?: {
    submitted?: boolean;
    alreadyExists?: boolean;
    programMissing?: boolean;
    /** Human-readable skip/failure detail from the adapter. */
    detail?: string;
  };
}

interface PortalSubmission {
  id: number;
  applicationId: number;
  studentId: number;
  universityKey: string;
  universityName: string;
  mode: SubmissionMode;
  status: SubmissionStatus;
  externalRef: string | null;
  error: string | null;
  resultJson: SubmissionResultJson | null;
  attempts: number;
  maxAttempts: number;
  enqueuedBy: number | null;
  createdAt: string;
  updatedAt: string;
  supersededByApplicationId: number | null;
  supersededFromApplicationId: number | null;
  meta: {
    fallbackStep?: string | null;
    fallbackSource?: string | null;
    sameUniversity?: boolean | null;
  } | null;
}

interface ListResponse {
  data: PortalSubmission[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<SubmissionStatus, {
  icon: React.ElementType;
  className: string;
}> = {
  queued:          { icon: Clock,       className: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400" },
  running:         { icon: Play,        className: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400" },
  submitted:       { icon: CheckCircle2, className: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400" },
  already_exists:  { icon: UserCheck, className: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400" },
  program_missing: { icon: SkipForward, className: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400" },
  failed:          { icon: AlertCircle, className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400" },
  canceled:        { icon: MinusCircle, className: "bg-muted text-muted-foreground" },
  dry_run:         { icon: Eye, className: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400" },
  program_full:    { icon: Layers, className: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400" },
  exclusive_region: { icon: Globe, className: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400" },
};

// Canonical status → i18n label key. SINGLE SOURCE shared by the row badge AND
// the status filter dropdown so the two can never drift.
const STATUS_LABEL_KEYS: Record<SubmissionStatus, string> = {
  queued:           "portalAutomation.submissions.statusPending",
  running:          "portalAutomation.submissions.statusRunning",
  submitted:        "portalAutomation.submissions.statusSubmitted",
  already_exists:   "portalAutomation.submissions.statusAlreadyRegistered",
  program_missing:  "portalAutomation.submissions.statusSkipped",
  failed:           "portalAutomation.submissions.statusFailed",
  canceled:         "portalAutomation.submissions.statusCanceled",
  dry_run:          "portalAutomation.submissions.statusDryRun",
  program_full:     "portalFallback.programFull",
  exclusive_region: "portalAutomation.submissions.statusExclusiveRegion",
};

// All canonical statuses in display order — drives the filter dropdown so any
// new enum value (added to STATUS_CONFIG) is covered automatically. No
// hardcoded subset: dropdown options and row badges share this source.
const ALL_STATUSES = Object.keys(STATUS_CONFIG) as SubmissionStatus[];

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ---------------------------------------------------------------------------
// Expandable error / detail text — truncates long messages with a toggle.
// ---------------------------------------------------------------------------

function ErrorDetail({
  text, prefix, tone = "error",
}: {
  text: string;
  prefix?: string;
  tone?: "error" | "warning";
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 80;
  const toneClass =
    tone === "warning"
      ? "text-orange-600 dark:text-orange-400"
      : "text-destructive";
  return (
    <span className="inline-flex max-w-full items-baseline gap-1">
      <span
        className={cn(
          toneClass,
          "break-words",
          !expanded && isLong && "inline-block max-w-[220px] truncate align-bottom",
        )}
      >
        {prefix ? `${prefix}: ` : ""}{text}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-[11px] text-muted-foreground underline hover:text-foreground"
        >
          {expanded
            ? t("portalAutomation.submissions.detailHide")
            : t("portalAutomation.submissions.detailShow")}
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Submission row
// ---------------------------------------------------------------------------

interface RowProps {
  sub: PortalSubmission;
  onRetry: (id: number) => Promise<void>;
  onCancel: (id: number) => void;
  onProcess: (id: number) => void;
  retryingId: number | null;
  cancelingId: number | null;
  processingId: number | null;
  processingAll: boolean;
}

function SubmissionRow({
  sub, onRetry, onCancel, onProcess,
  retryingId, cancelingId, processingId, processingAll,
}: RowProps) {
  const { t } = useI18n();
  const cfg = STATUS_CONFIG[sub.status];
  const Icon = cfg.icon;
  const isRetrying   = retryingId  === sub.id;
  const isCanceling  = cancelingId === sub.id;
  const isProcessing = processingId === sub.id;

  const canRetry   = sub.status === "failed" || sub.status === "canceled" || sub.status === "dry_run";
  const canCancel  = sub.status === "queued"  || sub.status === "running";
  const canProcess = sub.status === "queued";

  return (
    <Card className="rounded-xl">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          {/* Status + meta */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn("gap-1 text-xs py-0", cfg.className)}>
                <Icon className="w-3 h-3" />
                {t(STATUS_LABEL_KEYS[sub.status])}
              </Badge>
              <Badge variant={sub.mode === "real" ? "default" : "secondary"} className="text-xs py-0">
                {sub.mode === "real"
                  ? t("portalAutomation.submissions.modeReal")
                  : t("portalAutomation.submissions.modeDry")}
              </Badge>
              {sub.meta?.fallbackStep && (
                <Badge
                  variant="outline"
                  className="gap-1 text-xs py-0 border-purple-300 text-purple-700 dark:border-purple-800 dark:text-purple-300"
                >
                  <Layers className="w-3 h-3" />
                  {t(
                    sub.meta.fallbackSource === "rule"
                      ? "portalFallback.fallbackStepRule"
                      : "portalFallback.fallbackStepAuto",
                    { step: sub.meta.fallbackStep },
                  )}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground font-medium">
                {sub.universityName}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span>#{sub.applicationId}</span>
              {sub.supersededByApplicationId != null && (
                <>
                  <span>·</span>
                  <a
                    href={`${BASE_URL}/admin/applications/${sub.supersededByApplicationId}`}
                    className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    <ArrowRight className="w-3 h-3" />
                    {t("portalFallback.supersededTo", { id: sub.supersededByApplicationId })}
                  </a>
                </>
              )}
              {sub.supersededFromApplicationId != null && (
                <>
                  <span>·</span>
                  <a
                    href={`${BASE_URL}/admin/applications/${sub.supersededFromApplicationId}`}
                    className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    <Layers className="w-3 h-3" />
                    {t("portalFallback.supersededFrom", { id: sub.supersededFromApplicationId })}
                  </a>
                </>
              )}
              {sub.externalRef && (
                <>
                  <span>·</span>
                  <code className="bg-muted px-1 rounded text-[11px]">{sub.externalRef}</code>
                </>
              )}
              {sub.error && (
                <>
                  <span>·</span>
                  <ErrorDetail text={sub.error} />
                </>
              )}
              {sub.resultJson?.result?.detail && (
                <>
                  <span>·</span>
                  <ErrorDetail
                    text={sub.resultJson.result.detail}
                    prefix={t("portalAutomation.submissions.skipDetailLabel")}
                    tone="warning"
                  />
                </>
              )}
              {sub.resultJson?.missingSlots && sub.resultJson.missingSlots.length > 0 && (
                <>
                  <span>·</span>
                  <span className="text-destructive">
                    {t("portalAutomation.submissions.missingDocSlotsLabel")}: {sub.resultJson.missingSlots.join(", ")}
                  </span>
                </>
              )}
              <span>·</span>
              <span>{new Date(sub.createdAt).toLocaleString()}</span>
              <span>·</span>
              <span>{t("portalAutomation.submissions.attemptsLabel", { current: String(sub.attempts), max: String(sub.maxAttempts) })}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              asChild
            >
              <a href={`${BASE_URL}/staff/applications/${sub.applicationId}`} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3.5 h-3.5" />
                {t("portalAutomation.submissions.viewApplication")}
              </a>
            </Button>
            {canProcess && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-primary hover:text-primary"
                onClick={() => onProcess(sub.id)}
                disabled={isProcessing || processingAll || processingId !== null}
              >
                {isProcessing
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <PlayCircle className="w-3.5 h-3.5" />}
                {t("portalAutomation.submissions.processButton")}
              </Button>
            )}
            {canRetry && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => onRetry(sub.id)}
                disabled={isRetrying}
              >
                {isRetrying
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RotateCcw className="w-3.5 h-3.5" />}
                {t("portalAutomation.submissions.retryButton")}
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-destructive hover:text-destructive"
                onClick={() => onCancel(sub.id)}
                disabled={isCanceling}
              >
                {isCanceling
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <XCircle className="w-3.5 h-3.5" />}
                {t("portalAutomation.submissions.cancelButton")}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function PortalSubmissionsTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [subs, setSubs]       = useState<PortalSubmission[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage]       = useState(1);
  const limit                 = 20;

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [modeFilter, setModeFilter]     = useState<string>("all");
  const [retryingId,   setRetryingId]   = useState<number | null>(null);
  const [cancelingId,  setCancelingId]  = useState<number | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const [resetingStuck, setResetingStuck] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // Confirmation targets for destructive / live actions.
  const [confirmCancelId, setConfirmCancelId]   = useState<number | null>(null);
  const [confirmProcessId, setConfirmProcessId] = useState<number | null>(null);
  const [confirmProcessAll, setConfirmProcessAll] = useState(false);

  const load = useCallback(async (p: number, status: string, mode: string) => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (status !== "all") params.set("status", status);
      if (mode   !== "all") params.set("mode",   mode);
      const res = await customFetch<ListResponse>(`/api/portal-submissions?${params}`);
      setSubs(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      setLoadError(true);
      toast({ title: t("portalAutomation.submissions.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { load(page, statusFilter, modeFilter); }, [load, page, statusFilter, modeFilter]);

  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      await customFetch(`/api/portal-submissions/${id}/retry`, { method: "POST" });
      setSubs((prev) => prev.map((s) => s.id === id ? { ...s, status: "queued", error: null, attempts: 0 } : s));
      toast({ title: t("portalAutomation.submissions.retryQueued") });
    } catch {
      toast({ title: t("portalAutomation.submissions.retryError"), variant: "destructive" });
    } finally {
      setRetryingId(null);
    }
  };

  const handleCancel = async (id: number) => {
    setCancelingId(id);
    try {
      await customFetch(`/api/portal-submissions/${id}/cancel`, { method: "POST" });
      setSubs((prev) => prev.map((s) => s.id === id ? { ...s, status: "canceled" } : s));
      toast({ title: t("portalAutomation.submissions.cancelSuccess") });
    } catch {
      toast({ title: t("portalAutomation.submissions.cancelError"), variant: "destructive" });
    } finally {
      setCancelingId(null);
    }
  };

  const handleProcess = async (id: number) => {
    setProcessingId(id);
    try {
      interface ProcessResult {
        processed: number;
        results: { id: number; status: string; error?: string }[];
      }
      const data = await customFetch<ProcessResult>(
        `/api/portal-submissions/${id}/process`,
        { method: "POST" },
      );
      const requeued = data.results.find(r => r.status === "requeued");
      const failed = data.results.find(r => r.status === "failed");
      if (requeued) {
        toast({ title: t("portalAutomation.submissions.requeuedMessage") });
      } else if (failed) {
        toast({
          title: t("portalAutomation.submissions.processError"),
          description: failed.error ? failed.error.slice(0, 120) : undefined,
          variant: "destructive",
        });
      } else {
        toast({ title: t("portalAutomation.submissions.processSuccess") });
      }
      await load(page, statusFilter, modeFilter);
    } catch (err: unknown) {
      const body = err && typeof err === "object" && "error" in err
        ? (err as { error: string }).error
        : null;
      if (body === "ALREADY_RUNNING") {
        toast({ title: t("portalAutomation.submissions.alreadyRunning"), variant: "destructive" });
      } else {
        toast({ title: t("portalAutomation.submissions.processError"), variant: "destructive" });
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleProcessAll = async () => {
    setProcessingAll(true);
    try {
      interface ProcessAllResult {
        processed: number;
        results: { id: number; status: string; error?: string }[];
      }
      const data = await customFetch<ProcessAllResult>(
        "/api/portal-submissions/process-queued",
        { method: "POST" },
      );
      const failedCount   = data.results.filter(r => r.status === "failed").length;
      const requeuedCount = data.results.filter(r => r.status === "requeued").length;
      const firstErr = data.results.find(r => r.status === "failed")?.error;
      if (failedCount > 0) {
        toast({
          title: t("portalAutomation.submissions.processAllError"),
          description: firstErr ? firstErr.slice(0, 120) : `${failedCount} failed`,
          variant: "destructive",
        });
      } else if (requeuedCount > 0) {
        toast({ title: t("portalAutomation.submissions.requeuedMessage") });
      } else {
        toast({
          title: t("portalAutomation.submissions.processAllSuccess", { count: String(data.processed) }),
        });
      }
      await load(page, statusFilter, modeFilter);
    } catch (err: unknown) {
      const body = err && typeof err === "object" && "error" in err
        ? (err as { error: string }).error
        : null;
      if (body === "ALREADY_RUNNING") {
        toast({ title: t("portalAutomation.submissions.alreadyRunning"), variant: "destructive" });
      } else {
        toast({ title: t("portalAutomation.submissions.processAllError"), variant: "destructive" });
      }
    } finally {
      setProcessingAll(false);
      await load(page, statusFilter, modeFilter);
    }
  };

  const handleResetStuck = async () => {
    setResetingStuck(true);
    try {
      interface ResetResult { reset: number; ids: number[] }
      const data = await customFetch<ResetResult>(
        "/api/portal-submissions/reset-stuck",
        { method: "POST" },
      );
      if (data.reset > 0) {
        toast({ title: t("portalAutomation.submissions.resetStuckSuccess", { count: String(data.reset) }) });
      } else {
        toast({ title: t("portalAutomation.submissions.resetStuckNone") });
      }
      await load(page, statusFilter, modeFilter);
    } catch {
      toast({ title: t("portalAutomation.submissions.resetStuckError"), variant: "destructive" });
    } finally {
      setResetingStuck(false);
    }
  };

  const totalPages = Math.ceil(total / limit);
  const hasQueued  = subs.some((s) => s.status === "queued");
  const hasRunning = subs.some((s) => s.status === "running");

  return (
    <div className="space-y-4 py-2">
      {/* Filters + actions */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("portalAutomation.submissions.filterAll")}</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(STATUS_LABEL_KEYS[s])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={modeFilter} onValueChange={(v) => { setModeFilter(v); setPage(1); }}>
            <SelectTrigger className="w-32 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("portalAutomation.submissions.filterAll")}</SelectItem>
              <SelectItem value="dry">{t("portalAutomation.submissions.modeDry")}</SelectItem>
              <SelectItem value="real">{t("portalAutomation.submissions.modeReal")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setManualOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("portalAutomation.manualSubmit.newButton")}
          </Button>
          {hasRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50"
              onClick={handleResetStuck}
              disabled={resetingStuck || loading}
            >
              {resetingStuck
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RotateCcw className="w-3.5 h-3.5" />}
              {t("portalAutomation.submissions.resetStuckButton")}
            </Button>
          )}
          {hasQueued && (
            <Button
              variant="default"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setConfirmProcessAll(true)}
              disabled={processingAll || processingId !== null || loading}
            >
              {processingAll
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ListStart className="w-3.5 h-3.5" />}
              {t("portalAutomation.submissions.processAllButton")}
            </Button>
          )}
          <Button
            variant="outline" size="sm" className="h-9 gap-1.5"
            onClick={() => load(page, statusFilter, modeFilter)}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {t("portalAutomation.submissions.refreshButton")}
          </Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : loadError ? (
        <PortalErrorState onRetry={() => load(page, statusFilter, modeFilter)} retrying={loading} />
      ) : subs.length === 0 ? (
        <PortalEmptyState
          icon={Inbox}
          title={t("portalAutomation.submissions.emptyTitle")}
          description={t("portalAutomation.submissions.emptyDescription")}
          action={
            <Button size="sm" className="gap-1.5" onClick={() => setManualOpen(true)}>
              <Plus className="w-3.5 h-3.5" />
              {t("portalAutomation.manualSubmit.newButton")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {subs.map((sub) => (
            <SubmissionRow
              key={sub.id}
              sub={sub}
              onRetry={handleRetry}
              onCancel={(id) => setConfirmCancelId(id)}
              onProcess={(id) => setConfirmProcessId(id)}
              retryingId={retryingId}
              cancelingId={cancelingId}
              processingId={processingId}
              processingAll={processingAll}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            {t("common.previous")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline" size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            {t("common.next")}
          </Button>
        </div>
      )}

      <ManualSubmitDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onQueued={() => load(1, statusFilter, modeFilter)}
      />

      {/* Cancel confirmation */}
      <AlertDialog open={confirmCancelId !== null} onOpenChange={(o) => { if (!o) setConfirmCancelId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("portalAutomation.submissions.cancelConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("portalAutomation.submissions.cancelConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = confirmCancelId;
                setConfirmCancelId(null);
                if (id !== null) void handleCancel(id);
              }}
            >
              {t("portalAutomation.submissions.cancelButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Process single confirmation */}
      <AlertDialog open={confirmProcessId !== null} onOpenChange={(o) => { if (!o) setConfirmProcessId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("portalAutomation.submissions.processConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("portalAutomation.submissions.processConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = confirmProcessId;
                setConfirmProcessId(null);
                if (id !== null) void handleProcess(id);
              }}
            >
              {t("portalAutomation.submissions.confirmProcess")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Process all confirmation */}
      <AlertDialog open={confirmProcessAll} onOpenChange={setConfirmProcessAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("portalAutomation.submissions.processAllConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("portalAutomation.submissions.processAllConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmProcessAll(false);
                void handleProcessAll();
              }}
            >
              {t("portalAutomation.submissions.confirmProcess")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
