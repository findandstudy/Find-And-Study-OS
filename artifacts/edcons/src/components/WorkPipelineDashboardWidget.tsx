import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarClock, MessageSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { request, type FollowUp } from "@/pages/staff/useWorkPipelines";

type Item<T> = {
  item: T;
  boardId: string;
  cardId: string;
  boardName: string;
  cardTitle: string;
};
export function WorkPipelineDashboardWidget() {
  const { user } = useAuth();
  const { lang, t, isRTL } = useI18n();

  const feature = useQuery({
    queryKey: ["work-pipeline-feature", user?.id],
    queryFn: () => request<{ enabled: boolean }>("/feature"),
    retry: false,
  });
  const q = useQuery({
    queryKey: ["work-pipeline-dashboard", user?.id],
    queryFn: () =>
      request<{
        followUps: Item<FollowUp>[];
        notes: Item<{ id: string; text: string; by: number; at: string }>[];
      }>("/dashboard"),
    enabled: feature.data?.enabled === true,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  if (!feature.data?.enabled || q.isPending) return null;
  // Activity belongs on the dashboard, but empty pipelines must not add empty panels.
  if (q.isSuccess && !q.data.followUps.length && !q.data.notes.length) return null;
  const href = (r: Item<unknown>) =>
    `/staff/pipelines?pipeline=${r.boardId}&card=${r.cardId}`;
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display font-bold text-lg">
          {t("workPipelines.pipelineFollowupsAndNotes")}
        </h2>
        <Link
          href="/staff/pipelines"
          className="text-sm text-primary hover:underline"
        >
          {t("workPipelines.openPipelines")}
        </Link>
      </div>
      {q.isPending ? (
        <p role="status">{t("workPipelines.loading")}</p>
      ) : q.isError ? (
        <div role="alert">
          <p>{t("workPipelines.pipelineActivityCouldNotBe")}</p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("workPipelines.retry")}
          </Button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 font-semibold text-sm">
              <CalendarClock className="w-4 h-4" />
              {t("workPipelines.upcomingAndOverdueFollowups")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("workPipelines.assignedToYouOrCreated")}
            </p>
            {!q.data.followUps.length && (
              <p className="text-sm text-muted-foreground">
                {t("workPipelines.noScheduledFollowups")}
              </p>
            )}
            <div className="max-h-64 overflow-y-auto space-y-2">
              {q.data.followUps.map((r) => (
                <Link
                  key={r.item.id}
                  href={href(r)}
                  className={`block rounded-xl border p-3 hover:bg-secondary/50 ${Date.parse(r.item.scheduledAt) < Date.now() ? "border-red-500/30 bg-red-500/5" : ""}`}
                >
                  <p className="font-medium text-sm">{r.item.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.boardName} · {r.cardTitle}
                  </p>
                  <p className="text-xs mt-1">
                    {new Date(r.item.scheduledAt).toLocaleString(lang)}
                  </p>
                </Link>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 font-semibold text-sm">
              <MessageSquare className="w-4 h-4" />
              {t("workPipelines.recentNotes")}
            </h3>
            {!q.data.notes.length && (
              <p className="text-sm text-muted-foreground">
                {t("workPipelines.noNotesYet")}
              </p>
            )}
            <div className="max-h-64 overflow-y-auto space-y-2">
              {q.data.notes.map((r) => (
                <Link
                  key={r.item.id}
                  href={href(r)}
                  className="block rounded-xl border p-3 hover:bg-secondary/50"
                >
                  <p className="text-xs text-muted-foreground truncate">
                    {r.boardName} · {r.cardTitle}
                  </p>
                  <p className="text-sm whitespace-pre-wrap line-clamp-3 mt-1">
                    {r.item.text}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(r.item.at).toLocaleString(lang)}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
