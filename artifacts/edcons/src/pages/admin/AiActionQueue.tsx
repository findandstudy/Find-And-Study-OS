import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Loader2, ListChecks, ShieldAlert, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";

type PortalDiagnosis = {
  classification?: string;
  confidence?: number;
  risk?: string;
  retrySafe?: boolean;
  requiresCodeChange?: boolean;
  summary?: string;
  evidence?: string[];
  recommendedAction?: string;
  missingDataFields?: string[];
  selectorCandidates?: unknown[];
  proposedSpecPatch?: unknown[];
};

type ActionItem = {
  id: number;
  personaId: number;
  personaName: string | null;
  runId: number | null;
  actionType: string;
  payload: {
    context?: {
      submissionId?: number;
      universityKey?: string;
      adapterKey?: string;
      reviewOnly?: boolean;
    };
    diagnosis?: PortalDiagnosis;
    structuredOutputValid?: boolean;
  } | null;
  preview: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewerEmail: string | null;
};

export default function AiActionQueue() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const load = async () => {
    try {
      const data = await customFetch<{ actions: ActionItem[] }>(
        "/api/ai-personas/queue/actions",
      );
      setItems(data.actions);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const review = async (id: number, decision: "approved" | "rejected") => {
    setReviewingId(id);
    try {
      await customFetch(`/api/ai-personas/queue/actions/${id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      toast({
        title:
          decision === "approved"
            ? t("aiActionQueue.approvedToast")
            : t("aiActionQueue.rejectedToast"),
        description: t("aiActionQueue.reviewOnlyNotice"),
      });
      await load();
    } catch (error) {
      toast({
        title: t("aiActionQueue.reviewError"),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setReviewingId(null);
    }
  };

  const pending = items.filter((i) => i.status === "pending_approval");
  const history = items.filter((i) => i.status !== "pending_approval");

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ListChecks className="h-6 w-6 text-indigo-500" /> {t("aiActionQueue.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("aiActionQueue.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("aiActionQueue.pendingTitle", { count: pending.length })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <div className="text-sm text-muted-foreground">{t("aiActionQueue.loading")}</div>}
          {!loading && pending.length === 0 && (
            <div className="text-sm text-muted-foreground">{t("aiActionQueue.noPending")}</div>
          )}
          {pending.map((a) => (
            <div key={a.id} className="border rounded p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">{a.actionType}</Badge>
                  <span className="text-muted-foreground">
                    {a.personaName ?? t("aiActionQueue.personaShort", { id: a.personaId })} · {t("aiActionQueue.runShort", { id: a.runId ?? "—" })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reviewingId === a.id}
                    onClick={() => void review(a.id, "rejected")}
                  >
                    {reviewingId === a.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <X className="h-3.5 w-3.5" />}
                    {t("aiActionQueue.reject")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={reviewingId === a.id}
                    onClick={() => void review(a.id, "approved")}
                  >
                    {reviewingId === a.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Check className="h-3.5 w-3.5" />}
                    {t("aiActionQueue.approve")}
                  </Button>
                </div>
              </div>
              {a.actionType === "portal_fix_proposal" && a.payload?.diagnosis ? (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/20 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-indigo-600" />
                    <Badge variant="secondary">{a.payload.diagnosis.classification}</Badge>
                    <Badge variant="outline">
                      {t("aiActionQueue.riskLabel")}: {a.payload.diagnosis.risk}
                    </Badge>
                    <Badge variant="outline">
                      {t("aiActionQueue.confidenceLabel")}:{" "}
                      {Math.round((a.payload.diagnosis.confidence ?? 0) * 100)}%
                    </Badge>
                    {a.payload.context?.submissionId && (
                      <a
                        href="/admin/portal-automation"
                        className="text-xs text-primary hover:underline"
                      >
                        {t("aiActionQueue.submissionShort", {
                          id: a.payload.context.submissionId,
                        })}
                      </a>
                    )}
                  </div>
                  <p className="text-sm">{a.payload.diagnosis.summary}</p>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {t("aiActionQueue.recommendedAction")}:
                    </span>{" "}
                    {a.payload.diagnosis.recommendedAction}
                  </div>
                  {(a.payload.diagnosis.evidence?.length ||
                    a.payload.diagnosis.selectorCandidates?.length ||
                    a.payload.diagnosis.proposedSpecPatch?.length) && (
                    <details className="rounded border bg-background/70 p-2 text-xs">
                      <summary className="cursor-pointer font-medium">
                        {t("aiActionQueue.technicalDetails")}
                      </summary>
                      <div className="mt-2 space-y-2">
                        {!!a.payload.diagnosis.evidence?.length && (
                          <ul className="list-disc space-y-1 pl-5">
                            {a.payload.diagnosis.evidence.map((item, index) => (
                              <li key={`${a.id}-evidence-${index}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                        {!!a.payload.diagnosis.selectorCandidates?.length && (
                          <pre className="max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">
                            {JSON.stringify(
                              a.payload.diagnosis.selectorCandidates,
                              null,
                              2,
                            )}
                          </pre>
                        )}
                        {!!a.payload.diagnosis.proposedSpecPatch?.length && (
                          <pre className="max-h-64 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">
                            {JSON.stringify(
                              a.payload.diagnosis.proposedSpecPatch,
                              null,
                              2,
                            )}
                          </pre>
                        )}
                      </div>
                    </details>
                  )}
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    {t("aiActionQueue.reviewOnlyNotice")}
                  </div>
                </div>
              ) : a.preview ? (
                <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap max-h-48 overflow-auto">
                  {a.preview}
                </pre>
              ) : null}
              <div className="text-xs text-muted-foreground">
                {new Date(a.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("aiActionQueue.historyTitle", { count: history.length })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 && (
            <div className="text-sm text-muted-foreground">{t("aiActionQueue.noHistory")}</div>
          )}
          {history.map((a) => (
            <div
              key={a.id}
              className="border rounded p-2 text-sm flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{a.status}</Badge>
                <span>{a.actionType}</span>
                <span className="text-muted-foreground">
                  · {a.personaName ?? `#${a.personaId}`}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {a.reviewerEmail ?? ""} {a.reviewedAt ? new Date(a.reviewedAt).toLocaleString() : ""}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
