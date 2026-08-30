import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { CalendarClock, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/hooks/use-i18n";

interface FollowUpRow {
  id: number;
  leadId?: number | null;
  studentId?: number | null;
  title: string;
  scheduledAt: string;
  leadName?: string | null;
}

export function UpcomingFollowUpsWidget({ detailHrefPrefix }: { detailHrefPrefix: string }) {
  const { t, lang } = useI18n();
  const { data = [], isLoading } = useQuery<FollowUpRow[]>({
    queryKey: ["/api/follow-ups/upcoming", detailHrefPrefix],
    queryFn: () => customFetch("/api/follow-ups/upcoming"),
    staleTime: 30_000,
  });
  const now = Date.now();

  return (
    <Card className="p-5 border-none shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <CalendarClock className="w-4 h-4 text-blue-600" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">{t("staffDash.upcomingFollowUps")}</h3>
          <p className="text-xs text-muted-foreground">{t("followUps.ranges.next7")}</p>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-4 text-center">{t("common.loading")}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">{t("staffDash.noFollowUps")}</p>
      ) : (
        <div className="space-y-2 max-h-[320px] overflow-y-auto">
          {data.slice(0, 8).map((followUp) => {
            const href = followUp.leadId
              ? `${detailHrefPrefix}/leads/${followUp.leadId}`
              : followUp.studentId
                ? `${detailHrefPrefix}/students/${followUp.studentId}`
                : null;
            const overdue = new Date(followUp.scheduledAt).getTime() < now;
            const content = (
              <div className={`p-3 rounded-xl border transition-colors ${overdue ? "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20" : "border-border hover:bg-secondary/50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground line-clamp-1">{followUp.title}</p>
                  {href && <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />}
                </div>
                {followUp.leadName && <p className="text-xs text-primary mt-0.5 truncate">{followUp.leadName}</p>}
                <p className={`text-xs mt-1 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                  {new Date(followUp.scheduledAt).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" })}
                  {overdue ? ` — ${t("common.overdue")}` : ""}
                </p>
              </div>
            );
            return href ? <Link key={followUp.id} href={href}>{content}</Link> : <div key={followUp.id}>{content}</div>;
          })}
        </div>
      )}
    </Card>
  );
}
