import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  type PortalOperationsResponse,
} from "@workspace/api-client-react";
import { ADMIN_ROLES } from "@workspace/roles";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import type { OperationsQueueItem } from "@/lib/operationsQueue";
import {
  addDaysToDueDate,
  canActOnTask,
  taskIdFromQueueRow,
  type OperationsTaskAction,
} from "@/lib/operationsWorkActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileWarning,
  GraduationCap,
  Inbox,
  Link2,
  ListChecks,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";

type ApplicationPipelineSummary = {
  meta: {
    stages?: Array<{ stage: string; total: number }>;
  };
};

type Document = {
  id: number;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  applicationId?: number | null;
  studentId?: number | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

type Stage = {
  key: string;
  label: string;
  sortOrder: number;
  isCaseClose: boolean;
};

type OfferDeadline = {
  docId: number;
  applicationId: number;
  universityName?: string | null;
  programName?: string | null;
  studentFirstName?: string | null;
  studentLastName?: string | null;
  validUntil?: string | null;
  daysLeft?: number | null;
};

type Integration = {
  id: number;
  key: string;
  name: string;
  category: string;
  isEnabled: boolean;
  updatedAt?: string | null;
};

type OperationsWorkResponse = {
  schemaVersion: number;
  asOf: string;
  generatedAt: string;
  items: OperationsQueueItem[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    mine: number;
    tasks: number;
    applications: number;
    documents: number;
    portal: number;
    offers: number;
  };
  meta: {
    limit: number;
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

function operationsWorkPath(input: {
  scope: "all" | "mine";
  search?: string;
  severity?: "all" | OperationsQueueItem["severity"];
  source?: "all" | OperationsQueueItem["source"];
  cursor?: string | null;
}): string {
  const params = new URLSearchParams({ scope: input.scope, limit: "50" });
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.severity && input.severity !== "all")
    params.set("severity", input.severity);
  if (input.source && input.source !== "all")
    params.set("source", input.source);
  if (input.cursor) params.set("cursor", input.cursor);
  return `/api/operations/work-items?${params.toString()}`;
}

const severityClass: Record<OperationsQueueItem["severity"], string> = {
  critical:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  high: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  medium:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
  low: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

const sourceClass: Record<OperationsQueueItem["source"], string> = {
  task: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  application: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  document:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  portal:
    "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  offer: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
};

const statusClass: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700",
  verified: "bg-emerald-100 text-emerald-700",
  accepted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  quarantined: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
  review_required: "bg-amber-100 text-amber-700",
  needs_review: "bg-amber-100 text-amber-700",
  scanning: "bg-blue-100 text-blue-700",
};

function safeDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function countBy<T>(rows: T[], read: (row: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows)
    result.set(read(row), (result.get(read(row)) ?? 0) + 1);
  return result;
}

function QueueTable({
  rows,
  empty,
  isAdmin,
  pendingAction,
  onTaskAction,
}: {
  rows: OperationsQueueItem[];
  empty: string;
  isAdmin: boolean;
  pendingAction: string | null;
  onTaskAction: (row: OperationsQueueItem, action: OperationsTaskAction) => void;
}) {
  const { lang: uiLanguage } = useUiLanguage();
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <CheckCircle2 className="mx-auto size-8 text-emerald-500" />
        <p className="mt-3 text-sm font-medium">{empty}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[1240px] text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-medium">{translateUi(uiLanguage, "Kimlik / kayıt")}</th>
            <th className="px-3 py-2.5 font-medium">{translateUi(uiLanguage, "Durum")}</th>
            <th className="px-3 py-2.5 font-medium">{translateUi(uiLanguage, "Sonraki aksiyon")}</th>
            <th className="px-3 py-2.5 font-medium">{translateUi(uiLanguage, "Sahip / kuyruk")}</th>
            <th className="px-3 py-2.5 font-medium">{translateUi(uiLanguage, "Tarih")}</th>
            <th className="px-3 py-2.5 font-medium">{translateUi(uiLanguage, "Risk / engel")}</th>
            <th className="px-3 py-2.5 font-medium">{translateUi(uiLanguage, "Son hareket")}</th>
            <th className="w-[190px] px-3 py-2.5 text-right">{translateUi(uiLanguage, "Aksiyon")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const taskId = taskIdFromQueueRow(row);
            return (
              <tr key={row.id} className="align-top hover:bg-muted/25">
                <td className="px-3 py-3">
                  <p className="max-w-[260px] font-medium">{row.identity}</p>
                  <div className="mt-1 flex gap-1.5">
                    <Badge
                      className={"border-0 text-[10px] " + sourceClass[row.source]}
                    >
                      {row.source}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={"text-[10px] " + severityClass[row.severity]}
                    >
                      {row.severity}
                    </Badge>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <Badge variant="outline">{row.state}</Badge>
                </td>
                <td className="max-w-[230px] px-3 py-3 font-medium">
                  {row.nextAction}
                </td>
                <td className="px-3 py-3">{row.owner}</td>
                <td className="whitespace-nowrap px-3 py-3 text-xs">
                  {safeDate(row.dueAt)}
                </td>
                <td className="max-w-[220px] px-3 py-3 text-xs text-muted-foreground">
                  {row.blocker}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                  {safeDate(row.lastActivityAt)}
                </td>
                <td className="px-3 py-3 text-right">
                  {canActOnTask(row, isAdmin) && (
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                        onClick={() => onTaskAction(row, "complete")}
                        disabled={pendingAction === row.id + ":complete"}
                        title={translateUi(uiLanguage, "Görevi tamamlandı olarak işaretle")}
                      >
                        <CheckCircle2 className="size-3.5" /> {translateUi(uiLanguage, "Tamamla")} </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 px-2 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                        onClick={() => onTaskAction(row, "snooze")}
                        disabled={pendingAction === row.id + ":snooze"}
                        title={translateUi(uiLanguage, "Görevi 3 gün ertele")}
                      >
                        <Clock3 className="size-3.5" /> {translateUi(uiLanguage, "+3 gün")} </Button>
                    </div>
                  )}
                  <a
                    href={taskId !== null ? "/staff/tasks?taskId=" + taskId : row.href}
                    aria-label={translateUi(uiLanguage, "Kaydı aç")}
                    className="inline-flex rounded-md p-2 text-primary hover:bg-primary/10"
                  >
                    <ArrowRight className="size-4" />
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OperationsCenter() {
  const { lang: uiLanguage } = useUiLanguage();
  const { user } = useAuth(true);
  const { lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tr = lang === "tr";
  const isAdmin = Boolean(user?.role && ADMIN_ROLES.includes(user.role));
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<
    "all" | OperationsQueueItem["severity"]
  >("all");
  const [source, setSource] = useState<"all" | OperationsQueueItem["source"]>(
    "all",
  );
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const work = useInfiniteQuery<OperationsWorkResponse>({
    queryKey: ["operations-center", "work-items", "mine"],
    queryFn: ({ pageParam }) =>
      customFetch(
        operationsWorkPath({
          scope: "mine",
          cursor: typeof pageParam === "string" ? pageParam : null,
        }),
      ),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    retry: false,
  });

  const exceptions = useInfiniteQuery<OperationsWorkResponse>({
    queryKey: [
      "operations-center",
      "work-items",
      "all",
      debouncedSearch,
      severity,
      source,
    ],
    queryFn: ({ pageParam }) =>
      customFetch(
        operationsWorkPath({
          scope: "all",
          search: debouncedSearch,
          severity,
          source,
          cursor: typeof pageParam === "string" ? pageParam : null,
        }),
      ),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    retry: false,
  });

  const applications = useQuery<ApplicationPipelineSummary>({
    queryKey: ["operations-center", "application-stage-summary"],
    queryFn: () =>
      customFetch(
        "/api/applications?pipelineSummary=1&includeFacets=0&includeTotals=0",
      ),
    retry: false,
  });
  const documents = useQuery<Document[]>({
    queryKey: ["operations-center", "documents"],
    queryFn: () => customFetch("/api/documents?limit=1000"),
    retry: false,
  });
  const stages = useQuery<{ stages: Stage[] }>({
    queryKey: ["operations-center", "stages"],
    queryFn: () => customFetch("/api/portal-automation/stage-options"),
    retry: false,
  });
  const offers = useQuery<{ data: OfferDeadline[] }>({
    queryKey: ["operations-center", "offers"],
    queryFn: () => customFetch("/api/applications/offer-letter-deadlines"),
    retry: false,
  });
  const portal = useQuery<PortalOperationsResponse>({
    queryKey: ["operations-center", "portal"],
    queryFn: () => customFetch("/api/portal-automation/operations"),
    enabled: isAdmin,
    retry: false,
  });
  const integrations = useQuery<{ data: Integration[] }>({
    queryKey: ["operations-center", "integrations"],
    queryFn: () => customFetch("/api/integrations"),
    enabled: isAdmin,
    retry: false,
  });

  const documentRows = documents.data ?? [];
  const stageRows = stages.data?.stages ?? [];
  const offerRows = offers.data?.data ?? [];
  const myRows = work.data?.pages.flatMap((page) => page.items) ?? [];
  const exceptionRows =
    exceptions.data?.pages.flatMap((page) => page.items) ?? [];
  const workSummary = exceptions.data?.pages[0]?.summary ?? {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    mine: 0,
    tasks: 0,
    applications: 0,
    documents: 0,
    portal: 0,
    offers: 0,
  };
  const documentStatusCounts = countBy(documentRows, (row) =>
    (row.status ?? "pending").toLowerCase(),
  );
  const stageCounts = new Map(
    (applications.data?.meta.stages ?? []).map((row) => [row.stage, row.total]),
  );
  const loading =
    work.isLoading ||
    exceptions.isLoading ||
    applications.isLoading ||
    documents.isLoading ||
    stages.isLoading ||
    offers.isLoading;
  const partialErrors = [
    work,
    exceptions,
    applications,
    documents,
    stages,
    offers,
    ...(isAdmin ? [portal, integrations] : []),
  ].filter((query) => query.isError).length;

  const refreshAll = () => {
    void work.refetch();
    void exceptions.refetch();
    void applications.refetch();
    void documents.refetch();
    void stages.refetch();
    void offers.refetch();
    if (isAdmin) {
      void portal.refetch();
      void integrations.refetch();
    }
  };

  async function recordTaskAction(
    row: OperationsQueueItem,
    action: OperationsTaskAction,
    taskId: number,
  ): Promise<void> {
    // Activity telemetry is best-effort and intentionally contains no student,
    // partner or task title data. The task endpoint remains the source of truth.
    try {
      await customFetch("/api/activity/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "operations.task_action",
          route:
            typeof window !== "undefined"
              ? window.location.pathname
              : "/staff/operations",
          metadata: {
            action,
            taskId,
            reasonCode: row.reasonCode,
            source: row.source,
          },
        }),
      });
    } catch {
      // A telemetry outage must never turn a successful task action into an
      // apparent failure or cause the user to repeat a mutation.
    }
  }

  async function handleTaskAction(
    row: OperationsQueueItem,
    action: OperationsTaskAction,
  ): Promise<void> {
    if (!canActOnTask(row, isAdmin)) return;
    const taskId = taskIdFromQueueRow(row);
    if (taskId === null) return;
    if (
      action === "complete" &&
      !window.confirm(
        tr
          ? "Bu görevi tamamlandı olarak işaretlemek istiyor musunuz?"
          : "Mark this task as completed?",
      )
    ) {
      return;
    }
    const key = row.id + ":" + action;
    setPendingAction(key);
    try {
      const snoozedDueDate = addDaysToDueDate(row.dueAt, 3);
      if (action === "snooze" && !snoozedDueDate) {
        toast({
          title: tr ? translateUi(uiLanguage, "Görev ertelenemedi") : translateUi(uiLanguage, "Task could not be snoozed"),
          description: tr ? translateUi(uiLanguage, "Geçerli bir tarih bulunamadı.") : translateUi(uiLanguage, "No valid due date was found."),
          variant: "destructive",
        });
        return;
      }
      const body: Record<string, string> =
        action === "complete"
          ? { status: "done" }
          : { dueDate: snoozedDueDate as string };
      await customFetch("/api/tasks/" + taskId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      void recordTaskAction(row, action, taskId);
      toast({
        title:
          action === "complete"
            ? tr
              ? translateUi(uiLanguage, "Görev tamamlandı")
              : translateUi(uiLanguage, "Task completed")
            : tr
              ? translateUi(uiLanguage, "Görev 3 gün ertelendi")
              : translateUi(uiLanguage, "Task snoozed for 3 days"),
      });
      await queryClient.invalidateQueries({
        queryKey: ["operations-center", "work-items"],
      });
    } catch (error) {
      const description =
        error instanceof Error ? error.message : tr ? "İşlem başarısız." : "Action failed.";
      toast({
        title: tr ? translateUi(uiLanguage, "Görev güncellenemedi") : translateUi(uiLanguage, "Task was not updated"),
        description,
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  }

  if (loading && myRows.length === 0 && exceptionRows.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {tr ? translateUi(uiLanguage, "İş & İstisna Merkezi") : translateUi(uiLanguage, "Work & Exception Center")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {tr
              ? translateUi(uiLanguage, "Görev, başvuru, belge, offer ve portal sinyallerini mevcut yetki sınırları içinde tek öncelikli iş kuyruğunda birleştirir.")
              : translateUi(uiLanguage, "Combines tasks, applications, evidence, offers and portal signals into one prioritized queue within existing access boundaries.")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refreshAll}
          className="gap-2"
          disabled={loading}
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          {tr ? translateUi(uiLanguage, "Yenile") : translateUi(uiLanguage, "Refresh")}
        </Button>
      </div>

      {partialErrors > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {tr
              ? `${partialErrors} veri kaynağı yüklenemedi; görünüm yalnız doğrulanabilen kaynakları gösteriyor.`
              : `${partialErrors} data source(s) failed; this view shows only successfully loaded sources.`}
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: tr ? "Kritik" : "Critical",
            value: workSummary.critical,
            icon: AlertTriangle,
            tone: "text-red-600 bg-red-500/10",
          },
          {
            label: tr ? "Yüksek" : "High",
            value: workSummary.high,
            icon: Clock3,
            tone: "text-amber-600 bg-amber-500/10",
          },
          {
            label: tr ? "Benim işlerim" : "My work",
            value: workSummary.mine,
            icon: UserRoundCheck,
            tone: "text-blue-600 bg-blue-500/10",
          },
          {
            label: tr ? "Belge inceleme" : "Evidence review",
            value: workSummary.documents,
            icon: FileCheck2,
            tone: "text-emerald-600 bg-emerald-500/10",
          },
          {
            label: tr ? "Portal istisnası" : "Portal exceptions",
            value: workSummary.portal,
            icon: Bot,
            tone: "text-orange-600 bg-orange-500/10",
          },
        ].map(({ label, value, icon: Icon, tone }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {value}
                </p>
              </div>
              <div className={`rounded-xl p-2.5 ${tone}`}>
                <Icon className="size-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="work" className="space-y-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl bg-muted/60 p-1">
          <TabsTrigger value="work">{tr ? translateUi(uiLanguage, "İşim") : translateUi(uiLanguage, "My Work")}</TabsTrigger>
          <TabsTrigger value="exceptions">
            {tr ? translateUi(uiLanguage, "İstisnalar") : translateUi(uiLanguage, "Exceptions")}
          </TabsTrigger>
          <TabsTrigger value="evidence">
            {tr ? translateUi(uiLanguage, "Belge Merkezi") : translateUi(uiLanguage, "Evidence Center")}
          </TabsTrigger>
          <TabsTrigger value="integrations">
            {tr ? translateUi(uiLanguage, "Entegrasyonlar") : translateUi(uiLanguage, "Integrations")}
          </TabsTrigger>
          <TabsTrigger value="journey">
            {tr ? translateUi(uiLanguage, "Offer / Vize / Kayıt") : translateUi(uiLanguage, "Offer / Visa / Enrolment")}
          </TabsTrigger>
          <TabsTrigger value="communication">
            {tr ? translateUi(uiLanguage, "İletişim & Onay") : translateUi(uiLanguage, "Communication & Consent")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="work" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {tr ? translateUi(uiLanguage, "Birleşik iş kuyruğum") : translateUi(uiLanguage, "Unified My Work")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <QueueTable
                rows={myRows}
                isAdmin={isAdmin}
                pendingAction={pendingAction}
                onTaskAction={(row, action) => void handleTaskAction(row, action)}
                empty={
                  tr
                    ? "Şu anda size atanmış acil bir iş yok."
                    : "There is no urgent work assigned to you."
                }
              />
              {work.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => void work.fetchNextPage()}
                    disabled={work.isFetchingNextPage}
                  >
                    {work.isFetchingNextPage
                      ? tr
                        ? translateUi(uiLanguage, "Yükleniyor…")
                        : translateUi(uiLanguage, "Loading…")
                      : tr
                        ? translateUi(uiLanguage, "Daha fazla iş yükle")
                        : translateUi(uiLanguage, "Load more work")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exceptions" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-base">
                    {tr
                      ? translateUi(uiLanguage, "Case Orchestration & Exception Center")
                      : translateUi(uiLanguage, "Case Orchestration & Exception Center")}
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tr
                      ? translateUi(uiLanguage, "Öncelik açıklanabilir kurallarla hesaplanır; bu ekran iş akışı durumunu kendiliğinden değiştirmez.")
                      : translateUi(uiLanguage, "Priority is calculated with explainable rules; this view never mutates workflow state by itself.")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={tr ? "Kuyrukta ara" : "Search queue"}
                      className="w-[220px] pl-8"
                    />
                  </div>
                  <select
                    value={severity}
                    onChange={(event) =>
                      setSeverity(event.target.value as typeof severity)
                    }
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="all">
                      {tr ? translateUi(uiLanguage, "Tüm önemler") : translateUi(uiLanguage, "All severities")}
                    </option>
                    <option value="critical">{translateUi(uiLanguage, "Critical")}</option>
                    <option value="high">{translateUi(uiLanguage, "High")}</option>
                    <option value="medium">{translateUi(uiLanguage, "Medium")}</option>
                    <option value="low">{translateUi(uiLanguage, "Low")}</option>
                  </select>
                  <select
                    value={source}
                    onChange={(event) =>
                      setSource(event.target.value as typeof source)
                    }
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="all">
                      {tr ? translateUi(uiLanguage, "Tüm kaynaklar") : translateUi(uiLanguage, "All sources")}
                    </option>
                    <option value="application">{translateUi(uiLanguage, "Application")}</option>
                    <option value="task">{translateUi(uiLanguage, "Task")}</option>
                    <option value="document">{translateUi(uiLanguage, "Document")}</option>
                    <option value="portal">{translateUi(uiLanguage, "Portal")}</option>
                    <option value="offer">{translateUi(uiLanguage, "Offer")}</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <QueueTable
                rows={exceptionRows}
                isAdmin={isAdmin}
                pendingAction={pendingAction}
                onTaskAction={(row, action) => void handleTaskAction(row, action)}
                empty={
                  tr
                    ? "Seçili filtrelerde açık istisna yok."
                    : "No open exceptions match these filters."
                }
              />
              <div className="mt-4 flex flex-col items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {tr
                    ? `${exceptionRows.length} / ${exceptions.data?.pages[0]?.meta.total ?? 0} kayıt gösteriliyor`
                    : `${exceptionRows.length} of ${exceptions.data?.pages[0]?.meta.total ?? 0} records shown`}
                </span>
                {exceptions.hasNextPage && (
                  <Button
                    variant="outline"
                    onClick={() => void exceptions.fetchNextPage()}
                    disabled={exceptions.isFetchingNextPage}
                  >
                    {exceptions.isFetchingNextPage
                      ? tr
                        ? translateUi(uiLanguage, "Yükleniyor…")
                        : translateUi(uiLanguage, "Loading…")
                      : tr
                        ? translateUi(uiLanguage, "Daha fazla istisna yükle")
                        : translateUi(uiLanguage, "Load more exceptions")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evidence" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {["pending", "review_required", "verified", "rejected"].map(
              (key) => (
                <Card key={key}>
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {key.replaceAll("_", " ")}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {documentStatusCounts.get(key) ?? 0}
                    </p>
                  </CardContent>
                </Card>
              ),
            )}
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck2 className="size-4 text-primary" />
                {tr
                  ? translateUi(uiLanguage, "Evidence & Document Center")
                  : translateUi(uiLanguage, "Evidence & Document Center")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {tr
                  ? translateUi(uiLanguage, "Gerçek belge kayıtlarının doğrulama durumunu ve bağlı case'i gösterir; dosya içeriğini bu listeye taşımaz.")
                  : translateUi(uiLanguage, "Shows verification state and linked case for real document records without bringing file contents into this list.")}
              </p>
            </CardHeader>
            <CardContent>
              {documentRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {tr ? translateUi(uiLanguage, "Görüntülenebilir belge yok.") : translateUi(uiLanguage, "No visible documents.")}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2.5">
                          {tr ? translateUi(uiLanguage, "Belge") : translateUi(uiLanguage, "Document")}
                        </th>
                        <th className="px-3 py-2.5">
                          {tr ? translateUi(uiLanguage, "Durum") : translateUi(uiLanguage, "Status")}
                        </th>
                        <th className="px-3 py-2.5">{translateUi(uiLanguage, "Case")}</th>
                        <th className="px-3 py-2.5">
                          {tr ? translateUi(uiLanguage, "Güncellendi") : translateUi(uiLanguage, "Updated")}
                        </th>
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {documentRows.slice(0, 100).map((document) => (
                        <tr key={document.id}>
                          <td className="px-3 py-3">
                            <p className="font-medium">
                              {document.name ||
                                document.type ||
                                `#${document.id}`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {document.type || "—"}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <Badge
                              className={`border-0 ${statusClass[(document.status ?? "pending").toLowerCase()] ?? "bg-slate-100 text-slate-700"}`}
                            >
                              {document.status || "pending"}
                            </Badge>
                          </td>
                          <td className="px-3 py-3">
                            {document.applicationId
                              ? `Application #${document.applicationId}`
                              : document.studentId
                                ? `Student #${document.studentId}`
                                : "—"}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">
                            {safeDate(document.updatedAt ?? document.createdAt)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {(document.applicationId || document.studentId) && (
                              <a
                                href={
                                  document.applicationId
                                    ? `/staff/applications/${document.applicationId}`
                                    : `/staff/students/${document.studentId}`
                                }
                                className="text-primary"
                              >
                                <ArrowRight className="size-4" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4">
          {!isAdmin ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {tr
                  ? translateUi(uiLanguage, "Entegrasyon sağlık görünümü yönetici yetkisi gerektirir.")
                  : translateUi(uiLanguage, "Integration health requires administrator access.")}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">
                      {tr ? translateUi(uiLanguage, "İzlenen portal işi") : translateUi(uiLanguage, "Tracked portal work")}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {Number(portal.data?.summary.tracked ?? 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">
                      {tr ? translateUi(uiLanguage, "Kontrol zamanı gelen") : translateUi(uiLanguage, "Due for check")}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {Number(portal.data?.summary.due ?? 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">
                      {tr ? translateUi(uiLanguage, "Askıya alınan") : translateUi(uiLanguage, "Suspended")}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {Number(portal.data?.summary.suspended ?? 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">
                      {tr ? translateUi(uiLanguage, "Onay bekleyen") : translateUi(uiLanguage, "Pending review")}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {Number(portal.data?.summary.pendingReviews ?? 0)}
                    </p>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Link2 className="size-4 text-primary" />
                    {tr
                      ? translateUi(uiLanguage, "Integration Control Tower")
                      : translateUi(uiLanguage, "Integration Control Tower")}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {tr
                      ? translateUi(uiLanguage, "Etkinlik durumu sağlık kanıtı değildir. Sonuç kaydı olmayan bağlantı 'doğrulanmadı' olarak gösterilir.")
                      : translateUi(uiLanguage, "Enabled does not mean healthy. Connections without a recorded real test remain unverified.")}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2.5">
                            {tr ? translateUi(uiLanguage, "Bağlantı") : translateUi(uiLanguage, "Connection")}
                          </th>
                          <th className="px-3 py-2.5">
                            {tr ? translateUi(uiLanguage, "Kategori") : translateUi(uiLanguage, "Category")}
                          </th>
                          <th className="px-3 py-2.5">{translateUi(uiLanguage, "Config")}</th>
                          <th className="px-3 py-2.5">{translateUi(uiLanguage, "Health")}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(integrations.data?.data ?? []).map((integration) => (
                          <tr key={integration.id}>
                            <td className="px-3 py-3">
                              <p className="font-medium">{integration.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {integration.key}
                              </p>
                            </td>
                            <td className="px-3 py-3">
                              {integration.category}
                            </td>
                            <td className="px-3 py-3">
                              <Badge
                                variant={
                                  integration.isEnabled
                                    ? "default"
                                    : "secondary"
                                }
                              >
                                {integration.isEnabled
                                  ? tr
                                    ? translateUi(uiLanguage, "Etkin")
                                    : translateUi(uiLanguage, "Enabled")
                                  : tr
                                    ? translateUi(uiLanguage, "Kapalı")
                                    : translateUi(uiLanguage, "Disabled")}
                              </Badge>
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant="outline">
                                {tr ? translateUi(uiLanguage, "Doğrulanmadı") : translateUi(uiLanguage, "Unverified")}
                              </Badge>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <a
                                href="/admin/settings"
                                className="text-primary"
                              >
                                <ArrowRight className="size-4" />
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {tr ? translateUi(uiLanguage, "İzole portal sıraları") : translateUi(uiLanguage, "Isolated portal lanes")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(portal.data?.lanes ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {tr ? translateUi(uiLanguage, "Aktif sıra yok.") : translateUi(uiLanguage, "No active lanes.")}
                    </p>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {portal.data!.lanes.map((lane) => (
                        <div
                          key={lane.laneKey}
                          className="rounded-xl border p-3"
                        >
                          <div className="flex items-center justify-between">
                            <p className="font-medium">{lane.universityKey}</p>
                            {Number(lane.suspended) > 0 && (
                              <Badge variant="destructive">
                                {lane.suspended} {translateUi(uiLanguage, "suspended")} </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {lane.adapterKey} · {lane.due} {translateUi(uiLanguage, "due ·")} {lane.retrying}{" "} {translateUi(uiLanguage, "retrying")} </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="journey" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="size-4 text-primary" />
                {tr
                  ? translateUi(uiLanguage, "Offer, Visa & Enrolment Journey")
                  : translateUi(uiLanguage, "Offer, Visa & Enrolment Journey")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {tr
                  ? translateUi(uiLanguage, "Mevcut dinamik application stage'lerini ve offer kanıtlarını aynı case yolculuğunda görünür kılar. State değişikliği yine kanıtlı akış üzerinden yapılır.")
                  : translateUi(uiLanguage, "Projects dynamic application stages and offer evidence into one case journey. State changes still use the evidence-bound workflow.")}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {stageRows.map((stage) => (
                  <div key={stage.key} className="rounded-xl border p-3">
                    <p className="text-sm font-medium">{stage.label}</p>
                    <p className="mt-2 text-2xl font-semibold">
                      {stageCounts.get(stage.key) ?? 0}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {stage.isCaseClose
                        ? tr
                          ? translateUi(uiLanguage, "Kapanış durumu")
                          : translateUi(uiLanguage, "Closing state")
                        : stage.key}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {tr ? translateUi(uiLanguage, "Offer son tarihleri") : translateUi(uiLanguage, "Offer deadlines")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {offerRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {tr
                    ? translateUi(uiLanguage, "Yaklaşan offer son tarihi yok.")
                    : translateUi(uiLanguage, "No upcoming offer deadline.")}
                </p>
              ) : (
                <div className="space-y-2">
                  {offerRows.slice(0, 50).map((offer) => (
                    <a
                      key={offer.docId}
                      href={`/staff/applications/${offer.applicationId}`}
                      className="flex items-center justify-between rounded-xl border p-3 hover:bg-muted/40"
                    >
                      <div>
                        <p className="font-medium">
                          {offer.universityName ||
                            `Application #${offer.applicationId}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {offer.programName || "—"}
                        </p>
                      </div>
                      <Badge
                        variant={
                          (offer.daysLeft ?? 999) <= 7
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {offer.daysLeft == null
                          ? "—"
                          : `${offer.daysLeft} days`}
                      </Badge>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communication" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="size-4 text-primary" />
                {tr
                  ? translateUi(uiLanguage, "Communication, Consent & Guardian/Sponsor")
                  : translateUi(uiLanguage, "Communication, Consent & Guardian/Sponsor")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {tr
                  ? translateUi(uiLanguage, "Mevcut inbox ve bildirim altyapısını kullanır; onay, tercih ve temsil yetkisi birbirinin yerine geçmez.")
                  : translateUi(uiLanguage, "Uses the existing inbox and notification foundation; consent, preference and relationship authority remain separate.")}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <a
                  href="/staff/messages"
                  className="rounded-xl border p-4 hover:bg-muted/40"
                >
                  <Inbox className="size-5 text-primary" />
                  <p className="mt-3 font-medium">
                    {tr ? translateUi(uiLanguage, "Birleşik Inbox") : translateUi(uiLanguage, "Unified Inbox")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground"> {translateUi(uiLanguage, "WhatsApp, Messenger, Instagram")} </p>
                </a>
                <a
                  href="/admin/settings"
                  className="rounded-xl border p-4 hover:bg-muted/40"
                >
                  <ShieldCheck className="size-5 text-primary" />
                  <p className="mt-3 font-medium">
                    {tr ? translateUi(uiLanguage, "İletişim tercihleri") : translateUi(uiLanguage, "Communication preferences")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tr
                      ? translateUi(uiLanguage, "Kanal ve kategori bazlı kontrol")
                      : translateUi(uiLanguage, "Channel and category controls")}
                  </p>
                </a>
                <div className="rounded-xl border p-4">
                  <Users className="size-5 text-primary" />
                  <p className="mt-3 font-medium">{translateUi(uiLanguage, "Guardian / Sponsor")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tr
                      ? translateUi(uiLanguage, "Purpose-limited ilişki ve paylaşım kapsamı foundation üzerinde; mutating UI henüz kapalı.")
                      : translateUi(uiLanguage, "Purpose-limited relationship foundation exists; mutating UI remains closed.")}
                  </p>
                </div>
                <div className="rounded-xl border p-4">
                  <ListChecks className="size-5 text-primary" />
                  <p className="mt-3 font-medium">
                    {tr ? translateUi(uiLanguage, "Karar izi") : translateUi(uiLanguage, "Decision receipt")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tr
                      ? translateUi(uiLanguage, "Gönderim öncesi consent, suppression ve quiet-hours değerlendirmesi.")
                      : translateUi(uiLanguage, "Consent, suppression and quiet-hours evaluation before sending.")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            <FileWarning className="mr-2 inline size-4" />
            {tr
              ? translateUi(uiLanguage, "Bu dilim consent veya guardian yetkisi üretmez; yalnız mevcut güvenli altyapıyı doğru operasyon alanına bağlar. Yazma akışları ayrı maker-checker ve hukuk kapısından geçecek.")
              : translateUi(uiLanguage, "This slice does not mint consent or guardian authority; it only places the existing safe foundation in the right workspace. Write flows remain behind maker-checker and legal gates.")}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
